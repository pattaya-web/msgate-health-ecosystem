/**
 * Nommage des créas (2026-11-05), du Studio jusqu'à Meta.
 *
 *   S{semaine ISO}_{MIX1…MIX5 | VIDEO}_{CONCEPT}_{VARIANTE}[_IT{n}][_{k}]
 *
 * Ex. S45_MIX1_HEMIOS_NAVY, S45_MIX3_LIFESTYLE_HER, S46_MIX1_HEMIOS_NAVY_IT2,
 * S45_VIDEO_STOLE_A. Le fichier téléchargé porte ce nom (+ extension) ;
 * l'Ads uploader de msgate en fait le nom de la pub chez Meta, la Pipeline
 * créa le relit. Même module dans msgate (src/lib/creative-naming.ts) : garder
 * les deux identiques.
 */

export const MIX_OPTIONS = ["MIX1", "MIX2", "MIX3", "MIX4", "MIX5", "VIDEO"] as const;

/** Un morceau du nom : majuscules, sans accents, rien d'autre que A-Z 0-9 et des tirets (le « _ » sépare les morceaux). */
export function slugToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Semaine ISO 8601 (1 à 53) d'une date, à l'heure de Paris. */
export function isoWeek(date: Date = new Date()): number {
  const day = new Date(date.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }) + "T12:00:00Z");
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

export interface CreativeName {
  week: number;
  /** « MIX1 »… ou « VIDEO ». */
  mix: string;
  concept: string;
  variante: string;
  /** 2, 3… pour _IT2, _IT3 ; absent pour la créa d'origine. */
  iteration?: number;
}

export interface ParsedCreativeName extends CreativeName {
  /** Suffixe de doublon (_2, _3) posé à l'upload. */
  dup?: number;
  /**
   * MIX_CONCEPT_VARIANTE, sans semaine, _IT ni doublon : regroupe une créa et
   * ses itérations, même lancées une autre semaine (S46_MIX1_HEMIOS_NAVY_IT2
   * est une itération de S45_MIX1_HEMIOS_NAVY).
   */
  base: string;
}

export function normalizeMix(v: string): string {
  const s = v.toUpperCase().replace(/\s+/g, "");
  if (s === "VIDEO" || s === "VIDÉO") return "VIDEO";
  const m = /^MIX(\d+)$/.exec(s) ?? /^(\d+)$/.exec(s);
  return m ? `MIX${Number(m[1])}` : "";
}

export function buildCreativeName(n: CreativeName): string {
  const mix = normalizeMix(n.mix);
  const concept = slugToken(n.concept);
  const variante = slugToken(n.variante);
  if (!n.week || !mix || !concept || !variante) return "";
  const parts = [`S${String(n.week).padStart(2, "0")}`, mix, concept, variante];
  if (n.iteration && n.iteration > 1) parts.push(`IT${n.iteration}`);
  return parts.join("_");
}

const NAME_RE = /^S(\d{1,2})_(MIX\d+|VIDEO)_([A-Z0-9-]+)_([A-Z0-9-]+)(?:_IT(\d+))?(?:_(\d+))?$/;

export function parseCreativeName(raw: string): ParsedCreativeName | null {
  const name = raw.trim().replace(/\.[a-z0-9]{2,4}$/i, "");
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const week = Number(m[1]);
  if (week < 1 || week > 53) return null;
  const iteration = m[5] ? Number(m[5]) : undefined;
  const dup = m[6] ? Number(m[6]) : undefined;
  const base = `${m[2]}_${m[3]}_${m[4]}`;
  return { week, mix: m[2], concept: m[3], variante: m[4], iteration, dup, base };
}

/** Prochaine variante libre V1, V2… parmi les noms déjà pris pour ce préfixe S45_MIX1_CONCEPT. */
export function nextVariante(prefix: string, taken: string[]): string {
  let max = 0;
  for (const t of taken) {
    const p = parseCreativeName(t);
    if (!p || `S${String(p.week).padStart(2, "0")}_${p.mix}_${p.concept}` !== prefix) continue;
    const v = /^V(\d+)$/.exec(p.variante);
    if (v) max = Math.max(max, Number(v[1]));
  }
  return `V${max + 1}`;
}

/** Prochaine itération (_IT2, _IT3…) d'une créa, d'après les noms existants. */
export function nextIteration(of: string, taken: string[]): number {
  const origin = parseCreativeName(of);
  if (!origin) return 2;
  let max = 1;
  for (const t of taken) {
    const p = parseCreativeName(t);
    if (p && p.base === origin.base) max = Math.max(max, p.iteration ?? 1);
  }
  return max + 1;
}

/** Noms répétés : _2, _3 ajoutés à partir du deuxième. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k > 1 ? `${n}_${k}` : n;
  });
}

/* ------------------------------------------------------------------ *
 * Propre à msgate (Ads Manager, Ads uploader, Pipeline créa)
 * ------------------------------------------------------------------ */

/** La semaine écrite dans un nom d'ad set : « TEST - S45 - MIX 1 », « S 45 », « s45 » → 45. */
export function weekFromAdsetName(name: string): number | null {
  const m = /(?:^|[^A-Z0-9])S\s*-?\s*(\d{1,2})(?![0-9])/i.exec(name ?? "");
  if (!m) return null;
  const week = Number(m[1]);
  return week >= 1 && week <= 53 ? week : null;
}

/** Le MIX écrit dans un nom d'ad set : « MIX 1 », « MIX1 », « Mix 2 » → MIX1 / MIX2 ; « VIDEO » / « VIDÉO » → VIDEO. */
export function mixFromAdsetName(name: string): string | null {
  const mix = /MIX\s*-?\s*(\d+)/i.exec(name ?? "");
  if (mix) return `MIX${Number(mix[1])}`;
  return /VID[EÉ]O/i.test(name ?? "") ? "VIDEO" : null;
}

/** Nom de fichier sans extension (le nom de la pub dans l'uploader). */
export function fileStemName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

/**
 * Le début d'un nom à la convention pour une pub d'un ad set : la semaine du
 * lancement de la pub (repli : la semaine écrite dans le nom de l'ad set),
 * le MIX lu dans le nom de l'ad set. null si l'un des deux manque.
 */
export function namingContextFor(adsetName: string, createdTime?: string | null): { week: number | null; mix: string | null } {
  const launched = createdTime ? new Date(createdTime) : null;
  const week = launched && !Number.isNaN(launched.getTime()) ? isoWeek(launched) : weekFromAdsetName(adsetName);
  return { week, mix: mixFromAdsetName(adsetName) };
}

/**
 * Un CONCEPT à proposer depuis un ancien nom libre (« Hemios navy v2 » → HEMIOS) :
 * le premier mot parlant, ou "" si le nom vient d'un outil (hf_2026…, format-3-4…, IMG_1234, uuid).
 */
export function conceptGuess(oldName: string): string {
  const stem = fileStemName(oldName ?? "").trim();
  if (!stem || /^(hf|img|vid|dsc|pxl|format|copy|untitled|image|video|ad)(?![a-z])/i.test(stem)) return "";
  const words = stem.split(/[\s_·|/\\,.()-]+/).map(slugToken).filter(Boolean);
  const word = words.find((w) => /[A-Z]/.test(w) && w.length >= 3 && !/^(S\d{1,2}|MIX\d+|V\d+|IT\d+|COPY|AD|ADS|NEW|TEST)$/.test(w));
  return word ?? "";
}
