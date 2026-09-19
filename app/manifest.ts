import type { MetadataRoute } from "next";

// The "app card" a phone reads when someone adds HomeBase to the home
// screen: its name, its icon, and how to open it. Next.js serves this at
// /manifest.webmanifest and links it from every page's <head>.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "HomeBase",
    short_name: "HomeBase",
    description: "Our household, in one app.",
    start_url: "/",
    scope: "/",
    // Full screen, without the browser's address bar and toolbar.
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
