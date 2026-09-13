import { NextResponse } from "next/server";
import { checkHermesAuth } from "@/hermes/auth";
import { runTool } from "@/hermes/run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/hermes/tools/<name> avec un corps JSON = l'entrée de l'outil.
 * Seule porte d'entrée de Hermes ; elle n'accepte que la clé dédiée et ne
 * connaît que les outils du registre.
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const auth = checkHermesAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const { name } = await params;
  let input: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
  }
  const result = await runTool(name, input);
  return NextResponse.json(result.body, { status: result.status });
}
