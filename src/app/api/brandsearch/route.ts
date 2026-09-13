import { NextResponse } from "next/server";
import { bestMedia, brandByUrl, brandMetaAds, discoverBrands, downloadAdMedia, isBrandsearchReady, type BsMetaAd } from "@/lib/brandsearch/client";
import { extensionFor, saveFile } from "@/lib/drive/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Passerelle Brandsearch pour SpyShop. La clé ne quitte jamais le serveur ;
 * le navigateur ne voit que des marques, des pubs, et le chemin Drive où une
 * pub a été rangée.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const action = params.get("action");
  if (!isBrandsearchReady()) return NextResponse.json({ error: "BRANDSEARCH_API_KEY manquante dans .env.local" }, { status: 503 });
  try {
    switch (action) {
      case "discover":
        return NextResponse.json(
          await discoverBrands({
            limit: Number(params.get("limit") || 8),
            seed: params.get("seed") || undefined,
            niche: params.get("niche") || undefined,
            monthly_visits_min: Number(params.get("visits_min") || 0) || undefined,
            meta_active_min: Number(params.get("meta_min") || 0) || undefined,
            product_count_min: Number(params.get("products_min") || 0) || undefined,
            country_code: params.get("country") || undefined,
          })
        );
      case "brand": {
        const url = params.get("url");
        if (!url) return NextResponse.json({ error: "URL manquante" }, { status: 400 });
        return NextResponse.json({ brand: await brandByUrl(url) });
      }
      case "ads": {
        const brand = params.get("brand");
        if (!brand) return NextResponse.json({ error: "Marque manquante" }, { status: 400 });
        return NextResponse.json(
          await brandMetaAds(brand, {
            status: params.get("status") === "inactive" ? "inactive" : "active",
            pageSize: Number(params.get("limit") || 12),
            page: Number(params.get("page") || 1),
            sortBy: params.get("sort") || undefined,
          })
        );
      }
      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Brandsearch indisponible" }, { status: 502 });
  }
}

type Body = {
  action?: "save-ad";
  /** Dossier Drive de destination, ex. « Creative Spy/Marque ». */
  folder?: string;
  ad?: BsMetaAd;
};

/**
 * Range une pub dans le Drive : le média est rapatrié maintenant, parce que
 * les liens Brandsearch meurent en trois jours. À côté, un petit .json garde
 * le texte, la dépense et le lien du tableau de bord.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }
  if (body.action !== "save-ad" || !body.ad || typeof body.folder !== "string") {
    return NextResponse.json({ error: "Pub ou dossier manquant" }, { status: 400 });
  }
  try {
    /*
     * D'abord l'endpoint de téléchargement, qui sert le fichier tant qu'il est
     * détenu ; sinon les liens directs, qui peuvent être la couverture d'une
     * vidéo pas encore rapatriée. Sans rien de tout ça, on le dit clairement.
     */
    let data: Buffer | null = null;
    let contentType = "";
    let fallbackExt = "jpg";
    const tries: Array<"video" | "image"> = body.ad.is_video ? ["video", "image"] : ["image"];
    for (const media of tries) {
      const got = await downloadAdMedia(body.ad.id, media);
      if (got) {
        data = got.data;
        contentType = got.contentType;
        fallbackExt = media === "video" ? "mp4" : "jpg";
        break;
      }
    }
    if (!data) {
      const direct = bestMedia(body.ad);
      if (direct) {
        const res = await fetch(direct.url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
        if (res.ok) {
          data = Buffer.from(await res.arrayBuffer());
          contentType = res.headers.get("content-type") ?? "";
          fallbackExt = direct.ext;
        }
      }
    }
    if (!data?.length) {
      return NextResponse.json({ error: "Média pas encore disponible chez Brandsearch — réessaie plus tard" }, { status: 404 });
    }
    const ext = extensionFor(contentType) || fallbackExt;
    const stem = `meta-${body.ad.ad_id || body.ad.id}`;
    const folder = body.folder.replace(/^\/+|\/+$/g, "");
    const saved = await saveFile(folder, `${stem}.${ext}`, data);
    const meta = {
      source: "brandsearch",
      platform: "meta",
      id: body.ad.id,
      adId: body.ad.ad_id ?? null,
      brand: body.ad.brand_id,
      status: body.ad.status ?? null,
      startDate: body.ad.start_date ?? null,
      title: body.ad.creative?.title ?? null,
      description: body.ad.creative?.description ?? null,
      cta: body.ad.creative?.cta ?? null,
      spendEur: body.ad.eu_total_spend ?? null,
      reach: body.ad.eu_total_reach ?? null,
      funnel: body.ad.funnel_type ?? null,
      dashboard: body.ad.dashboard_url ?? null,
      savedAt: new Date().toISOString(),
    };
    await saveFile(folder, `${stem}.json`, Buffer.from(JSON.stringify(meta, null, 2)));
    return NextResponse.json({ path: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enregistrement impossible" }, { status: 502 });
  }
}
