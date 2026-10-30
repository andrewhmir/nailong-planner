import { AppError } from "@/lib/errors";

const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const FORMATTER_OPTIONS = {
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
} as const;

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsAt(utcMs: number, timeZone: string): ZoneParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...FORMATTER_OPTIONS,
    timeZone,
  }).formatToParts(new Date(utcMs));
  const read = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of `timeZone` from UTC, in milliseconds, at the given instant. */
function offsetMsAt(utcMs: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = partsAt(utcMs, timeZone);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asIfUtc - utcMs;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Converts a UTC instant to `YYYY-MM-DDTHH:MM` in the given zone. */
export function utcToLocalWallTime(utcMs: number, timeZone: string): string {
  const { year, month, day, hour, minute } = partsAt(utcMs, timeZone);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** Converts a UTC instant to the calendar date (`YYYY-MM-DD`) in the given zone. */
export function utcToLocalDate(utcMs: number, timeZone: string): string {
  const { year, month, day } = partsAt(utcMs, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Converts a household wall-clock time (`YYYY-MM-DDTHH:MM`) to a UTC instant.
 * Throws a validation error for times that do not exist (DST spring-forward gap).
 */
export function localWallTimeToUtc(wallTime: string, timeZone: string): number {
  const match = WALL_TIME_PATTERN.exec(wallTime);
  if (!match) {
    throw new AppError("VALIDATION", "Times must look like YYYY-MM-DDTHH:MM.", 400, {
      time: "Use YYYY-MM-DDTHH:MM.",
    });
  }
  const [, year, month, day, hour, minute] = match;
  const naiveUtc = Date.UTC(
    Number(year ?? 0),
    Number(month ?? 1) - 1,
    Number(day ?? 1),
    Number(hour ?? 0),
    Number(minute ?? 0),
  );

  // Two passes converge for every real wall time; gaps and folds fall out of the
  // round-trip check below.
  let guess = naiveUtc - offsetMsAt(naiveUtc, timeZone);
  guess = naiveUtc - offsetMsAt(guess, timeZone);

  if (utcToLocalWallTime(guess, timeZone) !== wallTime) {
    throw new AppError(
      "VALIDATION",
      "That time does not exist in this timezone (daylight-saving gap).",
      400,
      { time: "Pick a time that exists on that date." },
    );
  }
  return guess;
}

/** Adds signed minutes to a `YYYY-MM-DDTHH:MM` wall stamp; malformed input is returned as-is. */
function addMinutesToWallTime(wallTime: string, minutes: number): string {
  const match = WALL_TIME_PATTERN.exec(wallTime);
  if (!match) {
    return wallTime;
  }
  const [, year, month, day, hour, minute] = match;
  const shifted = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute) + minutes),
  );
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/**
 * Like `localWallTimeToUtc`, but resolves a wall time that does not exist (a DST
 * spring-forward gap) by shifting it forward until it does: RFC 5545 §3.3.5
 * reads a non-existent 02:30 with the offset that applied before the gap, so it
 * lands at 03:30. Form input must keep `localWallTimeToUtc` so the user is told
 * to pick another time; recurrence expansion and the move/shift maths use this
 * one so a series operation cannot fail because one occurrence crosses the
 * transition.
 */
export function localWallTimeToUtcForward(wallTime: string, timeZone: string): number {
  if (!WALL_TIME_PATTERN.test(wallTime)) {
    return localWallTimeToUtc(wallTime, timeZone);
  }
  let failure: AppError | null = null;
  for (let shift = 0; shift < 3; shift += 1) {
    const candidate = shift === 0 ? wallTime : addMinutesToWallTime(wallTime, shift * 60);
    try {
      return localWallTimeToUtc(candidate, timeZone);
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      failure = error;
    }
  }
  throw failure ?? new AppError("VALIDATION", "That time does not exist in this timezone.", 400);
}

/** Validates an inclusive all-day range (`endDate` may equal `startDate`). */
export function toAllDayRange(
  startDate: string,
  endDate: string,
): { startDate: string; endDate: string } {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    throw new AppError("VALIDATION", "Dates must look like YYYY-MM-DD.", 400, {
      date: "Use YYYY-MM-DD.",
    });
  }
  if (endDate < startDate) {
    throw new AppError("VALIDATION", "The end date cannot be before the start date.", 400, {
      endDate: "Choose a later date.",
    });
  }
  return { startDate, endDate };
}

/** Adds whole days to a `YYYY-MM-DD` date without going through local time. */
export function addDaysToDate(date: string, days: number): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    throw new AppError("VALIDATION", "Dates must look like YYYY-MM-DD.", 400, {
      date: "Use YYYY-MM-DD.",
    });
  }
  const [, year, month, day] = match;
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
