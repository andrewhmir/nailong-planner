"use client";

import { hydrate, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  serializeSnapshot,
} from "@/lib/pwa/offlineSnapshot";

/**
 * Restores the last saved read-only view and keeps the per-user snapshot fresh.
 *
 * Hydration happens in an effect (never during render) so SSR and the first
 * client paint are unchanged; online behaviour is identical apart from an
 * instant cached paint while the normal refetch runs.
 */
export function OfflineSnapshotWriter({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Only hydrate for an offline cold start. Online the normal queries must be
    // authoritative: restoring saved rows first would mark them fresh for
    // `staleTime`, hiding data another tab or device just changed (and breaking
    // create-then-reload flows).
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const snapshot = offline ? loadSnapshot(userId) : null;
    if (snapshot) {
      try {
        hydrate(queryClient, snapshot.state);
      } catch {
        // A corrupt snapshot must never break the app; the refetch recovers.
        clearSnapshot(userId);
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    function scheduleSave() {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        saveSnapshot(userId, serializeSnapshot(queryClient));
      }, 1500);
    }

    const unsubscribe = queryClient.getQueryCache().subscribe(scheduleSave);
    // iOS often kills a backgrounded web app without another lifecycle event.
    const onPageHide = () => saveSnapshot(userId, serializeSnapshot(queryClient));
    window.addEventListener("pagehide", onPageHide);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe();
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [queryClient, userId]);

  return null;
}
