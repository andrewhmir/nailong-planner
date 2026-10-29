"use client";

import { useSyncExternalStore } from "react";
import { detectStandalone } from "@/lib/pwa/device";

const CARD = "scroll-mt-6 rounded-md border border-line-strong bg-surface p-6";
const CARD_HEADING = "border-b border-line pb-3 text-2xl font-normal text-ink";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readInstalled(): boolean {
  return detectStandalone();
}

/**
 * Settings card for the Home Screen install. The hint in the shell is
 * dismissible and one-time; this card is the always-available reference and
 * shows the installed state once the app runs standalone.
 *
 * `useSyncExternalStore` reports `null` during SSR/first hydration, so the
 * installed/uninstalled body appears only once the real display-mode is known
 * (and no effect-setState is needed).
 */
export function InstallAppCard() {
  const installed = useSyncExternalStore<boolean | null>(subscribe, readInstalled, () => null);

  return (
    <section className={CARD}>
      <h2 className={CARD_HEADING}>Install app</h2>
      {installed === null ? null : installed ? (
        <p className="mt-6 text-sm text-ink-soft">
          Installed — Nailong opens full-screen from your Home Screen, without the address bar.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-ink-soft">
            Add Nailong to your Home Screen: it then opens full-screen, without the address bar,
            and can show your last saved view offline.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-ink-soft">
            <li>
              <b>iPhone (Safari):</b> Share, then Add to Home Screen.
            </li>
            <li>
              <b>Android (Chrome):</b> browser menu, then Install app (or Add to Home screen).
            </li>
            <li>
              <b>Desktop:</b> the install icon in the address bar, or the browser menu.
            </li>
          </ul>
          <p className="mt-3 text-xs text-ink-mute">
            Installing needs the HTTPS address you normally use; a plain HTTP or LAN address cannot
            install.
          </p>
        </>
      )}
    </section>
  );
}
