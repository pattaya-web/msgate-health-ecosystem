import { execFile } from "child_process";
import { readdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

/**
 * Recolle les clips d'un angle en une seule vidéo prête à envoyer en ads.
 *
 * On réencode au lieu de faire une copie de flux : Seedance ne garantit pas des
 * paramètres identiques d'un clip à l'autre (débit, GOP, canaux audio), et un
 * `concat` en copie produit alors une vidéo qui se désynchronise ou refuse de
 * lire. Le réencodage coûte quelques secondes de CPU et donne un fichier sûr.
 */
export async function stitchClips(dir: string, files: string[], outName: string) {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable");
  if (files.length < 2) throw new Error("Il faut au moins deux clips à assembler");

  const listPath = path.join(dir, `${outName}.txt`);
  const outPath = path.join(dir, outName);

  // Le demuxer concat lit un fichier texte ; les chemins y sont relatifs au
  // fichier de liste, donc on n'écrit que les noms.
  await writeFile(listPath, files.map((file) => `file '${file}'`).join("\n"));

  try {
    await run(
      ffmpegPath,
      [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        // Cadence et échantillonnage fixes : c'est ce qui garde l'audio calé.
        "-r", "30",
        "-ar", "44100",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outPath,
      ],
      { maxBuffer: 1024 * 1024 * 32 }
    );
  } finally {
    await unlink(listPath).catch(() => undefined);
  }

  return outName;
}

/** Les mp4 déjà rapatriés du lot, hors montages déjà produits. */
export async function clipsIn(dir: string) {
  const files = await readdir(dir);
  return files.filter((file) => file.endsWith(".mp4") && !file.startsWith("montage-"));
}
