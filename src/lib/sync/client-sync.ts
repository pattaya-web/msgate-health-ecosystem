"use client";

import type { EcosystemSyncPayload } from "@/lib/airtable/sync";
import { mockProvider } from "@/lib/providers/mock-provider";

export async function syncAirtableToStore(): Promise<EcosystemSyncPayload> {
  const res = await fetch("/api/sync/airtable", {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Sync failed (${res.status})`);
  }
  const payload = (await res.json()) as EcosystemSyncPayload;
  await mockProvider.hydrateEcosystem(payload);
  return payload;
}
