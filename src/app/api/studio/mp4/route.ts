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

/** 512 Mo : au-delà, le navigateur aurait déjà lâché avant d'envoyer. */
const MAX_BYTES = 512 * 1024 * 1024;

/**
 * Convertit en MP4 la capture rendue par le navigateur.
 *
 * MediaRecorder ne produit du MP4 que sur certains navigateurs ; ailleurs il
 * sort du WebM. Renommer un WebM en `.mp4` donnerait un fichier que les régies
 * publicitaires et la plupart des lecteurs refusent — on réencode donc pour de
 * vrai, avec le ffmpeg déjà embarqué pour le montage UGC.
 */
export async function POST(request: Request) {
  if (!ffmpegPath) {
    return NextResponse.json({ error: "ffmpeg introuvable sur le serveur" }, { status: 500 });
  }

  const input = Buffer.from(await request.arrayBuffer());
  if (!input.length) return NextResponse.json({ error: "Vidéo vide" }, { status: 400 });
  if (input.length > MAX_BYTES) {
    return NextResponse.json({ error: "Vidéo trop lourde (512 Mo max)" }, { status: 413 });
  }

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const src = path.join(TMP, `${stamp}.in`);
  const out = path.join(TMP, `${stamp}.mp4`);

  try {
    await mkdir(TMP, { recursive: true });
    await writeFile(src, input);

    await run(
      ffmpegPath,
      [
        "-y",
        // Un WebM de MediaRecorder n'a ni durée ni index : sans horodatages
        // régénérés, ffmpeg peut clore le flux bien avant la fin réelle.
        "-fflags", "+genpts",
        "-i", src,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        // yuv420p et une dimension paire : sans ça, iOS et Meta refusent le fichier.
        "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:a", "aac",
        "-b:a", "128k",
        // L'index en tête permet la lecture avant téléchargement complet.
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Conversion MP4 impossible" },
      { status: 500 }
    );
  } finally {
    await rm(src, { force: true }).catch(() => undefined);
    await rm(out, { force: true }).catch(() => undefined);
  }
}
