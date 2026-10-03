import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { getKieTask, isKieDone, isKieFailed } from "@/lib/studio/kie";
import { saveStaticCreative, type StaticCreative } from "@/lib/studio/library";
import type { Ratio } from "@/lib/studio/ratios";

/**
 * Registre des tâches Kie lancées par le studio et pas encore rangées.
 *
 * Jusqu'ici, c'était le navigateur qui attendait la fin d'une tâche puis
 * envoyait le rendu en bibliothèque. Un onglet fermé, un rechargement après
 * deux heures, un stockage local plein : la tâche finissait chez Kie et
 * personne ne la rangeait — l'image, déjà facturée, expirait sur son hôte
 * temporaire. Le serveur note donc chaque tâche à sa création, avec tout ce
 * qu'il faut pour l'enregistrer, et la range lui-même dès qu'il la voit
 * aboutir (à la sonde) ou au rattrapage (à l'ouverture de la bibliothèque).
 */

export type PendingTask = {
  taskId: string;
  createdAt: string;
  brief: string;
  prompt: string;
  ratio: Ratio;
  resolution: "1K" | "2K";
  referenceUrls: string[];
  media: "image" | "video";
};

const ROOT = path.join(process.cwd(), ".msgate-cache", "studio-static");
const FILE = path.join(ROOT, "pending.json");
/** Kie ne garde pas ses résultats bien plus longtemps : au-delà, la tâche est abandonnée. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type State = { items: PendingTask[] | null; chain: Promise<unknown> };
const state = ((globalThis as typeof globalThis & { __msgateStudioPending?: State }).__msgateStudioPending ??= { items: null, chain: Promise.resolve() });

async function load(): Promise<PendingTask[]> {
  if (state.items) return state.items;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as { items?: PendingTask[] };
    state.items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    state.items = [];
  }
  return state.items;
}

async function persist() {
  await mkdir(ROOT, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmp, JSON.stringify({ items: state.items ?? [] }, null, 2));
  await rename(tmp, FILE);
}

/** Une seule opération à la fois : la sonde et le rattrapage peuvent voir la même tâche finir au même instant. */
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = state.chain.then(work, work);
  state.chain = run.catch(() => undefined);
  return run;
}

export function addPendingTasks(tasks: PendingTask[]) {
  return serialized(async () => {
    const items = await load();
    for (const task of tasks) {
      if (!task.taskId || items.some((entry) => entry.taskId === task.taskId)) continue;
      items.push(task);
    }
    await persist();
  });
}

export async function listPendingTasks(): Promise<PendingTask[]> {
  return [...(await load())];
}

export function dropPendingTask(taskId: string) {
  return serialized(async () => {
    const items = await load();
    const next = items.filter((entry) => entry.taskId !== taskId);
    if (next.length === items.length) return;
    state.items = next;
    await persist();
  });
}

/**
 * Range une tâche terminée si elle est encore en attente. Rend la créa écrite,
 * ou null quand la tâche n'était pas suivie ici (ancien onglet, autre écran).
 */
export function settlePendingTask(taskId: string, urls: string[]): Promise<StaticCreative | null> {
  return serialized(async () => {
    const items = await load();
    const entry = items.find((item) => item.taskId === taskId);
    if (!entry || !urls.length) return null;
    const saved = await saveStaticCreative({
      brief: entry.brief,
      prompt: entry.prompt,
      ratio: entry.ratio,
      resolution: entry.resolution,
      resultUrls: urls,
      referenceUrls: entry.referenceUrls,
      media: entry.media,
      taskId,
    });
    state.items = items.filter((item) => item.taskId !== taskId);
    await persist();
    return saved;
  });
}

/**
 * Rattrapage borné : sonde les tâches en attente, les plus anciennes d'abord,
 * range celles qui ont abouti, oublie celles qui ont échoué ou expiré. Appelé
 * à l'ouverture de la bibliothèque, il doit rester court.
 */
export function reconcilePendingTasks(limit = 6, budgetMs = 8_000) {
  return serialized(async () => {
    const items = await load();
    if (!items.length) return { settled: 0, dropped: 0 };
    const started = Date.now();
    const now = Date.now();
    let settled = 0;
    let dropped = 0;
    const ordered = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
    for (const entry of ordered) {
      if (Date.now() - started > budgetMs) break;
      if (now - new Date(entry.createdAt).getTime() > MAX_AGE_MS) {
        state.items = (state.items ?? []).filter((item) => item.taskId !== entry.taskId);
        dropped += 1;
        continue;
      }
      try {
        const task = await getKieTask(entry.taskId);
        if (isKieDone(task.state) && task.urls.length) {
          await saveStaticCreative({
            brief: entry.brief,
            prompt: entry.prompt,
            ratio: entry.ratio,
            resolution: entry.resolution,
            resultUrls: task.urls,
            referenceUrls: entry.referenceUrls,
            media: entry.media,
            taskId: entry.taskId,
          });
          state.items = (state.items ?? []).filter((item) => item.taskId !== entry.taskId);
          settled += 1;
        } else if (isKieFailed(task.state)) {
          state.items = (state.items ?? []).filter((item) => item.taskId !== entry.taskId);
          dropped += 1;
        }
      } catch {
        // limite de cadence ou réseau : la tâche reste en attente pour le prochain passage
      }
    }
    if (settled || dropped) await persist();
    return { settled, dropped };
  });
}
