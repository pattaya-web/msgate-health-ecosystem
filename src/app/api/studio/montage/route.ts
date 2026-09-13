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
 * Monte les clips côté serveur, avec ffmpeg.
 *
 * L'ancien montage rejouait les clips en temps réel dans un canvas et filmait
 * le résultat avec MediaRecorder. Chaque image demandait un `currentTime` qui
 * n'avait pas fini de décoder avant d'être dessinée : la capture ne recevait
 * une image neuve que toutes les 200 ms environ, d'où un rendu autour de 5
 * images par seconde quelle que soit la cadence demandée.
 *
 * Ici rien n'est rejoué : ffmpeg lit, concatène et réencode une seule fois. La
 * cadence et la définition deviennent de simples paramètres, et le son cesse
 * d'être un cas particulier.
 *
 * Les sous-titres restent rendus par le navigateur, en PNG, comme pour l'onglet
 * Texte : c'est le seul moyen d'obtenir à l'image exactement ce que montre la
 * preview, avec la vraie police, sans installer de fonte sur le serveur.
 */

type Caption = {
  /** PNG plein cadre, en data URL. */
  png: string;
  /** Fenêtre d'affichage, en secondes depuis le début du montage. */
  start: number;
  end: number;
};

type Body = {
  /** Clips à enchaîner, dans l'ordre, en data URL. */
  clips?: string[];
  captions?: Caption[];
  /** Piste musicale importée. */
  musicBase64?: string;
  /** Voix-off. */
  voiceBase64?: string;
  /** Volume de la musique, 0 à 1. */
  musicVolume?: number;
  /** Coupe le son propre des clips. */
  muteClips?: boolean;
  /** Vitesse de lecture ; 1 = inchangée. */
  speed?: number;
  fps?: 30 | 60;
  height?: 1280 | 1920;
};

function decode(dataUrl: string) {
  const base64 = dataUrl.includes("base64,")
    ? dataUrl.slice(dataUrl.indexOf("base64,") + 7)
    : dataUrl;
  return Buffer.from(base64, "base64");
}

/**
 * Un clip muet ferait échouer `concat` en mode `a=1` : la sonde évite de
 * demander une piste qui n'existe pas. ffmpeg sort en erreur quand aucune
 * sortie n'est demandée, donc la réponse est lue dans les deux flux.
 */
