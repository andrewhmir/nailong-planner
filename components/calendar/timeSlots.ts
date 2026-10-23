import type { TimeFormat } from "@/lib/services/preferences";

/**
 * Pure rules behind the event dialog's time control: the quick-pick slot grid,
 * the canonical `HH:MM` string form, and the parser for the "type a time" field.
 * Kept outside the component so the 12/24-hour matrix is unit-tested without
 * rendering.
 */

/** Minutes between quick-pick rows. */
export const SLOT_MINUTES = 15;

export type Meridiem = "am" | "pm";

const MINUTES_IN_DAY = 24 * 60;
const HHMM = /^(\d{1,2}):(\d{2})$/;
const TYPED = /^(\d{1,2})(?::(\d{1,2}))?(?:\s*([ap])(?:\.?m\.?)?)?$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function stepOf(stepMinutes: number): number {
  return Number.isFinite(stepMinutes) && stepMinutes >= 1 ? Math.round(stepMinutes) : SLOT_MINUTES;
}

/** `"08:30"` → 510; an unparseable or out-of-range value → null. */
export function minutesOfDay(time: string): number | null {
  const match = HHMM.exec(time.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/** 510 → `"08:30"`; a value outside the day wraps rather than throwing. */
export function formatMinutes(total: number): string {
  const wrapped = ((Math.round(total) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** Every quick-pick row of a day: 96 rows at the default 15-minute step. */
export function timeSlots(stepMinutes: number = SLOT_MINUTES): string[] {
  const step = stepOf(stepMinutes);
  const slots: string[] = [];
  for (let minutes = 0; minutes < MINUTES_IN_DAY; minutes += step) {
    slots.push(formatMinutes(minutes));
  }
  return slots;
}

/**
 * The row the list should focus for an off-grid value such as 08:37, so opening
 * the picker never jumps to midnight.
 */
export function nearestSlotIndex(time: string, stepMinutes: number = SLOT_MINUTES): number {
  const step = stepOf(stepMinutes);
  const count = Math.ceil(MINUTES_IN_DAY / step);
  const minutes = minutesOfDay(time);
  if (minutes === null) {
    return 0;
  }
  return Math.max(0, Math.min(count - 1, Math.round(minutes / step)));
}

/** Which half of the day a canonical `HH:MM` falls in; null when unparseable. */
export function meridiemOf(time: string): Meridiem | null {
  const minutes = minutesOfDay(time);
  if (minutes === null) {
    return null;
  }
  return minutes < MINUTES_IN_DAY / 2 ? "am" : "pm";
}

/**
 * Parses what the user typed into the canonical `HH:MM` the form stores.
 * Accepts `8`, `8:37`, `08:37` and, in 12-hour mode, an `am`/`pm` (or
 * `a.m.`/`p.m.`) suffix. A 12-hour value without a suffix inherits
 * `meridiemFallback`, which the caller passes from the current selection.
 * Returns null for anything it cannot read; the field then shows its hint.
 */
export function parseTypedTime(
  input: string,
  format: TimeFormat,
  meridiemFallback: Meridiem = "am",
): string | null {
  const match = TYPED.exec(input.trim().toLowerCase());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem: Meridiem | null =
    match[3] === "a" ? "am" : match[3] === "p" ? "pm" : null;
  if (minutes > 59) {
    return null;
  }
  if (format === "24h") {
    // "20:37" is fine; "8:37 PM" is not a 24-hour reading, so reject the suffix
    // instead of guessing which of the two the user meant.
    if (meridiem !== null || hours > 23) {
      return null;
    }
    return formatMinutes(hours * 60 + minutes);
  }
  if (hours < 1 || hours > 12) {
    return null;
  }
  const resolved = meridiem ?? meridiemFallback;
  const base = hours === 12 ? 0 : hours;
  return formatMinutes(base * 60 + minutes + (resolved === "pm" ? MINUTES_IN_DAY / 2 : 0));
}
