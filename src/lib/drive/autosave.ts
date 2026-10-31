import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { extensionFor, saveFile } from "@/lib/drive/store";
import { reportToday } from "@/lib/report-tz";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * La sauvegarde automatique dans le Drive.
 *
 * Chaque génération terminée du Studio IA (images, vidéos, montages) est
 * copiée dans le Drive, rangée par jour : on n'a plus à penser à
 * l'enregistrer, et elle survit à l'expiration des liens Kie. Un registre note
 * ce qui est déjà copié, pour ne jamais dupliquer une génération relue.
 *
 * Elles vont dans « Commun » (partagé avec l'associé, qui utilise le même
 * studio). Les Creatives, elles, ont déjà leur bibliothèque sur le disque :
 * pas de seconde copie, la copie de secours l'emporte telle quelle.
 */

export const AUTOSAVE_STUDIO = "Commun/Sauvegardes auto/Studio IA";

const LEDGER = path.join(STORAGE_ROOT, ".msgate-cache", "drive-autosave.json");

type Ledger = { saved: Record<string, string[]> };

const state = ((globalThis as typeof globalThis & { __msgateAutosave?: { ledger: Ledger | null; queue: Promise<unknown> } }).__msgateAutosave ??= {
  ledger: null,
  queue: Promise.resolve(),
});

async function loadLedger(): Promise<Ledger> {
  if (state.ledger) return state.ledger;
  try {
    state.ledger = JSON.parse(await readFile(LEDGER, "utf8")) as Ledger;
    state.ledger.saved ??= {};
  } catch {
    state.ledger = { saved: {} };
  }
  return state.ledger;
}

async function persistLedger(ledger: Ledger) {
  await mkdir(path.dirname(LEDGER), { recursive: true });
  const tmp = `${LEDGER}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(ledger));
  await rename(tmp, LEDGER);
}

export type AutosaveItem = {
  /** Nom souhaité, sans extension (elle est déduite du fichier). */
  name: string;
  /** Une URL http(s) ou un média local de l'app (/api/media/…). */
  url?: string;
  /** Ou un fichier déjà sur le disque. */
  file?: string;
};

/** Un nom lisible tiré d'un prompt : « 2026-10-31 14h05 · femme au café ». */
export function autosaveName(prompt: string, at = new Date()) {
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(at).replace(":", "h");
  const words = prompt.replace(/\s+/g, " ").trim().slice(0, 48).replace(/[\\/:*?"<>|]/g, " ").trim();
  return `${time} · ${words || "génération"}`;
}

async function fetchItem(item: AutosaveItem): Promise<{ data: Buffer; ext: string } | null> {
  if (item.file) {
    const data = await readFile(item.file);
    return { data, ext: path.extname(item.file).slice(1).toLowerCase() };
  }
  if (!item.url) return null;
  if (item.url.startsWith("/api/media/")) {
    const { localMediaPath } = await import("@/lib/studio-ia/media");
    const local = localMediaPath(item.url);
    if (!local) return null;
    return { data: await readFile(local), ext: path.extname(local).slice(1).toLowerCase() };
  }
  if (!/^https?:\/\//i.test(item.url)) return null;
  const res = await fetch(item.url, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`source ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const fromUrl = path.extname(new URL(item.url).pathname).slice(1).toLowerCase();
  return { data, ext: /^[a-z0-9]{2,4}$/.test(fromUrl) ? fromUrl : extensionFor(res.headers.get("content-type")) || "bin" };
}

/**
 * Copie une génération dans le Drive, une seule fois par clé. Ne lève jamais :
 * une sauvegarde ratée ne doit pas casser la génération ; elle sera retentée
 * au prochain passage (la clé n'est notée qu'en cas de succès).
 */
export function autosave(params: { key: string; folder: string; items: AutosaveItem[]; note?: Record<string, unknown> }) {
  state.queue = state.queue
    .then(async () => {
      const ledger = await loadLedger();
      if (ledger.saved[params.key]) return;
      const day = reportToday();
      const folder = `${params.folder}/${day}`;
      const saved: string[] = [];
      for (const item of params.items) {
        const got = await fetchItem(item).catch(() => null);
        if (!got?.data.length) continue;
        const rel = await saveFile(folder, `${item.name}.${got.ext}`, got.data);
        saved.push(rel);
        if (params.note) {
          const stem = rel.split("/").pop()!.replace(/\.[^.]+$/, "");
          await saveFile(folder, `${stem}.json`, Buffer.from(JSON.stringify({ ...params.note, savedAt: new Date().toISOString() }, null, 2))).catch(() => undefined);
        }
      }
      if (!saved.length) return;
      ledger.saved[params.key] = saved;
      await persistLedger(ledger);
    })
    .catch((error) => {
      console.warn("[drive] sauvegarde auto impossible", params.key, error instanceof Error ? error.message : error);
    });
  return state.queue;
}

/** Une génération Kie du Studio IA (image ou vidéo) terminée : copiée une fois, rangée par jour. */
export function autosaveGeneration(gen: { id: string; model: string; kind: string; prompt: string; resultUrls: string[]; createdAt?: string }) {
  if (!gen.resultUrls?.length) return;
  const base = autosaveName(gen.prompt, gen.createdAt ? new Date(gen.createdAt) : new Date());
  void autosave({
    key: `gen:${gen.id}`,
    folder: AUTOSAVE_STUDIO,
    items: gen.resultUrls.map((url, index) => ({ name: gen.resultUrls.length > 1 ? `${base} (${index + 1})` : base, url })),
    note: { source: "Studio IA", model: gen.model, kind: gen.kind, prompt: gen.prompt },
  });
}
