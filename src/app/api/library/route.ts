import { NextResponse } from "next/server";
import {
  adaptScriptToProduct,
  adaptStaticToProduct,
  adaptVideoToProduct,
  analyzeStaticReference,
  analyzeVideoReference,
} from "@/lib/creative-library/analyze";
import {
  deleteScript,
  deleteStyle,
  getScript,
  getStyle,
  listLibrary,
  renameStyle,
  saveScript,
  saveStyle,
  updateScript,
} from "@/lib/creative-library/store";
import type { StaticSpec, VideoSpec } from "@/lib/creative-library/types";
import type { ProductInput } from "@/lib/ugc/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  action?:
    | "analyze-static"
    | "analyze-video"
    | "save-style"
    | "rename-style"
    | "delete-style"
    | "save-script"
    | "update-script"
    | "delete-script"
    | "adapt-static"
    | "adapt-video"
    | "adapt-script";
  id?: string;
  name?: string;
  pitch?: string;
  tags?: string[];
  source?: string;
  format?: string;
  text?: string;
  /** Statique ou vignette : data URL. */
  imageDataUrl?: string;
  aspect?: string;
  /** Vidéo de référence : data URL mp4/mov. */
  videoDataUrl?: string;
  kind?: "static" | "video";
  static?: StaticSpec;
  video?: VideoSpec;
  posterDataUrl?: string | null;
  product?: ProductInput;
};

function decode(dataUrl: string) {
  const base64 = dataUrl.includes("base64,") ? dataUrl.slice(dataUrl.indexOf("base64,") + 7) : dataUrl;
  return Buffer.from(base64, "base64");
}

export async function GET() {
  return NextResponse.json(await listLibrary());
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "analyze-static": {
        if (!body.imageDataUrl) return NextResponse.json({ error: "Image manquante" }, { status: 400 });
        const spec = await analyzeStaticReference(body.imageDataUrl, body.aspect || "1:1");
        return NextResponse.json({ static: spec });
      }

      case "analyze-video": {
        if (!body.videoDataUrl) return NextResponse.json({ error: "Vidéo manquante" }, { status: 400 });
        const { spec, poster } = await analyzeVideoReference(decode(body.videoDataUrl));
        return NextResponse.json({ video: spec, poster });
      }

      case "save-style": {
        if (!body.kind || !body.name?.trim()) {
          return NextResponse.json({ error: "Nom et type obligatoires" }, { status: 400 });
        }
        if (body.kind === "static" && !body.static) {
          return NextResponse.json({ error: "Relevé de la statique manquant" }, { status: 400 });
        }
        if (body.kind === "video" && !body.video) {
          return NextResponse.json({ error: "Relevé de la vidéo manquant" }, { status: 400 });
        }
        const style = await saveStyle(
          {
            kind: body.kind,
            name: body.name.trim(),
            pitch: body.pitch?.trim() || "",
            tags: (body.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
            static: body.kind === "static" ? body.static : undefined,
            video: body.kind === "video" ? body.video : undefined,
          },
          body.posterDataUrl
        );
        return NextResponse.json({ style, ...(await listLibrary()) });
      }

      case "rename-style": {
        if (!body.id) return NextResponse.json({ error: "Style manquant" }, { status: 400 });
        await renameStyle(body.id, body.name || "", body.pitch);
        return NextResponse.json(await listLibrary());
      }

      case "delete-style": {
        if (!body.id) return NextResponse.json({ error: "Style manquant" }, { status: 400 });
        await deleteStyle(body.id);
        return NextResponse.json(await listLibrary());
      }

      case "save-script": {
        if (!body.text?.trim()) return NextResponse.json({ error: "Script vide" }, { status: 400 });
        const script = await saveScript({
          name: body.name?.trim() || body.text.trim().slice(0, 48),
          text: body.text.trim(),
          tags: (body.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
          source: body.source?.trim() || undefined,
          format: body.format?.trim() || undefined,
        });
        return NextResponse.json({ script, ...(await listLibrary()) });
      }

      case "update-script": {
        if (!body.id) return NextResponse.json({ error: "Script manquant" }, { status: 400 });
        await updateScript(body.id, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.text !== undefined ? { text: body.text } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
        });
        return NextResponse.json(await listLibrary());
      }

      case "delete-script": {
        if (!body.id) return NextResponse.json({ error: "Script manquant" }, { status: 400 });
        await deleteScript(body.id);
        return NextResponse.json(await listLibrary());
      }

      case "adapt-static": {
        if (!body.id || !body.product?.name) {
          return NextResponse.json({ error: "Style et produit obligatoires" }, { status: 400 });
        }
        const style = await getStyle(body.id);
        if (!style?.static) return NextResponse.json({ error: "Style statique introuvable" }, { status: 404 });
        const elements = await adaptStaticToProduct(style.static, body.product);
        return NextResponse.json({ style, elements });
      }

      case "adapt-video": {
        if (!body.id || !body.product?.name) {
          return NextResponse.json({ error: "Style et produit obligatoires" }, { status: 400 });
        }
        const style = await getStyle(body.id);
        if (!style?.video) return NextResponse.json({ error: "Style vidéo introuvable" }, { status: 404 });
        const angle = await adaptVideoToProduct(style, body.product);
        return NextResponse.json({ angle, styleBlock: style.video.styleBlock });
      }

      case "adapt-script": {
        if (!body.id || !body.product?.name) {
          return NextResponse.json({ error: "Script et produit obligatoires" }, { status: 400 });
        }
        const script = await getScript(body.id);
        if (!script) return NextResponse.json({ error: "Script introuvable" }, { status: 404 });
        const angle = await adaptScriptToProduct(script, body.product);
        return NextResponse.json({ angle });
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bibliothèque indisponible" },
      { status: 502 }
    );
  }
}
