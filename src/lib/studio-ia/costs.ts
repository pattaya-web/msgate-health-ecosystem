import { getSettings } from "@/lib/db";
import { DEFAULT_CREDIT_USD, PROVIDERS } from "./config";
import { resolveProvider } from "./select-provider";
import type { ProviderChoice, Quote, Resolution, TransformType } from "./types";

/**
 * Devis calculé côté serveur, à partir de la configuration centralisée.
 * Le client n'affiche que ce que cette fonction renvoie.
 */
export function quote(args: {
  provider: ProviderChoice;
  transform: TransformType;
  durationSec: number;
  resolution: Resolution;
  variants: number;
  hasProduct?: boolean;
}): Quote {
  const durationSec = Math.max(1, Math.ceil(args.durationSec || 5));
  const variants = Math.min(4, Math.max(1, Math.round(args.variants || 1)));
  const id = resolveProvider(args.provider, { transform: args.transform, durationSec, hasProduct: args.hasProduct });
  const p = PROVIDERS[id];
  const perSec = p.creditsPerSec[args.resolution] ?? p.creditsPerSec["720p"];
  const creditsPerVideo = Math.round(perSec * Math.min(durationSec, p.maxDurationSec));
  const rate = getSettings().creditUsdRate || DEFAULT_CREDIT_USD;
  return {
    provider: id,
    providerLabel: p.label,
    durationSec,
    creditsPerVideo,
    credits: creditsPerVideo * variants,
    usdPerVideo: creditsPerVideo * rate,
    usd: creditsPerVideo * variants * rate,
    variants,
    verified: p.verifiedPricing,
    ...(p.billedBy ? { billedBy: p.billedBy } : {}),
  };
}
