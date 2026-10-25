import { describe, expect, it } from "vitest";
import type { EventRow } from "@/lib/db/schema";
import { expandOccurrences } from "@/lib/recurrence/expand";
import { localWallTimeToUtc, utcToLocalWallTime } from "@/lib/time/zone";

const TAIPEI = "Asia/Taipei";
const LONDON = "Europe/London";
const at = (wall: string) => localWallTimeToUtc(wall, TAIPEI);
const atLondon = (wall: string) => localWallTimeToUtc(wall, LONDON);

function timedRule(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1",
    householdId: "h1",
    collectionId: "c1",
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
    tzid: null,
    externalSource: null,
    externalUid: null,
    externalRecurrenceId: null,
    externalKey: null,
    externalContentHash: null,
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

describe("expandOccurrences in a DST timezone", () => {
  function londonSeries(overrides: Partial<EventRow> = {}): EventRow {
    return timedRule({
      tzid: LONDON,
      startAt: atLondon("2027-03-02T09:00"),
      endAt: atLondon("2027-03-02T10:00"),
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      ...overrides,
    });
  }

  const wallTimes = (starts: Array<number | null>) =>
    starts.map((start) => utcToLocalWallTime(start ?? 0, LONDON).slice(11));

  it("keeps a weekly 09:00 series at 09:00 wall time across the spring change", () => {
    const occurrences = expandOccurrences(
      londonSeries(),
      { from: atLondon("2027-03-01T00:00"), to: atLondon("2027-04-14T00:00") },
      TAIPEI,
    );

    expect(occurrences.map((occurrence) => new Date(occurrence.startAt ?? 0).toISOString())).toEqual([
      "2027-03-02T09:00:00.000Z",
      "2027-03-09T09:00:00.000Z",
      "2027-03-16T09:00:00.000Z",
      "2027-03-23T09:00:00.000Z",
      "2027-03-30T08:00:00.000Z",
      "2027-04-06T08:00:00.000Z",
      "2027-04-13T08:00:00.000Z",
    ]);
    expect(wallTimes(occurrences.map((occurrence) => occurrence.startAt))).toEqual(
      Array(7).fill("09:00"),
    );
  });

  it("keeps a weekly 09:00 series at 09:00 wall time across the autumn change", () => {
    const occurrences = expandOccurrences(
      londonSeries({
        startAt: atLondon("2027-10-05T09:00"),
        endAt: atLondon("2027-10-05T10:00"),
      }),
      { from: atLondon("2027-10-01T00:00"), to: atLondon("2027-11-17T00:00") },
      TAIPEI,
    );

    expect(occurrences.map((occurrence) => new Date(occurrence.startAt ?? 0).toISOString())).toEqual([
      "2027-10-05T08:00:00.000Z",
      "2027-10-12T08:00:00.000Z",
      "2027-10-19T08:00:00.000Z",
      "2027-10-26T08:00:00.000Z",
      "2027-11-02T09:00:00.000Z",
      "2027-11-09T09:00:00.000Z",
      "2027-11-16T09:00:00.000Z",
    ]);
    expect(wallTimes(occurrences.map((occurrence) => occurrence.startAt))).toEqual(
      Array(7).fill("09:00"),
    );
  });

  it("matches EXDATE instants against the event zone, not the household zone", () => {
    const occurrences = expandOccurrences(
      londonSeries({ exdates: JSON.stringify(["2027-03-30T08:00:00.000Z"]) }),
      { from: atLondon("2027-03-01T00:00"), to: atLondon("2027-04-14T00:00") },
      TAIPEI,
    );

    expect(occurrences.map((occurrence) => new Date(occurrence.startAt ?? 0).toISOString())).toEqual([
      "2027-03-02T09:00:00.000Z",
      "2027-03-09T09:00:00.000Z",
      "2027-03-16T09:00:00.000Z",
      "2027-03-23T09:00:00.000Z",
      "2027-04-06T08:00:00.000Z",
      "2027-04-13T08:00:00.000Z",
    ]);
  });

  it("shifts an occurrence inside the spring-forward gap instead of dropping it", () => {
    const series = londonSeries({
      startAt: atLondon("2027-03-21T01:30"),
      endAt: atLondon("2027-03-21T02:30"),
      rrule: "FREQ=WEEKLY;BYDAY=SU",
    });
    const occurrences = expandOccurrences(
      series,
      { from: atLondon("2027-03-01T00:00"), to: atLondon("2027-04-05T00:00") },
      TAIPEI,
    );

    // London's gap is 01:00–02:00 local: 2027-03-28 01:30 does not exist and is
    // shifted by RFC 5545 §3.3.5 to 02:30 BST.
    expect(wallTimes(occurrences.map((occurrence) => occurrence.startAt))).toEqual([
      "01:30",
      "02:30",
      "01:30",
    ]);
  });

  it("keeps the last occurrence when UNTIL is a UTC instant in a DST zone", () => {
    const occurrences = expandOccurrences(
      londonSeries({ rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20270406T085959Z" }),
      { from: atLondon("2027-03-01T00:00"), to: atLondon("2027-04-20T00:00") },
      TAIPEI,
    );

    expect(occurrences.map((occurrence) => new Date(occurrence.startAt ?? 0).toISOString())).toEqual([
      "2027-03-02T09:00:00.000Z",
      "2027-03-09T09:00:00.000Z",
      "2027-03-16T09:00:00.000Z",
      "2027-03-23T09:00:00.000Z",
      "2027-03-30T08:00:00.000Z",
      "2027-04-06T08:00:00.000Z",
    ]);
  });

  it("anchors a tzid-less series in a DST household zone", () => {
    const series = timedRule({
      tzid: null,
      startAt: atLondon("2027-03-02T09:00"),
      endAt: atLondon("2027-03-02T10:00"),
      rrule: "FREQ=WEEKLY;BYDAY=TU",
    });
    const occurrences = expandOccurrences(
      series,
      { from: atLondon("2027-03-01T00:00"), to: atLondon("2027-04-14T00:00") },
      LONDON,
    );

    expect(wallTimes(occurrences.map((occurrence) => occurrence.startAt))).toEqual(
      Array(7).fill("09:00"),
    );
  });
});
