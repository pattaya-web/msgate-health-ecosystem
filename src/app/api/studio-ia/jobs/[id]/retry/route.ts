import { NextRequest, NextResponse } from "next/server";
import { JobError, retryJob } from "@/lib/studio-ia/jobs";

export const dynamic = "force-dynamic";

/** `scope: "voice"` relance seulement la voix et l'assemblage ; `"all"` repart de zéro. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { scope, voiceId, voiceName, voiceAmbience, lipSync, voiceMode } = (await req.json().catch(() => ({}))) as {
    scope?: "all" | "voice";
    voiceId?: string;
    voiceName?: string;
    voiceAmbience?: "raw" | "close" | "room" | "far";
    lipSync?: boolean;
    voiceMode?: "keep" | "transform";
  };
  try {
    const job = await retryJob(
      id,
      scope === "voice" ? "voice" : "all",
      voiceId || voiceAmbience || typeof lipSync === "boolean" || voiceMode
        ? { voiceId: voiceId ?? "", voiceName: voiceName ?? "", voiceAmbience, lipSync, voiceMode }
        : undefined,
    );
    return NextResponse.json({ job });
  } catch (e) {
    const err = e as JobError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}
