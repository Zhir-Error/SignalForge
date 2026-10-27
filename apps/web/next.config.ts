import type { NextConfig } from "next";

const apiOrigin = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${apiOrigin}/v1/:path*` },
      {
        source: "/api/auth/:path*",
        destination: `${apiOrigin}/api/auth/:path*`,
      },
    ];
  },
  poweredByHeader: false,
};

export default nextConfig;
