import type { MetadataRoute } from "next";

/** Rail token from `app/globals.css`; also the browser/status-bar chrome colour. */
export const PWA_THEME_COLOR = "#334451";

/** Paper token; painted while the installed app prepares its first frame. */
export const PWA_BACKGROUND_COLOR = "#ffffff";

/**
 * The web app manifest.
 *
 * Kept as a pure builder rather than inline in `app/manifest.ts` so the
 * install-critical fields (icon sizes, scope, display) are unit-testable
 * without booting Next. iOS 26 launches every Home Screen add standalone;
 * older iOS reads `display` here (and the apple metadata in `app/layout.tsx`).
 */
export function buildManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Nailong Planner",
    short_name: "Nailong",
    description: "A private planner for two.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    lang: "en",
    dir: "ltr",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Calendar", short_name: "Calendar", url: "/" },
      { name: "Tasks", short_name: "Tasks", url: "/tasks" },
    ],
  };
}
