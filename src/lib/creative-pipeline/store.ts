import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Le stockage du pipeline créa (page Meta Ads Manager) : les briefs, le statut
 * de chaque créa avec son historique (automatique ou à la main), les réglages
 * modifiables (taux d'upsell, facteur réel forcé) et le journal des
 * changements. Un fichier JSON sur le disque persistant du serveur.
 */

export type CreativeStatus = "BRIEF" | "EN PROD" | "PRÊTE" | "TEST" | "SCALING" | "HYPER" | "COSTCAP" | "OFF";
export type BriefStatus = "BRIEF" | "EN PROD" | "PRÊTE" | "UPLOADÉE";

export type Brief = {
  id: string;
  /** S_HISHERS_VELVET_v2 : S (statique) ou V (vidéo), concept, méthode, version. */
  creaId: string;
  format: "S" | "V";
  concept: string;
  method: string;
  version: number;
  type: "Itération" | "Nouveau concept";
  /** Pour une itération : headline swap, visual swap, badge swap, hook swap. */
  swap: string;
  /** Post ID de la créa d'origine (itération). */
  source: string;
  angle: string;
  headline: string;
  badge: string;
  visual: string;
  price: string;
  formats: string[];
  targetAdset: string;
  deadline: string;
  assignee: string;
  status: BriefStatus;
  /** Post ID une fois en ligne (facultatif). */
  postId: string;
  createdAt: string;
  createdBy: string;
  /** Quand chaque statut a été atteint. */
  statusAt: Partial<Record<BriefStatus, string>>;
};

export type StatusChange = { at: string; who: string; from: CreativeStatus | null; to: CreativeStatus; note: string };

export type CreativeState = {
  /** Le statut calculé la dernière fois. */
  auto: CreativeStatus | null;
  /** Le statut forcé à la main (prioritaire), ou null. */
  manual: CreativeStatus | null;
  history: StatusChange[];
};

export type PipelineSettings = {
  /** Taux d'acceptation de l'upsell à 9,99 $ (0,10 = 10 %) ; null = valeur par défaut. */
  upsellRate: number | null;
  /** Facteur réel forcé (commandes ÷ achats Meta) ; null = calculé. */
  factor: number | null;
};

export type JournalLine = { id: string; at: string; who: string; what: string };

type Store = {
  briefs: Brief[];
  creatives: Record<string, CreativeState>;
  settings: PipelineSettings;
  journal: JournalLine[];
};

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "creative-pipeline.json");
const EMPTY: Store = { briefs: [], creatives: {}, settings: { upsellRate: null, factor: null }, journal: [] };

const state = ((globalThis as typeof globalThis & { __msgateCreativePipeline?: { store: Store | null } }).__msgateCreativePipeline ??= { store: null });

export async function readStore(): Promise<Store> {
  if (state.store) return state.store;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<Store>;
    state.store = {
      briefs: Array.isArray(parsed.briefs) ? parsed.briefs : [],
      creatives: parsed.creatives && typeof parsed.creatives === "object" ? parsed.creatives : {},
      settings: { ...EMPTY.settings, ...(parsed.settings ?? {}) },
      journal: Array.isArray(parsed.journal) ? parsed.journal : [],
    };
  } catch {
    state.store = structuredClone(EMPTY);
  }
  return state.store;
}

let writing: Promise<void> = Promise.resolve();

/** Modifie le stockage et l'écrit sur disque (une écriture à la fois). */
export async function updateStore<T>(change: (store: Store) => T): Promise<T> {
  let result!: T;
  writing = writing.then(async () => {
    const store = await readStore();
    result = change(store);
    store.journal = store.journal.slice(-500);
    for (const creative of Object.values(store.creatives)) creative.history = creative.history.slice(-30);
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2));
    await rename(tmp, FILE);
  });
  await writing;
  return result;
}

export function journalLine(who: string, what: string): JournalLine {
  return { id: randomUUID(), at: new Date().toISOString(), who, what };
}
