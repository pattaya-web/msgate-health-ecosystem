import type { Brief } from "@/lib/creative-pipeline/store";

/**
 * Le prompt image d'un brief, à coller dans le Studio IA (avec les photos du
 * produit en référence) : le bloc commun (fidélité produit, deux colliers
 * identiques, safe zones) puis ce que dit le brief. Module sans dépendance
 * serveur.
 */

export const COMMON_BLOCK = [
  "PRODUCT FIDELITY: the necklaces must match the reference product photos exactly: same chain, same pendant shape, same metal colour and finish, same proportions and size on the body. No invented details, no extra text or logo on the product.",
  "TWO IDENTICAL NECKLACES: show exactly two identical necklaces (buy one, get one), both fully visible and in focus.",
  "SAFE ZONES: keep the product, the headline, the badge and the price inside the central area; leave the top 14 % and the bottom 20 % of the image free of key elements (Stories and Reels interface).",
  "STYLE: photoreal, sharp, natural light, real skin texture, no AI look, no watermark.",
].join("\n");

export function briefPrompt(brief: Pick<Brief, "format" | "formats" | "angle" | "headline" | "badge" | "visual" | "price" | "type" | "swap">) {
  const lines = [
    COMMON_BLOCK,
    "",
    `FORMAT: ${brief.format === "V" ? "first frame of a vertical video ad" : "static image ad"}, ${(brief.formats.length ? brief.formats : ["3:4", "1:1"]).join(" and ")}.`,
    brief.angle ? `ANGLE: ${brief.angle}.` : "",
    brief.visual ? `SCENE: ${brief.visual.replace(/\s*\n\s*/g, " ")}` : "",
    brief.headline ? `HEADLINE (exact text, large, readable on mobile): "${brief.headline}".` : "",
    brief.badge ? `BADGE (exact text, small round or ribbon badge): "${brief.badge}".` : "",
    brief.price ? `PRICE DISPLAY: ${brief.price.replace(/barré/gi, "with a strikethrough on")}.` : "",
    brief.type === "Itération" && brief.swap ? `ITERATION: ${brief.swap} of the original ad; keep everything else identical to it.` : "",
  ];
  return lines.filter((line, index) => line || index === 1).join("\n");
}

/** Le mercredi qui vient (ou aujourd'hui si on est mercredi), « YYYY-MM-DD » : validation 18 h, upload jeudi 9 h. */
export function defaultDeadline(today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + ((3 - weekday + 7) % 7));
  return date.toISOString().slice(0, 10);
}
