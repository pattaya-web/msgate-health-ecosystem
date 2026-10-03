import { NextRequest, NextResponse } from "next/server";
import { createTask, KieError } from "@/lib/kie";
import { insert } from "@/lib/db";
import { getModel } from "@/lib/models";
import type { Generation } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Traduit les refus les plus frequents de KIE.
 *
 * « File type not supported » ne dit ni quel fichier ni quel format est
 * attendu : sans reformulation, on ne peut rien en faire.
 */
function explain(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("file type") || m.includes("not supported")) {
    return (
      "Format de fichier refusé par le modèle. Les images doivent être en JPG, PNG ou WEBP, " +
      "les vidéos en MP4 ou MOV. Vérifie aussi qu'une vidéo n'est pas dans un emplacement photo."
    );
  }
  if (m.includes("duration")) {
    return "Durée de vidéo hors limites. Kling demande un clip entre 3 et 30 secondes.";
  }
  if (m.includes("size") || m.includes("large")) {
    return "Fichier trop lourd : 10 Mo maximum pour une image, 100 Mo pour une vidéo.";
  }
  if (m.includes("insufficient") || m.includes("credit")) {
    return "Crédits KIE insuffisants pour lancer cette génération.";
  }
  return msg;
}

export async function POST(req: NextRequest) {
  const { model, input } = (await req.json()) as { model: string; input: Record<string, unknown> };
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Modèle inconnu : ${model}` }, { status: 400 });

  // On nettoie les champs vides pour ne pas envoyer de null à KIE.
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === "" || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    payload[k] = v;
  }

  /*
   * Bascule vers le point d'entree image-vers-image.
   *
   * KIE separe les deux endpoints d'un meme modele. Le catalogue n'expose
   * qu'une entree pour ne pas obliger a choisir avant d'avoir ses images : on
   * corrige ici l'identifiant si des references ont ete fournies.
   */
  const hasRefs = ["input_urls", "image_urls", "image_input"].some((k) => {
    const v = payload[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
  const target = def.withImages && hasRefs ? def.withImages : model;

  /*
   * « Fond : Auto » n'est pas une valeur, c'est l'absence de consigne. KIE le
   * refuse pourtant sur GPT Image 2 en 2K (« generation with background is
   * temporarily unavailable at the current resolution ») : on ne l'envoie pas.
   */
  if (payload.background === "auto") delete payload.background;

  const base = process.env.PUBLIC_BASE_URL?.trim();
  // Le callback n'est utile que si le tool est joignable depuis Internet.
  const callback = base && !base.includes("localhost") ? `${base}/api/kie/callback` : undefined;

  try {
    let taskId: string;
    try {
      taskId = await createTask(target, payload, callback);
    } catch (e) {
      // Fond explicite refuse a cette definition : on retente sans, plutot que d'echouer.
      const msg = (e as KieError).message ?? "";
      if (payload.background && /generation with background/i.test(msg)) {
        delete payload.background;
        taskId = await createTask(target, payload, callback);
      } else {
        throw e;
      }
    }
    const row = insert("generations", {
      taskId,
      model: target,
      // Les modeles de swap rendent une video : c'est ce que la galerie doit lire.
      kind: def.kind === "image" ? "image" : "video",
      prompt: String(payload.prompt ?? ""),
      input: payload,
      state: "waiting",
      resultUrls: [],
      creditsConsumed: 0,
      failMsg: "",
      progress: 0,
      costTimeSec: 0,
      updatedAt: new Date().toISOString(),
    }) as unknown as Generation;
    return NextResponse.json(row);
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: explain(err.message) }, { status: err.code === 401 ? 401 : 502 });
  }
}
