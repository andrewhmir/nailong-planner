import { addDaysToDate, utcToLocalDate, utcToLocalWallTime } from "@/lib/time/zone";

/**
 * Default ranges for the quick-create bubble (spec D2/D3).
 *
 * GCal's rule set, kept deliberately small: a day click on today starts at the
 * next half hour, a day click on another day starts at 09:00, a week/day slot
 * click keeps the clicked quarter hour, and every bubble lasts 60 minutes.
 */

export interface QuickCreateRange {
  /** Wall clock start in the household timezone (`YYYY-MM-DDTHH:MM`). */
  startWall: string;
  /** Wall clock end in the household timezone (`YYYY-MM-DDTHH:MM`). */
  endWall: string;
  allDay: boolean;
}

const SNAP_MINUTES = 15;
const DURATION_MINUTES = 60;
const MORNING_START_MINUTES = 9 * 60;
const MINUTES_PER_DAY = 24 * 60;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesFromWall(time: string): number {
  const [hourText = "0", minuteText = "0"] = time.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function wallFromMinutes(dateWall: string, totalMinutes: number): string {
  let day = dateWall;
  let minutes = totalMinutes;
  while (minutes >= MINUTES_PER_DAY) {
    day = addDaysToDate(day, 1);
    minutes -= MINUTES_PER_DAY;
  }
  while (minutes < 0) {
    day = addDaysToDate(day, -1);
    minutes += MINUTES_PER_DAY;
  }
  return `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function rangeFromMinutes(
  dateWall: string,
  startMinutes: number,
  allDay: boolean,
): QuickCreateRange {
  return {
    startWall: wallFromMinutes(dateWall, startMinutes),
    endWall: wallFromMinutes(dateWall, startMinutes + DURATION_MINUTES),
    allDay,
  };
}

/**
 * `timeWall` is `HH:MM` for a week/day slot click (it is snapped down to the
 * quarter hour); null for a month day click.
 */
export function defaultRangeForDate(
  dateWall: string,
  timeWall: string | null,
  now: Date,
  timezone: string,
): QuickCreateRange {
  if (timeWall !== null) {
    const snapped = Math.floor(minutesFromWall(timeWall) / SNAP_MINUTES) * SNAP_MINUTES;
    return rangeFromMinutes(dateWall, snapped, false);
  }

  if (dateWall !== utcToLocalDate(now.getTime(), timezone)) {
    return rangeFromMinutes(dateWall, MORNING_START_MINUTES, false);
  }

  const nowWall = utcToLocalWallTime(now.getTime(), timezone);
  const nowMinutes = minutesFromWall(nowWall.slice(11));
  const nextHalfHour = Math.ceil(nowMinutes / 30) * 30;
  return rangeFromMinutes(dateWall, nextHalfHour, false);
}

/**
 * A dragged selection keeps its own bounds. All-day selections are handed over
 * as midnight-to-midnight in FullCalendar's exclusive-end convention.
 */
export function defaultRangeFromSelection(
  startMs: number,
  endMs: number,
  allDay: boolean,
  timezone: string,
): QuickCreateRange {
  return {
    startWall: utcToLocalWallTime(startMs, timezone),
    endWall: utcToLocalWallTime(endMs, timezone),
    allDay,
  };
}
