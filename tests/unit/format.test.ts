import { describe, expect, it } from "vitest";
import type { ShadeTokens } from "@/lib/color/palette";
import type { EventView } from "@/lib/services/events";
import {
  formatInstant,
  formatOccurrenceHeading,
  formatOccurrenceWhen,
  formatWallTime,
} from "@/lib/time/format";
import { localWallTimeToUtc } from "@/lib/time/zone";

const TZ = "Asia/Taipei";

function base(overrides: Partial<EventView>): EventView {
  return {
    id: "e1",
    householdId: "h1",
    calendarId: "c1",
    title: "Event",
    description: null,
    location: null,
    allDay: 1,
    startAt: null,
    endAt: null,
    startDate: "2026-10-21",
    endDate: "2026-10-21",
    rrule: null,
    exdates: null,
    createdBy: "user-a",
    createdAt: 0,
    updatedAt: 0,
    color: {} as ShadeTokens,
    ...overrides,
  };
}

function allDayEvent(startDate: string, endDate = startDate): EventView {
  return base({ allDay: 1, startDate, endDate });
}

function timedEvent(startWall: string, endWall: string): EventView {
  return base({
    allDay: 0,
    startAt: localWallTimeToUtc(startWall, TZ),
    endAt: localWallTimeToUtc(endWall, TZ),
    startDate: null,
    endDate: null,
  });
}

describe("formatWallTime", () => {
  it("renders 24h and 12h wall times", () => {
    expect(formatWallTime("19:00", "24h")).toBe("19:00");
    expect(formatWallTime("19:00", "12h")).toBe("7:00 PM");
    expect(formatWallTime("00:00", "12h")).toBe("12:00 AM");
    expect(formatWallTime("12:00", "12h")).toBe("12:00 PM");
    expect(formatWallTime("09:05", "24h")).toBe("09:05");
  });

  it("accepts a full wall-time string and leaves other input alone", () => {
    expect(formatWallTime("2026-10-21T19:00", "12h")).toBe("7:00 PM");
    expect(formatWallTime("noon", "12h")).toBe("noon");
  });
});

describe("formatInstant", () => {
  it("formats a UTC instant in the household zone", () => {
    const instant = localWallTimeToUtc("2026-10-21T19:00", TZ);
    expect(formatInstant(instant, TZ, "24h")).toBe("19:00");
    expect(formatInstant(instant, TZ, "12h")).toBe("7:00 PM");
  });
});

describe("formatOccurrenceWhen", () => {
  it("keeps a single all-day event human", () => {
    const event = allDayEvent("2026-10-21");
    expect(formatOccurrenceWhen(event, "2026-10-21", TZ, "24h")).toBe("All day · 21 Oct");
  });

  it("keeps a multi-day all-day range inclusive and human", () => {
    const event = allDayEvent("2026-10-21", "2026-10-23");
    expect(formatOccurrenceWhen(event, "2026-10-21", TZ, "24h")).toBe(
      "All day · 21–23 Oct (3 days)",
    );
  });

  it("shows the end date when a timed event crosses midnight", () => {
    const event = timedEvent("2026-10-21T22:00", "2026-10-22T06:00");
    expect(formatOccurrenceWhen(event, "2026-10-21T22:00", TZ, "24h")).toBe(
      "21 Oct 22:00 – 22 Oct 06:00",
    );
  });

  it("renders a same-day timed occurrence as a time range", () => {
    const event = timedEvent("2026-10-21T19:00", "2026-10-21T20:30");
    expect(formatOccurrenceWhen(event, "2026-10-21T19:00", TZ, "24h")).toBe("19:00 – 20:30");
    expect(formatOccurrenceWhen(event, "2026-10-21T19:00", TZ, "12h")).toBe("7:00 PM – 8:30 PM");
  });

  it("uses the occurrence start for a repeating series, not the series start", () => {
    const event = timedEvent("2026-10-21T22:00", "2026-10-22T06:00");
    const occurrenceStart = new Date(localWallTimeToUtc("2026-10-28T22:00", TZ)).toISOString();
    expect(formatOccurrenceWhen(event, occurrenceStart, TZ, "24h")).toBe(
      "28 Oct 22:00 – 29 Oct 06:00",
    );
  });

  it("moves a repeating all-day range to its occurrence date", () => {
    const event = allDayEvent("2026-10-21", "2026-10-23");
    expect(formatOccurrenceWhen(event, "2026-11-04", TZ, "24h")).toBe(
      "All day · 4–6 Nov (3 days)",
    );
  });
});

describe("formatOccurrenceHeading", () => {
  it("resolves the clicked occurrence's own date (F28)", () => {
    const event = timedEvent("2026-10-15T13:00", "2026-10-15T14:00");
    expect(formatOccurrenceHeading(event, "2026-10-27T13:00", TZ)).toBe("Tue, 27 Oct 2026");
  });

  it("renders all-day occurrence dates and uses the occurrence for repeats", () => {
    const event = allDayEvent("2026-10-21", "2026-10-23");
    expect(formatOccurrenceHeading(event, "2026-10-21", TZ)).toBe("Wed, 21 Oct 2026");
    expect(formatOccurrenceHeading(event, "2026-11-04", TZ)).toBe("Wed, 4 Nov 2026");
  });
});
