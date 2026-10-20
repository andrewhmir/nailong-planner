import { rrulestr } from "rrule";
import type { EventRow } from "@/lib/db/schema";
import { addDaysToDate, localWallTimeToUtc } from "@/lib/time/zone";

export interface Occurrence {
  eventId: string;
  /** Stable key: local date for all-day events, ISO instant for timed events. */
  startKey: string;
  startAt: number | null;
  endAt: number | null;
  startDate: string | null;
  endDate: string | null;
}

export interface OccurrenceRange {
  from: number;
  to: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYYMMDDTHHMMSSZ`, the form rrule expects after `DTSTART:`. */
function utcStamp(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function utcDateStamp(date: string): string {
  return `${date.replace(/-/g, "")}T000000Z`;
}

function utcMidnight(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function utcDateOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function daysInclusive(startDate: string, endDate: string): number {
  return Math.max(1, Math.round((utcMidnight(endDate) - utcMidnight(startDate)) / DAY_MS) + 1);
}

function parseExdates(event: EventRow, timezone: string): { instants: Set<number>; dates: Set<string> } {
  const instants = new Set<number>();
  const dates = new Set<string>();
  if (!event.exdates) {
    return { instants, dates };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(event.exdates);
  } catch {
    return { instants, dates };
  }
  if (!Array.isArray(raw)) {
    return { instants, dates };
  }
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
      dates.add(entry);
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(entry)) {
      instants.add(localWallTimeToUtc(entry, timezone));
      continue;
    }
    const parsed = Date.parse(entry);
    if (Number.isFinite(parsed)) {
      instants.add(parsed);
    }
  }
  return { instants, dates };
}

function plainOccurrence(event: EventRow): Occurrence {
  if (event.allDay === 1) {
    return {
      eventId: event.id,
      startKey: event.startDate ?? "",
      startAt: null,
      endAt: null,
      startDate: event.startDate,
      endDate: event.endDate,
    };
  }
  return {
    eventId: event.id,
    startKey: event.startAt === null ? "" : new Date(event.startAt).toISOString(),
    startAt: event.startAt,
    endAt: event.endAt,
    startDate: null,
    endDate: null,
  };
}

function safeRule(rule: string, dtstart: string): { between: (after: Date, before: Date, inc: boolean) => Date[] } | null {
  try {
    const parsed = rrulestr(`DTSTART:${dtstart}\nRRULE:${rule}`);
    return parsed as unknown as { between: (after: Date, before: Date, inc: boolean) => Date[] };
  } catch {
    return null;
  }
}

function expandTimed(event: EventRow, range: OccurrenceRange, timezone: string): Occurrence[] {
  if (event.startAt === null) {
    return [plainOccurrence(event)];
  }
  const rule = safeRule(event.rrule ?? "", utcStamp(event.startAt));
  if (!rule) {
    return [plainOccurrence(event)];
  }

  const duration = Math.max(0, (event.endAt ?? event.startAt) - event.startAt);
  const { instants } = parseExdates(event, timezone);
  const starts = rule.between(new Date(range.from - duration), new Date(range.to), true);

  return starts
    .map((start) => start.getTime())
    .filter((start) => start >= event.startAt! && !instants.has(start))
    .map((start) => ({
      eventId: event.id,
      startKey: new Date(start).toISOString(),
      startAt: start,
      endAt: start + duration,
      startDate: null,
      endDate: null,
    }));
}

function expandAllDay(event: EventRow, range: OccurrenceRange): Occurrence[] {
  if (!event.startDate) {
    return [plainOccurrence(event)];
  }
  const rule = safeRule(event.rrule ?? "", utcDateStamp(event.startDate));
  if (!rule) {
    return [plainOccurrence(event)];
  }

  const durationDays = daysInclusive(event.startDate, event.endDate ?? event.startDate);
  const { dates } = parseExdates(event, "UTC");
  const after = new Date(range.from - DAY_MS);
  const before = new Date(range.to + DAY_MS);
  const results: Occurrence[] = [];

  for (const occurrence of rule.between(after, before, true)) {
    const startDate = utcDateOf(occurrence.getTime());
    if (startDate < event.startDate || dates.has(startDate)) {
      continue;
    }
    results.push({
      eventId: event.id,
      startKey: startDate,
      startAt: null,
      endAt: null,
      startDate,
      endDate: addDaysToDate(startDate, durationDays - 1),
    });
  }
  return results;
}

/**
 * Expands one stored event into concrete occurrences for the visible range.
 * Recurring series are anchored to the event's own stored start (`DTSTART`),
 * never to the page-load time, and `exdates` are matched against the generated
 * occurrences.
 */
export function expandOccurrences(
  event: EventRow,
  range: OccurrenceRange,
  timezone: string,
): Occurrence[] {
  if (!event.rrule) {
    return [plainOccurrence(event)];
  }
  return event.allDay === 1 ? expandAllDay(event, range) : expandTimed(event, range, timezone);
}
