import type { MetadataRoute } from "next";

export const dynamic = "force-static";
export const revalidate = false;

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "OpenVoice",
    short_name: "OpenVoice",
    description: "A social platform for honest conversation.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/openvoice-192.png", sizes: "192x192", type: "image/png" },
      { src: "/openvoice-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/openvoice-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}