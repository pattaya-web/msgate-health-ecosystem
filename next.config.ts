import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * Environnement affiché par le badge du header. `NEXT_PUBLIC_APP_ENV` fait
 * foi (dev / stable / production) ; à défaut, un build Vercel de production
 * est marqué « production », et le badge devinera d'après le port en local.
 */
function appEnv(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_ENV ?? "").trim();
  if (explicit) return explicit;
  return process.env.VERCEL_ENV === "production" ? "production" : "";
}

/** Commit court figé au build : Vercel le fournit, en local on interroge git. */
function commitSha(): string {
  const explicit = (process.env.NEXT_PUBLIC_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  if (explicit) return explicit.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_ENV: appEnv(),
    NEXT_PUBLIC_COMMIT_SHA: commitSha(),
  },

  /**
   * ffmpeg-static localise son binaire via `__dirname`. Bundlé par Next, ce
   * chemin devient `\ROOT\node_modules\...` et le spawn échoue en ENOENT. On le
   * sort du bundle pour qu'il soit chargé par le `require` natif de Node.
   */
  serverExternalPackages: ["ffmpeg-static"],

  experimental: {
    /** Fondu natif entre deux routes via l'API View Transitions du navigateur. */
    viewTransition: true,
  },

  async redirects() {
    return [
      { source: "/alerts", destination: "/", permanent: false },
      { source: "/alerts/:path*", destination: "/", permanent: false },
      { source: "/recovery", destination: "/", permanent: false },
      { source: "/recovery/:path*", destination: "/", permanent: false },
      { source: "/business", destination: "/", permanent: false },
      { source: "/business/:path*", destination: "/", permanent: false },
      { source: "/ads/upload", destination: "/ads-uploader", permanent: false },
      { source: "/studio/upload", destination: "/ads-uploader", permanent: false },
    ];
  },
};

export default nextConfig;
