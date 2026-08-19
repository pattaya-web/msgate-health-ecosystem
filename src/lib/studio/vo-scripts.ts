import { scrapeProduct } from "@/lib/meta/ad-copy";
import { kieClaude } from "@/lib/studio/kie";
import { extractBriefUrls } from "@/lib/studio/expand";

export async function expandVoiceScripts(brief: string, count = 3) {
  const clean = brief.trim();
  if (!clean) return { scripts: [] as string[], productTitle: "" };
  const n = Math.min(8, Math.max(1, count));
  const urls = extractBriefUrls(clean);
  const instructions = clean.replace(/https?:\/\/[^\s)\]>'"]+/gi, " ").replace(/\s+/g, " ").trim();

  let facts = "";
  let productTitle = "";
  if (urls[0]) {
    try {
      const product = await scrapeProduct(urls[0]);
      productTitle = product.title;
      facts = [
        `Product URL: ${product.url}`,
        product.title ? `Name: ${product.title}` : "",
        product.price ? `Price: ${product.price}` : "",
        product.description ? `Description: ${product.description}` : "",
        product.text ? `Page text: ${product.text.slice(0, 3500)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } catch {
      facts = `Product URL: ${urls[0]}`;
    }
  }

  const context = [facts, instructions ? `User brief: ${instructions}` : "", !facts ? `Brief: ${clean}` : ""]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await kieClaude(
      `You write spoken UGC voice-over scripts for paid social ads (TikTok / Meta).

${context}

Write exactly ${n} distinct voice-over scripts.
Rules:
- Spoken out loud, 8–18 seconds each (about 25–45 words).
- Follow the user brief language. If the brief is French, write French. Otherwise US English.
- Use product facts from the page (name, benefit, price if useful). No fake claims.
- No stage directions, no [pause], no emojis, no hashtags, no "hey guys welcome back".
- Hook in the first sentence. One clear CTA at the end.
Return ONLY JSON: {"scripts":["..."]}`,
      4000
    );
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? (JSON.parse(match[0]) as { scripts?: unknown[] }) : null;
    const scripts = (parsed?.scripts || []).map((item) => String(item).trim()).filter(Boolean).slice(0, n);
    if (scripts.length) return { scripts, productTitle };
  } catch {
    // fallback below
  }

  const name = productTitle || "this";
  return {
    productTitle,
    scripts: Array.from({ length: n }, (_, i) => {
      const hooks = [
        `I was not expecting ${name} to work this fast.`,
        `Okay so if you have been looking at ${name}…`,
        `This is the part nobody tells you about ${name}.`,
      ];
      return `${hooks[i % hooks.length]} ${instructions || "It actually makes a difference."} Go check it before it sells out.`;
    }),
  };
}
