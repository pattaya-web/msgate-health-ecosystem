import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * La grille du fournisseur : ce que coûte un colis selon le nombre de colliers
 * de la commande (1, 2, 3, 4, puis 5 et plus), et non un coût par pièce.
 *
 * Plusieurs grilles se succèdent : chacune s'applique à partir d'un numéro de
 * commande Shopify (« #V1317 ») ou d'une date. Une commande prend la grille la
 * plus récente dont le départ est atteint ; la grille sans départ couvre tout
 * ce qui précède. Réglée par l'admin (page Grille fournisseur), sans code.
 */

export type SupplierGrid = {
  id: string;
  label: string;
  /** N° de commande Shopify à partir duquel la grille s'applique (1317 pour #V1317) ; null = pas de départ par numéro. */
  fromOrder: number | null;
  /** Date (AAAA-MM-JJ) à partir de laquelle la grille s'applique ; null = pas de départ par date. */
  fromDate: string | null;
  /** Coût total du colis en USD pour 1, 2, 3 et 4 colliers. */
  prices: [number, number, number, number];
  /** Au-delà de 4 colliers : coût de 4 + ce montant par collier supplémentaire. */
  extraPerUnit: number;
  updatedAt: string;
};

export type SupplierGridConfig = {
  /** Les boutiques dont les commandes sont chiffrées à la grille (les autres gardent le coût par pièce). */
  stores: string[];
  grids: SupplierGrid[];
  updatedAt: string;
};

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "supplier-grids.json");

/** Les grilles de départ (Venom) : avant #V1317, puis à partir de #V1317. */
const DEFAULT_CONFIG: SupplierGridConfig = {
  stores: ["venom-necklace.com"],
  grids: [
    { id: "avant-v1317", label: "Grille initiale", fromOrder: null, fromDate: null, prices: [8.33, 10.49, 13.19, 15.61], extraPerUnit: 2.12, updatedAt: "" },
    { id: "v1317", label: "Grille #V1317", fromOrder: 1317, fromDate: null, prices: [8.03, 10.19, 12.89, 15.01], extraPerUnit: 2.12, updatedAt: "" },
  ],
  updatedAt: "",
};

const state = ((globalThis as typeof globalThis & { __msgateSupplierGrid?: { config: SupplierGridConfig | null } }).__msgateSupplierGrid ??= { config: null });

const money = (value: unknown) => {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) && number >= 0 && number < 10_000 ? Math.round(number * 100) / 100 : null;
};
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** « #V1317 », « V1317 » ou « 1317 » → 1317. */
export function orderNumber(name: unknown): number | null {
  const match = String(name ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Une grille telle que saisie dans la page admin (valeurs encore à vérifier). */
export type SupplierGridInput = { id?: string; label?: unknown; fromOrder?: unknown; fromDate?: unknown; prices?: unknown; extraPerUnit?: unknown };

function cleanGrid(input: SupplierGridInput, previous?: SupplierGrid): SupplierGrid {
  const prices = Array.isArray(input.prices) ? input.prices : previous?.prices ?? [];
  const parsed = [0, 1, 2, 3].map((i) => money(prices[i]));
  if (parsed.some((value) => value === null)) throw new Error("Grille incomplète : il faut un coût pour 1, 2, 3 et 4 colliers.");
  const extra = money(input.extraPerUnit ?? previous?.extraPerUnit);
  if (extra === null) throw new Error("Coût par collier supplémentaire (5 et plus) invalide.");
  const fromOrder = input.fromOrder === null || input.fromOrder === undefined || input.fromOrder === "" ? null : orderNumber(input.fromOrder);
  const fromDate = isDay(input.fromDate) ? input.fromDate : null;
  return {
    id: previous?.id ?? input.id ?? randomUUID(),
    label: String(input.label ?? previous?.label ?? "").trim().slice(0, 80) || (fromOrder ? `Grille #V${fromOrder}` : fromDate ? `Grille du ${fromDate}` : "Grille initiale"),
    fromOrder,
    fromDate,
    prices: parsed as [number, number, number, number],
    extraPerUnit: extra,
    updatedAt: new Date().toISOString(),
  };
}

export async function getSupplierGrids(): Promise<SupplierGridConfig> {
  if (state.config) return state.config;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<SupplierGridConfig>;
    const grids = (parsed.grids ?? []).flatMap((grid) => {
      try {
        return [{ ...cleanGrid(grid, grid as SupplierGrid), updatedAt: grid.updatedAt ?? "" }];
      } catch {
        return [];
      }
    });
    state.config = {
      stores: Array.isArray(parsed.stores) ? parsed.stores.filter((store) => typeof store === "string" && store) : DEFAULT_CONFIG.stores,
      grids: grids.length ? grids : DEFAULT_CONFIG.grids,
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    state.config = DEFAULT_CONFIG;
  }
  return state.config;
}

async function persist(next: SupplierGridConfig) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, FILE);
  state.config = next;
  return next;
}

