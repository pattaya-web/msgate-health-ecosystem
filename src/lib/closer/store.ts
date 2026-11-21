import { randomBytes, randomUUID } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Les closers et leurs calls.
 *
 * Les calls arrivent tout seuls depuis ibostate.com : la page /book/ d'IBOState
 * envoie chaque réservation au bot Telegram (@ibostate_leads_bot) ET ici
 * (/api/closer/ingest), avec les mêmes données — heure exacte, lien Meet,
 * téléphone, réponses pré-call. Les fiches « NEW LEAD » arrivent de la même
 * façon et complètent la fiche du prospect quand il réserve.
 *
 * Un closer se connecte sans mot de passe, par un lien personnel que l'admin
 * lui envoie ; le retirer (ou le désactiver) coupe son accès tout de suite.
 *
 * Disque permanent du serveur (.msgate-cache), un seul fichier.
 */

export type Closer = {
  id: string;
  name: string;
  /** Identifiant de connexion (minuscules, sans espace) : c'est aussi le nom de sa session. */
  identifier: string;
  /** Fuseau IANA (Asia/Dubai, Europe/Paris…) : son agenda s'affiche à son heure. */
  timezone: string;
  /**
   * Les noms sous lesquels ses calls arrivent : IBOState réserve au nom de
   * « Kelly », c'est Noura qui fait le call. Un call dont l'hôte correspond
   * à un de ces noms lui revient.
   */
  aliases: string[];
  /** Clé du lien d'accès personnel (régénérable). */
  accessToken: string;
  active: boolean;
  createdAt: string;
};

export type Answer = { label: string; value: string };

export type CloserLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  place: string;
  telegram: string;
  preferredContact: string;
  /** qualified / disqualified / review */
  eligibility: string;
  answers: Answer[];
  notes: string;
  receivedAt: string;
};

export type CallStatus = "booked" | "done" | "no-show" | "cancelled";

export type CloserCall = {
  id: string;
  closerId: string | null;
  /** Nom d'hôte reçu (« Kelly ») : sert à rattacher le call à un closer. */
  host: string;
  /** Début du call, en UTC (ISO). */
  startAt: string;
  durationMin: number;
  prospectTz: string;
  joinUrl: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  answers: Answer[];
  leadId: string | null;
  status: CallStatus;
  closerNote: string;
  source: "ibostate" | "manual";
  createdAt: string;
  updatedAt: string;
};

export type CloserStore = { closers: Closer[]; calls: CloserCall[]; leads: CloserLead[] };

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "closers.json");
const EMPTY: CloserStore = { closers: [], calls: [], leads: [] };

function normalize(raw: Partial<CloserStore> | null): CloserStore {
  return {
    closers: Array.isArray(raw?.closers) ? raw!.closers : [],
    calls: Array.isArray(raw?.calls) ? raw!.calls : [],
    leads: Array.isArray(raw?.leads) ? raw!.leads : [],
  };
}

export async function readClosers(): Promise<CloserStore> {
  try {
    return normalize(JSON.parse(await readFile(FILE, "utf8")) as Partial<CloserStore>);
  } catch {
    return structuredClone(EMPTY);
  }
}

/* Les écritures passent l'une après l'autre : deux réservations simultanées ne s'écrasent pas. */
let queue: Promise<unknown> = Promise.resolve();

export function updateClosers<T>(change: (store: CloserStore) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const store = await readClosers();
    const result = await change(store);
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await rename(tmp, FILE);
    syncCache = null;
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/*
 * Lecture synchrone pour la vérification de session (proxy et routes) : un
 * closer retiré ou désactivé perd l'accès à la requête suivante. Relue
 * seulement quand le fichier change.
 */
let syncCache: { mtime: number; closers: Closer[] } | null = null;

export function activeCloserSync(identifier: string): Closer | null {
  try {
    if (!existsSync(FILE)) return null;
    const mtime = statSync(FILE).mtimeMs;
    if (!syncCache || syncCache.mtime !== mtime) {
      syncCache = { mtime, closers: normalize(JSON.parse(readFileSync(FILE, "utf8")) as Partial<CloserStore>).closers };
    }
    return syncCache.closers.find((closer) => closer.active && closer.identifier === identifier) ?? null;
  } catch {
    return null;
  }
}

export function newAccessToken() {
  return randomBytes(24).toString("base64url");
}

export function newId() {
  return randomUUID();
}

export function cleanIdentifier(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 40);
}

export function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Chiffres seuls : sert à rapprocher un call de sa fiche lead. */
export function phoneDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

/** Le closer d'un call reçu : celui dont un alias (ou le prénom) correspond au nom d'hôte. */
export function closerForHost(closers: Closer[], host: string) {
  const wanted = host.trim().toLowerCase();
  if (!wanted) return null;
  return (
    closers.find((closer) => closer.active && closer.aliases.some((alias) => alias.trim().toLowerCase() === wanted)) ??
    closers.find((closer) => closer.active && closer.name.trim().toLowerCase() === wanted) ??
    null
  );
}

/** La fiche lead d'un prospect : même téléphone (chiffres) ou même e-mail. */
export function leadFor(leads: CloserLead[], phone: string, email: string) {
  const digits = phoneDigits(phone);
  const mail = email.trim().toLowerCase();
  return (
    leads.find((lead) => (digits.length >= 7 && phoneDigits(lead.phone).endsWith(digits.slice(-10))) || (mail && lead.email.toLowerCase() === mail)) ??
    null
  );
}
