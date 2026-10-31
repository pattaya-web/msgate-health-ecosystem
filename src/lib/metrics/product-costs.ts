import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Le coût de revient de base des produits (COGS), saisi par l'admin.
 *
 * Reign ne connaît que les prix de vente : la marge réelle a besoin du coût
 * d'achat et d'envoi d'une unité. On garde un coût par produit (clé : l'id
 * produit Reign, ou à défaut le nom de la ligne de commande) et un coût par
 * défaut appliqué aux produits qui n'en ont pas.
 */

export type ProductCosts = {
  /** Coût d'une unité quand le produit n'a pas de coût propre, en USD. */
  defaultUnitCost: number;
  /** Coût d'une unité par nom de produit (anciennement aussi par id `prd_…`), en USD. */
  products: Record<string, number>;
  updatedAt: string;
};

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "product-costs.json");

const state = ((globalThis as typeof globalThis & { __msgateProductCosts?: { costs: ProductCosts | null } }).__msgateProductCosts ??= { costs: null });

function clean(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

export async function getProductCosts(): Promise<ProductCosts> {
  if (state.costs) return state.costs;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<ProductCosts>;
    const products: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.products ?? {})) {
      const cost = clean(value);
      if (cost !== null) products[key] = cost;
    }
    state.costs = { defaultUnitCost: clean(parsed.defaultUnitCost) ?? 0, products, updatedAt: parsed.updatedAt ?? "" };
  } catch {
    state.costs = { defaultUnitCost: 0, products: {}, updatedAt: "" };
  }
  return state.costs;
}

export async function saveProductCosts(patch: { defaultUnitCost?: unknown; products?: Record<string, unknown> }): Promise<ProductCosts> {
  const current = await getProductCosts();
  const products = { ...current.products };
  for (const [key, value] of Object.entries(patch.products ?? {})) {
    if (!key || key.length > 200) continue;
    // Un champ vidé retire le coût propre : le produit retombe sur le coût par défaut.
    if (value === null || value === "") {
      delete products[key];
      continue;
    }
    const cost = clean(value);
    if (cost !== null) products[key] = cost;
  }
  const next: ProductCosts = {
    defaultUnitCost: patch.defaultUnitCost === undefined ? current.defaultUnitCost : (clean(patch.defaultUnitCost) ?? current.defaultUnitCost),
    products,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, FILE);
  state.costs = next;
  return next;
}

/** Le coût d'une unité : celui du produit, sinon celui de la ligne par son nom, sinon le coût par défaut. */
export function unitCostFor(costs: ProductCosts, productId: string | null, name: string) {
  if (productId && costs.products[productId] !== undefined) return { cost: costs.products[productId], fallback: false };
  if (name && costs.products[name] !== undefined) return { cost: costs.products[name], fallback: false };
  return { cost: costs.defaultUnitCost, fallback: true };
}
