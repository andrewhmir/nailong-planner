import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/lib/roadmap";

const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("service worker version", () => {
  it("carries a cache version for the current release", () => {
    // The release bump must touch public/sw.js, or installed apps never see the
    // new worker and the update prompt silently stops working.
    expect(sw).toContain(`SW_VERSION = "v${APP_VERSION}`);
  });
});