import { NextResponse } from "next/server";
import {
  aggregateTransactions,
  getPhoenixConfig,
  getTransactionHistory,
} from "@/lib/phoenix/client";

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
    const customerId = searchParams.get("customerId") || searchParams.get("CustomerId");
    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }
    const startDateTime =
      searchParams.get("startDateTime") || searchParams.get("StartDateTime") || undefined;

    const data = await getTransactionHistory({ customerId, startDateTime });
    const txs = data.Result || [];
    const aggregates = aggregateTransactions(txs);

    return NextResponse.json({
      ok: true,
      customerId: Number(customerId) || customerId,
      Result: txs,
      aggregates,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transaction history failed" },
      { status: 502 }
    );
  }
}
