import { NextRequest, NextResponse } from "next/server";
import { uploadToKie, KieError } from "@/lib/kie";

export const dynamic = "force-dynamic";
/** Une vidéo de rush peut être longue à monter : on laisse largement le temps. */
export const maxDuration = 600;

/** 100 Mo. Au-delà, les modèles refusent de toute façon le média. */
const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Rend un fichier local accessible aux modèles KIE.
 *
 * Sans ça, le swap vidéo imposerait de faire tourner un tunnel : les modèles
 * ne lisent que des URL publiques. On passe par le stockage temporaire de KIE,
 * qui purge au bout de trois jours.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Fichier trop lourd (${Math.round(file.size / 1e6)} Mo). Limite : 100 Mo.` },
      { status: 413 },
    );
  }

  try {
    const url = await uploadToKie(file);
    return NextResponse.json({ url, name: file.name, size: file.size });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
