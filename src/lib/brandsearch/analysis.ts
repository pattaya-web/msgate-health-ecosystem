import { askHermesText, askHermesVision, hermesAnalysisAvailable, hermesCannotSee } from "@/lib/creative-engine/hermes-analysis";
import { parseLenientJson } from "@/lib/creative-engine/workspace-plan";
import { uploadBase64 } from "@/lib/studio/kie";
import { brandWordOf, SIGNALS_NOTE, type CompetitorAnalysis, type CompetitorCreative, type CreativeAnalysis, type CreativePattern } from "@/lib/brandsearch/types";

/**
 * L'analyse visuelle des pubs concurrentes choisies par l'opérateur : Hermes
 * reçoit les images (URL Brand Search, qu'il charge lui-même) et le texte de
 * chaque pub, décrit l'ADN créatif de chacune, regroupe les motifs récurrents
 * et recommande — sans imposer. Aucune génération, rien d'écrit.
 */

export const MAX_ANALYZED_CREATIVES = 12;

const SYSTEM =
  "You are the competitor-creative analyst of the MSGate CRM Creative Engine. You look at the attached ad images yourself and answer with the requested JSON object ONLY: no prose, no markdown fences. Read-only task: do not browse beyond the attached images, do not call tools that write or generate anything.";

export class VisionUnavailableError extends Error {}

function signalLine(creative: CompetitorCreative): string {
  const s = creative.signals;
  const parts = [
    s.euTotalSpend !== null ? `EU spend ≈ €${Math.round(s.euTotalSpend).toLocaleString("en-US")}` : null,
    s.euDailySpend !== null ? `daily ≈ €${Math.round(s.euDailySpend)}` : null,
    s.euTotalReach !== null ? `EU reach ≈ ${Math.round(s.euTotalReach).toLocaleString("en-US")}` : null,
    s.reachRank !== null ? `reach rank ${s.reachRank}` : null,
    s.activeDays !== null ? `${s.activeDays} days active` : null,
    s.duplicateCount !== null ? `${s.duplicateCount} duplicate variant(s)` : null,
    creative.status !== "unknown" ? creative.status : null,
  ].filter(Boolean);
  return parts.join(", ") || "no signals";
}

