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

/**
 * Où tourne une créa : TEST (ABO), MAIN (CBO), BIDCAP / COSTCAP ; SCALING = les
 * anciens ad sets « SCALING - », traités comme MAIN en attendant leur migration.
 */
export type CreativeStatus = "BRIEF" | "EN PROD" | "PRÊTE" | "TEST" | "MAIN" | "SCALING" | "BIDCAP" | "COSTCAP" | "OFF";
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
  /** Date de lancement (created_time de la pub Meta la plus ancienne, sinon premier jour avec impressions). Ne fait que reculer. */
  launchedAt?: string | null;
};

/** Les seuils du pipeline et de la rampe des ad sets TEST, modifiables dans Réglages. */
export type Thresholds = {
  /** Marge 7 j sous laquelle une créa est CUT (%). */
  cutMargin: number;
  /** Marge 7 j à partir de laquelle une créa est BEST (%). */
  bestMargin: number;
  /** Ventes 7 j en dessous desquelles il n'y a pas de verdict. */
  minSales: number;
  /** Ventes 7 j pour passer en MAIN avant J7, ou pour une BONNE. */
  mainSales: number;
  /** Ventes 7 j pour candidater au BidCap. */
  bidcapSales: number;
  /** Dépense en MAIN sur 3 j ($) à partir de laquelle on coupe la copie TEST. */
  testCutSpend: number;
  /** Écart de marge 3 j / 7 j (points) pour la flèche de tendance. */
  trendPts: number;
  /** ROAS 3 j de sauvetage : une CUT au-dessus est surveillée, pas coupée. */
  rescueRoas: number;
  /** Ad set TEST : ventes 3 j pour monter. */
  testSales: number;
  /** Ad set TEST : hausse (%). */
  testRise: number;
  /** Ad set TEST : attente entre deux hausses (h). */
  testWait: number;
  /** Ad set TEST : plafond, en multiple du budget de départ. */
  testCap: number;
  /** Surf : hausse du jour (%). */
  surfRise: number;
  /** Surf : ROAS du jour minimum. */
  surfRoas: number;
  /** Surf : ventes du jour minimum. */
  surfSales: number;
  /** Surf : avant cette heure (heure du compte). */
  surfHour: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  cutMargin: 7.5,
  bestMargin: 15,
  minSales: 5,
  mainSales: 10,
  bidcapSales: 20,
  testCutSpend: 50,
  trendPts: 3,
  rescueRoas: 1.61,
  testSales: 5,
  testRise: 25,
  testWait: 48,
  testCap: 2,
  surfRise: 30,
  surfRoas: 2.5,
  surfSales: 3,
  surfHour: 14,
};

export type PipelineSettings = {
  /** Taux d'acceptation de l'upsell à 9,99 $ (0,10 = 10 %) ; null = valeur par défaut. */
  upsellRate: number | null;
  /** Facteur réel forcé (commandes ÷ achats Meta) ; null = calculé. */
  factor: number | null;
  thresholds: Thresholds;
};

/** Une case cochée de la liste « À faire cette semaine », par semaine (clé : lundi|identifiant). */
export type WeekCheck = { at: string; who: string; label: string };

export type JournalLine = { id: string; at: string; who: string; what: string };

type Store = {
  briefs: Brief[];
  creatives: Record<string, CreativeState>;
  settings: PipelineSettings;
  journal: JournalLine[];
  checks: Record<string, WeekCheck>;
};

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "creative-pipeline.json");
const EMPTY: Store = { briefs: [], creatives: {}, settings: { upsellRate: null, factor: null, thresholds: DEFAULT_THRESHOLDS }, journal: [], checks: {} };

const state = ((globalThis as typeof globalThis & { __msgateCreativePipeline?: { store: Store | null } }).__msgateCreativePipeline ??= { store: null });

export async function readStore(): Promise<Store> {
  if (state.store) {
    // Un stockage gardé en mémoire par une version d'avant les seuils (rechargement à chaud).
    state.store.settings.thresholds = { ...DEFAULT_THRESHOLDS, ...(state.store.settings.thresholds ?? {}) };
    state.store.checks ??= {};
    return state.store;
  }
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<Store>;
    state.store = {
      briefs: Array.isArray(parsed.briefs) ? parsed.briefs : [],
      creatives: parsed.creatives && typeof parsed.creatives === "object" ? parsed.creatives : {},
      settings: { ...EMPTY.settings, ...(parsed.settings ?? {}), thresholds: { ...DEFAULT_THRESHOLDS, ...(parsed.settings?.thresholds ?? {}) } },
      journal: Array.isArray(parsed.journal) ? parsed.journal : [],
      checks: parsed.checks && typeof parsed.checks === "object" ? parsed.checks : {},
    };
    // 05/11/2026 : plus de HYPER (framework TEST → MAIN → BidCap / CostCap) ; les anciennes CBO HYPER comptent comme MAIN.
    const unhyper = (status: string | null) => (status === "HYPER" ? "MAIN" : status) as CreativeStatus | null;
    for (const creative of Object.values(state.store.creatives)) {
      creative.auto = unhyper(creative.auto);
      creative.manual = unhyper(creative.manual);
      for (const change of creative.history) {
        change.from = unhyper(change.from);
        change.to = unhyper(change.to) ?? change.to;
      }
    }
    // 04/11/2026 : le passage TEST → SCALING de MIX 4 venait d'un changement de règle, pas d'une vraie promotion.
    for (const creative of Object.values(state.store.creatives)) {
      creative.history = creative.history.filter(
        (change) => !(change.who === "auto" && change.from === "TEST" && change.to === "SCALING" && change.at >= "2026-11-04T00:00:00Z" && change.at < "2026-11-04T12:30:00Z")
      );
    }
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
    // Les cases cochées : 8 semaines suffisent.
    const oldest = new Date(Date.now() - 56 * 24 * 3_600_000).toISOString().slice(0, 10);
    for (const key of Object.keys(store.checks)) if (key.slice(0, 10) < oldest) delete store.checks[key];
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
