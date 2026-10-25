import { describe, expect, it } from "vitest";
import type { EventRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { expandOccurrences } from "@/lib/recurrence/expand";
import {
  continueRule,
  countOccurrencesBefore,
  dateDiffDays,
  localDateOfEvent,
  shiftEventTiming,
  shiftExdates,
  shiftOccurrenceKey,
  shiftRepeatRule,
  shiftSeriesTiming,
  truncateRuleBefore,
} from "@/lib/recurrence/scopes";
import { localWallTimeToUtc, utcToLocalWallTime } from "@/lib/time/zone";

const TAIPEI = "Asia/Taipei";
const LONDON = "Europe/London";
const at = (wall: string) => localWallTimeToUtc(wall, TAIPEI);
const atLondon = (wall: string) => localWallTimeToUtc(wall, LONDON);

function timedRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1",
    householdId: "h1",
    calendarId: "c1",
    title: "Weekly class",
    description: null,
    location: null,
    allDay: 0,
    startAt: at("2026-10-24T09:00"),
    endAt: at("2026-10-24T10:00"),
    startDate: null,
    endDate: null,
    rrule: "FREQ=WEEKLY;BYDAY=SA",
    exdates: null,
    recurrenceParentId: null,
    recurrenceId: null,
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

function allDayRow(overrides: Partial<EventRow> = {}): EventRow {
  return timedRow({
    allDay: 1,
    startAt: null,
    endAt: null,
    startDate: "2026-10-24",
    endDate: "2026-10-25",
    ...overrides,
  });
}

function londonRow(overrides: Partial<EventRow> = {}): EventRow {
  return timedRow({
    tzid: LONDON,
    startAt: atLondon("2027-03-02T09:00"),
    endAt: atLondon("2027-03-02T10:00"),
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    ...overrides,
  });
}

const iso = (wall: string, zone = TAIPEI) => new Date(localWallTimeToUtc(wall, zone)).toISOString();

describe("shiftOccurrenceKey", () => {
  it("shifts an all-day key by days", () => {
    expect(shiftOccurrenceKey("2026-10-24", { deltaDays: 1, deltaMs: 0 })).toBe("2026-10-25");
    expect(shiftOccurrenceKey("2026-03-01", { deltaDays: -1, deltaMs: 0 })).toBe("2026-02-28");
  });

  it("shifts an instant key by milliseconds", () => {
    expect(
      shiftOccurrenceKey("2026-10-24T01:00:00.000Z", { deltaDays: 1, deltaMs: 25 * 3_600_000 }),
    ).toBe("2026-10-25T02:00:00.000Z");
  });
});

describe("shiftExdates", () => {
  it("shifts all-day dates and leaves malformed values alone", () => {
    const shifted = shiftExdates(JSON.stringify(["2026-10-24", "not-a-date"]), true, {
      deltaDays: 1,
      deltaMs: 0,
    });
    expect(JSON.parse(shifted ?? "[]")).toEqual(["2026-10-25", "not-a-date"]);
  });

  it("returns null for missing or corrupt JSON", () => {
    expect(shiftExdates(null, false, { deltaDays: 1, deltaMs: 3_600_000 })).toBeNull();
    expect(shiftExdates("{not json", false, { deltaDays: 1, deltaMs: 3_600_000 })).toBeNull();
  });

  it("shifts timed instants but leaves floating wall times unchanged", () => {
    const shifted = shiftExdates(
      JSON.stringify(["2026-10-24T01:00:00.000Z", "2026-10-24T09:00"]),
      false,
      { deltaDays: 1, deltaMs: 3_600_000 },
    );
    expect(JSON.parse(shifted ?? "[]")).toEqual([
      "2026-10-24T02:00:00.000Z",
      "2026-10-24T09:00",
    ]);
  });
});

describe("shiftRepeatRule", () => {
  const context = { allDay: false, timezone: TAIPEI };

  it("shifts every weekly BYDAY token", () => {
    const rule = shiftRepeatRule("FREQ=WEEKLY;BYDAY=SA", "2026-10-24", "2026-10-25", {
      allDay: true,
      timezone: TAIPEI,
    });
    expect(rule).toContain("BYDAY=SU");

    const weekdays = shiftRepeatRule(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      "2026-10-05",
      "2026-10-06",
      { allDay: true, timezone: TAIPEI },
    );
    expect(weekdays).toContain("BYDAY=TU,WE,TH,FR,SA");
  });

  it("re-anchors a monthly day and shifts its UNTIL", () => {
    const rule = shiftRepeatRule(
      "FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20261215T235900Z",
      "2026-11-15",
      "2026-11-16",
      context,
    );
    expect(rule).toContain("BYMONTHDAY=16");
    expect(rule).toContain("UNTIL=20261217");
  });

  it("returns the rule verbatim when the day does not change", () => {
    const rule = "FREQ=WEEKLY;BYDAY=SA;UNTIL=20261201T000000Z";
    expect(shiftRepeatRule(rule, "2026-10-24", "2026-10-24", context)).toBe(rule);
  });

  it("refuses advanced or unsupported rules", () => {
    expect(shiftRepeatRule("FREQ=WEEKLY;BYDAY=TU;BYHOUR=9", "2026-10-06", "2026-10-07", context)).toBeNull();
    expect(shiftRepeatRule("FREQ=HOURLY", "2026-10-06", "2026-10-07", context)).toBeNull();
  });
});

describe("shiftSeriesTiming", () => {
  it("moves an all-day series and shifts its EXDATEs", () => {
    const { patch, delta } = shiftSeriesTiming(
      allDayRow({ exdates: JSON.stringify(["2026-11-07"]) }),
      "2026-10-24",
      {
        allDay: true,
        startAt: null,
        endAt: null,
        startDate: "2026-10-25",
        endDate: "2026-10-26",
      },
      TAIPEI,
    );
    expect(delta).toEqual({ deltaDays: 1, deltaMs: 0 });
    expect(patch.startDate).toBe("2026-10-25");
    expect(patch.endDate).toBe("2026-10-26");
    expect(patch.rrule).toContain("BYDAY=SU");
    expect(JSON.parse(patch.exdates ?? "[]")).toEqual(["2026-11-08"]);
    expect(patch.updatedAt).toBeTypeOf("number");
  });

  it("moves a timed series by the instant delta", () => {
    const occurrenceStart = iso("2026-10-24T09:00");
    const { patch, delta } = shiftSeriesTiming(
      timedRow(),
      occurrenceStart,
      {
        allDay: false,
        startAt: at("2026-10-25T10:00"),
        endAt: at("2026-10-25T11:00"),
        startDate: null,
        endDate: null,
      },
      TAIPEI,
    );
    expect(delta).toEqual({ deltaDays: 1, deltaMs: 25 * 3_600_000 });
    expect(patch.startAt).toBe(at("2026-10-25T10:00"));
    expect(patch.endAt).toBe(at("2026-10-25T11:00"));
    expect(patch.rrule).toContain("BYDAY=SU");
  });

  it("rejects an all-day/timed conversion", () => {
    expect(() =>
      shiftSeriesTiming(
        timedRow(),
        iso("2026-10-24T09:00"),
        { allDay: true, startAt: null, endAt: null, startDate: "2026-10-25", endDate: "2026-10-25" },
        TAIPEI,
      ),
    ).toThrow(AppError);
  });

  it("refuses an all-events move for a rule it cannot shift", () => {
    expect(() =>
      shiftSeriesTiming(
        timedRow({ rrule: "FREQ=WEEKLY;BYDAY=SA;BYHOUR=9" }),
        iso("2026-10-24T09:00"),
        {
          allDay: false,
          startAt: at("2026-10-25T10:00"),
          endAt: at("2026-10-25T11:00"),
          startDate: null,
          endDate: null,
        },
        TAIPEI,
      ),
    ).toThrow(/custom repeat rule/);
  });
});

describe("truncateRuleBefore", () => {
  it("writes COUNT for a COUNT series", () => {
    expect(
      truncateRuleBefore("FREQ=DAILY;COUNT=10", iso("2026-01-04T09:00"), 3, TAIPEI, true),
    ).toBe("FREQ=DAILY;COUNT=3");
  });

  it("writes an all-day UNTIL", () => {
    const rule = truncateRuleBefore("FREQ=WEEKLY;BYDAY=SA", "2026-10-31", 3, TAIPEI, false);
    expect(rule).toBe("FREQ=WEEKLY;BYDAY=SA;UNTIL=20261030");
  });

  it("writes a UTC UNTIL one second before a timed split in a DST zone", () => {
    const split = "2027-03-30T08:00:00.000Z"; // 09:00 BST after the London spring change
    const rule = truncateRuleBefore("FREQ=WEEKLY;BYDAY=TU", split, 4, LONDON, true);
    expect(rule).toContain("UNTIL=20270330T075959Z");

    const occurrences = expandOccurrences(
      londonRow({ rrule: rule }),
      { from: atLondon("2027-03-01T00:00"), to: atLondon("2027-05-01T00:00") },
      TAIPEI,
    );
    expect(occurrences.map((occurrence) => new Date(occurrence.startAt ?? 0).toISOString())).toEqual([
      "2027-03-02T09:00:00.000Z",
      "2027-03-09T09:00:00.000Z",
      "2027-03-16T09:00:00.000Z",
      "2027-03-23T09:00:00.000Z",
    ]);
    expect(occurrences.map((occurrence) => utcToLocalWallTime(occurrence.startAt ?? 0, LONDON).slice(11))).toEqual(
      Array(4).fill("09:00"),
    );
  });
});

describe("continueRule", () => {
  it("reduces COUNT by the occurrences left behind", () => {
    expect(continueRule("FREQ=DAILY;COUNT=10", 3)).toBe("FREQ=DAILY;COUNT=7");
  });

  it("returns a rule without COUNT verbatim", () => {
    const rule = "FREQ=WEEKLY;BYDAY=TU;UNTIL=20270406T085959Z";
    expect(continueRule(rule, 4)).toBe(rule);
  });
});

describe("countOccurrencesBefore", () => {
  it("counts the occurrences before the split", () => {
    expect(countOccurrencesBefore(allDayRow({ rrule: "FREQ=WEEKLY" }), "2026-11-07", TAIPEI)).toBe(2);
  });

  it("rejects a key that is not an occurrence", () => {
    try {
      countOccurrencesBefore(allDayRow({ rrule: "FREQ=WEEKLY" }), "2026-10-25", TAIPEI);
      expect.unreachable("expected a VALIDATION error");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION");
    }
  });
});

describe("shiftEventTiming", () => {
  it("shifts a timed exception row", () => {
    const patch = shiftEventTiming(timedRow(), { deltaDays: 1, deltaMs: 25 * 3_600_000 });
    expect(patch.startAt).toBe(at("2026-10-25T10:00"));
    expect(patch.endAt).toBe(at("2026-10-25T11:00"));
  });

  it("shifts an all-day exception row", () => {
    const patch = shiftEventTiming(allDayRow(), { deltaDays: 2, deltaMs: 0 });
    expect(patch.startDate).toBe("2026-10-26");
    expect(patch.endDate).toBe("2026-10-27");
  });
});

describe("date helpers", () => {
  it("computes signed day differences", () => {
    expect(dateDiffDays("2026-10-24", "2026-10-25")).toBe(1);
    expect(dateDiffDays("2026-10-25", "2026-10-24")).toBe(-1);
  });

  it("reads the series start date in the event zone", () => {
    expect(localDateOfEvent(allDayRow(), TAIPEI)).toBe("2026-10-24");
    expect(localDateOfEvent(londonRow(), LONDON)).toBe("2027-03-02");
  });
});
