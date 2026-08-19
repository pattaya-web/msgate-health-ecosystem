import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
