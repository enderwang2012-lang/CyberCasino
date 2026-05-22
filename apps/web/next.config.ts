import type { NextConfig } from "next";

const BACKEND_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  transpilePackages: ["@cybercasino/shared"],
  async rewrites() {
    return [
      {
        source: "/api/agents/soul/:path*",
        destination: `${BACKEND_URL}/api/agents/soul/:path*`,
      },
      {
        source: "/api/agents/create-by-ai",
        destination: `${BACKEND_URL}/api/agents/create-by-ai`,
      },
    ];
  },
};

export default nextConfig;
