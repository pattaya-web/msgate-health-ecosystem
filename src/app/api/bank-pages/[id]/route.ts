import { NextResponse } from "next/server";
import { deleteBankPage, updateBankPage } from "@/lib/bank-pages/store";
import type { BankPage } from "@/lib/bank-pages/types";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patch = (await request.json()) as Partial<BankPage>;
  const page = await updateBankPage(id, patch);
  if (!page) return NextResponse.json({ error: "Page introuvable" }, { status: 404 });
  return NextResponse.json({ page });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteBankPage(id);
  if (!ok) return NextResponse.json({ error: "Page introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
