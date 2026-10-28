import { describe, expect, it } from "vitest";
import { INSTALL_HINT_KEY, isIOS, isIOSSafari, isStandalone } from "@/lib/pwa/device";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

describe("device detection", () => {
  it("recognises iOS Safari and distinguishes it from in-app browsers", () => {
    expect(isIOS(IPHONE_SAFARI)).toBe(true);
    expect(isIOSSafari(IPHONE_SAFARI)).toBe(true);
    expect(isIOS(IPHONE_CHROME)).toBe(true);
    expect(isIOSSafari(IPHONE_CHROME)).toBe(false);
    expect(isIOS(ANDROID_CHROME)).toBe(false);
    expect(isIOSSafari(ANDROID_CHROME)).toBe(false);
    expect(isIOS(DESKTOP_CHROME)).toBe(false);
  });

  it("rejects common iOS in-app browsers that cannot install", () => {
    const tokens = ["Instagram 320.0.0", "FBAN/FBIOS", "FBAV/450.0", "Line/13.0"];
    for (const token of tokens) {
      const userAgent = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 ${token}`;
      expect(isIOSSafari(userAgent)).toBe(false);
    }
  });

  it("detects standalone via display-mode or navigator.standalone", () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(
      isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }),
    ).toBe(true);
    expect(
      isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} }),
    ).toBe(false);
  });

  it("pins the dismissal storage key", () => {
    expect(INSTALL_HINT_KEY).toBe("nailong.pwa.installHintDismissed");
  });
});
