import type { Ratio } from "@/lib/studio/ratios";
import { creativeName } from "./naming";
import type { BatchItem, ProductContext, TestBatch } from "./types";

/**
 * Un lot construit à partir de prompts déjà écrits (Ask Hermes) plutôt que
 * planifiés par le moteur. Pure : aucun appel Kie, aucune écriture ; le store
 * enregistre puis lance chaque créa avec la même mécanique qu'un lot normal.
 * Le prompt est conservé tel quel : c'est exactement ce qui part au modèle.
 */

export type PromptBatchSource = "ask-hermes";

export type PromptSpec = {
  prompt: string;
  angle?: string;
  hook?: string;
  label?: string;
};

export type PromptBatchSpec = {
  source: PromptBatchSource;
  /** Produit du CRM quand la page en affichait un ; sinon un nom seul. */
  productId?: string | null;
  productName: string;
  productUrl?: string;
  store?: string;
  prompts: PromptSpec[];
  ratio: Ratio;
  resolution: "1K" | "2K";
  /** Références envoyées explicitement (image jointe dans le chat), déjà hébergées. */
  referenceUrls: string[];
  /** Photos produit du CRM comme entrées image-to-image, seulement si l'opérateur l'a coché. */
  productImageUrls: string[];
  sessionId?: string | null;
  referenceFrameworkId?: string | null;
};

export const ASK_HERMES_FAMILY = { id: "ASK_HERMES", label: "Ask Hermes" } as const;

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40) || "produit";
}

export function buildPromptBatch(input: {
  spec: PromptBatchSpec;
  product: ProductContext | null;
  number: number;
  ids: { batch: string; items: string[] };
  now?: string;
}): TestBatch {
  const { spec, product, number, ids } = input;
  const store = product?.store ?? spec.store?.trim() ?? "Ask Hermes";
  const productName = product?.name ?? spec.productName.trim();
  const inputs = [...spec.referenceUrls, ...spec.productImageUrls];
  const model = inputs.length ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image";
  const items: BatchItem[] = spec.prompts.map((entry, index) => {
    const angle = entry.angle?.trim() || "Ask Hermes";
    return {
      id: ids.items[index],
      name: creativeName(store, productName, angle, ASK_HERMES_FAMILY.label, index + 1),
      prompt: entry.prompt.trim(),
      taskId: null,
      state: "pending",
      error: null,
      urls: [],
      file: null,
      status: "generated",
      model,
      referenceUsed: spec.referenceUrls.length > 0,
      generatedAt: null,
      parentId: null,
      angleId: `hermes-${slug(angle)}`,
      angleName: angle,
      presetId: "ask-hermes",
      presetName: "Ask Hermes",
      familyId: ASK_HERMES_FAMILY.id,
      familyLabel: ASK_HERMES_FAMILY.label,
      emphasis: "balanced",
      variation: index + 1,
      strategy: "hook",
      hook: entry.hook?.trim() ?? "",
      layout: entry.label?.trim() || "free prompt",
      subject: null,
      productVisibility: "medium",
      physicalProductAllowed: true,
      referenceStrategy: spec.referenceUrls.length ? "reference" : "none",
      visualConcept: "",
      singleCreativeOnly: true,
    };
  });
  return {
    id: ids.batch,
    number,
    store,
    productId: product?.id ?? (spec.productId?.trim() || `adhoc-${slug(productName)}`),
    productName,
    productUrl: product?.url ?? spec.productUrl?.trim() ?? "",
    createdAt: input.now ?? new Date().toISOString(),
    ratio: spec.ratio,
    resolution: spec.resolution,
    emphasis: "balanced",
    physicalMockup: false,
    familyMix: { mode: "auto" },
    referenceStrength: "medium",
    referenceUrls: spec.referenceUrls,
    productImageUrls: spec.productImageUrls,
    instructions: "",
    angles: [],
    presets: ["ask-hermes"],
    variationsPerAngle: 1,
    plan: {
      total: items.length,
      families: [{ id: ASK_HERMES_FAMILY.id, label: ASK_HERMES_FAMILY.label, group: "product", count: items.length }],
      groups: { transformation: 0, feature: 0, social: 0, product: items.length },
      angles: [],
      layouts: 0,
      subjects: 0,
      hooks: items.filter((item) => item.hook).length,
      adjustments: ["Prompts écrits par Hermes et envoyés tels quels, après confirmation de l'opérateur."],
    },
    items,
    source: spec.source,
    sessionId: spec.sessionId ?? null,
    referenceFrameworkId: spec.referenceFrameworkId ?? null,
  };
}
