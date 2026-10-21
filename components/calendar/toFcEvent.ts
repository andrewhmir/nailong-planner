import type { EventInput } from "@fullcalendar/react";
import type { Occurrence } from "@/lib/recurrence/expand";
import type { EventView } from "@/lib/services/events";
import { addDaysToDate } from "@/lib/time/zone";

export interface PlannerFcEvent extends EventInput {
  extendedProps: {
    eventId: string;
    calendarId: string;
    /** The occurrence this renderable represents: a local date or an ISO instant. */
    occurrenceStart: string;
    description: string | null;
    location: string | null;
    /** Saturated accent for the event's left bar: dots, borders, drag highlights. */
    accent: string;
    // Drives the event's aria-label and the details card's calendar row.
    calendarName: string;
  };
}

/** FullCalendar id for one occurrence of one event. */
export function occurrenceFcId(eventId: string, startKey: string): string {
  return `${eventId}::${startKey}`;
}

export function parseOccurrenceFcId(id: string): { eventId: string; startKey: string } | null {
  const separator = id.indexOf("::");
  if (separator === -1) {
    return null;
  }
  return { eventId: id.slice(0, separator), startKey: id.slice(separator + 2) };
}

/**
 * FullCalendar v7 replaced `backgroundColor`/`borderColor`/`textColor` with
 * `color` + `contrastColor`. Every block gets the pale container tint so ink
 * text clears 4.5:1; the saturated accent travels in `extendedProps.accent`
 * for the event's left bar and the month-view dot.
 */
export function occurrenceToFcEvent(
  occurrence: Occurrence,
  event: EventView,
  calendarName = "",
): PlannerFcEvent {
  const allDay = event.allDay === 1;

  return {
    id: occurrenceFcId(event.id, occurrence.startKey),
    title: event.title,
    color: event.color.containerHex,
    contrastColor: event.color.onContainer,
    allDay,
    start: allDay
      ? (occurrence.startDate ?? undefined)
      : occurrence.startAt === null
        ? undefined
        : new Date(occurrence.startAt).toISOString(),
    end: allDay
      ? occurrence.endDate
        ? addDaysToDate(occurrence.endDate, 1)
        : undefined
      : occurrence.endAt === null
        ? undefined
        : new Date(occurrence.endAt).toISOString(),
    extendedProps: {
      eventId: event.id,
      calendarId: event.calendarId,
      occurrenceStart: occurrence.startKey,
      description: event.description,
      location: event.location,
      accent: event.color.mainHex,
      calendarName,
    },
  };
}
