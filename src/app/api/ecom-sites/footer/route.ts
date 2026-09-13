import { NextResponse } from "next/server";
import { kieClaude } from "@/lib/studio/kie";
import { getEcomSite } from "@/lib/ecom-sites/store";
import { fullAddress, type EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * De quoi laisser la cascade essayer plusieurs modèles.
 *
 * Kie sert ses modèles Claude de façon inégale : le premier de la liste peut
 * être en panne quand le troisième répond. Une minute suffisait à peine à en
 * essayer un — et le texte de repli sortait alors qu'un modèle était debout.
 */
const REWRITE_TIMEOUT_MS = 100_000;

type Body = {
  siteId?: string;
  /** Le titre de la colonne, tel qu'il est écrit dans l'éditeur. */
  title?: string;
  /**
   * Le brouillon à l'écran, quand il n'est pas encore enregistré.
   *
   * Le texte doit parler de la boutique qu'on a sous les yeux, pas de celle
   * qui dort sur le disque : on vient peut-être de renommer la marque ou de
   * retirer la moitié du catalogue. Absent, on retombe sur le site enregistré.
   */
  draft?: Partial<EcomSite>;
};

/**
 * Le bloc de texte d'un pied de page, écrit à partir de la boutique.
 *
 * C'est le paragraphe qui ouvre le footer de presque toutes les boutiques —
 * qui on est, ce qu'on vend, ce qui se passe après la commande. Il tombe sous
 * les mêmes règles que la page « à propos » : ce site part en souscription, et
 * un analyste lit le pied de page. Rien qui puisse se vérifier et se démentir.
 */
function buildPrompt(site: EcomSite, title: string) {
  const names = site.products.slice(0, 10).map((product) => product.name).filter(Boolean);
  const categories = site.categories.map((category) => category.label).filter(Boolean);
  const address = fullAddress(site).trim();

  return [
    `Write the text of a footer column titled "${title}" for a US direct-to-consumer store called "${site.brandName}".`,
    "",
    "This is the short block of prose that sits at the bottom left of the page, next to the link columns. It is read after everything else, by someone deciding whether to trust the store.",
    "",
    "What the store is:",
    site.legalName ? `Operated by ${site.legalName}${site.stateOfIncorporation ? `, a ${site.stateOfIncorporation} LLC` : ""}${address ? `, registered at ${address}` : ""}.` : "",
    site.domain ? `Domain: ${site.domain}.` : "",
    categories.length ? `Categories: ${categories.join(", ")}.` : "",
    names.length ? `Products: ${names.join("; ")}.` : "",
    site.promise ? `Brand promise already on the site: ${site.promise}` : "",
    site.tagline ? `Tagline: ${site.tagline}` : "",
    "",
    "What the customer gets:",
    `Ships from ${site.shipsFrom || "the United States"} in ${site.deliveryMinDays} to ${site.deliveryMaxDays} business days.`,
    `Returns accepted within ${site.returnWindowDays} days.`,
    site.freeShippingThreshold > 0 ? `Free shipping over ${site.freeShippingThreshold} ${site.currency}.` : "",
    site.supportHours ? `Support reachable ${site.supportHours}.` : "",
    "",
    "ABSOLUTELY FORBIDDEN, in any form:",
    "- A founder or team member name, or any personal biography",
    "- A founding year, an age, \"since 20XX\", \"for over N years\"",
    "- Any laboratory, manufacturer, university or partner named",
    "- Any certification, seal, award or accreditation (GMP, FDA-approved, clinically proven)",
    "- Any press mention or media logo",
    "- Any customer count, review count or star rating",
    "- Any claim that a product treats, cures or prevents a disease",
    "- Any superlative implying a measurable ranking (the best, number one, leading)",
    "",
    "Tone: plain, concrete, calm American English, first person plural. Short sentences, no em dashes, no marketing hype.",
    "",
    "Return ONLY a JSON object shaped exactly like this, with no prose around it:",
    '{ "text": "two short paragraphs separated by a blank line, 160 to 260 characters each" }',
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function parseText(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Réponse illisible");
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as { text?: string };
  if (!parsed.text?.trim()) throw new Error("Texte vide");
  return parsed.text.trim();
}

/**
 * Le repli, quand Kie ne sert pas Claude.
 *
 * Le bloc doit exister : un pied de page sans un mot sur la boutique se
 * remarque. Ce texte est plat mais tenable, et se réécrit d'un bouton.
 */
function fallbackText(site: EcomSite) {
  const categories = site.categories.map((category) => category.label).filter(Boolean);
  const range = categories.length ? categories.join(" and ").toLowerCase() : "a short range";

  return [
    `${site.brandName || "We"} sells ${range}. We keep the catalogue short so we can answer questions about every item on it, and we print the full formula on the pack rather than hide it behind a blend.`,
    `Orders ship from ${site.shipsFrom || "the United States"} in ${site.deliveryMinDays} to ${site.deliveryMaxDays} business days, and you have ${site.returnWindowDays} days to send anything back. Support answers ${site.supportHours || "on weekdays"}.`,
  ].join("\n\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.siteId) return NextResponse.json({ error: "siteId requis" }, { status: 400 });

    const stored = await getEcomSite(body.siteId);
    if (!stored) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
    // Le brouillon prime : c'est la boutique qu'on a sous les yeux.
    const site: EcomSite = { ...stored, ...(body.draft ?? {}) };

    const title = (body.title || "About").trim() || "About";

    let text = fallbackText(site);
    let written = false;
    try {
      const raw = await Promise.race([
        kieClaude(buildPrompt(site, title), 1200),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("trop long")), REWRITE_TIMEOUT_MS)
        ),
      ]);
      text = parseText(raw);
      written = true;
    } catch {
      // Texte de repli : la colonne existe quand même.
    }

    return NextResponse.json({ text, written });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération impossible" },
      { status: 502 }
    );
  }
}
