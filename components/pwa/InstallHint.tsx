"use client";

import { useState, useSyncExternalStore } from "react";
import { INSTALL_HINT_KEY, detectStandalone, isIOSSafari } from "@/lib/pwa/device";

/** Nothing external changes the hint: dismissal is local state + storage. */
function subscribe(): () => void {
  return () => {};
}

function readCanShow(): boolean {
  if (!isIOSSafari(navigator.userAgent) || detectStandalone()) {
    return false;
  }
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) !== "1";
  } catch {
    return true;
  }
}

/**
 * The one-time iPhone-Safari install strip (Quiet native, option A).
 *
 * There is no install prompt event on iOS: Share -> Add to Home Screen is the
 * only path, so the hint says exactly that. It is shown only in iOS Safari, is
 * never shown once installed, and a dismissal is permanent for this device.
 * `useSyncExternalStore` keeps the server snapshot (no hint) out of hydration.
 */
export function InstallHint() {
  const canShow = useSyncExternalStore(subscribe, readCanShow, () => false);
  const [dismissed, setDismissed] = useState(false);

  if (!canShow || dismissed) {
    return null;
  }

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_HINT_KEY, "1");
    } catch {
      // Best effort; the hint simply returns next visit.
    }
    setDismissed(true);
  }

  return (
    <div className="flex items-start gap-2 border-b border-line bg-info-soft safe-x py-2 text-sm text-info-ink md:hidden">
      <span aria-hidden className="mt-0.5 font-bold">
        &#8679;
      </span>
      <p className="min-w-0 flex-1 leading-snug">
        Install Nailong for the full-screen app — tap <b>Share</b>, then <b>Add to Home Screen</b>.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install hint"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-sm hover:bg-well"
      >
        <span aria-hidden>&times;</span>
      </button>
    </div>
  );
}
