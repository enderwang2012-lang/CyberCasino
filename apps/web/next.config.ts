import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cybercasino/shared"],
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