export function analysisPrompt(input: { domain: string; creatives: CompetitorCreative[]; productName?: string | null; withClusters?: boolean }): string {
  const list = input.creatives
    .map((creative, index) =>
      [
        `Image ${index + 1} — ad id ${creative.id}${creative.adId ? ` (Meta ${creative.adId})` : ""}, ${input.domain}, ${signalLine(creative)}`,
        creative.headline ? `  headline: ${JSON.stringify(creative.headline)}` : "",
        creative.primaryText ? `  primary text: ${JSON.stringify(creative.primaryText.slice(0, 400))}` : "",
        creative.cta?.text ? `  CTA: ${creative.cta.text}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");
  const product = input.productName ? `The operator's own product is « ${input.productName} »; it is NOT in these images.` : "";
  return `Analyse the ${input.creatives.length} competitor static ads attached as images, in order (Image 1 = first ad below). Look at each image; the ad copy below is metadata, not a substitute for the picture.

ADS:
${list}

${product}
For EACH ad, describe from the image: creative archetype (e.g. before/after transformation, scientific authority / anatomy explainer, product + benefit callouts, provocative headline + visual proof, testimonial / UGC, comparison, offer / price block), marketing angle, hook mechanism, visual layout, headline hierarchy, subject / model, product placement, visual elements present (arrows, callouts, badges, post-it, annotations, price block, CTA, icons, before/after split, scientific diagrams), visual proof, colour strategy, direct-response structure. List in "competitorFacts" ONLY the product- or brand-specific wording written or shown on the ad (brand and product names, slogans, claims, guarantees, country of origin, materials, certifications, statistics, studies, prices) as written — never layout, colours or style.

${input.withClusters !== false ? `Then CLUSTER the ads into 3 to 6 recurring creative patterns (the creative DNA that repeats), each naming which ad ids belong to it, and recommend which ads are the most useful models (with a one-line reason) — the operator decides.

${SIGNALS_NOTE}

Return ONLY this JSON:
{"seen": true, "creatives": [{"id": "", "archetype": "", "angle": "", "hookMechanism": "", "layout": "", "subject": "", "productPlacement": "", "elements": [""], "proof": "", "colorStrategy": "", "competitorFacts": [""]}], "patterns": [{"name": "", "description": "", "mechanism": "", "adIds": [""]}], "recommended": [{"id": "", "why": ""}]}` : `Return ONLY this JSON (no patterns yet, they are clustered in a later step):
{"seen": true, "creatives": [{"id": "", "archetype": "", "angle": "", "hookMechanism": "", "layout": "", "subject": "", "productPlacement": "", "elements": [""], "proof": "", "colorStrategy": "", "competitorFacts": [""]}]}`}
If you truly cannot see the images, return {"seen": false, "reason": "..."} and nothing else.`;
}

/** Le regroupement, en texte seul, à partir des lectures par pub : motifs récurrents et recommandations. */
export function clusterPrompt(input: { domain: string; creatives: CompetitorCreative[]; analyses: CreativeAnalysis[]; productName?: string | null }): string {
  const byId = new Map(input.creatives.map((creative) => [creative.id, creative]));
  const lines = input.analyses
    .map((analysis) => {
      const creative = byId.get(analysis.id);
      return `- ad ${analysis.id}${creative ? ` (${signalLine(creative)})` : ""}: ${analysis.archetype} — angle: ${analysis.angle}; hook: ${analysis.hookMechanism}; layout: ${analysis.layout}; elements: ${analysis.elements.join(", ")}; proof: ${analysis.proof}; colours: ${analysis.colorStrategy}`;
    })
    .join("\n");
  return `Here are your own visual analyses of ${input.analyses.length} static ads from ${input.domain}${input.productName ? ` (the operator's own product is « ${input.productName} », not in these ads)` : ""}:
${lines}

CLUSTER them into 3 to 6 recurring creative patterns — the creative DNA that repeats across the ads — each with a name, a description, the mechanism that makes it work, and the ad ids that belong to it. Then recommend which ads are the most useful models for the operator, with a one-line reason each, using only the signals given. ${SIGNALS_NOTE} The operator decides; you recommend.

Return ONLY this JSON:
{"patterns": [{"name": "", "description": "", "mechanism": "", "adIds": [""]}], "recommended": [{"id": "", "why": ""}]}`;
}

const str = (value: unknown, max = 400) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const strings = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length >= 2).map((entry) => entry.trim().slice(0, 120)).slice(0, max) : []);

export function parseAnalysis(raw: string, creatives: CompetitorCreative[]): { seen: boolean; reason?: string; creatives: CreativeAnalysis[]; patterns: CreativePattern[]; recommended: Array<{ id: string; why: string }> } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("l'analyse n'a pas renvoyé de JSON");
  const parsed = parseLenientJson<{ seen?: unknown; reason?: unknown; creatives?: unknown; patterns?: unknown; recommended?: unknown }>(raw.slice(start, end + 1));
  if (parsed.seen === false) return { seen: false, reason: str(parsed.reason), creatives: [], patterns: [], recommended: [] };
  const known = new Set(creatives.map((creative) => creative.id));
  const byIndex = (value: unknown, position: number) => {
    const id = str(value, 80);
    if (known.has(id)) return id;
    // Hermes numérote parfois « Image 3 » au lieu de l'identifiant : on retombe sur l'ordre d'envoi.
    const match = /(\d+)/.exec(id);
    const index = match ? Number(match[1]) - 1 : position;
    return creatives[index]?.id ?? creatives[position]?.id ?? id;
  };
  const list = Array.isArray(parsed.creatives) ? parsed.creatives : [];
  const analysed: CreativeAnalysis[] = list.map((entry, position) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    return {
      id: byIndex(record.id, position),
      archetype: str(record.archetype, 120),
      angle: str(record.angle, 200),
      hookMechanism: str(record.hookMechanism, 300),
      layout: str(record.layout, 400),
      subject: str(record.subject, 200),
      productPlacement: str(record.productPlacement, 200),
      elements: strings(record.elements, 16),
      proof: str(record.proof, 300),
      colorStrategy: str(record.colorStrategy, 200),
      competitorFacts: strings(record.competitorFacts, 20),
    };
  });
  // Une pub que Hermes n'a pas pu lire revient vide : elle n'est pas « analysée », la galerie le montre et l'inspiration l'ignore.
  const readable = analysed.filter((creative) => creative.archetype || creative.elements.length || creative.angle);
  if (!readable.length) throw new Error("l'analyse ne décrit aucune pub");
  analysed.splice(0, analysed.length, ...readable);
  const patterns: CreativePattern[] = (Array.isArray(parsed.patterns) ? parsed.patterns : []).map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    return { name: str(record.name, 120), description: str(record.description, 600), mechanism: str(record.mechanism, 400), adIds: strings(record.adIds, 30).map((id, position) => byIndex(id, position)).filter((id) => known.has(id)) };
  }).filter((pattern) => pattern.name);
  const recommended = (Array.isArray(parsed.recommended) ? parsed.recommended : []).map((entry, position) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    return { id: byIndex(record.id, position), why: str(record.why, 300) };
  }).filter((entry) => known.has(entry.id));
  return { seen: true, creatives: analysed, patterns, recommended };
}

async function rehost(url: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return url;
    const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!type.startsWith("image/")) return url;
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > 6_000_000) return url;
    return await uploadBase64(`data:${type};base64,${data.toString("base64")}`, `competitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${type.includes("png") ? "png" : "jpg"}`);
  } catch {
    return url;
  }
}

/** Hermes regarde environ 40 s par image : les pubs partent par lots de 4 en parallèle, puis un tour texte dégage les motifs. */
export const ANALYSIS_CHUNK = 4;
const PER_IMAGE_MS = 60_000;

/** Hermes regarde les pubs sélectionnées (URLs Brand Search, rapatriées) et rend l'ADN de chacune, les motifs et ses recommandations. */
export async function analyzeCompetitorCreatives(input: { domain: string; creatives: CompetitorCreative[]; productName?: string | null }): Promise<CompetitorAnalysis> {
  if (!hermesAnalysisAvailable()) throw new Error("Hermes non configuré (HERMES_API_URL / HERMES_API_SERVER_KEY)");
  const creatives = input.creatives.filter((creative) => creative.imageUrl || creative.imageOriginalUrl).slice(0, MAX_ANALYZED_CREATIVES);
  if (!creatives.length) throw new Error("Aucune pub avec image à analyser");
  // Le CDN de Brand Search refuse parfois le lecteur d'Hermes (451) : chaque image est rapatriée ici puis servie depuis le dépôt de fichiers que Hermes lit sans faute ; à défaut, l'URL d'origine.
  const images = await Promise.all(creatives.map(async (creative) => {
    const original = creative.imageOriginalUrl ? await rehost(creative.imageOriginalUrl) : null;
    return original && original !== creative.imageOriginalUrl ? original : rehost((creative.imageUrl ?? creative.imageOriginalUrl) as string);
  }));
  const chunks: Array<{ creatives: CompetitorCreative[]; images: string[] }> = [];
  for (let start = 0; start < creatives.length; start += ANALYSIS_CHUNK) chunks.push({ creatives: creatives.slice(start, start + ANALYSIS_CHUNK), images: images.slice(start, start + ANALYSIS_CHUNK) });
  const single = chunks.length === 1;
  const readings = await Promise.all(
    chunks.map(async (chunk) => {
      const prompt = analysisPrompt({ ...input, creatives: chunk.creatives, withClusters: single });
      const read = async (extra: string) => {
        const raw = await askHermesVision(prompt + extra, SYSTEM, chunk.images, chunk.images.length * PER_IMAGE_MS + 60_000);
        if (hermesCannotSee(raw) && raw.indexOf("{") < 0) throw new VisionUnavailableError("Le modèle Hermes actuel ne voit pas les images.");
        return parseAnalysis(raw, chunk.creatives);
      };
      // Un JSON cassé (valeur sans guillemets, virgule en trop) vaut un second passage, une seule fois.
      const parsed = await read("").catch(async (error) => {
        if (error instanceof VisionUnavailableError) throw error;
        return read(`\n\nPREVIOUS ANSWER WAS NOT VALID JSON (${error instanceof Error ? error.message.slice(0, 120) : "invalid"}). Return the JSON object only, every string value double-quoted, no comments, no trailing commas.`);
      });
      if (!parsed.seen) throw new VisionUnavailableError(`Hermes n'a pas pu voir les pubs${parsed.reason ? ` — ${parsed.reason}` : ""}.`);
      return parsed;
    })
  );
  const brand = brandWordOf(input.domain);
  const analysed = readings.flatMap((reading) => reading.creatives).map((creative) => ({ ...creative, competitorFacts: [...new Set([brand, ...creative.competitorFacts])] }));
  let patterns: CreativePattern[] = readings[0]?.patterns ?? [];
  let recommended = readings[0]?.recommended ?? [];
  if (!single) {
    const prompt = clusterPrompt({ domain: input.domain, creatives, analyses: analysed, productName: input.productName });
    const cluster = async (extra: string) => {
      const raw = await askHermesText(prompt + extra, SYSTEM);
      const body = raw.slice(raw.indexOf("{") + 1, raw.lastIndexOf("}"));
      return parseAnalysis(`{"seen": true, "creatives": ${JSON.stringify(analysed)}, ${body}}`, creatives);
    };
    const clustered = await cluster("").catch(async (error) => cluster(`\n\nPREVIOUS ANSWER WAS NOT VALID JSON (${error instanceof Error ? error.message.slice(0, 120) : "invalid"}). Return the JSON object only, every string value double-quoted, no trailing commas.`));
    patterns = clustered.patterns;
    recommended = clustered.recommended;
  }
  return {
    domain: input.domain,
    analyzedIds: creatives.map((creative) => creative.id),
    creatives: analysed,
    patterns,
    recommended,
    signalsNote: SIGNALS_NOTE,
    engine: "hermes",
    analyzedAt: new Date().toISOString(),
  };
}
