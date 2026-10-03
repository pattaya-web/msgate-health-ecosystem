import { NextRequest, NextResponse } from "next/server";
import { KIE_VOICES } from "@/lib/studio-ia/kie-voices";
import { ElevenLabsError, listVoices } from "@/lib/studio-ia/providers/elevenlabs";
import { availableVoiceEngine } from "@/lib/studio-ia/voice-transform";

export const dynamic = "force-dynamic";

/**
 * Voix disponibles, selon le moteur : celles du compte ElevenLabs (speech-to-
 * speech) ou le catalogue ElevenLabs de KIE (TTS de repli). Sans aucune clé :
 * liste vide et `configured: false`, jamais une erreur.
 */
export async function GET(req: NextRequest) {
  const engine = availableVoiceEngine();
  if (!engine) return NextResponse.json({ configured: false, engine: null, voices: [] });
  if (engine === "kie-tts") return NextResponse.json({ configured: true, engine, voices: KIE_VOICES });
  try {
    const voices = await listVoices(req.nextUrl.searchParams.get("force") === "1");
    return NextResponse.json({ configured: true, engine, voices });
  } catch (e) {
    const err = e as ElevenLabsError;
    const message = err instanceof ElevenLabsError ? err.message : "ElevenLabs est injoignable pour l'instant (réseau). Réessaie dans quelques secondes.";
    return NextResponse.json({ configured: true, engine, voices: [], error: message }, { status: err.code === 401 ? 401 : 502 });
  }
}
