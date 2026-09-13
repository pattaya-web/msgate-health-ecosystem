/**
 * Noms propres et lisibles : STORE_PRODUCT_ANGLE_PRESET_V01.
 *
 * Le nom voyage partout — fichier, Meta Ads Manager, tableau de suivi — donc
 * il ne contient que des capitales, des chiffres et des tirets bas, et il
 * reste court même quand le titre produit fait une ligne entière.
 */

export function slugPart(value: string, max = 16) {
  const ascii = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
  /* Les mots vides allongent sans rien dire : « THE », « AND », « OF ». */
  const words = ascii.split(" ").filter((word) => word && !["THE", "AND", "OF", "A", "AN", "LE", "LA", "LES", "DE", "DU", "DES", "ET"].includes(word));
  let out = "";
  for (const word of words) {
    const next = out ? `${out}${word}` : word;
    if (next.length > max) break;
    out = next;
  }
  return out || ascii.replace(/ /g, "").slice(0, max) || "X";
}

export function creativeName(store: string, product: string, angle: string, preset: string, variation: number) {
  return [slugPart(store, 14), slugPart(product, 16), slugPart(angle, 14), slugPart(preset, 12), `V${String(variation).padStart(2, "0")}`].join("_");
}
