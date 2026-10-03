import { NextRequest, NextResponse } from "next/server";
import { MediaError } from "@/lib/studio-ia/media";
import { EnhanceError, enhancePrompt } from "@/lib/studio-ia/prompt-enhancer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** « Rédiger la consigne » : prompt structuré façon Higgsfield, écrit à partir de la vidéo et des références. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    sourceVideo?: string;
    referenceImages?: string[];
    productImages?: string[];
    productDescription?: string;
    sceneImage?: string;
    userPrompt?: string;
  } | null;
  if (!body?.sourceVideo) return NextResponse.json({ error: "Dépose d'abord ta vidéo." }, { status: 400 });
  try {
    const prompt = await enhancePrompt({
      sourceVideo: body.sourceVideo,
      referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages : [],
      productImages: Array.isArray(body.productImages) ? body.productImages : [],
      productDescription: body.productDescription,
      sceneImage: body.sceneImage,
      userPrompt: body.userPrompt,
    });
    return NextResponse.json({ prompt });
  } catch (e) {
    const err = e as EnhanceError | MediaError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : err.code === 404 ? 404 : 502 });
  }
}
