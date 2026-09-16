import { z } from "zod";
import { researchCompetitorCreatives } from "@/lib/brandsearch/research";
import { isBrandsearchReady } from "@/lib/brandsearch/client";
import type { CompetitorResearch } from "@/lib/brandsearch/types";
import type { ReadonlyTool } from "@/hermes/types";

/**
 * search_competitor_creatives — les créas statiques d'un concurrent chez
 * Brand Search, avec les seuls signaux que Brand Search fournit (dépense et
 * portée UE estimées, rang de portée, durée de diffusion, doublons). Lecture
 * seule ; la clé reste côté serveur ; un crédit Brand Search par pub renvoyée.
 * Les URL d'image expirent trois jours après la réponse : Hermes les regarde
 * tout de suite.
 */

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const competitorCreativesInput = z
  .object({
    domain: z.string().min(3).max(255).describe("Competitor domain, e.g. myhemios.com"),
    format: z.literal("static").optional().default("static").describe("Only static (image) ads are supported in this version"),
    limit: z.number().int().min(1).max(30).optional().default(20).describe("Ads returned (1 Brand Search credit each)"),
    page: z.number().int().min(1).max(50).optional().default(1),
    status: z.enum(["active", "inactive", "all"]).optional().default("active"),
    sort: z.enum(["spend", "reach", "rank", "active", "recent", "scaler"]).optional().default("spend").describe("spend = EU total spend, reach = EU reach, rank = reach rank, active = time active, recent = start date, scaler = Brand Search scaling score"),
    minSpendEur: z.number().min(0).optional().describe("Minimum estimated EU spend (EUR)"),
    startedFrom: z.string().refine(isDate, "YYYY-MM-DD").optional().describe("Ads started on or after this date"),
    startedTo: z.string().refine(isDate, "YYYY-MM-DD").optional().describe("Ads started on or before this date"),
    platforms: z.array(z.enum(["facebook", "instagram", "messenger", "audience_network", "threads"])).max(5).optional(),
    euCountries: z.array(z.string().length(2)).max(10).optional().describe("EU ad-library countries, ISO codes (Brand Search only tracks EU delivery)"),
    languages: z.array(z.string().min(2).max(5)).max(5).optional(),
    q: z.string().max(200).optional().describe("Phrase search across the ad copy"),
  })
  .strict();

export type CompetitorCreativesInput = z.infer<typeof competitorCreativesInput>;

export type CompetitorCreativesOutput = CompetitorResearch & {
  notes: string[];
};

export const competitorCreativesTool: ReadonlyTool<CompetitorCreativesInput, CompetitorCreativesOutput> = {
  name: "search_competitor_creatives",
  description:
    "Read-only competitor research on Brand Search: the static (image) Meta ads of a competitor domain with the performance signals Brand Search actually provides (EU spend and reach estimates, reach rank, days active, duplicate variants) plus headline, primary text, CTA and the image URL to look at. No ROAS, revenue or conversion data exists in Brand Search: rank ads as « top creatives based on available Brand Search signals », never as proven winners. Landing pages are not provided. Image URLs expire after 3 days. Costs one Brand Search credit per ad returned: keep limit small.",
  input: competitorCreativesInput,
  async run(input) {
    if (!isBrandsearchReady()) throw new Error("Brand Search n'est pas configuré (BRANDSEARCH_API_KEY)");
    const research = await researchCompetitorCreatives({
      domain: input.domain,
      limit: input.limit,
      page: input.page,
      status: input.status,
      sort: input.sort,
      minSpendEur: input.minSpendEur,
      startedFrom: input.startedFrom,
      startedTo: input.startedTo,
      platforms: input.platforms,
      euCountries: input.euCountries,
      languages: input.languages,
      q: input.q,
    });
    return {
      ...research,
      notes: [
        research.signalsNote,
        "landingPage is always null: Brand Search does not return the ad's landing page.",
        "imageUrl / imageOriginalUrl expire 3 days after this response: analyse them now, do not store them.",
        "Competitor-specific wording (brand, claims, guarantees, origin, statistics) is inspiration only and must never be transferred to the operator's product.",
      ],
    };
  },
};
