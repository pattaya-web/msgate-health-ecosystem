import { NextResponse } from "next/server";
import { getPhoenixConfig, getStores } from "@/lib/phoenix/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!getPhoenixConfig()) {
      return NextResponse.json(
        { error: "Phoenix not configured — set PHOENIX_* in .env.local" },
        { status: 503 }
      );
    }
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") || 1);
    const limit = Number(searchParams.get("limit") || 25);
    const data = await getStores({ page, limit });
    const config = getPhoenixConfig()!;
    return NextResponse.json({
      ok: true,
      client: config.clientLabel,
      ...data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stores fetch failed" },
      { status: 502 }
    );
  }
}
