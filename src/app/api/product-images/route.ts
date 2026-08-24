import { NextResponse } from "next/server";
import { createKieTask, getKieTask, uploadBase64 } from "@/lib/studio/kie";
import { buildPrompt, type AgeBand, type ShotId } from "@/lib/product-images/shots";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type GenerateProduct = {
  handle: string;
  title: string;
  type?: string;
  /**
   * Photos d'origine du produit. Plusieurs angles valent bien mieux qu'une seule
   * image : sans dos ni détail, le modèle invente les parties qu'il ne voit pas.
   */
  referenceUrls?: string[];
};

type Body = {
  action?: "prompts" | "logo" | "generate" | "status";
  products?: GenerateProduct[];
  shots?: ShotId[];
  age?: AgeBand;
  logoUrl?: string;
  logoDataUrl?: string;
  taskIds?: string[];
  resolution?: string;
};

/** Les visuels produit sortent toujours en portrait 3:4 : non négociable côté client. */
const ASPECT_RATIO = "3:4";

/** Kie accepte 8 images d'entrée ; on en garde une pour le logo du plan unboxing. */
const MAX_PRODUCT_REFS = 6;

/** Kie limite la cadence : un lot trop large déclenche « call frequency is too high ». */
const POLL_CHUNK = 4;
const POLL_GAP_MS = 350;

const TRANSIENT = /frequency is too high|rate.?limit|too many requests|\b429\b|timeout|ETIMEDOUT|ECONNRESET/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Création de tâches : Kie n'en accepte qu'une poignée d'affilée. */
const CREATE_CONCURRENCY = 2;
const CREATE_GAP_MS = 700;
const CREATE_RETRIES = 3;

/** Réessaie tant que l'erreur est une saturation, avec un délai qui double. */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CREATE_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!TRANSIENT.test(message)) throw error;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Exécute les tâches par petits lots espacés, dans l'ordre, sans rafale. */
async function runQueue<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  gapMs: number
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = await Promise.all(items.slice(i, i + concurrency).map(worker));
    out.push(...batch);
    if (i + concurrency < items.length) await sleep(gapMs);
  }
  return out;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  try {
    if (body.action === "logo") {
      if (!body.logoDataUrl) return NextResponse.json({ error: "Logo manquant" }, { status: 400 });
      const url = await uploadBase64(body.logoDataUrl, `logo-${Date.now()}.png`);
      return NextResponse.json({ url });
    }

    const products = body.products ?? [];
    const shots = body.shots ?? [];

    if (body.action === "prompts") {
      const prompts = products.flatMap((product) =>
        shots.map((shot) => ({
          handle: product.handle,
          shot,
          prompt: buildPrompt(shot, product, body.age),
        }))
      );
      return NextResponse.json({ prompts });
    }

    if (body.action === "generate") {
      if (!products.length || !shots.length) {
        return NextResponse.json({ error: "Sélectionne au moins un produit et un plan" }, { status: 400 });
      }

      const entries = products.flatMap((product) => shots.map((shot) => ({ product, shot })));

      const jobs = await runQueue(
        entries,
        async ({ product, shot }) => {
          const prompt = buildPrompt(shot, product, body.age);
          const productRefs = (product.referenceUrls ?? []).slice(0, MAX_PRODUCT_REFS);

          // L'unboxing montre le produit DANS la boîte : il lui faut le logo et les
          // photos produit. Le logo passe en premier, le prompt s'appuie sur cet
          // ordre pour distinguer ce qui va sur le couvercle de ce qui va dedans.
          const references = (
            shot === "packaging" ? [body.logoUrl, ...productRefs] : productRefs
          ).filter((url): url is string => Boolean(url && /^https:\/\//i.test(url)));

          try {
            const taskId = await withRetry(() =>
              references.length
                ? createKieTask("gpt-image-2-image-to-image", {
                    prompt,
                    input_urls: references,
                    aspect_ratio: ASPECT_RATIO,
                    resolution: body.resolution || "1K",
                  })
                : createKieTask("gpt-image-2-text-to-image", {
                    prompt,
                    aspect_ratio: ASPECT_RATIO,
                    resolution: body.resolution || "1K",
                  })
            );
            return { handle: product.handle, shot, prompt, taskId, error: null, refs: references.length };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Création impossible";
            return {
              handle: product.handle,
              shot,
              prompt,
              taskId: null,
              // Après trois tentatives espacées, c'est bien la file qui sature.
              error: TRANSIENT.test(message) ? "Kie saturé — relance ce produit" : message,
              refs: references.length,
            };
          }
        },
        CREATE_CONCURRENCY,
        CREATE_GAP_MS
      );

      return NextResponse.json({ jobs });
    }

    if (body.action === "status") {
      const taskIds = (body.taskIds ?? []).slice(0, 60);
      const results: Array<{
        taskId: string;
        state?: string;
        urls: string[];
        failMsg: string | null;
        throttled?: boolean;
      }> = [];

      // Petits lots espacés plutôt qu'un Promise.all sur toutes les tâches.
      for (let i = 0; i < taskIds.length; i += POLL_CHUNK) {
        const chunk = taskIds.slice(i, i + POLL_CHUNK);
        const batch = await Promise.all(
          chunk.map(async (taskId) => {
            try {
              const task = await getKieTask(taskId);
              return { taskId, state: task.state, urls: task.urls, failMsg: task.failMsg ?? null };
            } catch (error) {
              const message = error instanceof Error ? error.message : "Statut illisible";
              // Une limite de cadence n'est pas un échec de génération : on
              // laisse la tâche en cours, le client redemandera plus tard.
              if (TRANSIENT.test(message)) {
                return { taskId, state: "pending", urls: [], failMsg: null, throttled: true };
              }
              return { taskId, state: "fail", urls: [], failMsg: message };
            }
          })
        );
        results.push(...batch);
        if (i + POLL_CHUNK < taskIds.length) await sleep(POLL_GAP_MS);
      }

      return NextResponse.json({ results, throttled: results.some((row) => row.throttled) });
    }

    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération impossible" },
      { status: 502 }
    );
  }
}
