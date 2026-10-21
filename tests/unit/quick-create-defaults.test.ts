import { describe, expect, it } from "vitest";
import {
  defaultRangeForDate,
  defaultRangeFromSelection,
  type QuickCreateRange,
} from "@/components/calendar/quickCreateDefaults";
import { localWallTimeToUtc } from "@/lib/time/zone";

const TZ = "Asia/Taipei";

function taipei(wall: string): number {
  return localWallTimeToUtc(wall, TZ);
}

describe("defaultRangeForDate", () => {
  it("starts at the next half hour for today", () => {
    const now = new Date("2026-10-21T14:07:00+08:00");
    expect(defaultRangeForDate("2026-10-21", null, now, TZ)).toEqual<QuickCreateRange>({
      startWall: "2026-10-21T14:30",
      endWall: "2026-10-21T15:30",
      allDay: false,
    });
  });

  it("starts at 09:00 for another day, and honours a clicked week-slot time", () => {
    const now = new Date("2026-10-21T14:07:00+08:00");
    expect(defaultRangeForDate("2026-10-25", null, now, TZ).startWall).toBe("2026-10-25T09:00");
    expect(defaultRangeForDate("2026-10-25", "10:07", now, TZ)).toEqual<QuickCreateRange>({
      startWall: "2026-10-25T10:00",
      endWall: "2026-10-25T11:00",
      allDay: false,
    });
  });

  it("snaps a clicked slot to a quarter hour and keeps a 60-minute block", () => {
    const now = new Date("2026-10-21T14:07:00+08:00");
    expect(defaultRangeForDate("2026-10-25", "10:52", now, TZ)).toEqual<QuickCreateRange>({
      startWall: "2026-10-25T10:45",
      endWall: "2026-10-25T11:45",
      allDay: false,
    });
  });

  it("rolls into the next day when the block crosses midnight", () => {
    const now = new Date("2026-10-21T14:07:00+08:00");
    expect(defaultRangeForDate("2026-10-25", "23:30", now, TZ)).toEqual<QuickCreateRange>({
      startWall: "2026-10-25T23:30",
      endWall: "2026-10-26T00:30",
      allDay: false,
    });
  });
});

describe("defaultRangeFromSelection", () => {
  it("uses midnight-to-midnight for an all-day selection", () => {
    expect(
      defaultRangeFromSelection(taipei("2026-10-22T00:00"), taipei("2026-10-24T00:00"), true, TZ),
    ).toEqual<QuickCreateRange>({
      startWall: "2026-10-22T00:00",
      endWall: "2026-10-24T00:00",
      allDay: true,
    });
  });

  it("keeps the dragged wall times for a timed selection", () => {
    expect(
      defaultRangeFromSelection(taipei("2026-10-22T14:00"), taipei("2026-10-22T16:30"), false, TZ),
    ).toEqual<QuickCreateRange>({
      startWall: "2026-10-22T14:00",
      endWall: "2026-10-22T16:30",
      allDay: false,
    });
  });
});
