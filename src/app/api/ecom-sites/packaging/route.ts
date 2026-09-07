import { NextResponse } from "next/server";
import { createKieTask, getKieTask, uploadBase64 } from "@/lib/studio/kie";
import { getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import { sitePalette, type EcomProduct, type EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ASPECT_RATIO = "1:1";
const CREATE_GAP_MS = 900;
const TRANSIENT = /rate|limit|429|timeout|busy|saturé|too many/i;

type Body = {
  action?: "generate" | "status";
  siteId?: string;
  handles?: string[];
  taskIds?: string[];
  resolution?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPrompt(product: EcomProduct, site: EcomSite) {
  const theme = sitePalette(site.themeId, site.brandColors);
  const brandName = site.brandName;
  return [
    `Product packaging photograph for a US direct-to-consumer brand.`,
    `The attached image is the brand logo. Reproduce it exactly as given on the front of the packaging, correctly spelled, unrotated, not redrawn.`,
    `Brand name printed on the pack: "${brandName}".`,
    `Product name printed on the pack: "${product.name}".`,
    product.dosage ? `Secondary line on the pack: "${product.dosage}".` : "",
    `Packaging style: clean modern retail supplement packaging, matte finish, accent colour ${theme.accent} against ${theme.sand}.`,
    `Single pack, centred, floating on a plain ${theme.wash} background, soft studio lighting, gentle contact shadow, square crop, photorealistic, sharp label text.`,
    `Do not invent certification seals, award badges, medical claims, star ratings or any text beyond the brand name, the product name and the line given above.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;

    if (body.action === "status") {
      const taskIds = (body.taskIds ?? []).slice(0, 40);
      const results = await Promise.all(
        taskIds.map(async (taskId) => {
          try {
            const task = await getKieTask(taskId);
            return { taskId, state: task.state, urls: task.urls, failMsg: task.failMsg ?? null };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Statut illisible";
            // Une limite de cadence ne veut pas dire que la tâche a échoué.
            if (TRANSIENT.test(message)) return { taskId, state: "pending", urls: [], failMsg: null };
            return { taskId, state: "fail", urls: [], failMsg: message };
          }
        })
      );
      return NextResponse.json({ results });
    }

    if (!body.siteId) return NextResponse.json({ error: "siteId requis" }, { status: 400 });

    const site = await getEcomSite(body.siteId);
    if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
    if (!site.logoDataUrl) {
      return NextResponse.json(
        { error: "Charge le logo du site avant de générer les packagings" },
        { status: 400 }
      );
    }

    const wanted = new Set(body.handles?.length ? body.handles : site.products.map((p) => p.handle));
    const targets = site.products.filter((product) => wanted.has(product.handle));
    if (!targets.length) return NextResponse.json({ error: "Aucun produit sélectionné" }, { status: 400 });

    // Un seul upload du logo pour toute la fournée.
    const logoUrl = await uploadBase64(site.logoDataUrl, `${site.slug}-logo.png`);

    const jobs: Array<{ handle: string; taskId: string | null; error: string | null }> = [];
    for (const product of targets) {
      try {
        const taskId = await createKieTask("gpt-image-2-image-to-image", {
          prompt: buildPrompt(product, site),
          input_urls: [logoUrl],
          aspect_ratio: ASPECT_RATIO,
          resolution: body.resolution || "1K",
        });
        jobs.push({ handle: product.handle, taskId, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Création impossible";
        jobs.push({
          handle: product.handle,
          taskId: null,
          error: TRANSIENT.test(message) ? "Kie saturé — relance ce produit" : message,
        });
      }
      await sleep(CREATE_GAP_MS);
    }

    // Les taskId sont posés sur les produits : un rechargement de page retrouve
    // les générations en cours au lieu de les perdre.
    const byHandle = new Map(jobs.map((job) => [job.handle, job.taskId]));
    await updateEcomSite(site.id, {
      products: site.products.map((product) =>
        byHandle.has(product.handle)
          ? { ...product, packagingTaskId: byHandle.get(product.handle) ?? null }
          : product
      ),
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Génération packaging impossible" },
      { status: 502 }
    );
  }
}
