import { describe, expect, it } from "vitest";
import { PWA_BACKGROUND_COLOR, PWA_THEME_COLOR, buildManifest } from "@/lib/pwa/manifest";

describe("pwa manifest", () => {
  it("describes a standalone app rooted at /", () => {
    const manifest = buildManifest();
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("Nailong Planner");
    expect(manifest.short_name).toBe("Nailong");
    expect(manifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(manifest.background_color).toBe(PWA_BACKGROUND_COLOR);
    expect(PWA_THEME_COLOR).toBe("#334451");
  });

  it("carries the install-critical icon sizes and one maskable", () => {
    const icons = buildManifest().icons ?? [];
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });

  it("offers Calendar and Tasks shortcuts", () => {
    expect(buildManifest().shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Calendar", url: "/" }),
        expect.objectContaining({ name: "Tasks", url: "/tasks" }),
      ]),
    );
  });
});
