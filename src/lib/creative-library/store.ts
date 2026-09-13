import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { mirror } from "@/lib/storage";
import { BUILTIN_STYLES } from "@/lib/creative-library/builtin";
import type { LibraryIndex, ScriptTemplate, StyleTemplate } from "@/lib/creative-library/types";

/**
 * La bibliothèque vit dans `.msgate-cache/creative-library/` : un index JSON et
 * une affiche par style. Les styles intégrés ne sont jamais écrits — ils sont
 * fusionnés à la lecture, ce qui permet d'en ajouter dans le code sans
 * migration et de ne jamais les perdre sur un disque effacé.
 */
const ROOT = path.join(process.cwd(), ".msgate-cache", "creative-library");
const INDEX = path.join(ROOT, "library.json");

async function load(): Promise<LibraryIndex> {
  try {
    const parsed = JSON.parse(await readFile(INDEX, "utf8")) as Partial<LibraryIndex>;
    return { styles: parsed.styles ?? [], scripts: parsed.scripts ?? [] };
  } catch {
    return { styles: [], scripts: [] };
  }
}

async function save(index: LibraryIndex) {
  await mkdir(ROOT, { recursive: true });
  const payload = JSON.stringify(index, null, 2);
  await writeFile(INDEX, payload);
  mirror(INDEX, Buffer.from(payload));
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listLibrary(): Promise<LibraryIndex> {
  const stored = await load();
  // Un style intégré dont l'affiche a été déposée se présente avec : la
  // grille montre alors la vraie créa plutôt que l'aperçu dessiné.
  const builtins = await Promise.all(
    BUILTIN_STYLES.map(async (style) => ((await hasBuiltinPoster(style.id)) ? { ...style, poster: `${style.id}.jpg` } : style))
  );
  return {
    styles: [...stored.styles.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), ...builtins],
    scripts: stored.scripts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function getStyle(id: string): Promise<StyleTemplate | null> {
  const builtin = BUILTIN_STYLES.find((style) => style.id === id);
  if (builtin) return builtin;
  const stored = await load();
  return stored.styles.find((style) => style.id === id) ?? null;
}

export async function getScript(id: string): Promise<ScriptTemplate | null> {
  const stored = await load();
  return stored.scripts.find((script) => script.id === id) ?? null;
}

/**
 * Enregistre un style avec son affiche. L'affiche arrive en data URL (image ou
 * vignette extraite de la vidéo) et repart sur disque sous le nom du style :
 * l'index ne transporte jamais d'image, sinon il devient illisible.
 */
export async function saveStyle(
  input: Omit<StyleTemplate, "id" | "createdAt" | "poster" | "builtin">,
  posterDataUrl?: string | null
): Promise<StyleTemplate> {
  const stored = await load();
  const id = newId(input.kind === "static" ? "st" : "vd");
  let poster: string | undefined;

  if (posterDataUrl) {
    const [, type = "image/png", base64 = ""] =
      posterDataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
    if (base64) {
      const ext = type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
      poster = `${id}.${ext}`;
      await mkdir(ROOT, { recursive: true });
      const target = path.join(ROOT, poster);
      const buffer = Buffer.from(base64, "base64");
      await writeFile(target, buffer);
      mirror(target, buffer);
    }
  }

  const style: StyleTemplate = { ...input, id, createdAt: new Date().toISOString(), poster };
  stored.styles.push(style);
  await save(stored);
  return style;
}

export async function renameStyle(id: string, name: string, pitch?: string) {
  const stored = await load();
  const style = stored.styles.find((item) => item.id === id);
  if (!style) return false;
  if (name.trim()) style.name = name.trim();
  if (pitch !== undefined) style.pitch = pitch.trim();
  await save(stored);
  return true;
}

export async function deleteStyle(id: string) {
  const stored = await load();
  const style = stored.styles.find((item) => item.id === id);
  if (!style) return false;
  stored.styles = stored.styles.filter((item) => item.id !== id);
  await save(stored);
  if (style.poster) await rm(path.join(ROOT, path.basename(style.poster)), { force: true }).catch(() => undefined);
  return true;
}

/**
 * Affiches des styles intégrés : déposées à la main dans `data/style-posters/`
 * sous le nom du style (`builtin-claim-callouts.jpg`…). Elles ne sont pas
 * versionnées avec le code — ce sont des créas d'autrui — mais une fois là,
 * la grille montre la vraie DA au lieu de l'aperçu dessiné.
 */
const BUILTIN_POSTERS = path.join(process.cwd(), "data", "style-posters");

function typeOf(file: string) {
  return /\.jpe?g$/i.test(file) ? "image/jpeg" : /\.webp$/i.test(file) ? "image/webp" : "image/png";
}

const REFERENCES = path.join(process.cwd(), "data", "references");

function referencePosterPath(id: string) {
  const style = BUILTIN_STYLES.find((item) => item.id === id);
  if (!style?.referencePoster) return null;
  const file = path.normalize(path.join(REFERENCES, style.referencePoster));
  // Le chemin reste sous data/references : un identifiant ne remonte jamais.
  return file.startsWith(REFERENCES) ? file : null;
}

export async function hasBuiltinPoster(id: string) {
  const reference = referencePosterPath(id);
  if (reference) {
    try {
      await readFile(reference);
      return true;
    } catch {
      // pas déposée : on regarde data/style-posters
    }
  }
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    try {
      await readFile(path.join(BUILTIN_POSTERS, `${path.basename(id)}.${ext}`));
      return true;
    } catch {
      // essai suivant
    }
  }
  return false;
}

export async function readPoster(id: string) {
  const style = await getStyle(id);
  if (!style) return null;

  if (style.builtin) {
    const reference = referencePosterPath(id);
    if (reference) {
      try {
        return { data: await readFile(reference), type: typeOf(reference) };
      } catch {
        // pas déposée : on regarde data/style-posters
      }
    }
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const file = path.join(BUILTIN_POSTERS, `${path.basename(id)}.${ext}`);
      try {
        return { data: await readFile(file), type: typeOf(file) };
      } catch {
        // essai suivant
      }
    }
    return null;
  }

  if (!style.poster) return null;
  const file = path.join(ROOT, path.basename(style.poster));
  try {
    return { data: await readFile(file), type: typeOf(file) };
  } catch {
    return null;
  }
}

export async function saveScript(input: Omit<ScriptTemplate, "id" | "createdAt">): Promise<ScriptTemplate> {
  const stored = await load();
  const script: ScriptTemplate = { ...input, id: newId("sc"), createdAt: new Date().toISOString() };
  stored.scripts.push(script);
  await save(stored);
  return script;
}

export async function updateScript(id: string, patch: Partial<Pick<ScriptTemplate, "name" | "text" | "tags" | "source" | "format">>) {
  const stored = await load();
  const script = stored.scripts.find((item) => item.id === id);
  if (!script) return false;
  Object.assign(script, patch);
  await save(stored);
  return true;
}

export async function deleteScript(id: string) {
  const stored = await load();
  const before = stored.scripts.length;
  stored.scripts = stored.scripts.filter((item) => item.id !== id);
  if (stored.scripts.length === before) return false;
  await save(stored);
  return true;
}
