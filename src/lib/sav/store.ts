import { fetchSavMessages } from "@/lib/sav/imap";
import { buildMetrics, buildThreads } from "@/lib/sav/threads";
import type { SavInboxPayload } from "@/lib/sav/types";

/**
 * Une connexion IMAP coûte une poignée de secondes : le résultat est gardé
 * quelques minutes en mémoire, comme le reste du cockpit (cf. lib/meta/client).
 * Rien n'est écrit sur disque — la boîte SAV contient des données clients.
 */

const CACHE_TTL_MS = 3 * 60 * 1000;
/** Plafond de sécurité par dossier sur une plage large. */
const MAX_PER_MAILBOX = 1500;

type Entry = { at: number; value: SavInboxPayload };

const cache = ((globalThis as typeof globalThis & {
  __msgateSavInbox?: Map<string, Entry>;
}).__msgateSavInbox ??= new Map<string, Entry>());

export async function getSavInbox(params: {
  start: string;
  end: string;
  force?: boolean;
}): Promise<SavInboxPayload> {
  const key = `${params.start}:${params.end}`;
  const hit = cache.get(key);
  if (!params.force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const { messages, warnings } = await fetchSavMessages({
    since: params.start,
    limit: MAX_PER_MAILBOX,
  });

  // Le serveur filtre à la journée près ; la borne haute est appliquée ici.
  const endBoundary = `${params.end}T23:59:59.999Z`;
  const inRange = messages.filter((message) => message.date <= endBoundary);

  const threads = buildThreads(inRange);
  const value: SavInboxPayload = {
    range: { start: params.start, end: params.end },
    threads,
    metrics: buildMetrics(threads, inRange, { start: params.start, end: params.end }),
    fetchedAt: new Date().toISOString(),
    warnings,
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}

export function findCachedThread(threadId: string) {
  for (const entry of cache.values()) {
    const thread = entry.value.threads.find((row) => row.id === threadId);
    if (thread) return thread;
  }
  return null;
}
