import { execFile } from "child_process";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const TMP = path.join(process.cwd(), ".msgate-cache", "tmp");

/**
 * Analyse d'une créative à refaire.
 *
 * Le « même montage » ne s'obtient pas en décrivant la vidéo, mais en relevant
 * sa STRUCTURE : combien de plans, et de quelle durée chacun. ffmpeg le donne
 * exactement, sans modèle et sans approximation. C'est cette grille de plans
 * qu'on rejoue ensuite avec l'avatar et le produit.
 *
 * La bande son d'origine est extraite telle quelle : on la remet sous le
 * montage final, ce qui garde le rythme et la musique de la créa de départ.
 */

export type Shot = {
  index: number;
  /** Début du plan dans la source, en secondes. */
  start: number;
  duration: number;
};

export type RemakeAnalysis = {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  shots: Shot[];
};

/** Seedance refuse en dehors de 4–15 s : les plans sont ramenés dans la plage. */
const MIN_SHOT = 4;
const MAX_SHOT = 15;

function ffmpeg() {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable sur le serveur");
  return ffmpegPath;
}

/** ffmpeg écrit ses sondes sur stderr et sort en erreur : c'est attendu. */
async function probe(file: string) {
  try {
    await run(ffmpeg(), ["-hide_banner", "-i", file], { maxBuffer: 1024 * 1024 * 8 });
    return "";
  } catch (error) {
    return String((error as { stderr?: string }).stderr || "");
  }
}

function parseProbe(out: string) {
  const dur = out.match(/Duration: (\d+):(\d+):(\d+\.?\d*)/);
  const duration = dur
    ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
    : 0;
  const size = out.match(/Video:.*?, (\d{2,5})x(\d{2,5})/);
  return {
    duration,
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(out),
  };
}

/**
 * Détection des coupes. Le filtre `scene` note chaque image selon sa différence
 * avec la précédente ; au-delà du seuil, c'est un changement de plan.
 */
async function detectCuts(file: string, threshold = 0.3): Promise<number[]> {
  // `metadata=print` écrit sur STDOUT, pas sur stderr : lire le mauvais flux
  // donnait systématiquement zéro coupe, donc un seul plan.
  const collect = (text: string) =>
    [...text.matchAll(/pts_time:([\d.]+)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0.2);

  try {
    const { stdout, stderr } = await run(
      ffmpeg(),
      [
        "-hide_banner",
        "-i", file,
        "-vf", `select='gt(scene,${threshold})',metadata=print:file=-`,
        "-an",
        "-f", "null",
        "-",
      ],
      { maxBuffer: 1024 * 1024 * 32 }
    );
    const found = collect(String(stdout || ""));
    return found.length ? found : collect(String(stderr || ""));
  } catch (error) {
    // Sur certains encodages le filtre échoue : on récupère ce qui a été écrit
    // avant l'arrêt plutôt que d'abandonner l'analyse.
    const err = error as { stdout?: string; stderr?: string };
    const found = collect(String(err.stdout || ""));
    return found.length ? found : collect(String(err.stderr || ""));
  }
}

/** Découpe régulière quand la source n'a pas de coupe franche. */
function evenShots(duration: number): Shot[] {
  const count = Math.max(1, Math.round(duration / 6));
  const each = duration / count;
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: Number((index * each).toFixed(2)),
    duration: Number(Math.min(MAX_SHOT, Math.max(MIN_SHOT, each)).toFixed(2)),
  }));
}

function shotsFromCuts(cuts: number[], duration: number): Shot[] {
  const bounds = [0, ...cuts.filter((cut) => cut < duration - 0.4), duration];
  const shots: Shot[] = [];

  for (let i = 0; i < bounds.length - 1; i += 1) {
    const raw = bounds[i + 1] - bounds[i];
    // Un plan de 0,5 s n'est pas générable : il est absorbé par le précédent.
    if (raw < 1 && shots.length) {
      shots[shots.length - 1].duration = Number(
        Math.min(MAX_SHOT, shots[shots.length - 1].duration + raw).toFixed(2)
      );
      continue;
    }
    shots.push({
      index: shots.length,
      start: Number(bounds[i].toFixed(2)),
      duration: Number(Math.min(MAX_SHOT, Math.max(MIN_SHOT, raw)).toFixed(2)),
    });
  }

  return shots.length ? shots : evenShots(duration);
}

