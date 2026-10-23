import { rrulestr } from "rrule";
import { localWallTimeToUtc, utcToLocalDate } from "@/lib/time/zone";

/**
 * The structured repeat model behind the event dialog. `event.rrule` stays the
 * only stored form (RFC 5545 text) — this module is the bidirectional adapter:
 * parse a stored rule into the controls the dialog shows, and format the
 * controls back into the rule Google Calendar would write.
 *
 * It deliberately models only what the editor can express. A stored rule with
 * parts outside that set still parses (so it is never silently mangled while
 * the user edits the title), and `advanced` tells the dialog to say so.
 */

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type MonthlyPattern =
  | { mode: "dayOfMonth"; day: number }
  | { mode: "weekday"; ordinal: 1 | 2 | 3 | 4 | 5 | -1; weekday: number };

export type RepeatEnd =
  | { mode: "never" }
  | { mode: "on"; date: string }
  | { mode: "after"; count: number };

export interface RepeatOptions {
  frequency: Frequency;
  /** 1..99; 1 is omitted from the rule text. */
  interval: number;
  /** 0 = Sunday … 6 = Saturday. Only weekly rules use it. */
  weekdays: number[];
  monthly: MonthlyPattern;
  end: RepeatEnd;
  /** RFC 5545 WKST; Google exports frequently carry `WKST=SU`. */
  weekStart: "MO" | "SU";
  /** The parsed rule carried parts the editor does not model. */
  advanced: boolean;
}

export interface RepeatContext {
  allDay: boolean;
  timezone: string;
}

/** Index is `Date#getUTCDay()` (0 = Sunday). */
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** RFC 5545 weekday order, used to serialise BYDAY deterministically. */
const RFC_WEEKDAY_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

const KNOWN_PARTS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "BYSETPOS",
  "UNTIL",
  "COUNT",
  "WKST",
]);

const FREQUENCIES: readonly Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

const MONTH_DAYS = 31;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateStamp(date: string): string {
  return date.replace(/-/g, "");
}

function utcDateOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function utcStampOf(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function partsOf(date: string): { year: number; month: number; day: number } {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return { year, month, day };
}

/** 0 = Sunday … 6 = Saturday for a `YYYY-MM-DD` local date. */
export function weekdayOfDate(date: string): number {
  const { year, month, day } = partsOf(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The weekday toggle order for the household's week start (0 = Sunday). */
export function weekdayOrder(weekStartsOn: number): number[] {
  const days = [0, 1, 2, 3, 4, 5, 6];
  return weekStartsOn === 0 ? days : [...days.slice(1), 0];
}

/** Household preference → RFC 5545 WKST. */
export function weekStartOf(weekStartsOn: number): "MO" | "SU" {
  return weekStartsOn === 0 ? "SU" : "MO";
}

function ordinalOfDayInMonth(date: string): 1 | 2 | 3 | 4 | 5 {
  const { day } = partsOf(date);
  return Math.min(5, Math.ceil(day / 7)) as 1 | 2 | 3 | 4 | 5;
}

/** A monthly anchor derived from the start date (Google's default monthly shape). */
export function monthlyAnchor(date: string): MonthlyPattern {
  return { mode: "weekday", ordinal: ordinalOfDayInMonth(date), weekday: weekdayOfDate(date) };
}

/** Day-of-month of a `YYYY-MM-DD` date, for the day-of-month monthly mode. */
export function dayOfMonthOf(date: string): number {
  return partsOf(date).day;
}

function sortByRfcWeekday(weekdays: number[]): number[] {
  return [...weekdays]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => RFC_WEEKDAY_ORDER.indexOf(DAY_CODES[a]!) - RFC_WEEKDAY_ORDER.indexOf(DAY_CODES[b]!));
}

/** The defaults a preset switch installs, anchored on the event's start date. */
export function newRepeatOptions(
  frequency: Frequency,
  startDate: string,
  weekStart: "MO" | "SU",
): RepeatOptions {
  return {
    frequency,
    interval: 1,
    weekdays: [weekdayOfDate(startDate)],
    monthly: monthlyAnchor(startDate),
    end: { mode: "never" },
    weekStart,
    advanced: false,
  };
}

/**
 * Re-derives the parts that are anchored to DTSTART when the start date moves,
 * so a weekly series stays on the new weekday instead of keeping a stale BYDAY
 * (the classic "the event I just moved does not appear on its new day" bug).
 */
export function anchorRepeat(options: RepeatOptions, startDate: string): RepeatOptions {
  if (options.frequency === "WEEKLY") {
    return { ...options, weekdays: [weekdayOfDate(startDate)] };
  }
  if (options.frequency === "MONTHLY") {
    if (options.monthly.mode === "dayOfMonth") {
      return { ...options, monthly: { mode: "dayOfMonth", day: partsOf(startDate).day } };
    }
    return { ...options, monthly: monthlyAnchor(startDate) };
  }
  return options;
}

function endSuffix(end: RepeatEnd, context: RepeatContext): string {
  if (end.mode === "never") {
    return "";
  }
  if (end.mode === "after") {
    return `;COUNT=${end.count}`;
  }
  if (context.allDay) {
    return `;UNTIL=${dateStamp(end.date)}`;
  }
  // Google writes UNTIL as the UTC instant of the last occurrence; end-of-day
  // in the series zone is equivalent for inclusion and survives DST rounding.
  // `localWallTimeToUtc` takes minute precision, so add the final 59 seconds.
  const wall = localWallTimeToUtc(`${end.date}T23:59`, context.timezone) + 59_000;
  return `;UNTIL=${utcStampOf(wall)}`;
}

/** Serialise the editor state into the RRULE text Google Calendar would write. */
export function formatRepeatRule(
  options: RepeatOptions,
  startDate: string,
  context: RepeatContext,
): string {
  void startDate;
  const parts = [`FREQ=${options.frequency}`];
  if (options.interval > 1) {
    parts.push(`INTERVAL=${options.interval}`);
  }

  if (options.frequency === "WEEKLY" && options.weekdays.length > 0) {
    const codes = sortByRfcWeekday(options.weekdays).map((day) => DAY_CODES[day]!);
    parts.push(`BYDAY=${codes.join(",")}`);
  }

  if (options.frequency === "MONTHLY") {
    if (options.monthly.mode === "dayOfMonth") {
      parts.push(`BYMONTHDAY=${options.monthly.day}`);
    } else {
      const ordinal = options.monthly.ordinal === -1 ? "-1" : String(options.monthly.ordinal);
      parts.push(`BYDAY=${ordinal}${DAY_CODES[options.monthly.weekday]!}`);
    }
  }

  if (options.frequency === "WEEKLY" && options.weekStart === "SU") {
    parts.push("WKST=SU");
  }

  const end = endSuffix(options.end, context);
  if (end) {
    parts.push(end.slice(1));
  }
  return parts.join(";");
}

function parseUntil(value: string, context: RepeatContext): string | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!stamp) {
    return null;
  }
  const [, year, month, day, hour, minute, second, zulu] = stamp;
  if (!zulu) {
    // Floating (or series-local) time: its own date is the end date.
    return `${year}-${month}-${day}`;
  }
  const instant = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (context.allDay) {
    return utcDateOf(instant);
  }
  return utcToLocalDate(instant, context.timezone);
}

