import { NextResponse } from "next/server";
import { fetchSavBodies, isSavConfigured } from "@/lib/sav/imap";
import { findCachedThread } from "@/lib/sav/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Détail d'un fil : mêmes messages, mais avec les corps complets. */
export async function GET(request: Request) {
  if (!isSavConfigured()) {
    return NextResponse.json({ error: "SAV non configuré" }, { status: 503 });
  }

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  const thread = findCachedThread(id);
  if (!thread) {
    return NextResponse.json(
      { error: "Fil introuvable — recharge la boîte SAV." },
      { status: 404 }
    );
  }

  try {
    const bodies = await fetchSavBodies(thread.messages.map((message) => message.id));
    return NextResponse.json({
      thread: {
        ...thread,
        messages: thread.messages.map((message) => ({
          ...message,
          body: bodies.get(message.id) || message.body || "",
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fil indisponible" },
      { status: 502 }
    );
  }
}
