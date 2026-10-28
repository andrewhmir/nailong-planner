/** Storage key remembering that the one-time install hint was dismissed. */
export const INSTALL_HINT_KEY = "nailong.pwa.installHintDismissed";

/** iPhone/iPad/iPod, including iPadOS desktop-mode user agents. */
export function isIOS(userAgent: string): boolean {
  return /iPhone|iPad|iPod/.test(userAgent);
}

/**
 * iOS Safari can add to the Home Screen; Chrome/Firefox/Edge/Opera and in-app
 * browsers on iOS cannot (and are not where the Share sheet lives).
 */
export function isIOSSafari(userAgent: string): boolean {
  if (!isIOS(userAgent)) {
    return false;
  }
  return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Instagram|FBAN|FBAV|Line\//.test(userAgent);
}

/** The minimal surface `isStandalone` reads, so tests need no DOM. */
export interface StandaloneEnv {
  matchMedia(query: string): { matches: boolean };
  navigator?: { standalone?: boolean };
}

/** Cross-platform display-mode check plus the iOS-only `navigator.standalone`. */
export function isStandalone(env: StandaloneEnv): boolean {
  if (env.matchMedia("(display-mode: standalone)").matches) {
    return true;
  }
  return env.navigator?.standalone === true;
}

/** Browser wrapper for `isStandalone`; false during SSR. */
export function detectStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return isStandalone({
    matchMedia: (query) => window.matchMedia(query),
    navigator: window.navigator as Navigator & { standalone?: boolean },
  });
}
