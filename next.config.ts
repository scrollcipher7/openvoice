import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.BUILD_TARGET === "capacitor" ? "export" : undefined,
  images: {
    unoptimized: true,
  },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;