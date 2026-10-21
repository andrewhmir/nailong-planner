import type { EventView } from "@/lib/services/events";
import type { TimeFormat } from "@/lib/services/preferences";
import { addDaysToDate, utcToLocalDate, utcToLocalWallTime } from "./zone";

/**
 * The single place that renders a time for a human (spec D2). 24-hour stays the
 * default; 12-hour is a per-user preference. Everything that shows a time to the
 * reader must come through here so the two formats cannot drift apart.
 */

const WALL_HHMM = /^(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const TWELVE_HOUR = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

const WEEKDAY_SHORT = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(date: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1] ?? 0),
    month: Number(match[2] ?? 1),
    day: Number(match[3] ?? 1),
  };
}

function monthName(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) {
    return "";
  }
  return MONTH_SHORT.format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

/** "2026-10-21" → "21 Oct"; an unparseable value comes back untouched. */
function formatDate(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) {
    return date;
  }
  return `${parsed.day} ${monthName(date)}`;
}

/** "21–23 Oct" inside one month, "21 Oct – 3 Nov" across months. */
function formatDateRange(startDate: string, endDate: string): string {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) {
    return `${startDate} – ${endDate}`;
  }
  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ${monthName(startDate)}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${monthName(startDate)} – ${end.day} ${monthName(endDate)}`;
  }
  return `${start.day} ${monthName(startDate)} ${start.year} – ${end.day} ${monthName(endDate)} ${end.year}`;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) {
    return 0;
  }
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endMs - startMs) / DAY_MS) + 1;
}

/**
 * Formats the wall clock portion of a wall-time string: `"19:00"` or a full
 * `"2026-10-21T19:00"` both render as `"19:00"` / `"7:00 PM"`.
 */
export function formatWallTime(wall: string, format: TimeFormat): string {
  const hhmm = wall.slice(-5);
  const match = WALL_HHMM.exec(hhmm);
  if (!match) {
    return wall;
  }
  if (format === "24h") {
    return hhmm;
  }
  // A fixed synthetic UTC date keeps the formatter from depending on the host
  // zone or on DST; only the clock portion is being rendered.
  const instant = Date.UTC(2000, 0, 1, Number(match[1] ?? 0), Number(match[2] ?? 0));
  return TWELVE_HOUR.format(new Date(instant));
}

/** Formats a UTC instant as a wall clock in the household timezone. */
export function formatInstant(utcMs: number, timezone: string, format: TimeFormat): string {
  return formatWallTime(utcToLocalWallTime(utcMs, timezone), format);
}

/** FullCalendar's `eventTimeFormat` shape for the chosen preference. */
export function fcEventTimeFormat(format: TimeFormat): {
  hour: "2-digit" | "numeric";
  minute: "2-digit";
  hour12: boolean;
} {
  return format === "12h"
    ? { hour: "numeric", minute: "2-digit", hour12: true }
    : { hour: "2-digit", minute: "2-digit", hour12: false };
}

/**
 * Human "when" string for one occurrence of an event. `occurrenceStart` is the
 * key `expandOccurrences` already produced — the local date for all-day events,
 * the ISO instant for timed ones — so a series occurrence renders its own date
 * without re-expanding the rule.
 */
export function formatOccurrenceWhen(
  event: EventView,
  occurrenceStart: string,
  timezone: string,
  format: TimeFormat,
): string {
  if (event.allDay === 1) {
    const startDate = occurrenceStart.slice(0, 10);
    const seriesDays = Math.max(
      1,
      daysBetween(event.startDate ?? startDate, event.endDate ?? event.startDate ?? startDate),
    );
    if (seriesDays === 1) {
      return `All day · ${formatDate(startDate)}`;
    }
    const endDate = addDaysToDate(startDate, seriesDays - 1);
    return `All day · ${formatDateRange(startDate, endDate)} (${seriesDays} days)`;
  }

  const startMs = Date.parse(occurrenceStart);
  if (!Number.isFinite(startMs)) {
    return "No time";
  }
  const startWall = utcToLocalWallTime(startMs, timezone);
  const startDate = startWall.slice(0, 10);
  const startTime = formatWallTime(startWall, format);

  if (event.startAt === null || event.endAt === null) {
    return `${formatDate(startDate)} ${startTime}`;
  }

  const endMs = startMs + (event.endAt - event.startAt);
  const endWall = utcToLocalWallTime(endMs, timezone);
  const endDate = endWall.slice(0, 10);
  const endTime = formatWallTime(endWall, format);

  if (startDate === endDate) {
    return `${startTime} – ${endTime}`;
  }
  return `${formatDate(startDate)} ${startTime} – ${formatDate(endDate)} ${endTime}`;
}

/** The date a search result or breadcrumb should point at. */
export function occurrenceDate(event: EventView, occurrenceStart: string, timezone: string): string {
  return event.allDay === 1
    ? occurrenceStart.slice(0, 10)
    : utcToLocalDate(Date.parse(occurrenceStart), timezone);
}

function weekdayName(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) {
    return "";
  }
  return WEEKDAY_SHORT.format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

/**
 * The date heading for a details card: "Wed, 21 Oct 2026". It resolves the
 * *clicked* occurrence (F28) instead of the series start.
 */
export function formatOccurrenceHeading(
  event: EventView,
  occurrenceStart: string,
  timezone: string,
): string {
  return formatWallDate(occurrenceDate(event, occurrenceStart, timezone));
}

/** "2026-10-28" → "Wed, 28 Oct 2026"; an unparseable value comes back untouched. */
export function formatWallDate(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) {
    return date;
  }
  return `${weekdayName(date)}, ${parsed.day} ${monthName(date)} ${parsed.year}`;
}
