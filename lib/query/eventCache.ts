import type { EventView } from "@/lib/services/events";

/**
 * Pure helpers for the optimistic event cache. Every TanStack range query under
 * `["events"]` holds an `EventView[]`, so these map one array at a time and the
 * mutation hooks in `lib/query/events.ts` apply them to every cached range.
 */

export type EventCacheMap = Record<string, EventView[]>;

export function applyEventPatch(
  events: EventView[],
  id: string,
  patch: Partial<EventView>,
): EventView[] {
  return events.map((event) => (event.id === id ? { ...event, ...patch } : event));
}

export function removeEvent(events: EventView[], id: string): EventView[] {
  return events.filter((event) => event.id !== id);
}

/**
 * Swaps a temp (`temp-<uuid>`) row for the row the server returned. The server
 * row takes the temp row's position so the grid does not reshuffle.
 */
export function replaceEvent(events: EventView[], event: EventView): EventView[] {
  const index = events.findIndex(
    (candidate) => candidate.id.startsWith("temp-") || candidate.id === event.id,
  );
  const kept = events.filter(
    (candidate) => !candidate.id.startsWith("temp-") && candidate.id !== event.id,
  );
  if (index === -1) {
    return [...kept, event];
  }
  const insertAt = Math.min(index, kept.length);
  return [...kept.slice(0, insertAt), event, ...kept.slice(insertAt)];
}

/** `exdates` is stored as a JSON array of occurrence keys; malformed means none. */
export function parseExdates(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}
