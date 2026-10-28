"use client";

import { useEffect } from "react";
import { notifyIfUpdateReady } from "@/lib/pwa/swUpdate";

/**
 * Registers the service worker in production only.
 *
 * Dev and the existing E2E dev server must never register a SW: a stale worker
 * serving old chunks is the classic "my changes do not appear" trap. The
 * production PWA spec runs against `next start`, so it exercises this path.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    let detachVisibility: (() => void) | undefined;

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (cancelled) {
          return;
        }

        notifyIfUpdateReady(registration);

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) {
            return;
          }
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") {
              notifyIfUpdateReady(registration);
            }
          });
        });

        const onVisibility = () => {
          if (document.visibilityState === "visible") {
            void registration.update();
          }
        };
        document.addEventListener("visibilitychange", onVisibility);
        detachVisibility = () => document.removeEventListener("visibilitychange", onVisibility);

        // A Home Screen app is far less likely to have its storage evicted.
        if (window.matchMedia("(display-mode: standalone)").matches) {
          void navigator.storage?.persist?.();
        }
      } catch {
        // A service worker is optional: private browsing and HTTP origins must
        // keep the app fully usable without one.
      }
    })();

    return () => {
      cancelled = true;
      detachVisibility?.();
    };
  }, []);

  return null;
}
