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
 * Les deux façons de montrer un produit.
 *
 * Par défaut (`product`), le produit seul, refait d'après les photos de la
 * source : même forme, mêmes couleurs, mêmes accessoires, sans boîte, sans
 * logo et sans texte. On ne fabrique pas un emballage que le client ne recevra
 * pas, et une boîte au logo de la boutique posée sur chaque produit se repère
 * immédiatement comme une image générée.
 *
 * `documented` : le produit est réellement livré dans un emballage de marque
 * et on en a la référence (photo ou fichier). On reproduit alors CET emballage,
 * avec le rendu d'une vraie photo de commerce, et le logo vient du fichier
 * exact, pas d'une réinvention du modèle.
 */
const NO_INVENTION = [
  "Do not add any packaging, box, sleeve, tag, sticker, barcode, QR code, certification mark, badge, seal,",
  "rating, price or any text that is not visible on the reference. Do not add accessories, refills or props",
  "that could be mistaken for part of the purchase.",
].join(" ");

const PHOTO_REALISM = [
  "Commercial product photograph, shot on a real camera: natural material texture (fabric weave, wood grain,",
  "matte or brushed plastic as on the reference), one soft key light, a real contact shadow on the surface,",
  "correct perspective and true-to-life proportions. Avoid CGI smoothness, glossy plastic reflections,",
  "floating objects, warped or garbled lettering and duplicated parts.",
].join(" ");

function productPrompt(product: EcomProduct, site: EcomSite, referenceCount: number) {
  const theme = sitePalette(site.themeId, site.brandColors);
  const included = (product.includedItems ?? []).map((item) => item.trim()).filter(Boolean);
  return [
    `Product photo of "${product.name}".`,
    referenceCount > 1
      ? `The ${referenceCount} attached images are photos of this exact product from the supplier: they show the same item.`
      : "The attached image is a photo of this exact product from the supplier.",
    "Reproduce the product itself faithfully: same shape, same proportions, same colours, same materials, same",
    "number of parts and the same features. Change nothing about the product.",
    "Remove everything that belongs to the supplier's photo rather than to the product: their logo, brand name,",
    "printed text, watermark, price, retail box, people, food, and any background props.",
    included.length
      ? `Show exactly what the customer receives, and nothing else: ${included.join("; ")}.`
      : "Show only the product as it appears in the reference, without any additional item.",
    NO_INVENTION,
    `Plain seamless background in a soft tone close to ${theme.sand}, the product centred and fully in frame.`,
    PHOTO_REALISM,
  ].join(" ");
}

function documentedPackPrompt(product: EcomProduct, hasLogo: boolean) {
  return [
    `Commercial photograph of the real retail packaging of "${product.name}".`,
    "IMAGE 1 is the reference of this packaging: reproduce it faithfully — same box or pouch construction,",
    "same proportions, same print layout, same colours, same panels and the same printed wording.",
    hasLogo
      ? "IMAGE 2 is the exact logo file: place it only where the reference shows the brand mark, once, copied as given — never redrawn, never retyped, never repeated."
      : "Keep the brand mark exactly where and as the reference shows it.",
    "Real cardboard or film: visible fibre texture, plausible folds, seams and glue flaps, crisp but physical",
    "printing, slightly soft edges. The packaging sits on a surface with a contact shadow, at a size consistent",
    "with the product it contains.",
    NO_INVENTION,
    PHOTO_REALISM,
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
            ? {
                ...product,
                imageUrl: byHandle.get(product.handle)!,
                packagingTaskId: null,
                // L'image est rattachée au nom du produit à cet instant, et à sa façon d'être faite.
                imageInfo:
                  product.packagingMode === "documented" && product.packagingReferenceUrl
                    ? { kind: "brand-pack" as const, forName: product.name, reference: "verified-pack" as const, at: new Date().toISOString() }
                    : { kind: "product-photo" as const, forName: product.name, reference: "source" as const, at: new Date().toISOString() },
              }
            : product
        ),
      });
      return NextResponse.json({ attached: byHandle.size });
    }

    if (!body.siteId) return NextResponse.json({ error: "siteId requis" }, { status: 400 });

    const site = await getEcomSite(body.siteId);
    if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
    const wanted = new Set(body.handles?.length ? body.handles : site.products.map((p) => p.handle));
    const targets = site.products.filter((product) => wanted.has(product.handle));
    if (!targets.length) return NextResponse.json({ error: "Aucun produit sélectionné" }, { status: 400 });

    // Le logo n'est envoyé que pour un emballage documenté, et une seule fois pour toute la fournée.
    const needsLogo = targets.some((product) => product.packagingMode === "documented" && product.packagingReferenceUrl);
    const logoUrl = needsLogo && site.logoDataUrl ? await uploadBase64(site.logoDataUrl, `${site.slug}-logo.png`) : "";

    const jobs: Array<{ handle: string; taskId: string | null; error: string | null }> = [];
    for (const product of targets) {
      try {
        let prompt: string;
        let inputs: string[];
        if (product.packagingMode === "documented") {
          const reference = product.packagingReferenceUrl?.trim();
          if (!reference) throw new Error("Emballage documenté sans référence : ajoute la photo ou le fichier de l'emballage réel");
          inputs = logoUrl ? [reference, logoUrl] : [reference];
          prompt = documentedPackPrompt(product, Boolean(logoUrl));
        } else {
          const references = [product.sourceImageUrl, ...(product.sourceImageUrls ?? [])]
            .map((url) => url?.trim() || "")
            .filter((url, index, all) => url && all.indexOf(url) === index)
            .slice(0, 3);
          // Sans photo du produit, on n'invente pas son apparence.
          if (!references.length) throw new Error("Aucune photo de référence du produit : ajoute-en une avant de générer");
          inputs = references;
          prompt = productPrompt(product, site, references.length);
        }
        const taskId = await createKieTask("gpt-image-2-image-to-image", {
          prompt,
          input_urls: inputs,
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
