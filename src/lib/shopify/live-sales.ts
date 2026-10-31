import { getReignConfig } from "@/lib/reign/client";
import { toReportLocal } from "@/lib/report-tz";
import { fetchShopifySales, isShopifySalesConfigured, type ShopifySalesFeed } from "@/lib/shopify/sales-orders";

/**
 * Les ventes lues directement chez Shopify, sans la synchro Reign.
 *
 * Le site en ligne (Vercel) n'a ni disque ni clé Reign : il ne peut pas tenir
 * le gros instantané que le PC construit. Pour Venom, la boutique Shopify voit
 * toutes les ventes (Shopify Payments comme checkout Reign) : la lire en direct
 * donne les mêmes chiffres, en 3 secondes, à 45 s près. Sur le PC, où Reign est
 * branché, ce mode reste éteint et rien ne change.
 */

const TTL_MS = 45_000;

const state = ((globalThis as typeof globalThis & {
  __msgateLiveShopify?: { feed: (ShopifySalesFeed & { since: string; fetchedAt: string }) | null; inflight: Promise<unknown> | null };
}).__msgateLiveShopify ??= { feed: null, inflight: null });

/** Vrai quand les ventes viennent de Shopify en direct (pas de Reign, Shopify branché). */
export function shopifyDirectMode() {
  return !getReignConfig() && isShopifySalesConfigured();
}

/** Les commandes depuis `since`, relues au plus toutes les 45 s (une seule lecture à la fois). */
export async function getLiveShopifySales(since: string) {
  const cached = state.feed;
  if (cached && cached.since <= since && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return cached;
  if (state.inflight) {
    await state.inflight.catch(() => undefined);
    if (state.feed && state.feed.since <= since && Date.now() - Date.parse(state.feed.fetchedAt) < TTL_MS) return state.feed;
  }
  const from = cached && cached.since < since ? cached.since : since;
  const run = fetchShopifySales(from).then((feed) => {
    state.feed = { ...feed, since: from, fetchedAt: new Date().toISOString() };
    return state.feed;
  });
  state.inflight = run;
  try {
    return await run;
  } finally {
    state.inflight = null;
  }
}

/** Le jour de Paris d'une date Shopify (ISO avec fuseau). */
export function reportDay(iso: string) {
  return (toReportLocal(iso) ?? iso).slice(0, 10);
}
