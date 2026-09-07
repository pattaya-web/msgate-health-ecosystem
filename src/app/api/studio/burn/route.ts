import { execFile } from "child_process";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const run = promisify(execFile);
const TMP = path.join(process.cwd(), ".msgate-cache", "tmp");
const MAX_BYTES = 512 * 1024 * 1024;

/**
 * Incruste un calque texte sur la vidéo d'origine.
 *
 * Remplace le réenregistrement image par image dans un canvas, qui rejouait la
 * vidéo en temps réel : d'où les saccades, les images figées et la perte de
 * cadence. Ici la vidéo source n'est pas rejouée, elle est simplement
 * réencodée une fois avec l'image posée dessus — la durée, la cadence et la
 * bande son d'origine sont conservées telles quelles.
 *
 * Le calque est rendu par le navigateur, donc avec la vraie police et
 * exactement le rendu de la preview : rien n'est redessiné côté serveur, ce qui
 * évite d'avoir à y installer une police.
 */

type Body = { videoBase64?: string; overlayPng?: string };

function decode(dataUrl: string) {
  const base64 = dataUrl.includes("base64,")
    ? dataUrl.slice(dataUrl.indexOf("base64,") + 7)
    : dataUrl;
  return Buffer.from(base64, "base64");
}

export async function POST(request: Request) {
  if (!ffmpegPath) {
    return NextResponse.json({ error: "ffmpeg introuvable sur le serveur" }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requête illisible" }, { status: 400 });
  }

  if (!body.videoBase64) return NextResponse.json({ error: "Vidéo manquante" }, { status: 400 });

  const video = decode(body.videoBase64);
  if (video.length > MAX_BYTES) {
    return NextResponse.json({ error: "Vidéo trop lourde (512 Mo max)" }, { status: 413 });
  }

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const src = path.join(TMP, `${stamp}.src`);
  const png = path.join(TMP, `${stamp}.png`);
  const out = path.join(TMP, `${stamp}.mp4`);

  try {
    await mkdir(TMP, { recursive: true });
    await writeFile(src, video);

    const hasOverlay = Boolean(body.overlayPng);
    if (hasOverlay) await writeFile(png, decode(body.overlayPng!));

    /**
     * La vidéo est mise à l'échelle en 1080×1920 avant l'incrustation, parce
     * que le calque est rendu à cette taille. `increase` + `crop` reproduisent
     * le cadrage « cover » de la preview au lieu d'ajouter des bandes.
     */
    const scale =
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";

    const args = hasOverlay
      ? [
          "-y",
          "-i", src,
          "-i", png,
          "-filter_complex", `[0:v]${scale}[bg];[bg][1:v]overlay=0:0:format=auto[v]`,
          "-map", "[v]",
          // La piste son d'origine est recopiée sans réencodage quand elle existe.
          "-map", "0:a?",
          "-c:a", "copy",
        ]
      : ["-y", "-i", src, "-vf", scale, "-c:a", "copy"];

    await run(
      ffmpegPath,
      [
        ...args,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out,
      ],
      { maxBuffer: 1024 * 1024 * 32 }
    );

    const mp4 = await readFile(out);
    return new NextResponse(new Uint8Array(mp4), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(mp4.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Incrustation impossible";
    // La sortie de ffmpeg dit précisément ce qui a bloqué : on la remonte.
    const detail = String((error as { stderr?: string }).stderr || "")
      .split("\n")
      .filter((line) => /error|invalid|no such|unable/i.test(line))
      .slice(-2)
      .join(" ");
    return NextResponse.json({ error: detail || message }, { status: 500 });
  } finally {
    await rm(src, { force: true }).catch(() => undefined);
    await rm(png, { force: true }).catch(() => undefined);
    await rm(out, { force: true }).catch(() => undefined);
  }
}
