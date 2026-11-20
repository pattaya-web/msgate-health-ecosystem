import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-root";

/**
 * L'espace de Noah (assistante) pour l'Instagram organique de Moosha : les
 * réels qu'elle publie (compteur du jour pour chauffer le compte), et ce que
 * Mady lui prépare (tutos vidéo, stratégie, prompts, liens).
 *
 * Disque permanent du serveur (.msgate-cache), un seul fichier.
 */

export type NoahPost = {
  id: string;
  at: string;
  /** Lien du réel (Instagram ou Buffer), facultatif. */
  url: string;
  note: string;
  by: string;
};

export type NoahResource = { id: string; title: string; url: string; note: string };
export type NoahPrompt = { id: string; title: string; text: string };

export type NoahConfig = {
  /** Compte Instagram travaillé. */
  account: string;
  /** Premier jour de la chauffe (AAAA-MM-JJ) ; vide = jour du premier réel. */
  warmupStart: string;
  /**
   * Objectif de réels par jour selon l'avancée de la chauffe :
   * une ligne par palier, « à partir du jour N : X réels ».
   */
  ramp: Array<{ fromDay: number; perDay: number }>;
  strategy: string;
  videos: NoahResource[];
  prompts: NoahPrompt[];
  links: NoahResource[];
};

export type NoahStore = { config: NoahConfig; posts: NoahPost[] };

const FILE = path.join(STORAGE_ROOT, ".msgate-cache", "noah-instagram.json");

export const DEFAULT_CONFIG: NoahConfig = {
  account: "moosha.us",
  warmupStart: "",
  // Montée progressive : un compte neuf qui publie 10 réels dès le premier jour se fait freiner.
  ramp: [
    { fromDay: 1, perDay: 3 },
    { fromDay: 8, perDay: 5 },
    { fromDay: 15, perDay: 7 },
    { fromDay: 22, perDay: 10 },
  ],
  strategy:
    "1. Chaque jour, crée tes réels dans le Studio IA Moosha avec les prompts ci-dessous.\n2. Monte-les si besoin dans Montage (texte, emojis, musique).\n3. Planifie-les dans Buffer sur @moosha.us, répartis dans la journée.\n4. Après chaque réel planifié, clique « J'ai posté un réel » pour le compter.",
  videos: [],
  prompts: [],
  links: [
    { id: "buffer", title: "Buffer (planifier les posts)", url: "https://publish.buffer.com", note: "" },
    { id: "instagram", title: "Instagram @moosha.us", url: "https://www.instagram.com/moosha.us/", note: "" },
  ],
};

export async function readNoah(): Promise<NoahStore> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<NoahStore>;
    return { config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) }, posts: Array.isArray(parsed.posts) ? parsed.posts : [] };
  } catch {
    return { config: DEFAULT_CONFIG, posts: [] };
  }
}

export async function writeNoah(store: NoahStore) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, FILE);
}
