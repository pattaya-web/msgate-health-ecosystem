import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * Les tests en cours de la page Pilotage : les tests de prix BOGO (produit
 * dupliqué à un autre prix, campagne ABO dédiée) et l'upsell post-achat du 3e
 * collier. Réglés depuis la page (date de lancement, mot-clé des campagnes),
 * sans toucher au code.
 */

export type PriceTest = {
  id: string;
  name: string;
  /** Le prix BOGO testé (une commande = ce montant). */
  price: number;
  /** Les campagnes du test : celles dont le nom contient ce mot-clé. */
  campaignKeyword: string;
  /** Premier jour du test (AAAA-MM-JJ) ; null = pas encore lancé. */
  startDate: string | null;
  days: number;
  dailyBudget: number;
  minSpend: number;
  /** Conversion (en %) à atteindre pour battre le prix de référence. */
  thresholdConversion: number;
};

export type TestsConfig = {
  /** Le prix de référence (BOGO actuel). */
  basePrice: number;
  priceTests: PriceTest[];
  upsell: { price: number; label: string };
  updatedAt: string;
};

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "pilotage-tests.json");

const DEFAULT_CONFIG: TestsConfig = {
  basePrice: 29.99,
  priceTests: [
    { id: "bogo-3499", name: "BOGO à 34,99 $", price: 34.99, campaignKeyword: "34.99", startDate: null, days: 4, dailyBudget: 80, minSpend: 300, thresholdConversion: 6.4 },
    { id: "bogo-3999", name: "BOGO à 39,99 $", price: 39.99, campaignKeyword: "39.99", startDate: null, days: 4, dailyBudget: 80, minSpend: 300, thresholdConversion: 5.3 },
  ],
  upsell: { price: 9.99, label: "3e collier post-achat" },
  updatedAt: "",
};

const state = ((globalThis as typeof globalThis & { __msgatePilotageTests?: { config: TestsConfig | null } }).__msgatePilotageTests ??= { config: null });

const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const num = (value: unknown, fallback: number) => {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export async function getTestsConfig(): Promise<TestsConfig> {
  if (state.config) return state.config;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<TestsConfig>;
    state.config = {
      basePrice: num(parsed.basePrice, DEFAULT_CONFIG.basePrice),
      priceTests: Array.isArray(parsed.priceTests) && parsed.priceTests.length ? parsed.priceTests : DEFAULT_CONFIG.priceTests,
      upsell: parsed.upsell ?? DEFAULT_CONFIG.upsell,
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    state.config = DEFAULT_CONFIG;
  }
  return state.config;
}

/** Règle un test de prix : date de lancement (ou null pour l'arrêter), mot-clé, seuil, budget… */
export async function updatePriceTest(id: unknown, patch: Record<string, unknown>) {
  const config = await getTestsConfig();
  const current = config.priceTests.find((test) => test.id === id);
  if (!current) throw new Error("Test introuvable");
  const next: PriceTest = {
    ...current,
    startDate: patch.startDate === null || patch.startDate === "" ? null : isDay(patch.startDate) ? patch.startDate : current.startDate,
    campaignKeyword: typeof patch.campaignKeyword === "string" && patch.campaignKeyword.trim() ? patch.campaignKeyword.trim().slice(0, 60) : current.campaignKeyword,
    thresholdConversion: patch.thresholdConversion !== undefined ? num(patch.thresholdConversion, current.thresholdConversion) : current.thresholdConversion,
    days: patch.days !== undefined ? Math.max(1, Math.min(30, Math.round(num(patch.days, current.days)))) : current.days,
    minSpend: patch.minSpend !== undefined ? num(patch.minSpend, current.minSpend) : current.minSpend,
    dailyBudget: patch.dailyBudget !== undefined ? num(patch.dailyBudget, current.dailyBudget) : current.dailyBudget,
  };
  const updated: TestsConfig = { ...config, priceTests: config.priceTests.map((test) => (test.id === next.id ? next : test)), updatedAt: new Date().toISOString() };
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(updated, null, 2));
  await rename(tmp, FILE);
  state.config = updated;
  return updated;
}
