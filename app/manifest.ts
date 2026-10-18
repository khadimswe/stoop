import type { MetadataRoute } from "next";

// A light PWA: installable, with the paper theme and the stoop mark. No service worker, no offline sync.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stoop",
    short_name: "Stoop",
    description: "Map the audience around your product with Qloo's taste data, then get ads made for them.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Paper, as in app/globals.css and the root viewport's themeColor.
    background_color: "#fbf5ec",
    theme_color: "#fbf5ec",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
