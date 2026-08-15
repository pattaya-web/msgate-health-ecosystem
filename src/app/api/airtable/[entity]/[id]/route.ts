import { NextResponse } from "next/server";
import { getAirtableConfig } from "@/lib/airtable/client";
import {
  isAirtableRecordId,
  llcIdFromDerivedBankId,
  updateBankViaLlcInAirtable,
  updateIboInAirtable,
  updateLlcInAirtable,
  updateMidInAirtable,
  type BankPatch,
  type IboPatch,
  type LlcPatch,
  type MidPatch,
} from "@/lib/airtable/write";

export const dynamic = "force-dynamic";

type Entity = "llcs" | "ibos" | "banks" | "mids";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ entity: string; id: string }> }
) {
  try {
    const { entity: rawEntity, id } = await context.params;
    const entity = rawEntity as Entity;
    const body = await request.json();

    if (!["llcs", "ibos", "banks", "mids"].includes(entity)) {
      return NextResponse.json({ error: "Unknown entity" }, { status: 400 });
    }

    if (!getAirtableConfig()) {
      return NextResponse.json({
        ok: true,
        mode: "local",
        entity,
        id,
        patch: body,
        message: "Saved locally (Airtable keys missing)",
      });
    }

    if (entity === "llcs") {
      if (!isAirtableRecordId(id)) {
        return NextResponse.json({
          ok: true,
          mode: "local",
          entity,
          id,
          patch: body,
          message: "Seed id — local only until Airtable sync replaces ids",
        });
      }
      const record = await updateLlcInAirtable(id, body as LlcPatch);
      return NextResponse.json({ ok: true, mode: "airtable", id: record.id, fields: record.fields });
    }

    if (entity === "ibos") {
      if (!isAirtableRecordId(id)) {
        return NextResponse.json({
          ok: true,
          mode: "local",
          entity,
          id,
          patch: body,
          message: "Seed id — local only until Airtable sync replaces ids",
        });
      }
      const record = await updateIboInAirtable(id, body as IboPatch);
      return NextResponse.json({ ok: true, mode: "airtable", id: record.id, fields: record.fields });
    }

    if (entity === "banks") {
      const patch = body as BankPatch & { llc_id?: string; banks_label?: string | null };
      const llcId =
        patch.llc_id ||
        llcIdFromDerivedBankId(id) ||
        (isAirtableRecordId(id) ? null : null);

      if (llcId && isAirtableRecordId(llcId)) {
        const record = await updateBankViaLlcInAirtable({
          llcId,
          patch,
          banksLabel: patch.banks_label,
        });
        return NextResponse.json({
          ok: true,
          mode: "airtable",
          via: "llc",
          id: record.id,
          fields: record.fields,
        });
      }

      // No LLC bridge — acknowledge local
      return NextResponse.json({
        ok: true,
        mode: "local",
        entity,
        id,
        patch,
        message: "Bank saved locally (linked via LLC Statuts Bank when LLC has Airtable id)",
      });
    }

    if (entity === "mids") {
      if (!isAirtableRecordId(id)) {
        return NextResponse.json({
          ok: true,
          mode: "local",
          entity,
          id,
          patch: body,
          message: "MID saved locally (needs Airtable MID record id for write-back)",
        });
      }
      try {
        const record = await updateMidInAirtable(id, body as MidPatch);
        return NextResponse.json({
          ok: true,
          mode: "airtable",
          id: record.id,
          fields: record.fields,
        });
      } catch (error) {
        // MIDs table may not exist yet
        return NextResponse.json({
          ok: true,
          mode: "local",
          entity,
          id,
          patch: body,
          message:
            error instanceof Error
              ? `MID local save (${error.message})`
              : "MID saved locally",
        });
      }
    }

    return NextResponse.json({ error: "Unhandled" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 }
    );
  }
}
