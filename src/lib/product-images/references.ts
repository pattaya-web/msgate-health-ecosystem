import type { CsvProduct } from "@/lib/product-images/csv";

/**
 * Choisit tout seul les photos à envoyer au modèle.
 *
 * Une fiche d'ensemble coordonné contient les photos de plusieurs vêtements. En
 * les envoyant toutes, le modèle fabrique un hybride — c'est ce qui a mis des
 * bandes sur un jogging uni. On lit donc le nom de fichier et le texte alternatif
 * de chaque photo : celle qui nomme un AUTRE vêtement que celui du titre est
 * écartée, sans que l'utilisateur ait à cliquer.
 */

/** Vocabulaire des articles. Deux mots de familles différentes = deux produits. */
const GARMENTS = [
  ["jogger", "jogging", "sweatpant", "trackpant"],
  ["jacket", "veste", "blazer", "coat", "manteau", "parka", "bomber"],
  ["hoodie", "sweatshirt", "sweat", "pull", "sweater", "jumper", "knit", "cardigan"],
  ["tshirt", "t-shirt", "tee", "top", "camisole", "tank", "debardeur"],
  ["shirt", "chemise", "blouse"],
  ["dress", "robe", "gown"],
  ["skirt", "jupe"],
  ["short", "shorts"],
  ["trouser", "pant", "pantalon", "jean", "denim"],
  ["legging", "collant"],
  ["bra", "brassiere", "soutien", "bralette"],
  ["shoe", "sneaker", "basket", "boot", "sandal", "chaussure"],
  ["bag", "sac", "tote", "backpack"],
  ["hat", "cap", "casquette", "chapeau", "beanie"],
  ["set", "coord", "co-ord", "tracksuit", "survetement", "ensemble"],
];

function normalise(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
}

/** Familles d'articles citées dans un texte. */
function familiesIn(text: string): Set<number> {
  const value = normalise(text);
  const found = new Set<number>();
  GARMENTS.forEach((words, index) => {
    if (words.some((word) => value.includes(normalise(word)))) found.add(index);
  });
  return found;
}

/** Ce qu'on peut lire d'une photo : son nom de fichier et son texte alternatif. */
function describe(url: string, alt: string) {
  const path = url.split("?")[0].split("/").pop() ?? "";
  return `${path} ${alt}`;
}

export type ScoredImage = { url: string; alt: string; keep: boolean; reason: string };

export function scoreImages(product: CsvProduct): ScoredImage[] {
  const subject = familiesIn(`${product.title} ${product.type}`);

  return product.images.map((url, index) => {
    const alt = product.imageAlts[index] ?? "";
    const text = describe(url, alt);
    const families = familiesIn(text);

    // Aucune famille nommée : la photo ne se contredit pas, on la garde.
    if (!families.size) {
      return { url, alt, keep: true, reason: "Aucun autre article nommé" };
    }

    const matches = [...families].some((family) => subject.has(family));
    if (matches) return { url, alt, keep: true, reason: "Correspond au titre" };

    // Le titre ne nomme aucun article connu : on ne peut rien exclure.
    if (!subject.size) return { url, alt, keep: true, reason: "Titre non reconnu" };

    const named = [...families].map((family) => GARMENTS[family][0]).join(", ");
    return { url, alt, keep: false, reason: `Montre un autre article (${named})` };
  });
}

/**
 * Photos retenues par défaut. Si le tri écarte tout — titre exotique, noms de
 * fichiers opaques — on retombe sur la première photo, qui est le packshot
 * principal chez Shopify.
 */
export function autoReferences(product: CsvProduct): string[] {
  const kept = scoreImages(product)
    .filter((image) => image.keep)
    .map((image) => image.url);
  return kept.length ? kept.slice(0, 6) : product.images.slice(0, 1);
}
