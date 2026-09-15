import type { CreativeRecord, PageContext, ProductRecord, QuickAction } from "./types";

/**
 * La couche que le CRM pose au-dessus du prompt système de Hermes (le serveur
 * d'API de Hermes « empile » un message system par-dessus le sien, sans rien
 * retirer à l'agent). Elle dit d'où vient la requête, ce que ce canal interdit,
 * et donne le contexte réel de la page : ids, noms, et le prompt exact stocké
 * quand une créa du Creative Engine est visée.
 */

const PAGE_LABEL: Record<PageContext["pageType"], string> = {
  dashboard: "Dashboard",
  ads: "Meta ads (campaign tree)",
  "ads-uploader": "Ads uploader",
  "mass-test": "Studio › Mass test (Creative Engine)",
  product: "Product view — a product is open on this page; « this product » / « the current product » is the one listed below",
  "product-creative-workspace": "Product Creative Workspace — the operator is producing creatives for the product listed below; « this product », « the current product », « the product I'm working on » all mean it",
  studio: "Studio",
  "studio-library": "Studio › Library",
  ugc: "UGC studio",
  drive: "Drive",
  "bank-pages": "Bank pages / e-commerce sites",
  spyshop: "SpyShop (competitor tracking)",
  phoenix: "Phoenix (payments CRM)",
  profit: "Profit",
  sav: "Support inbox",
  ecosystem: "Ecosystem (IBO / LLC / MID)",
  shopify: "Shopify",
  "product-images": "Product images",
  other: "CRM page",
};

const ACTION_BRIEF: Record<QuickAction, string> = {
  analyze:
    "TASK: analyse the attached creative as a performance-marketing operator. Cover: advertising angle, hook (headline / promise), composition and visual hierarchy, elements present (badges, arrows, price, social proof, before/after, product placement), typography and style, strengths, weaknesses, and the single change most likely to lift CTR. Compact bullet lists.",
  original:
    "TASK: the operator wants the ORIGINAL generation prompt. If the CRM CONTEXT below carries an ORIGINAL PROMPT, return it verbatim in a single code block, preceded by one line with the creative name, batch and status, and nothing else. If there is no ORIGINAL PROMPT (external or unknown creative), say plainly that the original prompt is not stored in the CRM, then offer a reconstructed prompt labelled as reconstructed.",
  reverse: [
    "TASK: REVERSE PROMPT. The operator wants a generation-ready image prompt reconstructed from the attached image, to paste directly into GPT Image / KIE. The prompt IS the deliverable: no marketing analysis, no « why it works », no strengths/weaknesses, no preamble. Start your answer with the heading below.",
    "",
    "Answer EXACTLY in this shape, nothing before, nothing after:",
    "",
    "LIKELY GENERATION PROMPT",
    "",
    "```",
    "[one detailed, directly reusable generation prompt, written as a single instruction to an image model: layout and composition, subject/model (age, gender, expression, pose, framing), product and its placement, every text element with its hierarchy and the visible wording when readable, badges, arrows, annotations, price elements, colors, typography style, lighting, camera look, background, ad aesthetic, and the aspect ratio]",
    "```",
    "",
    "STRUCTURE",
    "- Composition:",
    "- Subject:",
    "- Product:",
    "- Headline / text hierarchy:",
    "- Visual elements:",
    "- Marketing angle:",
    "- Visual style:",
    "- Lighting / camera look:",
    "- Background:",
    "- Ratio:",
    "",
    "Confidence: Low / Medium / High",
    "",
    "Rules:",
    "1. The generation prompt is always the main output; STRUCTURE is a one-line-per-item summary of what the prompt already contains. Keep the whole answer operational and concise.",
    "2. Reconstruct visual details as precisely as the image allows: layout, composition, typography hierarchy, badges, arrows, price elements, annotations, product placement, model/subject, camera style, lighting, colors, background, ad aesthetic.",
    "3. Preserve visible text verbatim when it is readable and useful (headline, labels, CTA); otherwise describe it generically.",
    "4. This is a reconstructed / likely prompt: never call it the original prompt and never claim it is what was actually used.",
    "5. Never present citations, studies, statistics or claims visible in the image as genuine or verified; if a citation or small text is visible but cannot be verified, describe it generically, e.g. « small academic-reference-style citations ».",
    "6. Infer the exact likely aspect ratio from the image (e.g. 3:4, 1:1, 9:16, 4:5) and state it in the prompt and under Ratio.",
    "7. If the operator asks to adapt the reference to the product in CRM CONTEXT (or to another product), write the prompt for that target product while preserving the reference creative's visual DNA (layout, hierarchy, elements, style, mood); otherwise describe the product as seen.",
    "8. If several images are attached, reverse the external / competitor one unless told otherwise, and say which image the prompt reconstructs in one short line after Confidence.",
  ].join("\n"),
  angle:
    "TASK: identify the advertising angle of the attached creative: the angle in one line, the underlying desire or pain it targets, the awareness level it speaks to, the proof mechanism used, and two alternative angles worth testing for the same product. Compact.",
  variations:
    "TASK: propose exactly 5 variations of the attached creative as TEXT BRIEFS ONLY (no image generation, no tool call that creates images). For each: a short name, what changes versus the current creative, the hook, the visual description in one or two lines, and the ratio. Number them 1 to 5.",
};

