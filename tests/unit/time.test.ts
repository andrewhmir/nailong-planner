import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { localWallTimeToUtc, toAllDayRange, utcToLocalWallTime } from "@/lib/time/zone";

describe("time zone helpers", () => {
  it("round-trips a Taipei wall time through UTC", () => {
    const utc = localWallTimeToUtc("2026-03-08T09:00", "Asia/Taipei");
    expect(utcToLocalWallTime(utc, "Asia/Taipei")).toBe("2026-03-08T09:00");
  });

  it("round-trips a New York wall time before and after a DST change", () => {
    const before = localWallTimeToUtc("2026-03-07T09:00", "America/New_York");
    const after = localWallTimeToUtc("2026-03-09T09:00", "America/New_York");

    expect(utcToLocalWallTime(before, "America/New_York")).toBe("2026-03-07T09:00");
    expect(utcToLocalWallTime(after, "America/New_York")).toBe("2026-03-09T09:00");
    // A daily 09:00 series is 47 hours apart across the spring-forward day, not 48.
    expect(after - before).toBe(47 * 60 * 60 * 1000);
  });

  it("rejects a local time that does not exist because of a DST gap", () => {
    expect(() => localWallTimeToUtc("2026-03-08T02:30", "America/New_York")).toThrow(AppError);
  });

  it("rejects malformed wall times", () => {
    expect(() => localWallTimeToUtc("2026-03-08", "Asia/Taipei")).toThrow(AppError);
  });

  it("keeps all-day dates as calendar dates and rejects reversed ranges", () => {
    expect(toAllDayRange("2026-03-08", "2026-03-08")).toEqual({
      startDate: "2026-03-08",
      endDate: "2026-03-08",
    });
    expect(() => toAllDayRange("2026-03-09", "2026-03-08")).toThrow(AppError);
    expect(() => toAllDayRange("2026-3-8", "2026-03-08")).toThrow(AppError);
  });
});
