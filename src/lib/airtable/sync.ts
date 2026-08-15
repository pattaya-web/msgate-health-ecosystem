import { airtableRequest, getAirtableConfig } from "@/lib/airtable/client";
import {
  attachLinkedLlcsToIbos,
  banksFromLlc,
  mapAirtableIbo,
  mapAirtableLlc,
} from "@/lib/airtable/mappers";
import type { AirtableRecord } from "@/lib/airtable/types";
import {
  recomputeIboBankCounts,
  seededBanksFromLlc,
  seededIbos,
  seededLlcs,
} from "@/lib/mock/airtable-seed";
import type { Bank, Ibo, Llc, SyncLog } from "@/types";

interface ListResponse<T> {
  records: AirtableRecord<T>[];
  offset?: string;
}

async function fetchAllRecords<T>(tableName: string): Promise<AirtableRecord<T>[]> {
  const records: AirtableRecord<T>[] = [];
  let offset: string | undefined;
  do {
    const qs = offset ? `?offset=${encodeURIComponent(offset)}` : "";
    const page = await airtableRequest<ListResponse<T>>(
      `${encodeURIComponent(tableName)}${qs}`
    );
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

export type EcosystemSyncPayload = {
  ibos: Ibo[];
  llcs: Llc[];
  banks: Bank[];
  source: "airtable" | "seed";
  log: SyncLog;
};

/** Local seed (cleaned CSV) — used until Airtable credentials are set */
export function syncFromSeed(): EcosystemSyncPayload {
  const banks = seededBanksFromLlc;
  const ibos = attachLinkedLlcsToIbos(
    recomputeIboBankCounts(seededIbos, banks),
    seededLlcs,
    banks
  );
  return {
    ibos,
    llcs: seededLlcs,
    banks,
    source: "seed",
    log: {
      id: `sync-seed-${Date.now()}`,
      source: "seed",
      status: "success",
      message: "Loaded IBO/LLC seed from cleaned Airtable export",
      records_synced: ibos.length + seededLlcs.length + banks.length,
      created_at: new Date().toISOString(),
    },
  };
}

export async function syncFromAirtable(): Promise<EcosystemSyncPayload> {
  const config = getAirtableConfig();
  if (!config) {
    return syncFromSeed();
  }

  try {
    const [iboRecords, llcRecords] = await Promise.all([
      fetchAllRecords<Record<string, unknown>>(config.tables.ibos),
      fetchAllRecords<Record<string, unknown>>(config.tables.llcs),
    ]);

    const ibos = iboRecords.map((r, i) => mapAirtableIbo(r as never, i));

    const iboLookup = new Map<string, string>();
    for (const ibo of ibos) {
      iboLookup.set(ibo.id, ibo.id);
      if (ibo.display_name) {
        iboLookup.set(ibo.display_name.toLowerCase(), ibo.id);
        iboLookup.set(ibo.display_name, ibo.id);
      }
      iboLookup.set(ibo.reference_code.toLowerCase(), ibo.id);
    }

    const llcs = llcRecords
      .map((r) => mapAirtableLlc(r as never, iboLookup))
      .filter((l) => l.name && l.name.trim() !== "");

    const banks = llcs.flatMap((llc) => banksFromLlc(llc));
    const ibosWithLinks = attachLinkedLlcsToIbos(
      recomputeIboBankCounts(ibos, banks),
      llcs,
      banks
    );

    const log: SyncLog = {
      id: `sync-airtable-${Date.now()}`,
      source: "airtable",
      status: "success",
      message: `Synced ${ibosWithLinks.length} IBOs, ${llcs.length} LLCs, ${banks.length} banks from Airtable`,
      records_synced: ibosWithLinks.length + llcs.length + banks.length,
      created_at: new Date().toISOString(),
    };

    return { ibos: ibosWithLinks, llcs, banks, source: "airtable", log };
  } catch (error) {
    const seed = syncFromSeed();
    seed.log = {
      id: `sync-fallback-${Date.now()}`,
      source: "airtable",
      status: "partial",
      message: `Airtable sync failed (${error instanceof Error ? error.message : "error"}) — using local seed`,
      records_synced: seed.log.records_synced,
      created_at: new Date().toISOString(),
    };
    seed.source = "seed";
    return seed;
  }
}
