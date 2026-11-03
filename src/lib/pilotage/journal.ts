import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { graphGet, centsToUnits, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import type { EntityLevel } from "@/lib/meta/types";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Le journal des modifications de pub : qui, quoi, quand, sur quelle
 * campagne, avec l'avant / après. Rempli tout seul à chaque changement de
 * budget, pause, relance ou création (Ads Manager, page Pilotage, uploader),
 * plus les notes écrites à la main. Il sert à relier chaque changement à son
 * effet, et aux règles « une modification par campagne et par jour » et « pas
 * deux hausses à moins de 48 h ».
 */

export type JournalAction = "budget" | "status" | "rename" | "create" | "copy" | "note";

export type JournalEntry = {
  id: string;
  at: string;
  /** L'identifiant de connexion (« mady », « alison »). */
  who: string;
  action: JournalAction;
  level: EntityLevel | null;
  objectId: string | null;
  objectName: string;
  campaignId: string | null;
  campaignName: string;
  accountId: string | null;
  /** Budget : montants dans la devise du compte ; statut : ACTIVE / PAUSED… */
  before: string | number | null;
  after: string | number | null;
  currency: string | null;
  /** « rampe » : bouton « Appliquer » de la rampe de scaling (Ads Manager). */
  source: "ads" | "pilotage" | "uploader" | "manuel" | "rampe";
  note: string;
};

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "pilotage-journal.json");
const MAX_ENTRIES = 3000;

const state = ((globalThis as typeof globalThis & { __msgateJournal?: { entries: JournalEntry[] | null } }).__msgateJournal ??= { entries: null });

export async function readJournal(): Promise<JournalEntry[]> {
  if (state.entries) return state.entries;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as { entries?: JournalEntry[] };
    state.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    state.entries = [];
  }
  return state.entries;
}

let writing: Promise<void> = Promise.resolve();

export async function appendJournal(entry: Omit<JournalEntry, "id" | "at"> & { at?: string }) {
  const full: JournalEntry = { ...entry, id: randomUUID(), at: entry.at ?? new Date().toISOString() };
  // Une écriture à la fois : deux changements simultanés ne s'écrasent pas.
  writing = writing.then(async () => {
    const entries = [...(await readJournal()), full].slice(-MAX_ENTRIES);
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ entries }, null, 2));
    await rename(tmp, FILE);
    state.entries = entries;
  });
  await writing;
  return full;
}

export type EntitySnapshot = {
  name: string;
  status: string | null;
  dailyBudget: number | null;
  campaignId: string | null;
  campaignName: string;
  accountId: string | null;
};

/** L'état d'une campagne, d'un ad set ou d'une pub juste avant une modification (pour l'avant / après du journal). */
export async function snapshotEntity(id: string, level: EntityLevel): Promise<EntitySnapshot | null> {
  try {
    const token = await resolveToken(id);
    const fields =
      level === "campaign"
        ? "name,status,daily_budget,account_id"
        : level === "adset"
          ? "name,status,daily_budget,account_id,campaign{id,name}"
          : "name,status,account_id,campaign{id,name}";
    const body = await graphGet<GraphError & { name?: string; status?: string; daily_budget?: string; account_id?: string; campaign?: { id?: string; name?: string } }>(
      `${encodeURIComponent(id)}?fields=${fields}`,
      token
    );
    if (body.error) return null;
    return {
      name: body.name ?? "",
      status: body.status ?? null,
      dailyBudget: body.daily_budget != null ? centsToUnits(body.daily_budget) : null,
      campaignId: level === "campaign" ? id : (body.campaign?.id ?? null),
      campaignName: level === "campaign" ? (body.name ?? "") : (body.campaign?.name ?? ""),
      accountId: body.account_id ?? null,
    };
  } catch {
    return null;
  }
}
