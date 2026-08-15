import { NextResponse } from "next/server";
import { syncFromAirtable } from "@/lib/airtable/sync";

export const dynamic = "force-dynamic";

/**
 * Sync IBO + LLC (+ banks derived) from Airtable.
 * Falls back to local cleaned seed if credentials are missing.
 */
export async function POST() {
  try {
    const payload = await syncFromAirtable();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
