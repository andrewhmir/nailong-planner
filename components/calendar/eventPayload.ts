import type { EventInputPayload } from "@/lib/query/events";
import { localWallTimeToUtc } from "@/lib/time/zone";

/**
 * Form-to-payload conversion for the event dialog. Kept pure and outside the
 * component so the rule-preservation contract (review focus 4) is unit-tested:
 * a rule the user did not touch must reach the server byte-identical.
 */

export type RepeatRule = "none" | "daily" | "weekly" | "monthly" | "yearly";

export const REPEAT_OPTIONS: Array<{ value: RepeatRule; label: string }> = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const RRULE_BY_REPEAT: Record<Exclude<RepeatRule, "none">, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

/** The preset that best matches a stored rule; unknown rules fall back to none. */
export function deriveRepeat(rule: string | null | undefined): RepeatRule {
  const value = rule ?? "";
  if (value.includes("FREQ=DAILY")) return "daily";
  if (value.includes("FREQ=WEEKLY")) return "weekly";
  if (value.includes("FREQ=MONTHLY")) return "monthly";
  if (value.includes("FREQ=YEARLY")) return "yearly";
  return "none";
}

export interface EventFormValues {
  title: string;
  calendarId: string;
  description: string;
  location: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: RepeatRule;
  initialRepeat: RepeatRule;
  initialRule: string | null;
  timezone: string;
}

export function buildEventPayload(values: EventFormValues): EventInputPayload {
  const repeatChanged = values.repeat !== values.initialRepeat;
  const payload: EventInputPayload = {
    title: values.title,
    calendarId: values.calendarId,
    description: values.description.trim() ? values.description : null,
    location: values.location.trim() ? values.location : null,
    allDay: values.allDay,
    // Preserve the exact stored rule (BYDAY, INTERVAL, COUNT…) unless the user
    // actually changed the Repeat control.
    rrule: !repeatChanged && values.initialRule
      ? values.initialRule
      : values.repeat === "none"
        ? null
        : (RRULE_BY_REPEAT[values.repeat] ?? null),
  };

  if (values.allDay) {
    payload.startDate = values.startDate;
    payload.endDate = values.endDate < values.startDate ? values.startDate : values.endDate;
    payload.startAt = null;
    payload.endAt = null;
  } else {
    payload.startAt = localWallTimeToUtc(`${values.startDate}T${values.startTime}`, values.timezone);
    payload.endAt = localWallTimeToUtc(`${values.endDate}T${values.endTime}`, values.timezone);
    payload.startDate = null;
    payload.endDate = null;
  }
  return payload;
}
