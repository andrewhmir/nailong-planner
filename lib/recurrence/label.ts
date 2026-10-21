/**
 * Human summary of an RFC 5545 repeat rule (`spec D9`). FullCalendar's rrule
 * plugin stores whatever Google-style rule the user picked, so the details card
 * translates the common shapes and stays silent for anything it does not know
 * — it must never throw.
 */

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

export function describeRrule(rrule: string): string {
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
  }

  return text;
}