/** Ajoute une grille, ou modifie celle dont l'id est donné. */
export async function saveSupplierGrid(input: SupplierGridInput) {
  const config = await getSupplierGrids();
  const previous = input.id ? config.grids.find((grid) => grid.id === input.id) : undefined;
  if (input.id && !previous) throw new Error("Grille introuvable");
  const grid = cleanGrid(input, previous);
  if (!previous && grid.fromOrder === null && !grid.fromDate) throw new Error("Une nouvelle grille a besoin d'un n° de commande ou d'une date de départ.");
  const grids = previous ? config.grids.map((row) => (row.id === grid.id ? grid : row)) : [...config.grids, grid];
  return persist({ ...config, grids, updatedAt: new Date().toISOString() });
}

export async function deleteSupplierGrid(id: unknown) {
  const config = await getSupplierGrids();
  const grids = config.grids.filter((grid) => grid.id !== id);
  if (!grids.length) throw new Error("Il faut garder au moins une grille.");
  return persist({ ...config, grids, updatedAt: new Date().toISOString() });
}

/** Le coût du colis pour `quantity` colliers selon une grille. */
export function parcelCost(grid: SupplierGrid, quantity: number) {
  if (quantity <= 0) return 0;
  if (quantity <= 4) return grid.prices[quantity - 1];
  return Math.round((grid.prices[3] + (quantity - 4) * grid.extraPerUnit) * 100) / 100;
}

/**
 * Le choix de grille pour une commande. `dateOfOrder` donne la date d'une
 * commande par son numéro : une grille posée « à partir de #V1317 » s'applique
 * aussi, par la date de #V1317, aux commandes dont on ignore le numéro.
 */
export function gridPicker(config: SupplierGridConfig, dateOfOrder: (number: number) => string | null) {
  const grids = config.grids.map((grid) => ({
    grid,
    // Le départ en date : la date choisie, sinon celle de la commande de départ.
    startDay: grid.fromDate ?? (grid.fromOrder !== null ? dateOfOrder(grid.fromOrder) : null),
    open: grid.fromOrder === null && !grid.fromDate,
  }));
  return (order: { number: number | null; day: string }): SupplierGrid => {
    let best: (typeof grids)[number] | null = null;
    for (const row of grids) {
      const reached = row.open
        ? true
        : row.grid.fromOrder !== null && order.number !== null
          ? order.number >= row.grid.fromOrder && (!row.grid.fromDate || order.day >= row.grid.fromDate)
          : row.startDay !== null && order.day >= row.startDay;
      if (!reached) continue;
      if (!best || compareStart(row, best) > 0) best = row;
    }
    return (best ?? grids[0]).grid;
  };
}

function compareStart(a: { grid: SupplierGrid; startDay: string | null; open: boolean }, b: { grid: SupplierGrid; startDay: string | null; open: boolean }) {
  if (a.open !== b.open) return a.open ? -1 : 1;
  if (a.startDay && b.startDay && a.startDay !== b.startDay) return a.startDay < b.startDay ? -1 : 1;
  return (a.grid.fromOrder ?? 0) - (b.grid.fromOrder ?? 0);
}

/** Les chiffres qui disent si une campagne gagne de l'argent. */
export function breakevenFrom(input: { revenue: number; cogs: number; fees: number; orders: number }) {
  const contribution = input.revenue - input.cogs - input.fees;
  return {
    /** ROAS sous lequel la pub coûte plus que ce que la vente laisse : CA ÷ (CA − articles − frais). */
    roasBreakeven: contribution > 0 && input.revenue > 0 ? Math.round((input.revenue / contribution) * 100) / 100 : null,
    /** Coût d'acquisition maximum par commande : (CA − articles − frais) ÷ commandes. */
    cpaMax: input.orders > 0 && contribution > 0 ? Math.round((contribution / input.orders) * 100) / 100 : null,
  };
}
