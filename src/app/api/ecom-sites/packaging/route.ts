import { NextResponse } from "next/server";
import { createKieTask, getKieTask, uploadBase64 } from "@/lib/studio/kie";
import { getEcomSite, updateEcomSite } from "@/lib/ecom-sites/store";
import { sitePalette, type EcomProduct, type EcomSite } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Formats acceptés ; le site en retient un, mesuré sur le modèle copié. */
const RATIOS = ["9:16", "3:4", "1:1", "4:3", "16:9"];
const CREATE_GAP_MS = 900;
const TRANSIENT = /rate|limit|429|timeout|busy|saturé|too many/i;

type Body = {
  action?: "generate" | "status" | "attach";
  siteId?: string;
  handles?: string[];
  taskIds?: string[];
  resolution?: string;
  /** Packs sortis, à poser tout de suite sur le site. */
  ready?: Array<{ handle: string; url: string }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deux prompts, selon qu'on ait un pack de référence ou non.
 *
 * Avec gabarit, on ne demande pas « un joli packaging » mais la reprise du pack
 * source à l'identique — même forme, même disposition, mêmes zones — en ne
 * changeant que la marque et la couleur. C'est ce qui fait qu'une boutique
 * clonée ressemble vraiment à celle dont elle s'inspire, au lieu d'aligner des
 * pots génériques qui n'ont rien à voir.
 *
 * Sans gabarit, on retombe sur la composition libre.
 */
function buildPrompt(product: EcomProduct, site: EcomSite, hasTemplate: boolean) {
  const theme = sitePalette(site.themeId, site.brandColors);

  /*
   * Le logo est la marque, et rien d'autre ne la porte.
   *
   * La consigne demandait aussi d'imprimer le nom de marque en toutes lettres.
   * Le modèle arbitrait alors entre les deux : certains packs recevaient le
   * logo, d'autres un nom composé au hasard d'une police. On ne demande donc
   * plus qu'une chose, et on interdit explicitement l'autre.
   */
  const shared = [
    "The brand mark on this pack is the supplied logo image, reproduced as given.",
    `NEVER typeset the brand name "${site.brandName}" as text: the logo already carries it.`,
    `Product name printed on the pack: "${product.name}".`,
    product.dosage ? `Secondary line on the pack: "${product.dosage}".` : "",
    `Do not invent certification seals, award badges, medical claims, star ratings or any text beyond the product name and the line given above.`,
  ].filter(Boolean);

  if (hasTemplate) {
    return [
      "Product packaging photograph. You are given TWO reference images.",
      "IMAGE 1 is the reference pack. IMAGE 2 is the brand logo.",
      "Reproduce IMAGE 1 exactly: same container type and shape, same proportions,",
      "same cap or closure, same label geometry, same placement and size of every",
      "block on the label, same camera angle, same lighting, same shadow, same",
      "background treatment and same crop.",
      `ONLY TWO THINGS CHANGE: the colour scheme becomes ${theme.accent} against ${theme.sand}, and the branding becomes mine.`,
      "Place the logo from IMAGE 2 exactly where the source brand mark sits, at the",
      "same size and the same proportions, pixel-faithful — never redrawn, never",
      "restyled, never replaced by typed letters. It must be legible and unrotated.",
      "Every other element keeps its position. Do not restyle, do not simplify, do",
      "not add or remove anything from the composition.",
      ...shared,
    ].join(" ");
  }

  return [
    `Product packaging photograph for a US direct-to-consumer brand.`,
    `The attached image is the brand logo. Reproduce it exactly as given on the front of the packaging — pixel-faithful, unrotated, never redrawn and never replaced by typed letters.`,
    ...shared,
    `Packaging style: clean modern retail supplement packaging, matte finish, accent colour ${theme.accent} against ${theme.sand}.`,
    `Single pack, centred, floating on a plain ${theme.wash} background, soft studio lighting, gentle contact shadow, square crop, photorealistic, sharp label text.`,
  ].join(" ");
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

    /*
     * Un pack sorti est enregistré tout de suite, sans attendre « Enregistrer ».
     *
     * Les résultats ne vivaient que dans le brouillon de l'onglet : fermer
     * l'onglet avant de sauvegarder faisait perdre des images déjà payées, et
     * rien ne prévenait. Le rendu arrive, il se pose. Le reste du brouillon —
     * textes, champs en cours de saisie — n'est pas touché.
     */
    if (body.action === "attach") {
      if (!body.siteId) return NextResponse.json({ error: "siteId requis" }, { status: 400 });
      const target = await getEcomSite(body.siteId);
      if (!target) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });

      const byHandle = new Map((body.ready ?? []).map((item) => [item.handle, item.url]));
      if (!byHandle.size) return NextResponse.json({ error: "Rien à poser" }, { status: 400 });

      await updateEcomSite(target.id, {
        products: target.products.map((product) =>
          byHandle.has(product.handle)
            ? { ...product, imageUrl: byHandle.get(product.handle)!, packagingTaskId: null }
            : product
        ),
      });
      return NextResponse.json({ attached: byHandle.size });
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
        /*
         * Le pack source passe en PREMIÈRE référence : le prompt s'y réfère
         * comme « IMAGE 1 », et l'ordre des images est ce qui le rend lisible.
         */
        const template = product.sourceImageUrl?.trim();
        const taskId = await createKieTask("gpt-image-2-image-to-image", {
          prompt: buildPrompt(product, site, Boolean(template)),
          input_urls: template ? [template, logoUrl] : [logoUrl],
          aspect_ratio: RATIOS.includes(site.imageRatio || "") ? site.imageRatio : "1:1",
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
