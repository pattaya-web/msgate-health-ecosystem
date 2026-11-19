import { execFile } from "child_process";
import { mkdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import { NextResponse } from "next/server";
import { STORAGE_ROOT } from "@/lib/storage-root";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const run = promisify(execFile);
const MEDIA_DIR = path.join(STORAGE_ROOT, "data", "media");
const TMP = path.join(STORAGE_ROOT, ".msgate-cache", "tmp");

type Body = {
  clips?: Array<{ url: string; in: number; out: number }>;
  overlays?: Array<{ png: string; start: number; end: number }>;
  music?: { url: string; offset: number; volume: number } | null;
  /** Volume du son des clips (0 = muet). */
  clipVolume?: number;
  width?: number;
  height?: number;
};

/** Un média envoyé par /api/upload : seulement nos fichiers, jamais un chemin libre. */
function mediaPath(url: string) {
  const name = /^\/api\/media\/([A-Za-z0-9]+\.[A-Za-z0-9]+)$/.exec(url)?.[1];
  if (!name) throw new Error(`Média invalide : ${url}`);
  return path.join(MEDIA_DIR, name);
}

/** Durée, images par seconde et présence d'une piste son (ffmpeg écrit tout ça en erreur standard). */
async function probe(file: string) {
  let text = "";
  try {
    const { stderr } = await run(ffmpegPath as string, ["-hide_banner", "-i", file], { maxBuffer: 8 * 1024 * 1024 });
    text = stderr;
  } catch (error) {
    text = String((error as { stderr?: string }).stderr ?? "");
  }
  const fps = Number(/,\s*(\d+(?:\.\d+)?)\s*fps/.exec(text)?.[1] ?? 0);
  return { fps, audio: /Stream #.*Audio:/.test(text) };
}

/**
 * Le rendu du montage.
 *
 * Chaque clip est coupé à ses bornes, mis au format du premier (cadrage
 * « cover », comme l'aperçu), puis tous sont mis bout à bout. Les textes et
 * emojis arrivent en PNG transparents dessinés par le navigateur et sont
 * incrustés pendant leur fenêtre. La musique est mixée sous le son des clips.
 *
 * Qualité : la résolution et la cadence du premier clip sont gardées (plafond
 * 1080 de large et 60 i/s), encodage H.264 à CRF 16, son AAC 192 kb/s — à
 * l'œil, la même qualité que les fichiers d'origine.
 */
export async function POST(request: Request) {
  if (!ffmpegPath) return NextResponse.json({ error: "ffmpeg introuvable sur le serveur" }, { status: 500 });
  const body = (await request.json().catch(() => null)) as Body | null;
  const clips = (body?.clips ?? []).filter((clip) => clip.out - clip.in > 0.05);
  if (!clips.length) return NextResponse.json({ error: "Ajoute au moins un clip." }, { status: 400 });

  const stamp = randomUUID().replace(/-/g, "");
  const made: string[] = [];
  try {
    await mkdir(TMP, { recursive: true });
    const files = clips.map((clip) => mediaPath(clip.url));
    for (const file of files) await stat(file);
    const probes = await Promise.all(files.map(probe));

    // Format de sortie : celui du premier clip, nombres pairs, 1080 de large au plus.
    let width = Math.round(body?.width || 1080);
    let height = Math.round(body?.height || 1920);
    if (width > 1080) {
      height = Math.round((height * 1080) / width);
      width = 1080;
    }
    width -= width % 2;
    height -= height % 2;
    const fps = Math.min(60, Math.max(24, Math.round(probes[0].fps || 30)));
    const clipVolume = Math.min(2, Math.max(0, body?.clipVolume ?? 1));
    const total = clips.reduce((sum, clip) => sum + (clip.out - clip.in), 0);

    const args: string[] = ["-y", "-hide_banner"];
    files.forEach((file) => args.push("-i", file));

    const overlays = body?.overlays ?? [];
    for (const [index, overlay] of overlays.entries()) {
      const file = path.join(TMP, `${stamp}-o${index}.png`);
      await writeFile(file, Buffer.from(overlay.png.slice(overlay.png.indexOf(",") + 1), "base64"));
      made.push(file);
      args.push("-i", file);
    }

    const musicIndex = files.length + overlays.length;
    if (body?.music?.url) {
      const offset = Math.max(0, body.music.offset || 0);
      // La musique boucle si le montage est plus long qu'elle ; -t referme le rendu au bon endroit.
      args.push("-stream_loop", "-1", "-ss", offset.toFixed(3), "-i", mediaPath(body.music.url));
    }

    const filters: string[] = [];
    clips.forEach((clip, index) => {
      const len = (clip.out - clip.in).toFixed(3);
      filters.push(
        `[${index}:v]trim=start=${clip.in.toFixed(3)}:end=${clip.out.toFixed(3)},setpts=PTS-STARTPTS,` +
          `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p[v${index}]`
      );
      filters.push(
        probes[index].audio
          ? `[${index}:a]atrim=start=${clip.in.toFixed(3)}:end=${clip.out.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clipVolume.toFixed(3)}[a${index}]`
          : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${len}[a${index}]`
      );
    });
    filters.push(`${clips.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${clips.length}:v=1:a=1[base][clipa]`);

    let video = "base";
    overlays.forEach((overlay, index) => {
      const start = Math.max(0, overlay.start).toFixed(3);
      const end = Math.max(overlay.start + 0.05, overlay.end).toFixed(3);
      filters.push(`[${video}][${files.length + index}:v]overlay=0:0:enable='between(t,${start},${end})'[o${index}]`);
      video = `o${index}`;
    });

    let audio = "clipa";
    if (body?.music?.url) {
      const volume = Math.min(2, Math.max(0, body.music.volume ?? 0.5));
      filters.push(`[${musicIndex}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${volume.toFixed(3)}[music]`);
      filters.push(`[clipa][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`);
      audio = "mix";
    }

    const outName = `${stamp}.mp4`;
    const out = path.join(MEDIA_DIR, outName);
    await mkdir(MEDIA_DIR, { recursive: true });
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", `[${video}]`,
      "-map", `[${audio}]`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "16",
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-t", total.toFixed(3),
      out
    );
    await run(ffmpegPath, args, { maxBuffer: 32 * 1024 * 1024, timeout: 280_000 });
    const info = await stat(out);
    return NextResponse.json({ url: `/api/media/${outName}`, size: info.size, width, height, fps, duration: total });
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const detail = String(err.stderr || err.message || "").split("\n").slice(-5).join(" ").trim();
    return NextResponse.json({ error: detail || "Rendu impossible" }, { status: 500 });
  } finally {
    await Promise.all(made.map((file) => rm(file, { force: true }).catch(() => undefined)));
  }
}
