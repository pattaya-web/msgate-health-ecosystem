import { NextResponse } from "next/server";
import { updateLlcInAirtable } from "@/lib/airtable/write";
import { getAirtableConfig } from "@/lib/airtable/client";
import type { EntityStatus } from "@/types";

export const dynamic = "force-dynamic";

type PatchBody = {
  status?: EntityStatus;
  bank_status?: EntityStatus;
  domain?: string | null;
  phone?: string | null;
  banks_label?: string | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as PatchBody;

    if (!getAirtableConfig()) {
      // Local-only mode: acknowledge write without Airtable
      return NextResponse.json({
        ok: true,
        mode: "local",
        id,
        patch: body,
        message: "Saved locally (Airtable keys missing — connect AIRTABLE_* for live write-back)",
      });
    }

    const record = await updateLlcInAirtable(id, body);
    return NextResponse.json({
      ok: true,
      mode: "airtable",
      id: record.id,
      fields: record.fields,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 }
    );
  }
}
