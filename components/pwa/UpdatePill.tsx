"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UPDATE_EVENT, applyUpdate } from "@/lib/pwa/swUpdate";

const TOAST_ID = "nailong-update";

/**
 * The user-initiated update surface: a compact pill in the phone top bar, and a
 * persistent toast with a Reload action on wider screens. Never reloads on its
 * own — an open editor must not lose its draft to a deploy.
 */
export function UpdatePill() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    function onUpdate(event: Event) {
      const next = (event as CustomEvent<ServiceWorkerRegistration>).detail;
      setRegistration(next);
      if (window.matchMedia("(min-width: 48rem)").matches) {
        toast("A new version of Nailong is ready", {
          id: TOAST_ID,
          duration: Infinity,
          action: { label: "Reload", onClick: () => applyUpdate(next) },
        });
      }
    }

    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(UPDATE_EVENT, onUpdate);
  }, []);

  if (!registration) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => applyUpdate(registration)}
      aria-label="Update ready — reload the app"
      className="shrink-0 rounded-pill border border-white/60 px-2 py-1 text-xs font-bold text-white hover:bg-rail-hover focus-visible:outline-white"
    >
      Update ready
    </button>
  );
}
