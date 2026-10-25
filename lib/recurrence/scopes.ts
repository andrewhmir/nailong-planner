import type { EventRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { expandOccurrences } from "@/lib/recurrence/expand";
import {
  anchorRepeat,
  formatRepeatRule,
  parseRepeatRule,
  type RepeatContext,
  type RepeatOptions,
} from "@/lib/recurrence/rule";
import { addDaysToDate, localWallTimeToUtc, utcToLocalDate, utcToLocalWallTime } from "@/lib/time/zone";

/**
 * Pure maths for per-instance recurrence scopes: the “All events” shift, the
 * “This and following” truncation/continuation of RRULE text, and the
 * occurrence-key shifts used when a series or an exception moves. The SQL side
 * lives in `lib/services/events.ts`; everything here is deterministic and
 * unit-tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const FLOATING_WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface ShiftDelta {
  /** Calendar-day offset for all-day values. */
  deltaDays: number;
  /** Instant offset for timed values (informational; expansion is wall-based). */
  deltaMs: number;
  /** Wall-clock minute offset for timed values, so DST transitions keep the clock. */
  deltaMinutes: number;
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

function dayMinutes(wall: string): number {
  const [hour = 0, minute = 0] = wall.slice(11).split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * Shifts a `YYYY-MM-DDTHH:MM` wall stamp by calendar days and clock minutes,
 * wrapping the clock into the calendar when it crosses midnight. This is the
 * DST-safe coordinate system: moving “09:00 Tuesday to 09:00 Monday” must stay
 * 09:00 in the series zone even when the instants are 23/25 hours apart.
 */
function shiftWall(wall: string, deltaDays: number, deltaMinutes: number): string {
  const date = wall.slice(0, 10);
  const total = dayMinutes(wall) + deltaMinutes;
  const extraDays = Math.floor(total / (24 * 60));
  const minutes = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${addDaysToDate(date, deltaDays + extraDays)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
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

function daysInclusive(startDate: string | null, endDate: string | null): number {
  if (!startDate) {
    return 1;
  }
  const start = utcMidnight(startDate.slice(0, 10));
  const end = utcMidnight((endDate ?? startDate).slice(0, 10));
  return Math.max(1, Math.round((end - start) / DAY_MS) + 1);
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
export function shiftOccurrenceKey(key: string, delta: ShiftDelta, zone: string): string {
  if (DATE_KEY.test(key)) {
    return addDaysToDate(key, delta.deltaDays);
  }
  const instant = Date.parse(key);
  if (!Number.isFinite(instant)) {
    return key;
  }
  const wall = shiftWall(utcToLocalWallTime(instant, zone), delta.deltaDays, delta.deltaMinutes);
  return new Date(localWallTimeToUtc(wall, zone)).toISOString();
}

/**
 * Shifts the stored EXDATE JSON. All-day series match dates; timed series match
 * instants and are shifted in the series zone's wall clock so a DST transition
 * does not move a skipped occurrence an hour. Values the expander would also
 * ignore (floating walls and junk) are left untouched rather than dropped.
 */
export function shiftExdates(
  raw: string | null,
  allDay: boolean,
  delta: ShiftDelta,
  zone: string,
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
    if (!Number.isFinite(instant)) {
      return entry;
    }
    const wall = shiftWall(utcToLocalWallTime(instant, zone), delta.deltaDays, delta.deltaMinutes);
    return new Date(localWallTimeToUtc(wall, zone)).toISOString();
  });
  return JSON.stringify(shifted);
}

function sameRepeatOptions(left: RepeatOptions, right: RepeatOptions): boolean {
  const sorted = (days: number[]) => [...days].sort((a, b) => a - b).join(",");
  const sameEnd =
    left.end.mode === right.end.mode &&
    (left.end.mode !== "on" || right.end.mode !== "on" || left.end.date === right.end.date) &&
    (left.end.mode !== "after" || right.end.mode !== "after" || left.end.count === right.end.count);
  return (
    left.frequency === right.frequency &&
    left.interval === right.interval &&
    left.weekStart === right.weekStart &&
    sorted(left.weekdays) === sorted(right.weekdays) &&
    left.monthly.mode === right.monthly.mode &&
    sameEnd
  );
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

/**
 * True when the editor's structured model can reproduce this rule, so shifting
 * it cannot silently drop a part. A known-but-unmodelled shape (e.g.
 * `FREQ=DAILY;BYDAY=MO,WE` or `FREQ=WEEKLY;BYMONTHDAY=1,15`) is refused instead
 * of being rewritten to something the user never asked for.
 */
export function isShiftableRule(rule: string, startDate: string, context: RepeatContext): boolean {
  const parsed = parseRepeatRule(rule, startDate, context);
  if (!parsed || parsed.advanced) {
    return false;
  }
  const keys = new Set(parseRuleParts(rule).map((part) => part.key));
  if (
    (parsed.frequency === "DAILY" || parsed.frequency === "YEARLY") &&
    (keys.has("BYDAY") || keys.has("BYMONTHDAY") || keys.has("BYSETPOS"))
  ) {
    return false;
  }
  if (parsed.frequency === "WEEKLY" && (keys.has("BYMONTHDAY") || keys.has("BYSETPOS"))) {
    return false;
  }
  if (parsed.frequency === "MONTHLY" && keys.has("BYMONTHDAY") && keys.has("BYDAY")) {
    return false;
  }
  if (parsed.frequency === "MONTHLY" && keys.has("BYSETPOS") && !keys.has("BYDAY")) {
    return false;
  }
  const canonical = formatRepeatRule(parsed, startDate, context);
  const reparsed = parseRepeatRule(canonical, startDate, context);
  if (!reparsed) {
    return false;
  }
  return sameRepeatOptions(parsed, reparsed);
}

/**
 * Shifts an RRULE's date pattern by a day offset: weekly weekdays move with the
 * event, a monthly pattern re-anchors on the new start date, daily/yearly keep
 * their shape, and `UNTIL` moves with the series. Returns `null` when the rule
 * cannot be represented safely — the caller must refuse a whole-series move
 * rather than rewrite the rule.
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
  if (!isShiftableRule(rule, oldStartDate, context)) {
    return null;
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
 * occurrence: series start/end, rule pattern, UNTIL, EXDATEs. Timed series are
 * shifted in wall-clock coordinates so a DST transition cannot change the
 * clock; a resize also carries the duration delta onto the series end.
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
    ? utcToLocalWallTime(occurrenceInstant, zone).slice(0, 10)
    : occurrenceStart.slice(0, 10);
  const oldOccurrenceWall = timed ? utcToLocalWallTime(occurrenceInstant, zone) : occurrenceStart;
  const newOccurrenceWall =
    move.startAt !== null
      ? utcToLocalWallTime(move.startAt, zone)
      : move.startDate !== null
        ? `${move.startDate}T${oldOccurrenceWall.slice(11)}`
        : oldOccurrenceWall;
  const newOccurrenceDate = newOccurrenceWall.slice(0, 10);
  const deltaDays = dateDiffDays(oldOccurrenceDate, newOccurrenceDate);
  const deltaMinutes = timed ? dayMinutes(newOccurrenceWall) - dayMinutes(oldOccurrenceWall) : 0;
  const deltaMs = timed ? (move.startAt ?? occurrenceInstant) - occurrenceInstant : 0;
  const delta: ShiftDelta = { deltaDays, deltaMs, deltaMinutes };

  const context: RepeatContext = { allDay: !timed, timezone: zone };
  const patch: Partial<EventRow> = {
    updatedAt: Date.now(),
    exdates: shiftExdates(row.exdates, !timed, delta, zone),
  };

  if (timed) {
    if (row.startAt === null || row.endAt === null) {
      throw seriesMoveError("That series does not have a start to move.");
    }
    const oldDuration = row.endAt - row.startAt;
    const newDuration =
      move.startAt !== null && move.endAt !== null ? move.endAt - move.startAt : oldDuration;
    const durationDeltaMinutes = Math.round((newDuration - oldDuration) / MINUTE_MS);
    const startWall = utcToLocalWallTime(row.startAt, zone);
    const endWall = utcToLocalWallTime(row.endAt, zone);
    patch.startAt = localWallTimeToUtc(
      shiftWall(startWall, deltaDays, deltaMinutes),
      zone,
    );
    patch.endAt = localWallTimeToUtc(
      shiftWall(endWall, deltaDays, deltaMinutes + durationDeltaMinutes),
      zone,
    );
  } else {
    if (!row.startDate) {
      throw seriesMoveError("That series does not have a start to move.");
    }
    const seriesDays = daysInclusive(row.startDate, row.endDate);
    const oldOccurrenceEndDate = addDaysToDate(oldOccurrenceDate, seriesDays - 1);
    const newOccurrenceEndDate = move.endDate
      ? move.endDate.slice(0, 10)
      : addDaysToDate(newOccurrenceDate, seriesDays - 1);
    patch.startDate = addDaysToDate(row.startDate, deltaDays);
    patch.endDate = addDaysToDate(row.endDate ?? row.startDate, dateDiffDays(oldOccurrenceEndDate, newOccurrenceEndDate));
  }

  if (row.rrule) {
    const newSeriesStartDate = timed
      ? utcToLocalDate(patch.startAt ?? row.startAt ?? Date.now(), zone)
      : patch.startDate ?? oldStartDate;
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

/** Rewrites the rule so the series ends just before `splitStart`. */
export function truncateRuleBefore(
  rule: string,
  splitStart: string,
  beforeCount: number,
  zone: string,
  timed: boolean,
): string {
  const parts = parseRuleParts(rule);
  const count = parts.find((part) => part.key === "COUNT")?.value ?? null;
  const setPart = (key: string, value: string): string => {
    let found = false;
    const next = parts.map((part) => {
      if (part.key !== key) {
        return part;
      }
      found = true;
      return { key, value };
    });
    return [...(found ? next : [...parts, { key, value }])]
      .map((part) => `${part.key}=${part.value}`)
      .join(";");
  };

  if (count !== null) {
    return setPart("COUNT", String(beforeCount));
  }

  if (!timed) {
    return setPart("UNTIL", dateStamp(addDaysToDate(splitStart.slice(0, 10), -1)));
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
  return setPart("UNTIL", utcStamp(localWallTimeToUtc(wallMinute, zone) + 59_000));
}

/** The later segment's rule when the repeat was not edited. */
export function continueRule(rule: string, beforeCount: number): string {
  const parts = parseRuleParts(rule);
  const count = parts.find((part) => part.key === "COUNT")?.value ?? null;
  if (count === null) {
    return rule;
  }
  const remaining = Number(count) - beforeCount;
  if (!Number.isInteger(remaining) || remaining < 1) {
    throw new AppError("VALIDATION", "That occurrence is not part of this series.", 400, {
      occurrenceStart: "Choose an earlier occurrence.",
    });
  }
  return parts
    .map((part) => (part.key === "COUNT" ? { key: "COUNT", value: String(remaining) } : part))
    .map((part) => `${part.key}=${part.value}`)
    .join(";");
}

function expansionWindow(row: EventRow, occurrenceStart: string): { from: number; to: number } {
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
  return { from: seriesStart, to: split + DAY_MS };
}

/**
 * Counts the occurrences *rendered* before `occurrenceStart` (EXDATEs removed)
 * and validates that the key is a live occurrence. Used by “This event”.
 */
export function countOccurrencesBefore(row: EventRow, occurrenceStart: string, zone: string): number {
  const occurrences = expandOccurrences(row, expansionWindow(row, occurrenceStart), zone);
  const match = occurrences.some((occurrence) => occurrence.startKey === occurrenceStart);
  if (!row.rrule || !match) {
    throw new AppError("VALIDATION", "That occurrence is not part of this series.", 400, {
      occurrenceStart: "Choose a real occurrence.",
    });
  }
  return occurrences.filter((occurrence) => occurrence.startKey < occurrenceStart).length;
}

/**
 * The occurrence's index in the RRULE sequence, ignoring EXDATEs. `COUNT` and a
 * split's truncation are defined on the sequence, not on what happens to be
 * rendered: skipping Oct 2 from a daily `COUNT=10` series must still split
 * “before the 4th occurrence”, not the 3rd.
 */
export function rulePositionBefore(row: EventRow, occurrenceStart: string, zone: string): number {
  if (!row.rrule) {
    throw new AppError("VALIDATION", "That event does not repeat.", 400, {
      occurrenceStart: "Choose a repeating event.",
    });
  }
  assertOccurrenceOf(row, occurrenceStart, zone);
  const withoutExdates: EventRow = { ...row, exdates: null };
  const occurrences = expandOccurrences(withoutExdates, expansionWindow(row, occurrenceStart), zone);
  return occurrences.filter((occurrence) => occurrence.startKey < occurrenceStart).length;
}

export function assertOccurrenceOf(row: EventRow, occurrenceStart: string, zone: string): void {
  countOccurrencesBefore(row, occurrenceStart, zone);
}

/** Shifts one exception row's timing (following-move re-link, all-move, undo). */
export function shiftEventTiming(row: EventRow, delta: ShiftDelta, zone: string): Partial<EventRow> {
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
  const startWall = utcToLocalWallTime(row.startAt, zone);
  const endWall = utcToLocalWallTime(row.endAt ?? row.startAt, zone);
  return {
    startAt: localWallTimeToUtc(shiftWall(startWall, delta.deltaDays, delta.deltaMinutes), zone),
    endAt: localWallTimeToUtc(shiftWall(endWall, delta.deltaDays, delta.deltaMinutes), zone),
    updatedAt: Date.now(),
  };
}
