import { rrulestr } from "rrule";
import type { EventRow } from "@/lib/db/schema";
import {
  addDaysToDate,
  localWallTimeToUtc,
  localWallTimeToUtcForward,
  utcToLocalDate,
  utcToLocalWallTime,
} from "@/lib/time/zone";

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
const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;

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
 * Offsets are whole minutes, so the instant's sub-minute part is the wall
 * clock's: keeping it is what makes a `:30` series start at `:30` (DTSTART is
 * second-precision, and dropping the seconds loses the first occurrence).
 */
function wallMsOf(instant: number, zone: string): number {
  const [date, time] = utcToLocalWallTime(instant, zone).split("T");
  const [year, month, day] = (date ?? "").split("-").map(Number);
  const [hour, minute] = (time ?? "").split(":").map(Number);
  const subMinute = ((instant % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0) + subMinute;
}

/** `YYYY-MM-DDTHH:MM` wall stamp of a floating stamp (the zone contract is minute-precision). */
function wallStampOf(wallMs: number): string {
  const date = new Date(wallMs);
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

/** Converts one floating stamp back into the real instant in `zone`. */
function instantOf(wallMs: number, zone: string): number {
  // RFC 5545 §3.3.5: a wall time inside the spring-forward gap is read with the
  // offset that applied before the gap, i.e. it lands an hour later.
  const subMinute = ((wallMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  return localWallTimeToUtcForward(wallStampOf(wallMs), zone) + subMinute;
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
  // DTSTART carries whole seconds, so compare at second precision: a series
  // stored with a sub-minute start must keep its own first occurrence.
  const seriesStart = Math.floor(event.startAt / SECOND_MS) * SECOND_MS;
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
    .filter((start) => start >= seriesStart && !instants.has(start))
    .map((start) => ({
      eventId: event.id,
      startKey: new Date(start).toISOString(),
      startAt: start,
      endAt: start + duration,
      startDate: null,
      endDate: null,
    }));
}

function expandAllDay(event: EventRow, range: OccurrenceRange, timezone: string): Occurrence[] {
  if (!event.startDate) {
    return [plainOccurrence(event)];
  }
  const rule = safeRule(event.rrule ?? "", utcDateStamp(event.startDate));
  if (!rule) {
    return [plainOccurrence(event)];
  }

  const durationDays = daysInclusive(event.startDate, event.endDate ?? event.startDate);
  const { dates } = parseExdates(event, "UTC");
  // An occurrence overlaps the window when its **inclusive** end (`durationDays`
  // days after its start) is not before the window's first household-local day.
  // Padding backwards by `durationDays - 1` days is the all-day equivalent of
  // the timed branch's duration padding: every overlapping block is generated,
  // and a block that ends before the window still is not. Using the local date
  // (not the raw instant) keeps this zone-independent.
  const firstDate = utcToLocalDate(range.from, timezone);
  const after = new Date(utcMidnight(addDaysToDate(firstDate, 1 - durationDays)));
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
  return event.allDay === 1 ? expandAllDay(event, range, timezone) : expandTimed(event, range, timezone);
}

/**
 * The first occurrence that **starts** at or after the window's origin. The
 * expander returns every occurrence that *overlaps* the window — it deliberately
 * pads backwards by the event's duration, so the first element is usually an
 * occurrence that started before the origin. A search result must open the next
 * real slot, not the one already in progress or yesterday's. Timed occurrences
 * compare their instant to `range.from`; all-day occurrences compare their start
 * date to the household-local date of `range.from`. Returns `null` when the
 * series has no occurrence left inside the window.
 */
export function firstOccurrenceAtOrAfter(
  event: EventRow,
  range: OccurrenceRange,
  timezone: string,
): Occurrence | null {
  const originDate = utcToLocalDate(range.from, timezone);
  for (const occurrence of expandOccurrences(event, range, timezone)) {
    if (occurrence.startAt !== null) {
      if (occurrence.startAt >= range.from) {
        return occurrence;
      }
    } else if ((occurrence.startDate ?? "") >= originDate) {
      return occurrence;
    }
  }
  return null;
}
