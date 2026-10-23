/**
 * Human summary of an RFC 5545 repeat rule (`spec D9`). FullCalendar's rrule
 * plugin stores whatever Google-style rule the user picked, so the details card
 * translates the common shapes and stays silent for anything it does not know
 * — it must never throw.
 */

import { formatWallDate } from "@/lib/time/format";
import { utcToLocalDate } from "@/lib/time/zone";

export interface DescribeRruleContext {
  /** Household zone, used to turn a timed rule's UTC UNTIL into a local date. */
  timezone?: string;
  /** All-day rules carry a DATE-only UNTIL with no timezone. */
  allDay?: boolean;
}

const FREQUENCY_NOUN: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

const FREQUENCY_UNIT: Record<string, string> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
  YEARLY: "years",
};

const WEEKDAY_NAMES: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

const ORDINALS: Record<string, string> = {
  "1": "first",
  "2": "second",
  "3": "third",
  "4": "fourth",
  "5": "fifth",
};

function parseRule(rrule: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const chunk of rrule.split(";")) {
    const separator = chunk.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    parts.set(chunk.slice(0, separator).trim().toUpperCase(), chunk.slice(separator + 1).trim());
  }
  return parts;
}

function joinList(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** 1 → "1st", 22 → "22nd"; used for a BYMONTHDAY monthly rule. */
function ordinalOf(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** A rule's UNTIL value as the local date the series ends; null when unreadable. */
function untilDate(value: string, context: DescribeRruleContext): string | null {
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
    const date = new Date(instant);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
      date.getUTCDate(),
    ).padStart(2, "0")}`;
  }
  return utcToLocalDate(instant, context.timezone ?? "UTC");
}

/** "1MO" → "first Monday"; "-1FR" → "last Friday". Null when not a month-weekday. */
function describeOrdinalWeekday(value: string): string | null {
  const match = /^(-?\d)?([A-Z]{2})$/.exec(value.trim().toUpperCase());
  if (!match) {
    return null;
  }
  const day = WEEKDAY_NAMES[match[2] ?? ""];
  if (!day) {
    return null;
  }
  const ordinal = match[1];
  if (!ordinal) {
    return null;
  }
  const named = ordinal === "-1" ? "last" : ORDINALS[ordinal];
  return named ? `${named} ${day}` : null;
}

export function describeRrule(rrule: string, context: DescribeRruleContext = {}): string {
  if (!rrule) {
    return "";
  }
  const parts = parseRule(rrule);
  const frequency = parts.get("FREQ") ?? "";
  if (!FREQUENCY_NOUN[frequency]) {
    return "";
  }

  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1) {
    return "";
  }

  let text =
    interval === 1
      ? (FREQUENCY_NOUN[frequency] ?? "")
      : `Every ${interval} ${FREQUENCY_UNIT[frequency] ?? ""}`;

  const byday = parts.get("BYDAY");
  const bymonthday = parts.get("BYMONTHDAY");
  if (byday) {
    const values = byday.split(",").map((value) => value.trim());
    if (frequency === "MONTHLY") {
      const described = values.map(describeOrdinalWeekday);
      if (described.every((value): value is string => value !== null)) {
        text += ` on the ${joinList(described)}`;
      }
    } else if (frequency === "WEEKLY") {
      const names = values.map((value) => WEEKDAY_NAMES[value.toUpperCase()] ?? null);
      if (names.every((value): value is string => value !== null)) {
        text += ` on ${joinList(names)}`;
      }
    }
  } else if (frequency === "MONTHLY" && bymonthday) {
    const day = Number(bymonthday);
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      text += ` on the ${ordinalOf(day)}`;
    }
  }

  if (parts.has("COUNT")) {
    const count = Number(parts.get("COUNT"));
    if (Number.isInteger(count) && count >= 1) {
      text += `, ${count} ${count === 1 ? "time" : "times"}`;
    }
  } else if (parts.has("UNTIL")) {
    let end: string | null = null;
    try {
      end = untilDate(parts.get("UNTIL") ?? "", context);
    } catch {
      end = null;
    }
    if (end) {
      text += `, until ${formatWallDate(end)}`;
    }
  }

  return text;
}
