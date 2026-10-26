import { describe, expect, it } from "vitest";
import type { ShadeTokens } from "@/lib/color/palette";
import type { EventView } from "@/lib/services/events";
import {
  formatInstant,
  formatOccurrenceHeading,
  formatOccurrenceWhen,
  formatWallDate,
  formatWallTime,
} from "@/lib/time/format";
import { localWallTimeToUtc } from "@/lib/time/zone";

const TZ = "Asia/Taipei";

function base(overrides: Partial<EventView>): EventView {
  return {
    id: "e1",
    householdId: "h1",
    collectionId: "c1",
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
    recurrenceParentId: null,
    recurrenceId: null,
    tzid: null,
    externalSource: null,
    externalUid: null,
    externalRecurrenceId: null,
    externalKey: null,
    externalContentHash: null,
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

/**
 * The occurrence key `expandOccurrences` produces for a timed occurrence: an ISO
 * instant, not a wall-clock string. Passing a bare "YYYY-MM-DDTHH:mm" would be
 * parsed in the host zone, so the test would only pass on a machine in `TZ`.
 */
function occurrenceInstant(wall: string): string {
  return new Date(localWallTimeToUtc(wall, TZ)).toISOString();
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
    expect(formatOccurrenceWhen(event, occurrenceInstant("2026-10-21T22:00"), TZ, "24h")).toBe(
      "21 Oct 22:00 – 22 Oct 06:00",
    );
  });

  it("renders a same-day timed occurrence as a time range", () => {
    const event = timedEvent("2026-10-21T19:00", "2026-10-21T20:30");
    const start = occurrenceInstant("2026-10-21T19:00");
    expect(formatOccurrenceWhen(event, start, TZ, "24h")).toBe("19:00 – 20:30");
    expect(formatOccurrenceWhen(event, start, TZ, "12h")).toBe("7:00 PM – 8:30 PM");
  });

  it("uses the occurrence start for a repeating series, not the series start", () => {
    const event = timedEvent("2026-10-21T22:00", "2026-10-22T06:00");
    const occurrenceStart = occurrenceInstant("2026-10-28T22:00");
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

describe("formatOccurrenceHeading", () => {  it("resolves the clicked occurrence's own date (F28)", () => {
    const event = timedEvent("2026-10-15T13:00", "2026-10-15T14:00");
    expect(formatOccurrenceHeading(event, "2026-10-27T13:00", TZ)).toBe("Tue, 27 Oct 2026");
  });

  it("renders all-day occurrence dates and uses the occurrence for repeats", () => {
    const event = allDayEvent("2026-10-21", "2026-10-23");
    expect(formatOccurrenceHeading(event, "2026-10-21", TZ)).toBe("Wed, 21 Oct 2026");
    expect(formatOccurrenceHeading(event, "2026-11-04", TZ)).toBe("Wed, 4 Nov 2026");
  });
});

describe("formatWallDate", () => {
  it("heads a bare date the same way as an occurrence", () => {
    expect(formatWallDate("2026-10-28")).toBe("Wed, 28 Oct 2026");
    expect(formatWallDate("not-a-date")).toBe("not-a-date");
  });
});
