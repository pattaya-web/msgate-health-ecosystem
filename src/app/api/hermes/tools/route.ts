import { NextResponse } from "next/server";
import { z } from "zod";
import { checkHermesAuth } from "@/hermes/auth";
import { TOOLS } from "@/hermes/registry";

export const dynamic = "force-dynamic";

/** Le manifeste : noms, descriptions et schémas d'entrée des outils. Avec la clé Hermes seulement. */
export async function GET(request: Request) {
  const auth = checkHermesAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return NextResponse.json({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input: z.toJSONSchema(tool.input),
      endpoint: `/api/hermes/tools/${tool.name}`,
      method: "POST",
    })),
    access: "read-only",
  });
}
