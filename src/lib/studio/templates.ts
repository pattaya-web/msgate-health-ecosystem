import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { persistJson, readMirror } from "@/lib/storage";
import { CREATIVE_CATEGORIES, CREATIVE_TYPES } from "@/lib/studio/creative-types";
import type { PromptTemplate, PromptTemplateInput } from "@/lib/studio/template-types";

/**
 * Persistance des templates de prompt : un fichier JSON, copié dans Supabase
 * quand il est configuré (même mécanisme que les produits du moteur). Au
 * premier accès, le fichier est amorcé avec les formats livrés dans le code,
 * pour que l'opérateur parte de quelque chose et puisse tout retoucher.
 */

const FILE = path.join(process.cwd(), ".msgate-cache", "creative-engine", "templates.json");

function uid() {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function readJson<T>(fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return fallback;
    const remote = await readMirror(FILE);
    if (!remote) return fallback;
    try {
      return JSON.parse(remote) as T;
    } catch {
      return fallback;
    }
  }
}

async function writeJson(items: PromptTemplate[]) {
  const payload = JSON.stringify({ items }, null, 2);
  await persistJson(FILE, payload, async () => {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, payload);
  });
}

/** Les formats du studio, tels qu'ils étaient au moment de l'amorçage. */
function seed(): PromptTemplate[] {
  const now = new Date().toISOString();
  return CREATIVE_TYPES.filter((type) => type.enabled).map((type) => ({
    id: `tpl-${type.id}`,
    name: type.name,
    description: type.description,
    category: type.category,
    prompt: type.promptInstructions,
    noLogo: true,
    visualElements: type.defaultVisualElements,
    builtinId: type.id,
    createdAt: now,
    updatedAt: now,
  }));
}

const CATEGORY_IDS = new Set<string>(CREATIVE_CATEGORIES.map((entry) => entry.id));

function clean(input: Partial<PromptTemplateInput>, current?: PromptTemplate): PromptTemplateInput {
  const name = (input.name ?? current?.name ?? "").trim().slice(0, 80);
  if (!name) throw new Error("Le nom du template est obligatoire");
  const prompt = (input.prompt ?? current?.prompt ?? "").trim().slice(0, 4000);
  if (!prompt) throw new Error("La consigne du template est obligatoire");
  const category = input.category && CATEGORY_IDS.has(input.category) ? input.category : current?.category ?? "performance";
  return { name, prompt, category, description: (input.description ?? current?.description ?? "").trim().slice(0, 200), noLogo: input.noLogo ?? current?.noLogo ?? true };
}

export async function listTemplates(): Promise<PromptTemplate[]> {
  const store = await readJson<{ items?: PromptTemplate[] } | null>(null);
  if (store && Array.isArray(store.items)) return store.items;
  const items = seed();
  await writeJson(items);
  return items;
}

export async function createTemplate(input: Partial<PromptTemplateInput>) {
  const items = await listTemplates();
  const now = new Date().toISOString();
  const template: PromptTemplate = { id: uid(), ...clean(input), visualElements: [], createdAt: now, updatedAt: now };
  await writeJson([template, ...items]);
  return template;
}

export async function updateTemplate(id: string, input: Partial<PromptTemplateInput>) {
  const items = await listTemplates();
  const current = items.find((item) => item.id === id);
  if (!current) throw new Error("Template introuvable");
  const next: PromptTemplate = { ...current, ...clean(input, current), updatedAt: new Date().toISOString() };
  await writeJson(items.map((item) => (item.id === id ? next : item)));
  return next;
}

export async function deleteTemplate(id: string) {
  const items = await listTemplates();
  if (!items.some((item) => item.id === id)) throw new Error("Template introuvable");
  await writeJson(items.filter((item) => item.id !== id));
}
