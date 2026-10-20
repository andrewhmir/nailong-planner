import { describe, expect, it } from "vitest";
import { occurrenceToFcEvent, parseOccurrenceFcId } from "@/components/calendar/toFcEvent";
import type { Occurrence } from "@/lib/recurrence/expand";
import type { EventView } from "@/lib/services/events";

const COLOR = {
  main: "oklch(0.65 0.09 190)",
  mainHex: "#40a19b",
  container: "oklch(0.82 0.05 190)",
  containerHex: "#a9d2ce",
  onContainer: "#273540",
};

function event(overrides: Partial<EventView> = {}): EventView {
  return {
    id: "e1",
    householdId: "h1",
    calendarId: "c1",
    title: "Quiz",
    description: "Chapter 3",
    location: null,
    allDay: 0,
    startAt: 1_700_000_000_000,
    endAt: 1_700_000_360_000,
    startDate: null,
    endDate: null,
    rrule: null,
    exdates: null,
    createdBy: "u1",
    createdAt: 0,
    updatedAt: 0,
    color: COLOR,
    ...overrides,
  } as EventView;
}

function timedOccurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    eventId: "e1",
    startKey: "2023-11-14T22:13:20.000Z",
    startAt: 1_700_000_000_000,
    endAt: 1_700_000_360_000,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

describe("occurrenceToFcEvent", () => {
  it("renders one concrete occurrence with its calendar colors", () => {
    const fc = occurrenceToFcEvent(timedOccurrence(), event());
    expect(fc.id).toBe("e1::2023-11-14T22:13:20.000Z");
    expect(fc.title).toBe("Quiz");
    expect(fc.allDay).toBe(false);
    expect(fc.start).toBe("2023-11-14T22:13:20.000Z");
    expect(fc.end).toBe("2023-11-14T22:19:20.000Z");
    expect(fc.color).toBe(COLOR.containerHex);
    expect(fc.contrastColor).toBe("#273540");
    expect(fc.extendedProps.accent).toBe(COLOR.mainHex);
    expect(fc.extendedProps.eventId).toBe("e1");
    expect(fc.extendedProps.calendarId).toBe("c1");
    expect(fc.extendedProps.occurrenceStart).toBe("2023-11-14T22:13:20.000Z");
  });

  it("converts the inclusive all-day end to FullCalendar's exclusive end", () => {
    const fc = occurrenceToFcEvent(
      { eventId: "e1", startKey: "2026-03-07", startAt: null, endAt: null, startDate: "2026-03-07", endDate: "2026-03-09" },
      event({ allDay: 1 }),
    );
    expect(fc.allDay).toBe(true);
    expect(fc.start).toBe("2026-03-07");
    expect(fc.end).toBe("2026-03-10");
    expect(fc.color).toBe(COLOR.containerHex);
    expect(fc.contrastColor).toBe("#273540");
    expect(fc.extendedProps.accent).toBe(COLOR.mainHex);
  });

  it("parses only ids that carry an occurrence key", () => {
    expect(parseOccurrenceFcId("e1::2026-10-20")).toEqual({ eventId: "e1", startKey: "2026-10-20" });
    expect(parseOccurrenceFcId("plain-id")).toBeNull();
  });
});
