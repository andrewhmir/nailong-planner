"use client";

import { useSyncExternalStore } from "react";
import { readSnapshotMeta } from "@/lib/pwa/offlineSnapshot";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * The amber offline bar: honest about what is on screen (last saved view or
 * nothing yet) and gone the moment the network returns. Sits under the
 * breadcrumb bar on every viewport; server snapshot is "online" so hydration
 * never mismatches.
 */
export function OfflineIndicator({ userId }: { userId: string }) {
  const online = useSyncExternalStore(subscribe, isOnline, () => true);
  if (online) {
    return null;
  }

  const savedAt = readSnapshotMeta(userId)?.savedAt;
  const time =
    savedAt === undefined
      ? null
      : new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning-soft bg-warning-soft px-3 py-2 text-sm font-bold text-warning-ink sm:px-6"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-pill bg-warning" />
      <span className="truncate">
        {time ? `Offline · showing your last saved view (${time})` : "Offline · no saved view yet"}
      </span>
    </div>
  );
}
