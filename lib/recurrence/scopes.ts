import type { EventRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { expandOccurrences } from "@/lib/recurrence/expand";
import {
  anchorRepeat,
  formatRepeatRule,
  parseRepeatRule,
  type RepeatContext,
} from "@/lib/recurrence/rule";
import { addDaysToDate, localWallTimeToUtc, utcToLocalDate, utcToLocalWallTime } from "@/lib/time/zone";

/**
 * Pure maths for per-instance recurrence scopes: the “All events” shift, the
 * “This and following” truncation/continuation of RRULE text, and the
 * occurrence-key shifts used when a series moves. The SQL side lives in
 * `lib/services/events.ts`; everything here is deterministic and unit-tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const FLOATING_WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface ShiftDelta {
  /** Calendar-day offset for all-day keys and date fields. */
  deltaDays: number;
  /** Instant offset for timed keys and timestamp fields. */
  deltaMs: number;
}

export interface SeriesMove {
  allDay: boolean;
  startAt: number | null;
  endAt: number | null;
  startDate: string | null;
  endDate: string | null;
}

const VALIDATION_FIELDS = (field: string, message: string) => ({ [field]: message });

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function utcMidnight(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function utcStamp(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function dateStamp(date: string): string {
  return date.replace(/-/g, "");
}

function modDay(day: number): number {
  return ((day % 7) + 7) % 7;
}

function timedOccurrenceInstant(occurrenceStart: string): number {
  const instant = Date.parse(occurrenceStart);
  if (!Number.isFinite(instant)) {
    throw new AppError("VALIDATION", "That occurrence is not part of this series.", 400, {
      occurrenceStart: "Choose a real occurrence.",
    });
  }
  return instant;
}

/** The start date the recurrence rule is anchored on, in the series' zone. */
export function localDateOfEvent(row: EventRow, zone: string): string {
  if (row.allDay === 1) {
    return row.startDate ?? "";
  }
  return row.startAt === null ? "" : utcToLocalDate(row.startAt, zone);
}

export function dateDiffDays(fromDate: string, toDate: string): number {
  return Math.round((utcMidnight(toDate) - utcMidnight(fromDate)) / DAY_MS);
}

/** Shifts one occurrence key: a local date for all-day, an ISO instant for timed. */
export function shiftOccurrenceKey(key: string, delta: ShiftDelta): string {
  if (DATE_KEY.test(key)) {
    return addDaysToDate(key, delta.deltaDays);
  }
  const instant = Date.parse(key);
  return Number.isFinite(instant) ? new Date(instant + delta.deltaMs).toISOString() : key;
}

/**
 * Shifts the stored EXDATE JSON. All-day series match dates; timed series match
 * instants. Values the expander would also ignore (floating walls and junk) are
 * left untouched rather than dropped, so a corrupt entry stays repairable.
 */
export function shiftExdates(
  raw: string | null,
  allDay: boolean,
  delta: ShiftDelta,
): string | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const shifted = parsed.map((entry) => {
    if (typeof entry !== "string") {
      return entry;
    }
    if (allDay) {
      return DATE_KEY.test(entry) ? addDaysToDate(entry, delta.deltaDays) : entry;
    }
    if (FLOATING_WALL.test(entry)) {
      return entry;
    }
    const instant = Date.parse(entry);
    return Number.isFinite(instant) ? new Date(instant + delta.deltaMs).toISOString() : entry;
  });
  return JSON.stringify(shifted);
}

/**
 * Shifts an RRULE's date pattern by a day offset: weekly weekdays move with the
 * event, a monthly pattern re-anchors on the new start date, daily/yearly keep
 * their shape, and `UNTIL` moves with the series. Returns `null` when the rule
 * is unparseable or carries parts the editor does not model — the caller must
 * then refuse a whole-series move rather than rewrite the rule.
 */
export function shiftRepeatRule(
  rule: string,
  oldStartDate: string,
  newStartDate: string,
  context: RepeatContext,
): string | null {
  const parsed = parseRepeatRule(rule, oldStartDate, context);
  if (!parsed || parsed.advanced) {
    return null;
  }
  const deltaDays = dateDiffDays(oldStartDate, newStartDate);
  if (deltaDays === 0) {
    return rule;
  }

  let options = parsed;
  if (options.frequency === "WEEKLY") {
    options = { ...options, weekdays: options.weekdays.map((day) => modDay(day + deltaDays)) };
  } else if (options.frequency === "MONTHLY") {
    options = anchorRepeat(options, newStartDate);
  }
  if (options.end.mode === "on") {
    options = { ...options, end: { mode: "on", date: addDaysToDate(options.end.date, deltaDays) } };
  }
  return formatRepeatRule(options, newStartDate, context);
}

function seriesMoveError(message: string): AppError {
  return new AppError("VALIDATION", message, 400, VALIDATION_FIELDS("rrule", message));
}

/**
 * The patch that moves a whole series by the same offset as one dragged
 * occurrence (series start/end, rule pattern, UNTIL, EXDATEs).
 */
export function shiftSeriesTiming(
  row: EventRow,
  occurrenceStart: string,
  move: SeriesMove,
  zone: string,
): { patch: Partial<EventRow>; delta: ShiftDelta } {
  const timed = row.allDay !== 1;
  if (move.allDay !== !timed) {
    throw seriesMoveError(
      "A repeating event can't switch between all-day and timed in one move. Edit the series instead.",
    );
  }

  const oldStartDate = localDateOfEvent(row, zone);
  const occurrenceInstant = timed ? timedOccurrenceInstant(occurrenceStart) : 0;
  const oldOccurrenceDate = timed
    ? utcToLocalDate(occurrenceInstant, zone)
    : occurrenceStart.slice(0, 10);
  const deltaMs = timed ? (move.startAt === null ? 0 : move.startAt - occurrenceInstant) : 0;
  const newOccurrenceDate = timed
    ? move.startAt === null
      ? oldOccurrenceDate
      : utcToLocalDate(move.startAt, zone)
    : (move.startDate ?? oldOccurrenceDate);
  const deltaDays = dateDiffDays(oldOccurrenceDate, newOccurrenceDate);
  const delta: ShiftDelta = { deltaDays, deltaMs };

  const context: RepeatContext = { allDay: !timed, timezone: zone };
  const patch: Partial<EventRow> = {
    updatedAt: Date.now(),
    exdates: shiftExdates(row.exdates, !timed, delta),
  };

  if (timed) {
    if (row.startAt === null || row.endAt === null) {
      throw seriesMoveError("That series does not have a start to move.");
    }
    patch.startAt = row.startAt + deltaMs;
    patch.endAt = row.endAt + deltaMs;
  } else {
    if (!row.startDate) {
      throw seriesMoveError("That series does not have a start to move.");
    }
    patch.startDate = addDaysToDate(row.startDate, deltaDays);
    patch.endDate = addDaysToDate(row.endDate ?? row.startDate, deltaDays);
  }

  if (row.rrule) {
    // The rule shifts by the occurrence delta, so the series start moves by the
    // same number of days the dragged occurrence did — never to the new date.
    const newSeriesStartDate = timed
      ? utcToLocalDate((row.startAt ?? 0) + deltaMs, zone)
      : addDaysToDate(row.startDate ?? oldStartDate, deltaDays);
    const shifted = shiftRepeatRule(row.rrule, oldStartDate, newSeriesStartDate, context);
    if (!shifted) {
      throw seriesMoveError(
        "This series uses a custom repeat rule that the app can't shift. Choose “This event” or edit the series instead.",
      );
    }
    patch.rrule = shifted;
  }

  return { patch, delta };
}

interface RulePart {
  key: string;
  value: string;
}

function parseRuleParts(rule: string): RulePart[] {
  const parts: RulePart[] = [];
  for (const chunk of rule.split(";")) {
    const separator = chunk.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    parts.push({ key: chunk.slice(0, separator).trim().toUpperCase(), value: chunk.slice(separator + 1).trim() });
  }
  return parts;
}

function serializeRuleParts(parts: RulePart[]): string {
  return parts.map((part) => `${part.key}=${part.value}`).join(";");
}

function setRulePart(parts: RulePart[], key: string, value: string): RulePart[] {
  const index = parts.findIndex((part) => part.key === key);
  if (index === -1) {
    return [...parts, { key, value }];
  }
  return parts.map((part, position) => (position === index ? { key, value } : part));
}

function rulePartValue(parts: RulePart[], key: string): string | null {
  return parts.find((part) => part.key === key)?.value ?? null;
}

/**
 * Rewrites the rule so the series ends just before `splitStart`: an existing
 * `COUNT` becomes the number of occurrences kept, otherwise (or additionally
 * when no COUNT exists) a synthetic `UNTIL` is written. Unknown parts are kept
 * verbatim so an advanced rule survives a split.
 */
export function truncateRuleBefore(
  rule: string,
  splitStart: string,
  beforeCount: number,
  zone: string,
  timed: boolean,
): string {
  const parts = parseRuleParts(rule);
  const count = rulePartValue(parts, "COUNT");
  if (count !== null) {
    return serializeRuleParts(setRulePart(parts, "COUNT", String(beforeCount)));
  }

  if (!timed) {
    const lastDate = addDaysToDate(splitStart.slice(0, 10), -1);
    return serializeRuleParts(setRulePart(parts, "UNTIL", dateStamp(lastDate)));
  }

  // One second before the split's wall time, expressed the way the expander
  // reads a `…Z` UNTIL: as the UTC instant whose wall time in the series zone
  // is one second earlier.
  const splitWall = utcToLocalWallTime(timedOccurrenceInstant(splitStart), zone);
  const wallMs = Date.UTC(
    Number(splitWall.slice(0, 4)),
    Number(splitWall.slice(5, 7)) - 1,
    Number(splitWall.slice(8, 10)),
    Number(splitWall.slice(11, 13)),
    Number(splitWall.slice(14, 16)),
  );
  const previousMinute = new Date(wallMs - MINUTE_MS);
  const wallMinute =
    `${previousMinute.getUTCFullYear()}-${pad(previousMinute.getUTCMonth() + 1)}-${pad(previousMinute.getUTCDate())}` +
    `T${pad(previousMinute.getUTCHours())}:${pad(previousMinute.getUTCMinutes())}`;
  const until = utcStamp(localWallTimeToUtc(wallMinute, zone) + 59_000);
  return serializeRuleParts(setRulePart(parts, "UNTIL", until));
}

/**
 * The later segment's rule when the repeat itself was not edited: a `COUNT`
 * series keeps only its remaining occurrences, an `UNTIL`/`Never` rule is
 * copied as-is (its DTSTART moves to the split occurrence).
 */
export function continueRule(rule: string, beforeCount: number): string {
  const parts = parseRuleParts(rule);
  const count = rulePartValue(parts, "COUNT");
  if (count === null) {
    return rule;
  }
  const remaining = Number(count) - beforeCount;
  if (!Number.isInteger(remaining) || remaining < 1) {
    throw new AppError("VALIDATION", "That occurrence is not part of this series.", 400, {
      occurrenceStart: "Choose an earlier occurrence.",
    });
  }
  return serializeRuleParts(setRulePart(parts, "COUNT", String(remaining)));
}

function expansionWindow(row: EventRow, occurrenceStart: string, zone: string): { from: number; to: number } {
  const timed = row.allDay !== 1;
  const seriesStart = timed
    ? (row.startAt ?? 0)
    : utcMidnight(row.startDate ?? occurrenceStart.slice(0, 10));
  const split = timed ? timedOccurrenceInstant(occurrenceStart) : utcMidnight(occurrenceStart.slice(0, 10));
  if (split < seriesStart) {
    throw new AppError("VALIDATION", "That occurrence is not part of this series.", 400, {
      occurrenceStart: "Choose an occurrence after the series start.",
    });
  }
  void zone;
  return { from: seriesStart, to: split + DAY_MS };
}

/**
 * Counts the occurrences strictly before `occurrenceStart`, and validates that
 * the key is a real occurrence of the series (not an EXDATE, not a gap).
 */
export function countOccurrencesBefore(row: EventRow, occurrenceStart: string, zone: string): number {
  if (!row.rrule) {
    throw new AppError("VALIDATION", "That event does not repeat.", 400, {
      occurrenceStart: "Choose a repeating event.",
    });
  }
  const occurrences = expandOccurrences(row, expansionWindow(row, occurrenceStart, zone), zone);
  const match = occurrences.some((occurrence) => occurrence.startKey === occurrenceStart);
  if (!match) {
    throw new AppError("VALIDATION", "That occurrence is not part of this series.", 400, {
      occurrenceStart: "Choose a real occurrence.",
    });
  }
  return occurrences.filter((occurrence) => occurrence.startKey < occurrenceStart).length;
}

export function assertOccurrenceOf(row: EventRow, occurrenceStart: string, zone: string): void {
  countOccurrencesBefore(row, occurrenceStart, zone);
}

/** Shifts one exception row's timing (used when following-move re-links it). */
export function shiftEventTiming(row: EventRow, delta: ShiftDelta): Partial<EventRow> {
  if (row.allDay === 1) {
    if (!row.startDate) {
      throw new AppError("VALIDATION", "That event does not have a date.", 400);
    }
    return {
      startDate: addDaysToDate(row.startDate, delta.deltaDays),
      endDate: addDaysToDate(row.endDate ?? row.startDate, delta.deltaDays),
      updatedAt: Date.now(),
    };
  }
  if (row.startAt === null) {
    throw new AppError("VALIDATION", "That event does not have a start time.", 400);
  }
  return {
    startAt: row.startAt + delta.deltaMs,
    endAt: (row.endAt ?? row.startAt) + delta.deltaMs,
    updatedAt: Date.now(),
  };
}
