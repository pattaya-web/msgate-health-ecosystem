import { CREATIVE_TYPES, type CreativeType } from "@/lib/studio/creative-types";
import {
  FAMILIES,
  FAMILY_MIX,
  isDigitalClass,
  strategyFor,
  type Angle,
  type CreativeEmphasis,
  type CreativeSpec,
  type FamilyGroup,
  type FamilyMixSetting,
  type PlanSummary,
  type ProductContext,
  type ProductVisibility,
  type ReferenceStrength,
  type SubjectSpec,
} from "@/lib/creative-engine/types";

/**
 * Le planificateur : il ne se demande pas « comment montrer ce produit de
 * quinze façons » mais « quelles sont quinze publicités vraiment différentes
 * qui pourraient convaincre ». Pour chaque lot il répartit les familles
 * visuelles selon l'emphase, tourne les mises en page, les sujets et les
 * accroches, puis vérifie qu'aucune répétition évidente ne reste.
 *
 * Déterministe à graine égale : un plan peut être relu, régénéré (autre
 * graine) ou rejoué à l'identique, sans dépenser un crédit d'image.
 */

export type PlanInput = {
  product: ProductContext;
  angles: Angle[];
  presets: CreativeType[];
  variations: number;
  emphasis: CreativeEmphasis;
  physicalMockup: boolean;
  familyMix: FamilyMixSetting;
  referenceStrength: ReferenceStrength;
  hasReference: boolean;
  seed: number;
};

