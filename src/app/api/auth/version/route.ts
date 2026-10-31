import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

/** En local, le commit courant (lu au plus toutes les 5 s) : un merge sur main suffit à signaler une nouvelle version. */
let cached: { at: number; version: string } | null = null;

async function localVersion() {
  if (cached && Date.now() - cached.at < 5_000) return cached.version;
  const version = await run("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), timeout: 5_000 })
    .then(({ stdout }) => stdout.trim())
    .catch(() => process.env.MSGATE_BUILD_ID ?? "");
  cached = { at: Date.now(), version };
  return version;
}

/**
 * La version que sert le serveur. L'interface la compare à celle de son
 * chargement et propose « Recharger » quand elles diffèrent
 * (src/components/layout/update-bar.tsx). En production, c'est l'identifiant
 * figé au build : chaque déploiement Vercel en change.
 */
export async function GET() {
  const version = process.env.NODE_ENV === "production" ? (process.env.MSGATE_BUILD_ID ?? "") : await localVersion();
  return NextResponse.json({ version }, { headers: { "cache-control": "no-store" } });
}
