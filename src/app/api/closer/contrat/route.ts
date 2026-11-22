import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { activeCloserSync } from "@/lib/closer/store";
import { CONTRACT_FILE } from "@/lib/closer/scripts";
import { STORAGE_ROOT } from "@/lib/storage-root";

export const dynamic = "force-dynamic";

/**
 * Le contrat IBOState (PDF) que le closer envoie au lead qui dit oui.
 * Il vit sur le disque du serveur (.msgate-cache/closer/), pas dans le dépôt
 * (public) : réservé à l'admin et aux closers actifs.
 */
export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  const allowed = session && (session.role === "admin" || (session.role === "closer" && activeCloserSync(session.email)));
  if (!allowed) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  try {
    const file = await readFile(path.join(STORAGE_ROOT, ".msgate-cache", "closer", CONTRACT_FILE));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${CONTRACT_FILE}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Contrat absent du serveur" }, { status: 404 });
  }
}
