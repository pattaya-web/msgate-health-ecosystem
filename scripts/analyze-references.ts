/**
 * Relit les vidéos déposées dans data/references/ pour que je puisse les voir.
 *
 * Pour chaque mp4/mov : découpe les plans (ffmpeg), extrait une image par plan,
 * transcrit la voix (ElevenLabs via Kie), et écrit un rapport lisible. Je lis
 * ensuite les images et le rapport pour comprendre ce qu'il faut reproduire.
 *
 *   npx tsx scripts/analyze-references.ts
 */
import { loadEnvConfig } from "@next/env";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { analyzeVideoReference } from "../src/lib/creative-library/analyze";
import { shotFrames, analyzeCreative } from "../src/lib/ugc/remake";

// La clé Kie vit dans .env.local : on la charge comme Next le ferait.
loadEnvConfig(process.cwd());

const ROOT = path.join(process.cwd(), "data", "references");

async function main() {
  const files = (await readdir(ROOT)).filter((file) => /\.(mp4|mov|m4v|webm)$/i.test(file));
  if (!files.length) {
    console.log("Aucune vidéo dans data/references/");
    return;
  }
  for (const file of files) {
    const name = file.replace(/\.[a-z0-9]+$/i, "");
    const out = path.join(ROOT, name);
    const report = path.join(out, "report.md");
    try {
      await readFile(report);
      console.log(`↷ ${file} déjà analysée`);
      continue;
    } catch {
      // à faire
    }
    console.log(`… ${file}`);
    const buffer = await readFile(path.join(ROOT, file));
    await mkdir(path.join(out, "frames"), { recursive: true });

    const analysis = await analyzeCreative(buffer);
    const frames = await shotFrames(buffer, analysis.shots);
    await Promise.all(
      frames.map((frame, index) =>
        frame ? writeFile(path.join(out, "frames", `shot-${String(index + 1).padStart(2, "0")}.jpg`), Buffer.from(frame, "base64")) : Promise.resolve()
      )
    );

    let spec = null as Awaited<ReturnType<typeof analyzeVideoReference>>["spec"] | null;
    let error = "";
    try {
      spec = (await analyzeVideoReference(buffer)).spec;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const lines = [
      `# ${file}`,
      "",
      `Durée : ${Math.round(analysis.duration)}s · ${analysis.width}x${analysis.height} · ${analysis.shots.length} plans · audio : ${analysis.hasAudio ? "oui" : "non"}`,
      "",
      spec?.styleBlock ? `## Dispositif\n\n${spec.styleBlock}\n` : "",
      "## Plans",
      "",
      ...analysis.shots.map((shot, index) => {
        const s = spec?.shots[index];
        return `${index + 1}. ${shot.duration.toFixed(1)}s (à ${shot.start.toFixed(1)}s) — ${s?.framing || "cadrage non relevé"}${s?.line ? `\n   > « ${s.line} »` : ""}`;
      }),
      "",
      spec?.transcript ? `## Transcription\n\n${spec.transcript}\n` : "## Transcription\n\n(aucune)\n",
      error ? `\n_Relevé partiel : ${error}_\n` : "",
    ];
    await writeFile(report, lines.filter((line) => line !== "").join("\n"));
    console.log(`✓ ${file} → ${path.relative(process.cwd(), report)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
