import { rrulestr } from "rrule";
import type { EventRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { addDaysToDate, localWallTimeToUtc, utcToLocalWallTime } from "@/lib/time/zone";

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
const HOUR_MS = 60 * 60 * 1000;

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

/**
 * Reads an instant's wall-clock components in `zone` as if they were UTC. This
 * is the "floating" coordinate system recurrence rules are defined in: a rule
 * expanded on floating stamps keeps its wall-clock time across a DST change.
 */
function wallMsOf(instant: number, zone: string): number {
  const [date, time] = utcToLocalWallTime(instant, zone).split("T");
  const [year, month, day] = (date ?? "").split("-").map(Number);
  const [hour, minute] = (time ?? "").split(":").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
}

/** Converts one floating stamp back into the real instant in `zone`. */
function instantOf(wallMs: number, zone: string): number {
  // RFC 5545 §3.3.5: a wall time inside the spring-forward gap is read with the
  // offset that applied before the gap, i.e. it lands an hour later.
  for (let shift = 0; shift < 3; shift += 1) {
    const date = new Date(wallMs + shift * HOUR_MS);
    const wall =
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
      `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
    try {
      return localWallTimeToUtc(wall, zone);
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
    }
  }
  throw new AppError("VALIDATION", `That recurrence does not exist in ${zone}.`, 400);
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

/**
 * `UNTIL` in an RRULE is a UTC instant; a floating expansion compares it with
 * wall stamps, so it must be moved into the same coordinate system or the last
 * occurrence of a DST-zone series silently disappears.
 */
function floatingRule(rule: string, zone: string): string {
  return rule.replace(/UNTIL=(\d{8}T\d{6})Z/, (_match, stamp: string) => {
    const instant = Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(9, 11)),
      Number(stamp.slice(11, 13)),
      Number(stamp.slice(13, 15)),
    );
    const wall = new Date(wallMsOf(instant, zone));
    return (
      `UNTIL=${wall.getUTCFullYear()}${pad(wall.getUTCMonth() + 1)}${pad(wall.getUTCDate())}` +
      `T${pad(wall.getUTCHours())}${pad(wall.getUTCMinutes())}${pad(wall.getUTCSeconds())}`
    );
  });
}

function expandTimed(event: EventRow, range: OccurrenceRange, timezone: string): Occurrence[] {
  if (event.startAt === null) {
    return [plainOccurrence(event)];
  }
  // A series keeps its wall-clock time in its own zone (the source calendar's
  // TZID for imported events); the household zone is only the fallback.
  const zone = event.tzid ?? timezone;
  const startWall = wallMsOf(event.startAt, zone);
  const rule = safeRule(floatingRule(event.rrule ?? "", zone), utcStamp(startWall));
  if (!rule) {
    return [plainOccurrence(event)];
  }

  const duration = Math.max(0, (event.endAt ?? event.startAt) - event.startAt);
  const { instants } = parseExdates(event, zone);
  // Expand in floating wall time, then convert every occurrence back to an instant.
  const after = new Date(wallMsOf(range.from, zone) - duration - DAY_MS);
  const before = new Date(wallMsOf(range.to, zone) + DAY_MS);
  const starts = rule.between(after, before, true);

  return starts
    .map((start) =>
      instantOf(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate(),
          start.getUTCHours(),
          start.getUTCMinutes(),
          start.getUTCSeconds(),
        ),
        zone,
      ),
    )
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
