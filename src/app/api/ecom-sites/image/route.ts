import { NextResponse } from "next/server";
import { createKieTask, getKieTask, uploadBase64 } from "@/lib/studio/kie";
import { getEcomSite } from "@/lib/ecom-sites/store";
import { sitePalette } from "@/lib/ecom-sites/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RATIOS = ["9:16", "3:4", "1:1", "4:3", "16:9"];
const TRANSIENT = /rate|limit|429|timeout|busy|saturé|too many|frequency/i;

type Body = {
  action?: "generate" | "status";
  siteId?: string;
  taskId?: string;
  /** La consigne, écrite en français. */
  prompt?: string;
  /** Images de référence : une photo à retoucher, un logo, un pack. */
  refs?: string[];
  /** Données d'image collées depuis le poste, à téléverser d'abord. */
  uploads?: Array<{ name: string; dataUrl: string }>;
  ratio?: string;
  /** Reprendre les packs brandés du site comme références supplémentaires. */
  usePacks?: boolean;
};

/**
 * Le cadre imposé à toute image du site.
 *
 * La consigne arrive en français et telle quelle : c'est celle de l'opérateur,
 * on ne la réécrit pas. Mais elle est encadrée — même direction artistique que
 * le reste du site, mêmes interdits — sinon chaque image régénérée ferait tache
 * à côté des autres, et l'ensemble cesserait de ressembler à une marque.
 */
function frame(prompt: string, accent: string, sand: string, hasPack: boolean) {
  return [
    "INSTRUCTION FROM THE OPERATOR, written in French. Follow it exactly:",
    prompt.trim(),
    "---",
    hasPack
      ? "THE ATTACHED IMAGES ARE THE REAL PRODUCTS. Every container in frame must be one of them, reproduced exactly with its brand logo readable. Never invent another pack, never redraw the logo."
      : "No invented logo, no invented brand name, no legible label text on any packaging.",
    `Colour world: ${accent} accents against ${sand}.`,
    "PHOTOGRAPH, not an illustration and not a 3D render. Real optics with mild",
    "edge softness, fine sensor grain, genuine shallow depth of field. One",
    "identifiable light source with a consistent shadow across every object.",
    "Real skin with pores and uneven tone, real fabric with weave and creases,",
    "surfaces with dust and small marks, slight asymmetry everywhere.",
    "ABSOLUTELY AVOID: airbrushed plastic skin, glowing rim light with no source,",
    "perfect symmetry, floating objects, over-saturated HDR, stock-photo blandness,",
    "CGI product renders, mangled or extra fingers, garbled or nonsense text.",
  ].join(" ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;

    if (body.action === "status") {
      if (!body.taskId) return NextResponse.json({ error: "taskId requis" }, { status: 400 });
      try {
        const task = await getKieTask(body.taskId);
        return NextResponse.json({ state: task.state, urls: task.urls, failMsg: task.failMsg ?? null });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Statut illisible";
        // Une limite de cadence ne veut pas dire que la tâche a échoué.
        if (TRANSIENT.test(message)) return NextResponse.json({ state: "pending", urls: [] });
        return NextResponse.json({ state: "fail", urls: [], failMsg: message });
      }
    }

    if (!body.siteId) return NextResponse.json({ error: "siteId requis" }, { status: 400 });
    if (!body.prompt?.trim()) return NextResponse.json({ error: "Décris ce que tu veux" }, { status: 400 });

    const site = await getEcomSite(body.siteId);
    if (!site) return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
    const theme = sitePalette(site.themeId, site.brandColors);

    /*
     * Les références, dans l'ordre où le modèle les lit.
     *
     * Ce qui vient du poste est téléversé d'abord : le modèle d'image ne sait
     * pas lire une donnée collée, il lui faut une adresse.
     */
    const refs: string[] = [...(body.refs ?? []).filter(Boolean)];
    for (const upload of body.uploads ?? []) {
      if (!upload?.dataUrl) continue;
      refs.push(await uploadBase64(upload.dataUrl, upload.name || `${site.slug}-ref.png`));
    }
    if (body.usePacks) {
      for (const product of site.products) {
        if (refs.length >= 5) break;
        if (product.imageUrl && product.imageUrl !== product.sourceImageUrl) refs.push(product.imageUrl);
      }
    }

    /*
     * Le format suit celui du site quand rien n'est demandé.
     *
     * Une image régénérée dans un autre rapport casse la grille où elle
     * retourne : la carte change de proportions, et la page se décale.
     */
    const asked = body.ratio && RATIOS.includes(body.ratio) ? body.ratio : "";
    const ratio = asked || (RATIOS.includes(site.imageRatio || "") ? site.imageRatio! : "1:1");

    const taskId = await createKieTask(
      refs.length ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
      {
        prompt: frame(body.prompt, theme.accent, theme.sand, refs.length > 0 && Boolean(body.usePacks)),
        ...(refs.length ? { input_urls: refs.slice(0, 5) } : {}),
        aspect_ratio: ratio,
        resolution: "1K",
      }
    );

    return NextResponse.json({ taskId, ratio, refs: refs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Génération impossible";
    return NextResponse.json(
      { error: TRANSIENT.test(message) ? "Kie saturé — réessaie dans un instant" : message },
      { status: 502 }
    );
  }
}
