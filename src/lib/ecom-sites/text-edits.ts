import { defaultCopyright, defaultLegalLine } from "@/lib/ecom-sites/footer";
import type { EcomSite } from "@/lib/ecom-sites/types";

/**
 * Une correction faite dans l'aperçu, ramenée là où le texte vit vraiment.
 *
 * On clique une phrase dans la boutique et on la retape : il faut ensuite
 * savoir d'où elle venait. Trois cas, dans l'ordre :
 *
 *   1. un champ du site (titre, produit, pilier, récit About…) : on écrit
 *      dedans, le formulaire suit ;
 *   2. un texte déduit des réglages (politiques, réassurance, pied de page) :
 *      on garde la correction dans `textEdits`, appliquée au rendu ;
 *   3. un mot du gabarit (« Add to cart », « Shop ») : rien à corriger ici.
 */

/** Champs qui ne sont pas du texte lisible : identifiants, adresses, images. */
const NOT_TEXT = /(^id$|^slug$|^handle$|^category$|^currency$|^themeId$|^block$|^type$|^level$|^src$|^align$|^space$|^background$|url$|urls$|taskid$|taskids$|^textEdits$|^layout$|^href$)/i;

export function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

type Replaced = { value: unknown; count: number };

/** Un objet dont plus aucun texte lisible ne reste : une carte vidée, à retirer. */
function isBlank(value: unknown): boolean {
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.every(isBlank);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).every(([key, entry]) => NOT_TEXT.test(key) || isBlank(entry));
  }
  return true;
}

/**
 * Remplace le texte partout où il apparaît tel quel. Un remplacement par du
 * vide RETIRE : une entrée de liste disparaît, une carte dont on a vidé le
 * dernier texte aussi.
 */
/** Les listes dont une entrée vidée reste en place : les cellules d'un tableau, pas les puces. */
const KEEP_EMPTY = /^(rows|header)$/;

function replaceDeep(value: unknown, from: string, to: string, keepEmpty = false): Replaced {
  if (typeof value === "string") {
    return normalizeText(value) === from ? { value: to, count: 1 } : { value, count: 0 };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const next: unknown[] = [];
    for (const entry of value) {
      const result = replaceDeep(entry, from, to, keepEmpty);
      count += result.count;
      if (!keepEmpty && result.count && !to && (typeof entry === "string" || isBlank(result.value))) continue;
      next.push(result.value);
    }
    return count ? { value: next, count } : { value, count: 0 };
  }
  if (value && typeof value === "object") {
    let count = 0;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (NOT_TEXT.test(key)) {
        next[key] = entry;
        continue;
      }
      const result = replaceDeep(entry, from, to, KEEP_EMPTY.test(key));
      count += result.count;
      next[key] = result.value;
    }
    return count ? { value: next, count } : { value, count: 0 };
  }
  return { value, count: 0 };
}

export type TextEditResult = { site: EcomSite; mode: "field" | "generated" | "none" };

/**
 * Applique \u00ab ce texte \u2192 celui-l\u00e0 \u00bb. Un texte voulu vide retire l'\u00e9l\u00e9ment :
 * la ligne d'une liste, la carte vid\u00e9e, le paragraphe d'une politique.
 */
export function applyTextEdit(site: EcomSite, rawFrom: string, rawTo: string): TextEditResult {
  const from = normalizeText(rawFrom);
  const to = rawTo.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!from || from === to) return { site, mode: "none" };

  /* 1. Le pied de page déduit : la phrase d'identité et le copyright ont leur champ. */
  if (site.legalName && normalizeText(defaultLegalLine(site)) === from) {
    return { site: { ...site, footer: { ...(site.footer ?? {}), legalLine: to } }, mode: "field" };
  }
  if (normalizeText(defaultCopyright(site, new Date().getFullYear())) === from) {
    return { site: { ...site, footer: { ...(site.footer ?? {}), copyright: to } }, mode: "field" };
  }

  /* 2. Un champ du site, où qu'il soit. */
  const replaced = replaceDeep(site, from, to);
  if (replaced.count) return { site: replaced.value as EcomSite, mode: "field" };

  /*
   * 3. Tout le reste : un texte déduit des réglages, un mot du gabarit, ou une
   * correction déjà faite qu'on retouche encore. La correction est gardée
   * « texte d'origine → texte voulu » et appliquée au rendu.
   */
  const edits = { ...(site.textEdits ?? {}) };
  const previous = Object.entries(edits).find(([, value]) => normalizeText(value) === from);
  if (previous) {
    if (normalizeText(previous[0]) === to) delete edits[previous[0]];
    else edits[previous[0]] = to;
    return { site: { ...site, textEdits: edits }, mode: "generated" };
  }
  edits[from] = to;
  return { site: { ...site, textEdits: edits }, mode: "generated" };
}
