/**
 * Le compteur des appels du serveur vers Meta (graph.facebook.com).
 *
 * L'appli Meta est en « development_access » : peu d'appels par heure et par
 * compte pub, et au-delà Meta répond « User request limit reached » pendant
 * de longues minutes. Chaque appel est noté (chemin sans jeton, nombre de
 * sous-requêtes d'un batch) et la jauge que Meta renvoie par compte
 * (x-business-use-case-usage) est gardée : /api/meta/usage montre qui consomme
 * et où en est chaque compte, et `metaPressure()` dit aux lectures de se
 * contenter du cache quand un compte approche de la limite.
 */

type Call = { at: number; key: string; weight: number; status: number };
type Gauge = { at: number; type: string; callCount: number; cpu: number; time: number; regainMinutes: number; tier?: string };

type UsageState = { calls: Call[]; gauges: Map<string, Gauge>; installed: boolean };
const holder = globalThis as typeof globalThis & { __msgateMetaUsage?: UsageState };
const state: UsageState = (holder.__msgateMetaUsage ??= { calls: [], gauges: new Map(), installed: false });

const KEEP_MS = 2 * 60 * 60_000;

/** « act_123/insights?level=ad » → « act/insights level=ad » : ce qui distingue un appel d'un autre, sans jeton ni identifiant. */
function keyOf(url: URL, method: string, body: unknown) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // sans la version (v21.0)
  const path = parts.map((part) => (/^act_\d+$/.test(part) ? "act" : /^\d+(_\d+)?$/.test(part) ? "{id}" : part)).join("/") || "batch";
  const level = url.searchParams.get("level");
  const extra = [level ? `level=${level}` : "", url.searchParams.get("time_increment") ? "daily" : ""].filter(Boolean).join(" ");
  let batch = "";
  if (!parts.length && typeof body === "string" && body.includes("batch=")) batch = " (batch)";
  return `${method} ${path}${extra ? ` ${extra}` : ""}${batch}`;
}

function batchWeight(body: unknown) {
  if (typeof body !== "string") return 1;
  try {
    const raw = new URLSearchParams(body).get("batch");
    const list = raw ? (JSON.parse(raw) as unknown[]) : null;
    return Array.isArray(list) ? list.length : 1;
  } catch {
    return 1;
  }
}

function readGauges(headers: Headers) {
  const raw = headers.get("x-business-use-case-usage");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<{ type: string; call_count: number; total_cputime: number; total_time: number; estimated_time_to_regain_access: number; ads_api_access_tier?: string }>>;
    for (const [accountId, rows] of Object.entries(parsed)) {
      for (const row of rows) {
        state.gauges.set(`${accountId}:${row.type}`, {
          at: Date.now(),
          type: row.type,
          callCount: row.call_count,
          cpu: row.total_cputime,
          time: row.total_time,
          regainMinutes: row.estimated_time_to_regain_access,
          tier: row.ads_api_access_tier,
        });
      }
    }
  } catch {
    // en-tête illisible : on ignore
  }
}

/** Branche le compteur sur fetch (une fois, côté Node). */
export function installMetaUsageLog() {
  if (state.installed) return;
  state.installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes("graph.facebook.com")) return original(input, init);
    const response = await original(input, init);
    try {
      const url = new URL(href);
      const method = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET") || "GET").toUpperCase();
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : init?.body;
      state.calls.push({ at: Date.now(), key: keyOf(url, method, body), weight: batchWeight(body), status: response.status });
      const cutoff = Date.now() - KEEP_MS;
      while (state.calls.length && state.calls[0].at < cutoff) state.calls.shift();
      readGauges(response.headers);
    } catch {
      // le compteur ne doit jamais casser un appel
    }
    return response;
  };
}

/** La jauge Meta la plus haute d'un compte (0 à 100 %), et dans combien de minutes il repart s'il est bloqué. */
export function metaPressure(accountId: string) {
  const id = accountId.replace(/^act_/, "");
  let pct = 0;
  let regain = 0;
  for (const [key, gauge] of state.gauges) {
    if (!key.startsWith(`${id}:`)) continue;
    // Une jauge vieille de plus de 10 min ne dit plus rien.
    if (Date.now() - gauge.at > 10 * 60_000) continue;
    pct = Math.max(pct, gauge.callCount, gauge.cpu, gauge.time);
    regain = Math.max(regain, gauge.regainMinutes);
  }
  return { pct, regainMinutes: regain };
}

/** Le récap pour /api/meta/usage : appels par type sur 5, 15 et 60 min, et les jauges par compte. */
export function metaUsageReport() {
  const now = Date.now();
  const windows = [5, 15, 60] as const;
  const byKey = new Map<string, { m5: number; m15: number; m60: number; errors: number }>();
  for (const call of state.calls) {
    const age = (now - call.at) / 60_000;
    if (age > 60) continue;
    const row = byKey.get(call.key) ?? { m5: 0, m15: 0, m60: 0, errors: 0 };
    if (age <= 5) row.m5 += call.weight;
    if (age <= 15) row.m15 += call.weight;
    row.m60 += call.weight;
    if (call.status >= 400) row.errors += 1;
    byKey.set(call.key, row);
  }
  const totals = Object.fromEntries(windows.map((w) => [`m${w}`, [...byKey.values()].reduce((sum, row) => sum + row[`m${w}`], 0)]));
  return {
    since: state.calls[0]?.at ?? null,
    totals,
    calls: [...byKey.entries()].map(([key, row]) => ({ key, ...row })).sort((a, b) => b.m60 - a.m60),
    gauges: [...state.gauges.entries()].map(([key, gauge]) => ({ account: key.split(":")[0], ...gauge, ageMin: Math.round((now - gauge.at) / 60_000) })),
  };
}

/**
 * Combien de temps une lecture peut resservir son cache, selon la jauge Meta
 * des comptes lus (« all » : le compte le plus chargé). Plus la jauge monte,
 * plus on garde le cache : la marge restante sert aux créations de pubs
 * (uploader), pas aux tableaux de bord qui se rafraîchissent.
 */
export function guardedTtl(baseMs: number, accountIds: string[] | "all") {
  const ids = accountIds === "all" ? [...new Set([...state.gauges.keys()].map((key) => key.split(":")[0]))] : accountIds;
  let pct = 0;
  let blocked = false;
  for (const id of ids) {
    const pressure = metaPressure(id);
    pct = Math.max(pct, pressure.pct);
    if (pressure.regainMinutes > 0) blocked = true;
  }
  if (blocked || pct >= 75) return Math.max(baseMs, 20 * 60_000);
  if (pct >= 50) return Math.max(baseMs, 10 * 60_000);
  if (pct >= 30) return Math.max(baseMs, 5 * 60_000);
  return baseMs;
}

/** « User request limit reached » (code 17), « too many calls » (4, 613, 80004…) : Meta freine, ça repart tout seul. */
export function isMetaRateLimit(message: string) {
  return /request limit|too many calls|rate limit|limit reached|#(4|17|32|613|80004)\b/i.test(message);
}
