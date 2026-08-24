import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * ffmpeg-static localise son binaire via `__dirname`. Bundlé par Next, ce
   * chemin devient `\ROOT\node_modules\...` et le spawn échoue en ENOENT. On le
   * sort du bundle pour qu'il soit chargé par le `require` natif de Node.
   */
  serverExternalPackages: ["ffmpeg-static"],

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
