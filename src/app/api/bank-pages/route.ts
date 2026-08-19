import { NextResponse } from "next/server";
import { createBankPage, listBankPages } from "@/lib/bank-pages/store";
import type { BankPage } from "@/lib/bank-pages/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const pages = await listBankPages();
  return NextResponse.json({ pages });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BankPage> & { brandName?: string };
    if (!body.brandName?.trim()) {
      return NextResponse.json({ error: "Nom de marque requis" }, { status: 400 });
    }
    const page = await createBankPage({ ...body, brandName: body.brandName });
    return NextResponse.json({ page });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Création impossible" },
      { status: 500 }
    );
  }
}