async function probe(file: string) {
  let text = "";
  try {
    const { stdout, stderr } = await run(ffmpegPath as string, ["-hide_banner", "-i", file], {
      maxBuffer: 1024 * 1024 * 8,
    });
    text = `${stdout}${stderr}`;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    text = `${err.stdout || ""}${err.stderr || ""}`;
  }

  const time = text.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  const seconds = time
    ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])
    : 0;

  return { seconds, audio: /Stream #.*Audio:/.test(text) };
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

  const clips = body.clips || [];
  if (!clips.length) return NextResponse.json({ error: "Aucun clip" }, { status: 400 });

  const fps = body.fps === 60 ? 60 : 30;
  const height = body.height === 1280 ? 1280 : 1920;
  const width = Math.round((height * 9) / 16);
  const speed = Math.min(4, Math.max(0.25, body.speed || 1));
  const musicVolume = Math.min(1, Math.max(0, body.musicVolume ?? 0.35));

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const made: string[] = [];
  const out = path.join(TMP, `${stamp}.mp4`);

  try {
    await mkdir(TMP, { recursive: true });

    const clipFiles: string[] = [];
    let total = 0;
    for (const [index, clip] of clips.entries()) {
      const buffer = decode(clip);
      total += buffer.length;
      if (total > MAX_BYTES) {
        return NextResponse.json({ error: "Montage trop lourd (512 Mo max)" }, { status: 413 });
      }
      const file = path.join(TMP, `${stamp}-c${index}.src`);
      await writeFile(file, buffer);
      clipFiles.push(file);
      made.push(file);
    }

    const captions = body.captions || [];
    for (const [index, caption] of captions.entries()) {
      const file = path.join(TMP, `${stamp}-cap${index}.png`);
      await writeFile(file, decode(caption.png));
      made.push(file);
    }

    let musicFile: string | null = null;
    if (body.musicBase64) {
      musicFile = path.join(TMP, `${stamp}.music`);
      await writeFile(musicFile, decode(body.musicBase64));
      made.push(musicFile);
    }

    let voiceFile: string | null = null;
    if (body.voiceBase64) {
      voiceFile = path.join(TMP, `${stamp}.voice`);
      await writeFile(voiceFile, decode(body.voiceBase64));
      made.push(voiceFile);
    }

    /**
     * Durée visée, mesurée sur les clips.
     *
     * Elle est indispensable, pas confortable : la musique est lue en boucle
     * infinie, et sans borne explicite ffmpeg continue de filtrer l'audio bien
     * après la fin de l'image jusqu'à saturer ses tampons — « No space left on
     * device ». `-t` referme le rendu au bon endroit.
     */
    const probes = await Promise.all(clipFiles.map((file) => probe(file)));
    const sourceSeconds = probes.reduce((total, item) => total + item.seconds, 0);
    const targetSeconds = sourceSeconds / speed;
    if (!targetSeconds) {
      return NextResponse.json({ error: "Clips illisibles (durée nulle)" }, { status: 400 });
    }

    /* ---------------- Vidéo ---------------- */

    const args: string[] = ["-y"];
    for (const file of clipFiles) args.push("-i", file);
    for (let index = 0; index < captions.length; index += 1) {
      args.push("-i", path.join(TMP, `${stamp}-cap${index}.png`));
    }
    // La musique tourne en boucle : c'est `-t` plus bas qui la coupe.
    if (musicFile) args.push("-stream_loop", "-1", "-i", musicFile);
    if (voiceFile) args.push("-i", voiceFile);

    const musicIndex = clipFiles.length + captions.length;
    const voiceIndex = musicIndex + (musicFile ? 1 : 0);

    const filters: string[] = [];

    // `increase` + `crop` reproduisent le cadrage « cover » de la preview :
    // l'image remplit le format vertical au lieu d'être posée entre deux bandes.
    const scale = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      "setsar=1",
      `fps=${fps}`,
      "format=yuv420p",
    ].join(",");
    clipFiles.forEach((_, index) => filters.push(`[${index}:v]${scale}[v${index}]`));

    const concatIn = clipFiles.map((_, index) => `[v${index}]`).join("");
    filters.push(`${concatIn}concat=n=${clipFiles.length}:v=1:a=0[base]`);

    let videoLabel = "base";
    if (speed !== 1) {
      filters.push(`[${videoLabel}]setpts=${(1 / speed).toFixed(6)}*PTS[sped]`);
      videoLabel = "sped";
    }

    // Les fenêtres des sous-titres sont déjà exprimées dans le temps du montage
    // final : elles se posent donc après la mise à la vitesse.
    captions.forEach((caption, index) => {
      const next = `ov${index}`;
      const start = Math.max(0, caption.start).toFixed(3);
      const end = Math.max(caption.start + 0.05, caption.end).toFixed(3);
      const window = `between(t,${start},${end})`;
      filters.push(
        `[${videoLabel}][${clipFiles.length + index}:v]overlay=0:0:enable='${window}'[${next}]`
      );
      videoLabel = next;
    });

    /* ---------------- Son ---------------- */

    const audioLabels: string[] = [];

    if (!body.muteClips) {
      if (probes.every((item) => item.audio)) {
        const parts = clipFiles.map((_, index) => `[${index}:a]`).join("");
        filters.push(`${parts}concat=n=${clipFiles.length}:v=0:a=1[rawa]`);
        if (speed !== 1) {
          // `atempo` ne prend qu'un facteur de 0,5 à 2 par passe.
          filters.push(`[rawa]atempo=${Math.min(2, Math.max(0.5, speed)).toFixed(4)}[clipa]`);
          audioLabels.push("clipa");
        } else {
          audioLabels.push("rawa");
        }
      }
    }

    if (musicFile) {
      filters.push(`[${musicIndex}:a]volume=${musicVolume.toFixed(3)}[musica]`);
      audioLabels.push("musica");
    }
    if (voiceFile) {
      filters.push(`[${voiceIndex}:a]volume=1.0[voicea]`);
      audioLabels.push("voicea");
    }

    let audioLabel: string | null = null;
    if (audioLabels.length === 1) {
      audioLabel = audioLabels[0];
    } else if (audioLabels.length > 1) {
      const inputs = audioLabels.map((label) => `[${label}]`).join("");
      filters.push(
        `${inputs}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[mixa]`
      );
      audioLabel = "mixa";
    }

    args.push("-filter_complex", filters.join(";"));
    args.push("-map", `[${videoLabel}]`);
    if (audioLabel) {
      args.push("-map", `[${audioLabel}]`, "-c:a", "aac", "-b:a", "192k");
    } else {
      args.push("-an");
    }

    args.push(
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "20",
      "-r", String(fps),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      // Borne dure : la musique bouclée n'a pas de fin propre.
      "-t", targetSeconds.toFixed(3),
      out
    );

    await run(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 16 });
    const mp4 = await readFile(out);

    return new NextResponse(new Uint8Array(mp4), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `inline; filename="montage-${fps}fps-${height}.mp4"`,
      },
    });
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const detail = String(err.stderr || err.message || "")
      .split("\n")
      .slice(-6)
      .join(" ")
      .trim();
    return NextResponse.json({ error: detail || "Montage impossible" }, { status: 500 });
  } finally {
    await Promise.all(
      [...made, out].map((file) => rm(file, { force: true }).catch(() => undefined))
    );
  }
}
