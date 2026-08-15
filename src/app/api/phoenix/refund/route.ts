import { NextResponse } from "next/server";
import { createRefund, getPhoenixConfig } from "@/lib/phoenix/client";
import type { PhoenixRefundRequest } from "@/lib/phoenix/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!getPhoenixConfig()) {
      return NextResponse.json(
        { error: "Phoenix not configured — set PHOENIX_* in .env.local" },
        { status: 503 }
      );
    }
    const body = (await request.json()) as PhoenixRefundRequest;
    if (!body?.customerId || !body?.orderId || !body?.actionType) {
      return NextResponse.json(
        { error: "customerId, orderId and actionType are required" },
        { status: 400 }
      );
    }
    const data = await createRefund(body);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refund failed" },
      { status: 502 }
    );
  }
}
