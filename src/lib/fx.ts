/**
 * Conversion de devises pour les ratios.
 *
 * Les ventes (Shopify, Reign) sont en dollars, les comptes Meta de Badgal
 * Collection en euros : un ROAS doit diviser des montants de même devise. On
 * convertit la dépense dans la devise des ventes au taux de référence de la
 * BCE (api.frankfurter.app, sans clé), gardé 6 heures. Si le service ne répond
 * pas, on reprend le dernier taux connu, sinon FX_EUR_USD ou un taux de repli.
 */

export const REPORT_CURRENCY = "USD";

type Rate = { rate: number; date: string; source: "bce" | "cache" | "env" | "fallback" };

const state = ((globalThis as typeof globalThis & { __msgateFx?: Map<string, { at: number; value: Rate }> }).__msgateFx ??= new Map());

const FALLBACK: Record<string, number> = { "EUR:USD": 1.1, "GBP:USD": 1.27, "CAD:USD": 0.72, "AUD:USD": 0.65 };

/** Le taux pour passer d'une devise à une autre (1 `from` = `rate` `to`). */
export async function fxRate(from: string, to: string = REPORT_CURRENCY): Promise<Rate> {
  const source = (from || to).toUpperCase();
  const target = to.toUpperCase();
  if (source === target) return { rate: 1, date: "", source: "bce" };
  const key = `${source}:${target}`;
  const hit = state.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.value;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${source}&to=${target}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rate = body.rates?.[target];
    if (!res.ok || !rate) throw new Error("taux absent");
    const value: Rate = { rate, date: body.date ?? "", source: "bce" };
    state.set(key, { at: Date.now(), value });
    return value;
  } catch {
    if (hit) return { ...hit.value, source: "cache" };
    const env = Number(process.env[`FX_${source}_${target}`]);
    if (Number.isFinite(env) && env > 0) return { rate: env, date: "", source: "env" };
    return { rate: FALLBACK[key] ?? 1, date: "", source: "fallback" };
  }
}

/** Les taux de plusieurs devises vers la devise des ventes, en un appel par devise. */
export async function fxRates(currencies: Iterable<string>, to: string = REPORT_CURRENCY) {
  const unique = [...new Set([...currencies].filter(Boolean).map((currency) => currency.toUpperCase()))];
  const entries = await Promise.all(unique.map(async (currency) => [currency, await fxRate(currency, to)] as const));
  return new Map(entries);
}

/** Une phrase pour dire quelle conversion a été faite, ou null s'il n'y en a pas eu. */
export function describeConversion(rates: Map<string, Rate>, to: string = REPORT_CURRENCY) {
  const converted = [...rates.entries()].filter(([currency]) => currency !== to);
  if (!converted.length) return null;
  return converted
    .map(([currency, { rate, date, source }]) => {
      const origin = source === "bce" || source === "cache" ? `taux BCE${date ? ` du ${date.split("-").reverse().join("/")}` : ""}` : "taux de repli";
      return `dépense ${currency} convertie en ${to} (1 ${currency} = ${rate.toFixed(4)} ${to}, ${origin})`;
    })
    .join(" ; ");
}
