import { NextResponse } from "next/server";
import { getAvatar } from "@/lib/ugc/avatar-store";

export const dynamic = "force-dynamic";

/**
 * Sert le portrait d'un avatar enregistré.
 *
 * La liste des avatars ne transporte pas les images : chacune pèse plusieurs
 * mégaoctets en data URL, et les envoyer toutes à chaque chargement de l'onglet
 * rendrait la page inutilisable. Le client demande donc les vignettes une par
 * une, et le navigateur les garde en cache — l'identifiant ne change jamais.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Identifiant manquant" }, { status: 400 });

  const avatar = await getAvatar(id);
  if (!avatar) return NextResponse.json({ error: "Avatar introuvable" }, { status: 404 });

  const [, type = "image/png", base64 = ""] =
    avatar.dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
  if (!base64) return NextResponse.json({ error: "Image illisible" }, { status: 422 });

  return new NextResponse(new Uint8Array(Buffer.from(base64, "base64")), {
    headers: {
      "Content-Type": type,
      // L'image d'un identifiant donné ne change plus : elle se met en cache.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
