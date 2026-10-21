"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { expandOccurrences } from "@/lib/recurrence/expand";
import type { EventView } from "@/lib/services/events";
import { occurrenceDate } from "@/lib/time/format";

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

interface ApiErrorBody {
  error?: { message?: string };
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Something went wrong.");
  }
  return payload as T;
}

/** Same key prefix as the range queries, so event mutations invalidate search too. */
export function useSearchEvents(query: string) {
  const normalized = query.trim().toLowerCase();
  return useQuery({
    queryKey: ["events", "search", normalized],
    enabled: normalized.length >= 2,
    queryFn: async () =>
      (
        await requestJson<{ events: EventView[] }>(
          `/api/events/search?q=${encodeURIComponent(query.trim())}`,
        )
      ).events,
    // Keep the previous list on screen while the next keystroke resolves.
    placeholderData: keepPreviousData,
  });
}

/**
 * The date a search result should open the grid at. For a series it is the next
 * occurrence from now, not the series' original start.
 */
export function navigableDateFor(event: EventView, timezone: string): string {
  if (event.rrule) {
    const now = Date.now();
    const [next] = expandOccurrences(event, { from: now, to: now + TWO_YEARS_MS }, timezone);
    if (next) {
      return occurrenceDate(event, next.startKey, timezone);
    }
  }
  const key =
    event.allDay === 1
      ? (event.startDate ?? "")
      : event.startAt === null
        ? ""
        : new Date(event.startAt).toISOString();
  return occurrenceDate(event, key, timezone);
}
