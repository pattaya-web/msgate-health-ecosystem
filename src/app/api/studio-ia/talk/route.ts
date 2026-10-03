import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/studio-ia/jobs";
import { createTalkJobs, TalkError } from "@/lib/studio-ia/talking-photo";
import type { TalkRequest } from "@/lib/studio-ia/types";

export const dynamic = "force-dynamic";

/** « Photo qui parle » : creation d'un lot de jobs InfiniteTalk, traites par la meme file. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as TalkRequest | null;
  if (!body) return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  try {
    const jobs = createTalkJobs(body);
    void tick();
    return NextResponse.json({ jobs });
  } catch (e) {
    const err = e as TalkError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}