/**
 * Read a stored rule into editor state. Returns `null` when the frequency
 * itself is outside the editor's vocabulary (e.g. `FREQ=HOURLY`); the caller
 * then keeps the stored rule verbatim instead of pretending it does not repeat.
 */
export function parseRepeatRule(
  rrule: string,
  startDate: string,
  context: RepeatContext,
): RepeatOptions | null {
  const raw = rrule?.trim();
  if (!raw) {
    return null;
  }

  const parts = new Map<string, string>();
  for (const chunk of raw.split(";")) {
    const separator = chunk.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    parts.set(chunk.slice(0, separator).trim().toUpperCase(), chunk.slice(separator + 1).trim());
  }

  const frequency = (parts.get("FREQ") ?? "").toUpperCase() as Frequency;
  if (!FREQUENCIES.includes(frequency)) {
    return null;
  }

  let advanced = false;
  for (const key of parts.keys()) {
    if (!KNOWN_PARTS.has(key)) {
      advanced = true;
    }
  }

  const rawInterval = parts.get("INTERVAL");
  let interval = rawInterval === undefined ? 1 : Number(rawInterval);
  if (!Number.isInteger(interval) || interval < 1) {
    interval = 1;
    advanced = true;
  }

  const rawWeekStart = (parts.get("WKST") ?? "MO").toUpperCase();
  const weekStart: "MO" | "SU" = rawWeekStart === "SU" ? "SU" : "MO";
  if (rawWeekStart !== "MO" && rawWeekStart !== "SU") {
    advanced = true;
  }

  const weekdays: number[] = [];
  const byDay = parts.get("BYDAY");
  if (frequency === "WEEKLY") {
    if (byDay) {
      for (const token of byDay.split(",")) {
        const day = DAY_CODES.indexOf(token.trim().toUpperCase() as (typeof DAY_CODES)[number]);
        if (day === -1) {
          advanced = true;
          continue;
        }
        weekdays.push(day);
      }
    }
    if (weekdays.length === 0) {
      weekdays.push(weekdayOfDate(startDate));
    }
  } else {
    weekdays.push(weekdayOfDate(startDate));
  }

  let monthly = monthlyAnchor(startDate);
  if (frequency === "MONTHLY") {
    const monthDay = parts.get("BYMONTHDAY");
    const ordinalDay = byDay ? /^(-?\d{1,2})([A-Z]{2})$/i.exec(byDay.trim()) : null;
    if (ordinalDay) {
      const ordinal = Number(ordinalDay[1]);
      const weekday = DAY_CODES.indexOf(ordinalDay[2]!.toUpperCase() as (typeof DAY_CODES)[number]);
      if (ordinal === -1 || (ordinal >= 1 && ordinal <= 5)) {
        if (weekday !== -1) {
          monthly = { mode: "weekday", ordinal: ordinal as 1 | 2 | 3 | 4 | 5 | -1, weekday };
        }
      } else {
        advanced = true;
      }
    } else if (byDay && parts.has("BYSETPOS")) {
      const ordinal = Number(parts.get("BYSETPOS"));
      const weekday = DAY_CODES.indexOf(byDay.trim().toUpperCase() as (typeof DAY_CODES)[number]);
      if ((ordinal === -1 || (ordinal >= 1 && ordinal <= 5)) && weekday !== -1) {
        monthly = { mode: "weekday", ordinal: ordinal as 1 | 2 | 3 | 4 | 5 | -1, weekday };
      } else {
        advanced = true;
      }
    } else if (monthDay) {
      const day = Number(monthDay);
      if (Number.isInteger(day) && day >= 1 && day <= MONTH_DAYS) {
        monthly = { mode: "dayOfMonth", day };
      } else {
        advanced = true;
      }
    } else if (byDay) {
      advanced = true;
    } else {
      // Plain `FREQ=MONTHLY` repeats on DTSTART's day of the month.
      monthly = { mode: "dayOfMonth", day: partsOf(startDate).day };
    }
  }

  let end: RepeatEnd = { mode: "never" };
  const count = parts.get("COUNT");
  const until = parts.get("UNTIL");
  if (count !== undefined) {
    const value = Number(count);
    if (Number.isInteger(value) && value >= 1) {
      end = { mode: "after", count: value };
    } else {
      advanced = true;
    }
    if (until !== undefined) {
      advanced = true;
    }
  } else if (until !== undefined) {
    const date = parseUntil(until, context);
    if (date) {
      end = { mode: "on", date };
    } else {
      advanced = true;
    }
  }

  return {
    frequency,
    interval,
    weekdays,
    monthly,
    weekStart,
    advanced,
    end,
  };
}

