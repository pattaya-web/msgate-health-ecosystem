import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { getAuthSecret } from "@/lib/auth/session";
import { listEcomSites } from "@/lib/ecom-sites/store";
import { previewUrl } from "@/lib/ecom-sites/preview-link";

/**
 * Liens d'aperçu des boutiques (admin) : `?id=` pour une seule, sinon toutes.
 * Ouvert dans le navigateur (Accept: text/html), une page avec les liens
 * cliquables ; sinon du JSON pour le bouton « Copier le lien d'aperçu ».
 */
export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (session?.role !== "admin") return NextResponse.json({ error: "Réservé à l'admin" }, { status: 403 });
  const secret = getAuthSecret();
  if (!secret) return NextResponse.json({ error: "Secret de session absent" }, { status: 500 });

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  const base = process.env.PUBLIC_BASE_URL?.trim() || `${proto}://${host}`;
  const id = url.searchParams.get("id");

  const sites = (await listEcomSites()).filter((site) => !id || site.id === id);
  const links = sites.map((site) => ({
    id: site.id,
    slug: site.slug,
    brandName: site.brandName,
    status: site.status ?? "published",
    url: site.status === "draft" ? previewUrl(base, site.slug, secret) : `${base.replace(/\/$/, "")}/s/${site.slug}`,
  }));

  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
    const rows = links
      .map(
        (link) =>
          `<li><strong>${esc(link.brandName)}</strong> <span>${link.status === "draft" ? "brouillon — lien d'aperçu" : "en ligne"}</span><br><a href="${esc(link.url)}">${esc(link.url)}</a></li>`
      )
      .join("");
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Liens des boutiques</title><style>body{font:15px system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 16px;color:#141414}li{margin:0 0 18px}span{color:#6b6b6b;font-size:13px}a{word-break:break-all}</style><h1>Liens des boutiques</h1><p>Un lien d'aperçu ouvre la boutique sans compte, sans la publier : elle reste en brouillon et non indexée.</p><ul>${rows}</ul>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ links }, { headers: { "Cache-Control": "no-store" } });
}
