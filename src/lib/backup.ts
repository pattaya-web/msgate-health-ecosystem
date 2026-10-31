import { copyFile, mkdir, readdir, readFile, rename, stat, utimes, writeFile } from "fs/promises";
import path from "path";

/**
 * La copie de secours, hors du disque de travail.
 *
 * Le Drive, les médias et les données du Studio IA et la bibliothèque des
 * Creatives vivent sur ce PC seulement. Toutes les 15 minutes (et à la
 * demande), on les recopie dans BACKUP_DIR — un dossier OneDrive, qui part
 * ensuite tout seul dans le cloud. La copie est incrémentale (seuls les
 * fichiers nouveaux ou modifiés sont recopiés) et n'efface jamais rien : un
 * fichier supprimé dans l'outil reste dans la sauvegarde.
 *
 * Sans BACKUP_DIR, rien ne se passe : le serveur de dev ne sauvegarde pas ses
 * données de test.
 */

const CWD = process.cwd();
const STATUS_FILE = path.join(CWD, ".msgate-cache", "backup-status.json");
const INTERVAL_MS = 15 * 60 * 1000;

const SOURCES = [
  { label: "Drive", src: path.join(CWD, ".msgate-cache", "drive"), dest: "Drive" },
  { label: "Studio IA · médias", src: path.join(CWD, "data", "media"), dest: "Studio IA/media" },
  { label: "Studio IA · données", src: path.join(CWD, "data", "db.json"), dest: "Studio IA/db.json" },
  { label: "Creatives", src: path.join(CWD, ".msgate-cache", "studio-static"), dest: "Creatives" },
];

export type BackupStatus = {
  configured: boolean;
  target: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  copied: number;
  checked: number;
  bytes: number;
  error: string | null;
};

const state = ((globalThis as typeof globalThis & { __msgateBackup?: { status: BackupStatus | null; timer: NodeJS.Timeout | null; running: Promise<BackupStatus> | null } }).__msgateBackup ??= {
  status: null,
  timer: null,
  running: null,
});

export function backupTarget() {
  const dir = process.env.BACKUP_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

async function loadStatus(): Promise<BackupStatus> {
  if (state.status) return state.status;
  const base: BackupStatus = { configured: Boolean(backupTarget()), target: backupTarget(), running: false, lastRunAt: null, lastSuccessAt: null, copied: 0, checked: 0, bytes: 0, error: null };
  try {
    state.status = { ...base, ...(JSON.parse(await readFile(STATUS_FILE, "utf8")) as Partial<BackupStatus>), configured: base.configured, target: base.target, running: false };
  } catch {
    state.status = base;
  }
  return state.status;
}

async function saveStatus(status: BackupStatus) {
  state.status = status;
  try {
    await mkdir(path.dirname(STATUS_FILE), { recursive: true });
    const tmp = `${STATUS_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(status, null, 2));
    await rename(tmp, STATUS_FILE);
  } catch {
    // le statut en mémoire suffit
  }
}

/** Recopie un fichier s'il manque ou a changé (taille ou date) ; renvoie les octets copiés. */
async function syncFile(src: string, dest: string, counters: { copied: number; checked: number; bytes: number }) {
  counters.checked += 1;
  const info = await stat(src);
  const existing = await stat(dest).catch(() => null);
  if (existing && existing.size === info.size && Math.abs(existing.mtimeMs - info.mtimeMs) < 2000) return;
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
  await utimes(dest, info.atime, info.mtime).catch(() => undefined);
  counters.copied += 1;
  counters.bytes += info.size;
}

async function syncTree(src: string, dest: string, counters: { copied: number; checked: number; bytes: number }) {
  const info = await stat(src).catch(() => null);
  if (!info) return;
  if (info.isFile()) {
    await syncFile(src, dest, counters);
    return;
  }
  for (const entry of await readdir(src, { withFileTypes: true })) {
    // Fichiers temporaires d'écriture : jamais dans la sauvegarde.
    if (entry.name.endsWith(".tmp")) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await syncTree(from, to, counters);
    else if (entry.isFile()) await syncFile(from, to, counters).catch(() => undefined);
  }
}

/** Lance une sauvegarde (ou rejoint celle qui tourne). */
export function runBackup(): Promise<BackupStatus> {
  if (state.running) return state.running;
  state.running = (async () => {
    const status = await loadStatus();
    const target = backupTarget();
    if (!target) return { ...status, configured: false, target: null };
    const started = { ...status, configured: true, target, running: true, lastRunAt: new Date().toISOString(), error: null };
    state.status = started;
    const counters = { copied: 0, checked: 0, bytes: 0 };
    try {
      await mkdir(target, { recursive: true });
      for (const source of SOURCES) await syncTree(source.src, path.join(target, source.dest), counters);
      const done = { ...started, running: false, lastSuccessAt: new Date().toISOString(), ...counters };
      await saveStatus(done);
      return done;
    } catch (error) {
      const failed = { ...started, running: false, ...counters, error: error instanceof Error ? error.message : "Sauvegarde impossible" };
      await saveStatus(failed);
      return failed;
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

export async function getBackupStatus() {
  const status = await loadStatus();
  return { ...status, configured: Boolean(backupTarget()), target: backupTarget(), running: Boolean(state.running) };
}

/** La sauvegarde toutes les 15 minutes, première passe une minute après le démarrage. */
export function startBackupScheduler() {
  if (state.timer || !backupTarget()) return;
  setTimeout(() => void runBackup(), 60_000);
  state.timer = setInterval(() => void runBackup(), INTERVAL_MS);
}