export async function analyzeCreative(buffer: Buffer): Promise<RemakeAnalysis> {
  await mkdir(TMP, { recursive: true });
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const src = path.join(TMP, `${stamp}.src`);

  try {
    await writeFile(src, buffer);
    const info = parseProbe(await probe(src));
    if (!info.duration) throw new Error("Vidéo illisible ou sans piste vidéo");

    const cuts = await detectCuts(src);
    return { ...info, shots: shotsFromCuts(cuts, info.duration) };
  } finally {
    await rm(src, { force: true }).catch(() => undefined);
  }
}

/**
 * Une image représentative par plan, prise au milieu du plan plutôt qu'à sa
 * première frame — au début d'une coupe l'image est souvent floue ou en pleine
 * transition, et ne dit rien du cadrage réel.
 */
export async function shotFrames(buffer: Buffer, shots: Shot[]): Promise<string[]> {
  await mkdir(TMP, { recursive: true });
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const src = path.join(TMP, `${stamp}.src`);
  const frames: string[] = [];

  try {
    await writeFile(src, buffer);
    for (const shot of shots) {
      const out = path.join(TMP, `${stamp}-${shot.index}.jpg`);
      const at = shot.start + Math.min(shot.duration, 2) / 2;
      try {
        await run(
          ffmpeg(),
          [
            "-y",
            // `-ss` avant `-i` : positionnement rapide, suffisant pour une vignette.
            "-ss", String(at),
            "-i", src,
            "-frames:v", "1",
            "-vf", "scale=512:-2",
            "-q:v", "4",
            out,
          ],
          { maxBuffer: 1024 * 1024 * 8 }
        );
        frames.push((await readFile(out)).toString("base64"));
      } catch {
        frames.push("");
      } finally {
        await rm(out, { force: true }).catch(() => undefined);
      }
    }
    return frames;
  } finally {
    await rm(src, { force: true }).catch(() => undefined);
  }
}

/**
 * Repose la bande son d'origine sous le montage refait.
 *
 * La vidéo est recopiée sans réencodage : seule la piste audio est remplacée.
 * `-shortest` cale la sortie sur la plus courte des deux, pour qu'un montage
 * légèrement plus long que la musique ne finisse pas sur du silence.
 */
export async function muxAudio(videoPath: string, audio: Buffer, outPath: string) {
  await mkdir(TMP, { recursive: true });
  const tmpAudio = path.join(TMP, `${Date.now().toString(36)}.m4a`);
  try {
    await writeFile(tmpAudio, audio);
    await run(
      ffmpeg(),
      [
        "-y",
        "-i", videoPath,
        "-i", tmpAudio,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "160k",
        "-shortest",
        "-movflags", "+faststart",
        outPath,
      ],
      { maxBuffer: 1024 * 1024 * 32 }
    );
    return outPath;
  } finally {
    await rm(tmpAudio, { force: true }).catch(() => undefined);
  }
}

/** Piste son de la créa d'origine, à remettre sous le montage refait. */
export async function extractAudio(buffer: Buffer): Promise<Buffer | null> {
  await mkdir(TMP, { recursive: true });
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const src = path.join(TMP, `${stamp}.src`);
  const out = path.join(TMP, `${stamp}.m4a`);

  try {
    await writeFile(src, buffer);
    await run(
      ffmpeg(),
      ["-y", "-i", src, "-vn", "-c:a", "aac", "-b:a", "160k", out],
      { maxBuffer: 1024 * 1024 * 32 }
    );
    return await readFile(out);
  } catch {
    // Créative muette : il n'y a simplement rien à extraire.
    return null;
  } finally {
    await rm(src, { force: true }).catch(() => undefined);
    await rm(out, { force: true }).catch(() => undefined);
  }
}