function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rand: () => number) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Répartit `total` entre les groupes au prorata des poids, sans perdre d'unité. */
function allocate(total: number, weights: Record<FamilyGroup, number>): Record<FamilyGroup, number> {
  const groups = Object.keys(weights) as FamilyGroup[];
  const sum = groups.reduce((acc, group) => acc + weights[group], 0) || 1;
  const raw = groups.map((group) => ({ group, exact: (total * weights[group]) / sum }));
  const counts = Object.fromEntries(raw.map(({ group, exact }) => [group, Math.floor(exact)])) as Record<FamilyGroup, number>;
  let left = total - groups.reduce((acc, group) => acc + counts[group], 0);
  for (const { group } of [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (left <= 0) break;
    counts[group] += 1;
    left -= 1;
  }
  return counts;
}

/** Les sujets tournent selon l'audience lue ; un produit ciblé ne se voit pas imposer l'autre genre. */
function subjectPool(product: ProductContext): SubjectSpec[] {
  const a = product.analysis;
  const gender = (a?.gender ?? "").toLowerCase();
  const wantsMen = /\b(man|men|male|homme|masculin)\b/.test(gender) && !/\b(woman|women|female|femme)\b/.test(gender);
  const wantsWomen = /\b(woman|women|female|femme|féminin)\b/.test(gender) && !/\b(man|men|male|homme)\b/.test(gender);
  const genders = wantsMen ? ["man"] : wantsWomen ? ["woman"] : ["woman", "man"];
  const range = (a?.ageRange ?? "").match(/(\d{2})\D+(\d{2})/);
  const lo = range ? Number(range[1]) : 22;
  const hi = range ? Number(range[2]) : 55;
  const bands = [
    [lo, Math.min(hi, lo + 9)],
    [Math.min(hi, lo + 10), Math.min(hi, lo + 19)],
    [Math.min(hi, lo + 20), hi],
  ].filter(([from, to], index, list) => to >= from && list.findIndex(([f, t]) => f === from && t === to) === index);
  const pool: SubjectSpec[] = [];
  for (const [from, to] of bands) {
    for (const g of genders) {
      pool.push({ gender: g, ageRange: `${from}-${to}`, notes: a?.targetCustomer ? `fits the target customer: ${a.targetCustomer}` : "" });
    }
  }
  return pool.length ? pool : [{ gender: "woman", ageRange: "25-35", notes: "" }, { gender: "man", ageRange: "25-35", notes: "" }];
}

/** Accroches de réserve par catégorie, quand celles de l'angle sont épuisées. */
function hookTemplates(product: ProductContext, angle: Angle, familyGroup: FamilyGroup) {
  const outcome = product.analysis?.transformation || product.analysis?.desires?.[0] || product.analysis?.benefits?.[0] || "the result you want";
  const problem = product.analysis?.mainProblem || product.analysis?.objections?.[0] || "the wrong thing";
  const short = outcome.split(/[.;,]/)[0].trim().slice(0, 48);
  const base: Record<string, string[]> = {
    provocation: ["You haven't seen your best version yet.", `Most people never fix ${problem.toLowerCase().slice(0, 40)}.`],
    curiosity: ["What would you look like at 100%?", `What if ${short.toLowerCase()} took less than you think?`],
    transformation: ["Same person. Different presence.", "Same face. Different energy."],
    problem: ["You're fixing the wrong things.", `${problem.slice(0, 48)}. Here's the real fix.`],
    desire: [`${short}.`, `Build ${short.toLowerCase()}.`],
    identity: ["Your glow-up isn't finished.", "Become the version people notice."],
    social: ["The glow-up people actually notice.", "Looking better changes how you carry yourself."],
    system: ["Stop guessing what to fix.", "Fix what people notice first."],
  };
  const order: Record<FamilyGroup, string[]> = {
    transformation: ["transformation", "identity", "curiosity", "provocation"],
    feature: ["problem", "desire", "curiosity", "provocation"],
    social: ["social", "identity", "desire", "transformation"],
    product: ["system", "desire", "problem", "curiosity"],
  };
  const list = order[familyGroup].flatMap((key) => base[key]);
  return [...angle.hooks, ...list, `${angle.name}.`];
}

function visibilityFor(emphasis: CreativeEmphasis, group: FamilyGroup, rand: () => number): ProductVisibility {
  if (group === "product") return emphasis === "outcome" ? "medium" : "hero";
  if (emphasis === "outcome") return rand() < 0.35 ? "none" : "subtle";
  if (emphasis === "balanced") return rand() < 0.5 ? "subtle" : "medium";
  return rand() < 0.5 ? "medium" : "hero";
}

function presetFor(familyPresets: string[], chosen: CreativeType[], variation: number) {
  const match = familyPresets.map((id) => chosen.find((preset) => preset.id === id)).find(Boolean);
  return match ?? chosen[(variation - 1) % chosen.length];
}

export type Plan = { specs: CreativeSpec[]; summary: PlanSummary };

export function planBatch(input: PlanInput): Plan {
  const rand = seeded(input.seed);
  const digital = isDigitalClass(input.product.analysis?.productClass);
  const physicalAllowed = !digital || input.physicalMockup;
  const total = input.angles.length * input.variations;
  const adjustments: string[] = [];

  /* 1. Combien de créas par groupe de familles. */
  const groupCounts =
    input.familyMix.mode === "custom"
      ? (() => {
          const custom = input.familyMix.counts;
          const sum = (Object.values(custom) as number[]).reduce((acc, value) => acc + value, 0);
          if (sum !== total) adjustments.push(`Mix personnalisé ramené de ${sum} à ${total} créas.`);
          return allocate(total, { transformation: custom.transformation || 0.01, feature: custom.feature || 0.01, social: custom.social || 0.01, product: custom.product || 0.01 });
        })()
      : allocate(total, FAMILY_MIX[input.emphasis]);

  /* 2. La file des familles : chaque groupe fait tourner ses familles, dans un ordre mélangé. */
  const queue: string[] = [];
  for (const group of Object.keys(groupCounts) as FamilyGroup[]) {
    const options = shuffle(
      FAMILIES.filter((family) => family.group === group && (physicalAllowed || !["PRODUCT_DEMO", "PRODUCT_HERO"].includes(family.id) || digital)),
      rand
    );
    for (let i = 0; i < groupCounts[group]; i += 1) queue.push(options[i % options.length].id);
  }
  const families = shuffle(queue, rand);

  /* 3. Un slot par angle × variante ; la famille vient de la file, les mises en page et sujets tournent. */
  const layoutUse = new Map<string, number>();
  const familyLayoutCursor = new Map<string, number>();
  const subjects = subjectPool(input.product);
  let subjectCursor = Math.floor(rand() * subjects.length);
  const usedHooks = new Set<string>();
  const specs: CreativeSpec[] = [];
  let cursor = 0;

  for (const angle of input.angles) {
    for (let variation = 1; variation <= input.variations; variation += 1) {
      const familyId = families[cursor % families.length];
      cursor += 1;
      const family = FAMILIES.find((item) => item.id === familyId) ?? FAMILIES[0];
      const layoutIndex = familyLayoutCursor.get(family.id) ?? Math.floor(rand() * family.layouts.length);
      familyLayoutCursor.set(family.id, layoutIndex + 1);
      const layout = family.layouts[layoutIndex % family.layouts.length];
      layoutUse.set(layout, (layoutUse.get(layout) ?? 0) + 1);

      const needsSubject = family.group !== "product" || family.id === "PRODUCT_DEMO";
      const pickedSubject = needsSubject ? subjects[subjectCursor % subjects.length] : null;
      if (needsSubject) subjectCursor += 1;

      const candidates = hookTemplates(input.product, angle, family.group);
      const hook = candidates.find((line) => !usedHooks.has(line.toLowerCase())) ?? candidates[0];
      usedHooks.add(hook.toLowerCase());
      /* Une accroche qui parle de barbe ou de rasage met un homme en sujet,
         quel que soit le tour de rôle : sinon le modèle dessine une femme barbue. */
      const menOnlyHook = /\b(beard|stubble|barber|shav(e|ing)|barbe)\b/i;
      const subject = pickedSubject && pickedSubject.gender === "woman" && menOnlyHook.test(`${hook} ${angle.name}`) ? { ...pickedSubject, gender: "man" as const } : pickedSubject;

      const preset = presetFor(family.presets, input.presets, variation);
      const visibility = visibilityFor(input.emphasis, family.group, rand);
      const referenceStrategy = !input.hasReference
        ? "none"
        : input.referenceStrength === "high"
          ? cursor % 2 ? "follow the reference composition closely" : "borrow the reference typography and density, own composition"
          : input.referenceStrength === "medium"
            ? "keep the reference's advertising structure, own layout"
            : "loose inspiration only";

      specs.push({
        angleId: angle.id,
        angleName: angle.name,
        presetId: preset.id,
        presetName: preset.name,
        familyId: family.id,
        familyLabel: family.label,
        emphasis: input.emphasis,
        variation,
        strategy: strategyFor(variation),
        hook,
        layout,
        subject,
        productVisibility: physicalAllowed || visibility !== "hero" ? visibility : "medium",
        physicalProductAllowed: physicalAllowed,
        referenceStrategy,
        singleCreativeOnly: true,
        visualConcept: `${family.label} — ${layout.split(",")[0]}${subject ? ` · ${subject.gender} ${subject.ageRange}` : ""} · « ${hook} »`,
      });
    }
  }

  /* 4. Validation : pas de mise en page ni de couverture produit envahissante. */
  for (const [layout, count] of layoutUse) {
    if (count / total > 0.4 && total >= 5) {
      let fixed = 0;
      for (const spec of specs) {
        if (spec.layout !== layout) continue;
        const family = FAMILIES.find((item) => item.id === spec.familyId);
        const alternative = family?.layouts.find((candidate) => candidate !== layout && (layoutUse.get(candidate) ?? 0) < Math.ceil(total * 0.3));
        if (!alternative) continue;
        spec.layout = alternative;
        layoutUse.set(alternative, (layoutUse.get(alternative) ?? 0) + 1);
        layoutUse.set(layout, (layoutUse.get(layout) ?? 0) - 1);
        fixed += 1;
        if ((layoutUse.get(layout) ?? 0) / total <= 0.4) break;
      }
      if (fixed) adjustments.push(`Mise en page « ${layout.split(",")[0]} » trop fréquente : ${fixed} créa(s) rebasculée(s).`);
    }
  }
  if (digital) {
    const heavy = specs.filter((spec) => spec.productVisibility === "hero" || spec.productVisibility === "medium");
    if (heavy.length / total > 0.3) {
      let fixed = 0;
      for (const spec of heavy) {
        if (heavy.length - fixed <= Math.floor(total * 0.3)) break;
        if (FAMILIES.find((item) => item.id === spec.familyId)?.group === "product") continue;
        spec.productVisibility = "subtle";
        fixed += 1;
      }
      if (fixed) adjustments.push(`Produit digital : ${fixed} créa(s) passée(s) en présence discrète du produit.`);
    }
  }

  const familyCounts = new Map<string, number>();
  for (const spec of specs) familyCounts.set(spec.familyId, (familyCounts.get(spec.familyId) ?? 0) + 1);
  const groups = { transformation: 0, feature: 0, social: 0, product: 0 } as Record<FamilyGroup, number>;
  for (const spec of specs) groups[FAMILIES.find((item) => item.id === spec.familyId)?.group ?? "product"] += 1;

  return {
    specs,
    summary: {
      total,
      families: [...familyCounts.entries()]
        .map(([id, count]) => {
          const family = FAMILIES.find((item) => item.id === id);
          return { id, label: family?.label ?? id, group: family?.group ?? "product", count };
        })
        .sort((a, b) => b.count - a.count),
      groups,
      angles: input.angles.map((angle) => ({ id: angle.id, name: angle.name, count: specs.filter((spec) => spec.angleId === angle.id).length })),
      layouts: new Set(specs.map((spec) => spec.layout)).size,
      subjects: new Set(specs.map((spec) => (spec.subject ? `${spec.subject.gender}-${spec.subject.ageRange}` : "none"))).size,
      hooks: new Set(specs.map((spec) => spec.hook.toLowerCase())).size,
      adjustments,
    },
  };
}

export function presetsFrom(ids: string[]) {
  return CREATIVE_TYPES.filter((type) => ids.includes(type.id));
}
