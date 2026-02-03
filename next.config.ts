import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium-min"],

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "olczdeydsmeuiizcvfjd.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
