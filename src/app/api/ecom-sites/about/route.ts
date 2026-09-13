import { NextResponse } from "next/server";
import { createKieTask, getKieTask, kieClaude } from "@/lib/studio/kie";
import { getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import { sitePalette, type EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TRANSIENT = /rate|limit|429|timeout|busy|saturé|too many|frequency/i;
const REWRITE_TIMEOUT_MS = 60_000;

type Body = { action?: "generate" | "status"; siteId?: string; taskId?: string };

type Story = {
  heading: string;
  paragraphs: string[];
  points: Array<{ title: string; body: string }>;
};

/**
 * Ce qu'un récit de marque peut dire, et ce qu'il ne doit jamais dire.
 *
 * Une page « à propos » est l'une des premières qu'un analyste de souscription
 * ouvre : son absence est un signal, mais son contenu se vérifie. Un fondateur
 * nommé, une année de création, un laboratoire partenaire, une certification,
 * une mention presse — tout cela se recoupe en quelques minutes, et un seul
 * élément faux ferme le dossier bien plus sûrement qu'une page absente.
 *
 * Le récit reste donc positionnel : ce que la marque vend, à qui, comment la
 * gamme est choisie, ce qu'elle promet après l'achat. Vrai par construction,
 * parce que ce sont des intentions et non des faits datés.
 */
function buildPrompt(site: EcomSite) {
  const names = site.products.slice(0, 10).map((product) => product.name).filter(Boolean);
  const categories = site.categories.map((category) => category.label).filter(Boolean);

  return [
    `Write the "About us" page copy for a US direct-to-consumer brand called "${site.brandName}".`,
    "",
    "This store will be submitted to a payment processor for merchant underwriting. An analyst will read this page and cross-check anything checkable. Your copy must therefore contain nothing that can be verified and found false.",
    "",
    "What the brand sells:",
    categories.length ? `Categories: ${categories.join(", ")}.` : "",
    names.length ? `Products: ${names.join("; ")}.` : "",
    site.promise ? `Existing promise text: ${site.promise}` : "",
    "",
    "ABSOLUTELY FORBIDDEN, in any form:",
    "- A founder or team member name, or any personal biography",
    "- A founding year, an age, \"since 20XX\", \"for over N years\", \"three generations\"",
    "- Any laboratory, manufacturer, university or partner named",
    "- Any certification, seal, award, ranking or accreditation (GMP, FDA-approved, organic certified, clinically proven)",
    "- Any press mention, publication or media logo",
    "- Any customer count, review count, star rating",
    "- Any charitable partnership, donation percentage or cause",
    "- Any employee count, office, warehouse or facility claim",
    "- Any claim that a product treats, cures or prevents a disease",
    "- Any superlative implying a measurable ranking (the best, number one, leading)",
    "",
    "WHAT TO WRITE INSTEAD, positioning rather than history:",
    "- Why this range and not a bigger catalogue",
    "- Who the products are for, in plain terms",
    "- How the brand decides what goes on a label and what stays off",
    "- What the customer can expect after ordering: shipping, returns, reaching support",
    "- The brand's point of view on its category",
    "",
    "Tone: plain, concrete, calm American English, first person plural. No em dashes, no marketing hype, short sentences. It should read like a small team explaining itself honestly, not an agency brochure.",
    "",
    "Return ONLY a JSON object shaped exactly like this:",
    "{",
    '  "heading": "short page heading, under 50 characters",',
    '  "paragraphs": ["three paragraphs, 220 to 320 characters each"],',
    '  "points": [ { "title": "three or four words", "body": "one or two sentences" } ]',
    "}",
    "Give exactly 3 paragraphs and exactly 3 points.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function parseJson(raw: string): Story {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Réponse illisible");
  return JSON.parse(candidate.slice(start, end + 1)) as Story;
}

/**
 * Le repli, quand aucun modèle de langage n'est disponible.
 *
 * La page doit exister : une boutique sans « à propos » se remarque en
 * souscription. Ce texte est plat mais tenable, et se réécrit d'un bouton
 * quand Kie répond de nouveau.
 */
function fallbackStory(site: EcomSite): Story {
  const categories = site.categories.map((category) => category.label).filter(Boolean);
  const range = categories.length ? categories.join(" and ").toLowerCase() : "our category";

  return {
    heading: `About ${site.brandName}`,
    paragraphs: [
      `${site.brandName} sells a short range in ${range}. We would rather stand behind a handful of products than list a catalogue we cannot answer questions about. Every item here earns its place, and we drop the ones that stop earning it.`,
      "We print the full formula on the label, including the parts that are not exciting. If an ingredient is in there at a token amount, we leave it out rather than list it for the sake of the label. What is on the pack is what is in the pack.",
      `Orders ship from ${site.shipsFrom || "the United States"} in ${site.deliveryMinDays} to ${site.deliveryMaxDays} business days, and you have ${site.returnWindowDays} days to send anything back. Support answers on ${site.supportEmail || "email"} and ${site.supportPhone || "the phone"}, ${site.supportHours || "on weekdays"}.`,
    ],
    points: [
      { title: "A short range", body: "We sell a handful of products, not a catalogue. Each one has a reason to exist." },
      { title: "Full labels", body: "Every active and its dose is printed on the pack. Nothing hides behind a proprietary blend." },
      { title: "Easy returns", body: `Send it back within ${site.returnWindowDays} days for a refund. No forms, no argument.` },
    ],
  };
}

/**
 * La scène qui accompagne le récit : un atelier, pas un portrait inventé.
 *
 * Un visage sur une page « à propos » se lit comme celui d'un fondateur. Faire
 * inventer une personne à un modèle d'image, sur un site soumis à
 * souscription, revient à mettre en ligne un faux dirigeant. Des mains, un
 * plan de travail, des commandes en préparation : la scène raconte l'activité
 * sans prétendre montrer quelqu'un.
 */
function imagePrompt(site: EcomSite, hasPack: boolean) {
  const theme = sitePalette(site.themeId, site.brandColors);
  return [
    hasPack
      ? "THE ATTACHED IMAGES ARE MY REAL PRODUCTS, and they are the only packaging allowed in this photograph. Reproduce each pack exactly as supplied, with its brand logo readable. Never invent another container."
      : "No branded packaging, no invented logos, no legible label text.",
    "Photograph for a brand's About page: a small workspace where orders are prepared.",
    "A clean table, a few packs set out, kraft mailers, a notebook, a roll of tape,",
    "one pair of hands mid-task. HANDS ONLY: no face, no portrait, no person identifiable.",
    `Colour world: ${theme.accent} accents against ${theme.sand}.`,
    "Shot on a 50mm lens at f/2.0, soft north-facing window light from the left with",
    "one consistent shadow, muted slightly desaturated grade, gentle film grain.",
    "Real surfaces with dust and small marks, real skin with pores, slight asymmetry.",
    "AVOID: airbrushed skin, glowing rim light with no source, perfect symmetry,",
    "CGI renders, stock-photo blandness, mangled fingers, garbled text, invented logos.",
  ].join(" ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;

    if (body.action === "status") {
      if (!body.taskId) return NextResponse.json({ error: "taskId requis" }, { status: 400 });
      try {
        const task = await getKieTask(body.taskId);
        return NextResponse.json({ state: task.state, urls: task.urls, failMsg: task.failMsg ?? null });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Statut illisible";
        // Une limite de cadence ne veut pas dire que la tâche a échoué.
        if (TRANSIENT.test(message)) return NextResponse.json({ state: "pending", urls: [] });
        return NextResponse.json({ state: "fail", urls: [], failMsg: message });
      }
    }

    if (!body.siteId) return NextResponse.json({ error: "siteId requis" }, { status: 400 });
    const site = await getEcomSite(body.siteId);
    if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });

    /*
     * Le texte ne dépend pas du modèle de langage pour exister.
     *
     * Kie coupe l'accès à Claude par périodes ; attendre sans borne ferait
     * échouer une page qu'on sait écrire soi-même. On borne, et on retombe sur
     * un texte tenable si rien ne répond.
     */
    let story = fallbackStory(site);
    let written = false;
    try {
      const raw = await Promise.race([
        kieClaude(buildPrompt(site), 2000),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("trop long")), REWRITE_TIMEOUT_MS)
        ),
      ]);
      const parsed = parseJson(raw);
      if (parsed.paragraphs?.length) {
        story = {
          heading: parsed.heading || `About ${site.brandName}`,
          paragraphs: parsed.paragraphs.slice(0, 4),
          points: (parsed.points || []).slice(0, 4),
        };
        written = true;
      }
    } catch {
      // Texte de repli : la page existe quand même.
    }

    // Les packs déjà brandés entrent dans la scène, comme pour les visuels.
    const packs = site.products
      .filter((product) => product.imageUrl && product.imageUrl !== product.sourceImageUrl)
      .map((product) => product.imageUrl)
      .slice(0, 3);

    let taskId: string | null = null;
    let imageError: string | null = null;
    try {
      taskId = await createKieTask(
        packs.length ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
        {
          prompt: imagePrompt(site, packs.length > 0),
          ...(packs.length ? { input_urls: packs } : {}),
          aspect_ratio: "4:3",
          resolution: "1K",
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image impossible";
      imageError = TRANSIENT.test(message) ? "Kie saturé — relance l'image" : message;
    }

    await updateEcomSite(site.id, { aboutStory: story, aboutTaskId: taskId });

    return NextResponse.json({ story, taskId, written, imageError });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération impossible" },
      { status: 502 }
    );
  }
}
