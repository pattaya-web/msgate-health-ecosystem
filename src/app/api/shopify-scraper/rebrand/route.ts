import { NextResponse } from "next/server";
import { fetchProducts, filterByPrice, normalizeShopUrl } from "@/lib/shopify-scraper/client";
import { getRebrand, hostOf, localUrl, rebrandTargets, refreshRebrand, startRebrand, type RebrandBrand } from "@/lib/shopify-scraper/rebrand";
import { isStorageReady } from "@/lib/storage";
import { uploadBase64 } from "@/lib/studio/kie";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  action?: "logo" | "start" | "refresh" | "retry";
  shop?: string;
  collection?: string;
  min?: number | null;
  max?: number | null;
  logoDataUrl?: string;
  logoUrl?: string;
  accent?: string;
  background?: string;
  brandName?: string;
  resolution?: "1K" | "2K";
  model?: "nano-banana-pro" | "gpt-image-2";
  scope?: "first" | "all";
  handles?: string[];
  /** Image d'origine à relancer (action retry). */
  src?: string;
};

const COLOR = /^#[0-9a-f]{6}$/i;

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * L'état d'une boutique, avec le mode d'hébergement des rendus : `publicUrls`
 * dit si tous les rendus prêts ont une adresse joignable depuis Internet,
 * `temporaryUrls` si certains ne tiennent que quelques jours (hébergement Kie,
 * faute de Supabase).
 */
async function stateOf(host: string, refresh: boolean) {
  const state = refresh ? await refreshRebrand(host) : await getRebrand(host);
  const done = state.items.filter((item) => item.state === "done");
  return {
    ...state,
    /*
     * Pour l'affichage, le fichier local : les URL Kie se chargent lentement ou
     * pas du tout dans le navigateur (vignettes blanches), alors que le rendu
     * est sur le disque. `url` reste l'adresse publique, pour le CSV.
     */
    items: state.items.map((item) => ({ ...item, localUrl: item.state === "done" && item.file ? localUrl(host, item.file) : null })),
    storageConfigured: isStorageReady(),
    publicUrls: done.every((item) => /^https?:\/\//i.test(item.url ?? "")),
    temporaryUrls: done.some((item) => item.temporary),
  };
}

export async function GET(request: Request) {
  const shop = normalizeShopUrl(new URL(request.url).searchParams.get("shop") || "");
  if (!shop) return NextResponse.json({ error: "URL de boutique invalide" }, { status: 400 });
  return NextResponse.json(await stateOf(hostOf(shop), true));
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  try {
    if (body.action === "logo") {
      if (!body.logoDataUrl || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(body.logoDataUrl)) {
        return NextResponse.json({ error: "Logo manquant" }, { status: 400 });
      }
      return NextResponse.json({ url: await uploadBase64(body.logoDataUrl, `rebrand-logo-${Date.now()}.png`) });
    }

    const shop = normalizeShopUrl(body.shop || "");
    if (!shop) return NextResponse.json({ error: "URL de boutique invalide" }, { status: 400 });
    const host = hostOf(shop);

    if (body.action === "refresh") return NextResponse.json(await stateOf(host, true));

    if (body.action === "start" || body.action === "retry") {
      const current = await getRebrand(host);
      const brand: RebrandBrand | null =
        body.logoUrl && /^https:\/\//i.test(body.logoUrl)
          ? {
              logoUrl: body.logoUrl,
              accent: COLOR.test(body.accent || "") ? (body.accent as string) : "#1f2937",
              background: COLOR.test(body.background || "") ? (body.background as string) : "#f5f5f4",
              brandName: (body.brandName || "").trim().slice(0, 80),
              resolution: body.resolution === "2K" ? "2K" : "1K",
              model: body.model === "gpt-image-2" ? "gpt-image-2" : "nano-banana-pro",
            }
          : current.brand;
      if (!brand) return NextResponse.json({ error: "Charge ton logo avant de lancer" }, { status: 400 });

      const { products } = await fetchProducts(shop, body.collection || undefined);
      const filtered = filterByPrice(products, num(body.min), num(body.max));
      const targets =
        body.action === "retry"
          ? rebrandTargets(filtered, "all").filter((target) => target.src === body.src)
          : rebrandTargets(filtered, body.scope === "all" ? "all" : "first", body.handles);
      if (!targets.length) return NextResponse.json({ error: "Aucune image à traiter" }, { status: 400 });

      await startRebrand(host, brand, targets, body.action === "retry");
      return NextResponse.json(await stateOf(host, false));
    }

    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rebranding impossible" }, { status: 502 });
  }
}
