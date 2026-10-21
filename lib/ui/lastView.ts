"use client";

import type { PlannerView } from "@/components/calendar/Toolbar";

const VALID_VIEWS: readonly PlannerView[] = [
  "dayGridMonth",
  "timeGridWeek",
  "timeGridDay",
  "listMonth",
];

function storageKey(userId: string): string {
  return `nailong.lastView.${userId}`;
}

/** The last view this device used, or null when nothing valid is stored. */
export function readLastView(userId: string): PlannerView | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw && (VALID_VIEWS as readonly string[]).includes(raw)
      ? (raw as PlannerView)
      : null;
  } catch {
    return null;
  }
}

export function writeLastView(userId: string, view: PlannerView): void {
  try {
    window.localStorage.setItem(storageKey(userId), view);
  } catch {
    // Storage can be blocked (private mode); the view just will not persist.
  }
}