/** Google caps a single series at 730 occurrences; count ours the same way. */
function countThroughEnd(options: RepeatOptions, startDate: string, endDate: string): number {
  const rule = formatRepeatRule(
    { ...options, end: { mode: "never" }, weekStart: "MO" },
    startDate,
    { allDay: true, timezone: "UTC" },
  );
  let parsed;
  try {
    parsed = rrulestr(`DTSTART:${dateStamp(startDate)}T000000Z\nRRULE:${rule}`);
  } catch {
    return Number.POSITIVE_INFINITY;
  }

  const { year, month, day } = partsOf(startDate);
  let cursor = new Date(Date.UTC(year, month - 1, day) - 1);
  let count = 0;
  while (count <= 730) {
    const next = parsed.after(cursor, false);
    if (!next) {
      break;
    }
    if (utcDateOf(next.getTime()) > endDate) {
      break;
    }
    count += 1;
    cursor = next;
  }
  return count;
}

/** Inline error for the repeat controls; `null` means the rule is saveable. */
export function validateRepeat(
  options: RepeatOptions,
  startDate: string,
  context: RepeatContext,
): string | null {
  if (!Number.isInteger(options.interval) || options.interval < 1 || options.interval > 99) {
    return "Repeat every must be between 1 and 99.";
  }
  if (options.end.mode === "after" && (!Number.isInteger(options.end.count) || options.end.count < 1 || options.end.count > 730)) {
    return "Repeat after must be between 1 and 730 occurrences.";
  }
  if (options.frequency === "WEEKLY") {
    if (options.weekdays.length === 0) {
      return "Choose at least one day for the repeat.";
    }
    if (options.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      return "Choose at least one day for the repeat.";
    }
  }
  if (options.frequency === "MONTHLY") {
    if (options.monthly.mode === "dayOfMonth") {
      if (!Number.isInteger(options.monthly.day) || options.monthly.day < 1 || options.monthly.day > MONTH_DAYS) {
        return "Choose a day between 1 and 31.";
      }
    } else if (!Number.isInteger(options.monthly.weekday) || options.monthly.weekday < 0 || options.monthly.weekday > 6) {
      return "Choose a weekday for the repeat.";
    }
  }
  if (options.end.mode === "on") {
    if (options.end.date < startDate) {
      return "The repeat can't end before the event starts.";
    }
    if (countThroughEnd(options, startDate, options.end.date) > 730) {
      return "That repeat would create more than 730 occurrences. Choose an earlier end date.";
    }
  }
  return null;
}

/** The end date a freshly selected "On" mode should start from. */
export function defaultEndDate(startDate: string): string {
  return startDate;
}

/** Keep `value` within the control's bounds without throwing. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
