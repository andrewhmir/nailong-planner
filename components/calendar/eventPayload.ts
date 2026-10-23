import type { EventInputPayload } from "@/lib/query/events";
import { formatRepeatRule, type RepeatOptions } from "@/lib/recurrence/rule";
import { localWallTimeToUtc } from "@/lib/time/zone";

/**
 * Form-to-payload conversion for the event dialog. Kept pure and outside the
 * component so the rule-preservation contract (review focus 4) is unit-tested:
 * a rule the user did not touch must reach the server byte-identical, while any
 * edit to the repeat controls is rebuilt from the structured `RepeatOptions`.
 */

export type RepeatPreset = "none" | "daily" | "weekly" | "monthly" | "yearly";

/** The preset a stored rule most closely resembles; unknown shapes fall back to none. */
export function deriveRepeat(rule: string | null | undefined): RepeatPreset {
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
  /** The repeat controls' state; null means "Does not repeat". */
  recurrence: RepeatOptions | null;
  /**
   * True when the dialog's recurrence state still matches the stored rule, so
   * the server must receive the rule byte-identical instead of a rebuilt one.
   */
  keepInitialRule: boolean;
  initialRule: string | null;
  timezone: string;
}

export function buildEventPayload(values: EventFormValues): EventInputPayload {
  const rrule =
    values.keepInitialRule && values.initialRule
      ? values.initialRule
      : values.recurrence
        ? formatRepeatRule(values.recurrence, values.startDate, {
            allDay: values.allDay,
            timezone: values.timezone,
          })
        : null;

  const payload: EventInputPayload = {
    title: values.title,
    calendarId: values.calendarId,
    description: values.description.trim() ? values.description : null,
    location: values.location.trim() ? values.location : null,
    allDay: values.allDay,
    rrule,
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