function quote(value: string) {
  return JSON.stringify(value);
}

function contextLines(context: PageContext | null, creative: CreativeRecord | null, product: ProductRecord | null): string[] {
  const lines: string[] = [];
  if (context) {
    lines.push(`- Page: ${context.route || "/"} — ${PAGE_LABEL[context.pageType] ?? "CRM page"}`);
    if (context.storeName || context.storeId) lines.push(`- Store: ${context.storeName ?? "?"}${context.storeId ? ` (id ${context.storeId})` : ""}`);
    if (context.productName || context.productId) {
      lines.push(`- Product: ${context.productName ?? "?"}${context.productId ? ` (id ${context.productId})` : ""}${context.productUrl ? ` — ${context.productUrl}` : ""}`);
    }
    if (context.primaryReferenceUrl) {
      lines.push(`- Primary product reference (${context.primaryReferenceType ?? "primary"}): ${context.primaryReferenceUrl} — the physical visual source of truth for this product (shape, proportions, colors, materials). It is sent to the image model at generation time. Any image attached in the chat is inspiration or a competitor creative, never a replacement for this product.`);
    }
    if (product) {
      const weak = product.engine === "fallback" ? " (keyword fallback, no AI analysis yet: treat these fields as weak)" : "";
      lines.push(`- Product sheet from the CRM Creative Engine${weak}: ${[product.category && `category ${product.category}`, product.productType && `type ${product.productType}`, product.productClass && `class ${product.productClass}`, product.store && `store ${product.store}`].filter(Boolean).join("; ")}`);
      if (product.targetCustomer) lines.push(`  - target customer: ${product.targetCustomer}`);
      if (product.mainProblem) lines.push(`  - main problem: ${product.mainProblem}`);
      if (product.mechanism) lines.push(`  - mechanism: ${product.mechanism}`);
      if (product.transformation) lines.push(`  - transformation: ${product.transformation}`);
      if (product.benefits.length) lines.push(`  - benefits: ${product.benefits.join(" | ")}`);
      if (product.features.length) lines.push(`  - physical / visual points: ${product.features.join(" | ")}`);
      if (product.angles.length) lines.push(`  - angles already identified: ${product.angles.join(" | ")}`);
    }
    if (context.campaignName || context.campaignId) lines.push(`- Meta campaign: ${context.campaignName ?? "?"}${context.campaignId ? ` (id ${context.campaignId})` : ""}`);
    if (context.adsetName || context.adsetId) lines.push(`- Meta ad set: ${context.adsetName ?? "?"}${context.adsetId ? ` (id ${context.adsetId})` : ""}`);
    if (context.adName || context.adId) lines.push(`- Meta ad: ${context.adName ?? "?"}${context.adId ? ` (id ${context.adId})` : ""}`);
    if (!creative && (context.batchId || context.batchNumber)) {
      lines.push(`- Creative batch: ${context.batchNumber ? `#${String(context.batchNumber).padStart(3, "0")}` : "?"}${context.batchId ? ` (id ${context.batchId})` : ""}`);
    }
    if (!creative && (context.creativeName || context.creativeId)) {
      lines.push(`- Creative: ${context.creativeName ?? "?"}${context.creativeId ? ` (id ${context.creativeId})` : ""} — metadata not loaded`);
    }
  }
  if (creative) {
    const batchNo = `#${String(creative.batchNumber).padStart(3, "0")}`;
    lines.push(`- Creative batch: ${batchNo} (id ${creative.batchId}) — store ${creative.store}, product ${creative.productName} (id ${creative.productId}), ratio ${creative.ratio}, resolution ${creative.resolution}, emphasis ${creative.emphasis}`);
    if (creative.instructions.trim()) lines.push(`- Operator instructions for this batch: ${quote(creative.instructions.trim())}`);
    lines.push(
      `- Creative: ${creative.name} (id ${creative.creativeId}) — status ${creative.status}, generation ${creative.state}${creative.generatedAt ? ` on ${creative.generatedAt}` : ""}, model ${creative.model}${creative.referenceUsed ? ", product reference image used" : ""}`
    );
    lines.push(`  - family: ${creative.family.label} (${creative.family.id}); angle: ${creative.angle.name} (${creative.angle.id}); hook: ${quote(creative.hook)}`);
    lines.push(`  - layout: ${creative.layout}; preset: ${creative.preset.name} (${creative.preset.id}); variation ${creative.variation} (${creative.strategy}); product visibility: ${creative.productVisibility}`);
    if (creative.subject) lines.push(`  - subject: ${creative.subject.gender}, ${creative.subject.ageRange}${creative.subject.notes ? ` — ${creative.subject.notes}` : ""}`);
    if (creative.visualConcept) lines.push(`  - visual concept: ${quote(creative.visualConcept)}`);
    lines.push(`- ORIGINAL PROMPT (exact, stored by the Creative Engine at generation time):`);
    lines.push('"""');
    lines.push(creative.prompt.trim());
    lines.push('"""');
  }
  return lines;
}

export type SystemLayerInput = {
  environment: string;
  context: PageContext | null;
  creative: CreativeRecord | null;
  /** Fiche du produit en contexte, quand c'est un produit du Creative Engine. */
  product?: ProductRecord | null;
  action?: QuickAction;
  externalImages: number;
  crmImageAttached: boolean;
};

export function systemLayer(input: SystemLayerInput): string {
  const parts: string[] = [];
  parts.push(
    [
      "## CHANNEL: MSGate CRM — « Ask Hermes » panel",
      `You are being reached from inside the MSGate CRM (environment: ${input.environment.toUpperCase()}), not from Telegram. You are the same Hermes: same memory, skills, MCP tools and MGATE business rules. Only the channel differs.`,
      "",
      "Rules for this channel:",
      "- READ-ONLY toward the business. Do not generate images (no KIE / image-generation tool), do not launch creative batches, do not create, pause or edit ads, ad sets, campaigns or budgets, do not refund, do not write to Airtable, Phoenix, Shopify or Disputifier, do not delete anything. If the operator asks for such an action, say it is not available from this panel and give the brief, prompt or plan instead. Reading through the msgate-crm MCP tools is fine.",
      "- The CRM CONTEXT below is authoritative data from the CRM database. « this product », « this batch », « this creative », « this ad » refer to it. Never invent ids, names, metrics or file names; if something is not in the context, say so or read it through a tool.",
      "- When an ORIGINAL PROMPT is present it is the exact prompt stored by the Creative Engine: reproduce it verbatim when asked, never paraphrase it, and never call any other prompt « original ». For any external or unknown image, every prompt you propose is a reconstructed / likely prompt and must be labelled as such.",
      "- Attached images arrive inline as image parts; analyse what is visible.",
      "- When you write image-generation prompts, put each complete prompt in its own ``` code block (one block per image), preceded by one line « Angle: … » and followed by one line « Hook: … » when relevant. You never generate images yourself: the operator can send those blocks to the CRM Creative Engine (Kie) after an explicit confirmation step in the panel.",
      "- Reply in the operator's language (they usually write French; keep product names and prompts in English). Be compact and operational. Markdown is rendered; put prompts in code blocks.",
    ].join("\n")
  );
  if (input.action) parts.push(ACTION_BRIEF[input.action]);
  const lines = contextLines(input.context, input.creative, input.product ?? null);
  if (lines.length) parts.push(["## CRM CONTEXT", ...lines].join("\n"));
  const attachments: string[] = [];
  if (input.crmImageAttached && input.creative) attachments.push(`- Image 1 is the CRM creative ${input.creative.name} (generated by our Creative Engine; its metadata and ORIGINAL PROMPT are in CRM CONTEXT).`);
  if (input.externalImages > 0) {
    const offset = input.crmImageAttached ? 1 : 0;
    attachments.push(
      `- ${input.externalImages === 1 ? `Image ${offset + 1} is` : `Images ${offset + 1} to ${offset + input.externalImages} are`} external (uploaded by the operator, NOT generated by our Creative Engine: no original prompt exists in the CRM).`
    );
  }
  if (attachments.length) parts.push(["## ATTACHMENTS", ...attachments].join("\n"));
  return parts.join("\n\n");
}

/** Le texte du tour utilisateur : le message, plus une mention courte des pièces jointes. */
export function userText(message: string, input: { creative: CreativeRecord | null; crmImageAttached: boolean; externalImages: Array<{ name: string }> }): string {
  const notes: string[] = [];
  if (input.crmImageAttached && input.creative) notes.push(`[attached: CRM creative ${input.creative.name}, batch #${String(input.creative.batchNumber).padStart(3, "0")}]`);
  for (const image of input.externalImages) notes.push(`[attached external image: ${image.name}]`);
  const text = message.trim();
  if (!notes.length) return text;
  return text ? `${text}\n\n${notes.join("\n")}` : notes.join("\n");
}
