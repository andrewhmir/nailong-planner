import { describe, expect, it } from "vitest";
import type { EventRow } from "@/lib/db/schema";
import { expandOccurrences } from "@/lib/recurrence/expand";
import { localWallTimeToUtc } from "@/lib/time/zone";

const TAIPEI = "Asia/Taipei";
const at = (wall: string) => localWallTimeToUtc(wall, TAIPEI);

function timedRule(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1",
    householdId: "h1",
    calendarId: "c1",
    title: "Weekly class",
    description: null,
    location: null,
    allDay: 0,
    startAt: at("2026-10-06T13:00"),
    endAt: at("2026-10-06T14:30"),
    startDate: null,
    endDate: null,
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    exdates: null,
    createdBy: "u1",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function range(fromWall: string, toWall: string) {
  return { from: at(fromWall), to: at(toWall) };
}

describe("expandOccurrences", () => {
  it("anchors a weekly series to its stored start, not to now", () => {
    const occurrences = expandOccurrences(timedRule(), range("2026-10-01T00:00", "2026-11-01T00:00"), TAIPEI);
    expect(occurrences).toHaveLength(4);
    expect(occurrences[0]?.startKey).toBe(new Date(at("2026-10-06T13:00")).toISOString());
    expect(occurrences[1]?.startAt).toBe(at("2026-10-13T13:00"));
    expect(occurrences[2]?.startAt).toBe(at("2026-10-20T13:00"));
    expect(occurrences[3]?.startAt).toBe(at("2026-10-27T13:00"));
  });

  it("keeps the series duration on every occurrence", () => {
    const [first] = expandOccurrences(timedRule(), range("2026-10-01T00:00", "2026-11-01T00:00"), TAIPEI);
    expect((first?.endAt ?? 0) - (first?.startAt ?? 0)).toBe(90 * 60 * 1000);
  });

  it("returns occurrences before the stored start when the range asks for them", () => {
    const occurrences = expandOccurrences(timedRule(), range("2026-09-01T00:00", "2026-10-01T00:00"), TAIPEI);
    expect(occurrences).toHaveLength(0);
  });

  it("skips exactly the excluded occurrence", () => {
    const excluded = new Date(at("2026-10-20T13:00")).toISOString();
    const occurrences = expandOccurrences(
      timedRule({ exdates: JSON.stringify([excluded]) }),
      range("2026-10-01T00:00", "2026-11-01T00:00"),
      TAIPEI,
    );
    expect(occurrences.map((occurrence) => occurrence.startAt)).toEqual([
      at("2026-10-06T13:00"),
      at("2026-10-13T13:00"),
      at("2026-10-27T13:00"),
    ]);
  });

  it("keeps a monthly series on the 31st in the months that have one", () => {
    const monthly = timedRule({
      startAt: at("2026-01-31T09:00"),
      endAt: at("2026-01-31T10:00"),
      rrule: "FREQ=MONTHLY",
    });
    const occurrences = expandOccurrences(monthly, range("2026-01-01T00:00", "2026-06-01T00:00"), TAIPEI);
    expect(occurrences.map((occurrence) => occurrence.startAt)).toEqual([
      at("2026-01-31T09:00"),
      at("2026-03-31T09:00"),
      at("2026-05-31T09:00"),
    ]);
  });

  it("expands an all-day series into local calendar dates", () => {
    const allDay = timedRule({
      allDay: 1,
      startAt: null,
      endAt: null,
      startDate: "2026-10-06",
      endDate: "2026-10-07",
      rrule: "FREQ=WEEKLY",
    });
    const occurrences = expandOccurrences(allDay, range("2026-10-01T00:00", "2026-11-01T00:00"), TAIPEI);
    expect(occurrences.map((occurrence) => occurrence.startDate)).toEqual([
      "2026-10-06",
      "2026-10-13",
      "2026-10-20",
      "2026-10-27",
    ]);
    expect(occurrences[0]?.endDate).toBe("2026-10-07");
  });

  it("skips one all-day occurrence by its date", () => {
    const allDay = timedRule({
      allDay: 1,
      startAt: null,
      endAt: null,
      startDate: "2026-10-06",
      endDate: "2026-10-06",
      rrule: "FREQ=WEEKLY",
      exdates: JSON.stringify(["2026-10-13"]),
    });
    const occurrences = expandOccurrences(allDay, range("2026-10-01T00:00", "2026-11-01T00:00"), TAIPEI);
    expect(occurrences.map((occurrence) => occurrence.startDate)).toEqual([
      "2026-10-06",
      "2026-10-20",
      "2026-10-27",
    ]);
  });
});
