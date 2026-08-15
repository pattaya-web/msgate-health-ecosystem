import { getMetaConfig, type MetaConfig } from "@/lib/meta/client";

export const GRAPH = "https://graph.facebook.com";

export type GraphError = { error?: { message: string; code?: number; type?: string } };

export function requireMetaConfig(): MetaConfig {
  const config = getMetaConfig();
  if (!config) throw new Error("Meta is not configured (missing META_ACCESS_TOKENS)");
  return config;
}

export async function graphGet<T extends GraphError>(path: string, token: string): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${GRAPH}/${requireMetaConfig().apiVersion}/${path}${separator}access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  return (await res.json()) as T;
}

export async function graphPost<T extends GraphError>(
  path: string,
  token: string,
  body: Record<string, string>
): Promise<T> {
  const res = await fetch(`${GRAPH}/${requireMetaConfig().apiVersion}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, access_token: token }),
    cache: "no-store",
  });
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ *
 * Batch
 *
 * The Graph API accepts up to 50 sub-requests per call. Chunks run in
 * parallel (capped) so a large BM doesn't wait for chunk N+1 to start.
 * ------------------------------------------------------------------ */

export type BatchRequest = { key: string; relativeUrl: string };

export type BatchResult<T> = { key: string; code: number; body: T | null; error?: string };

const BATCH_LIMIT = 50;
/** Slightly higher — date switches only hit insights when structure is warm. */
const CHUNK_CONCURRENCY = 4;

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await worker(items[index]);
      }
    })
  );
  return out;
}

async function runBatchChunk<T>(
  token: string,
  chunk: BatchRequest[],
  apiVersion: string
): Promise<BatchResult<T>[]> {
  const res = await fetch(`${GRAPH}/${apiVersion}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: token,
      include_headers: "false",
      batch: JSON.stringify(
        chunk.map((request) => ({ method: "GET", relative_url: request.relativeUrl }))
      ),
    }),
    cache: "no-store",
  });

  const payload = (await res.json()) as Array<{ code: number; body: string } | null> | GraphError;

  if (!Array.isArray(payload)) {
    const message = payload.error?.message || "Batch request failed";
    return chunk.map((request) => ({ key: request.key, code: 0, body: null, error: message }));
  }

  return payload.map((entry, index) => {
    const request = chunk[index];
    if (!entry) return { key: request.key, code: 0, body: null, error: "Réponse vide" };

    try {
      const parsed = JSON.parse(entry.body) as T & GraphError;
      return {
        key: request.key,
        code: entry.code,
        body: parsed,
        error: parsed?.error?.message,
      };
    } catch {
      return { key: request.key, code: entry.code, body: null, error: "Réponse illisible" };
    }
  });
}

export async function graphBatch<T>(
  token: string,
  requests: BatchRequest[]
): Promise<BatchResult<T>[]> {
  if (!requests.length) return [];

  const apiVersion = requireMetaConfig().apiVersion;
  const chunks: BatchRequest[][] = [];
  for (let offset = 0; offset < requests.length; offset += BATCH_LIMIT) {
    chunks.push(requests.slice(offset, offset + BATCH_LIMIT));
  }

  const parts = await mapPool(chunks, CHUNK_CONCURRENCY, (chunk) =>
    runBatchChunk<T>(token, chunk, apiVersion)
  );
  return parts.flat();
}

/** Meta returns budgets in the account's minor units (cents). */
export const centsToUnits = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 100 : 0;
};

export const unitsToCents = (value: number) => String(Math.round(value * 100));
