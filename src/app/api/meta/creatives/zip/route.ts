import JSZip from "jszip";
import { NextResponse } from "next/server";
import { isMetaConfigured } from "@/lib/meta/client";
import { fetchCreatives } from "@/lib/meta/creatives";
import {
  contentDisposition,
  extensionFor,
  isAllowedAssetUrl,
  safeFileName,
} from "@/lib/meta/download";
import type { CreativeDetail } from "@/lib/meta/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ADS = 120;
/** A whole ad set of videos is easily 200 MB; refuse to build more than that. */
const MAX_BYTES = 300 * 1024 * 1024;
const CONCURRENCY = 6;

function copyFor(creative: CreativeDetail) {
  const lines: string[] = [creative.adName, "=".repeat(creative.adName.length), ""];

  const block = (label: string, values: string[]) => {
    if (!values.length) return;
    lines.push(label.toUpperCase());
    values.forEach((value, index) => {
      lines.push(values.length > 1 ? `${index + 1}. ${value}` : value);
    });
    lines.push("");
  };

  block("Texte principal", creative.bodies);
  block("Titres", creative.titles);
  block("Descriptions", creative.descriptions);

  const meta: string[] = [];
  if (creative.callToAction) meta.push(`CTA : ${creative.callToAction}`);
  if (creative.link) meta.push(`Lien : ${creative.link}`);
  if (creative.urlTags) meta.push(`Paramètres : ${creative.urlTags}`);
  if (creative.postId) meta.push(`Post ID : ${creative.postId}`);
  if (creative.permalink) meta.push(`Publication : ${creative.permalink}`);
  if (creative.instagramPermalink) meta.push(`Instagram : ${creative.instagramPermalink}`);
  if (creative.previewLink) meta.push(`Aperçu Meta : ${creative.previewLink}`);
  meta.push(`Campagne : ${creative.campaignName}`);
  meta.push(`Ad set : ${creative.adsetName}`);
  if (meta.length) lines.push(...meta, "");

  return lines.join("\n");
}

/** Fixed-size worker pool: Meta throttles bursts, and memory stays bounded. */
async function pooled<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    })
  );
}

export async function POST(request: Request) {
  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: string[]; label?: string };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, MAX_ADS) : [];
  if (!ids.length) {
    return NextResponse.json({ error: "Aucune publicité sélectionnée." }, { status: 400 });
  }

  try {
    const { creatives, errors } = await fetchCreatives(ids);
    if (!creatives.length) {
      return NextResponse.json(
        { error: errors[0] || "Aucun créatif récupérable pour cette sélection." },
        { status: 404 }
      );
    }

    const zip = new JSZip();
    const missing: string[] = [];
    let bytes = 0;

    const jobs = creatives.flatMap((creative, index) => {
      const folder = `${String(index + 1).padStart(2, "0")} - ${safeFileName(creative.adName, creative.adId)}`;
      zip.file(`${folder}/copy.txt`, copyFor(creative));

      const downloadable = creative.assets.filter((asset) => asset.url && isAllowedAssetUrl(asset.url));
      // A source-less duplicate of an asset we did get is noise, not a miss.
      if (!downloadable.length && creative.assets.length) {
        missing.push(`${creative.adName} — ${creative.assets[0].kind}`);
      }

      return downloadable.map((asset, position) => ({ creative, folder, asset, position }));
    });

    await pooled(jobs, async ({ creative, folder, asset, position }) => {
      if (bytes >= MAX_BYTES) return;
      try {
        const res = await fetch(asset.url as string, { cache: "no-store" });
        if (!res.ok) {
          missing.push(`${creative.adName} — HTTP ${res.status}`);
          return;
        }
        const buffer = new Uint8Array(await res.arrayBuffer());
        bytes += buffer.byteLength;
        const extension = extensionFor(asset.url as string, res.headers.get("content-type"), asset.kind);
        const suffix = position > 0 ? `-${position + 1}` : "";
        zip.file(`${folder}/${safeFileName(creative.adName, creative.adId)}${suffix}.${extension}`, buffer);
      } catch {
        missing.push(`${creative.adName} — téléchargement impossible`);
      }
    });

    zip.file(
      "ad-copies.txt",
      creatives.map(copyFor).join(`\n${"-".repeat(60)}\n\n`)
    );

    if (missing.length) {
      zip.file(
        "fichiers-manquants.txt",
        [
          "Meta n'expose pas le fichier source de ces médias (vidéos hors librairie du compte).",
          "Le texte et l'aperçu restent disponibles dans copy.txt.",
          "",
          ...missing,
        ].join("\n")
      );
    }

    const payload = await zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
    const filename = `${safeFileName(body.label || "creatives")}.zip`;

    return new Response(payload, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(filename),
        "Content-Length": String(payload.byteLength),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Archive impossible" },
      { status: 502 }
    );
  }
}
