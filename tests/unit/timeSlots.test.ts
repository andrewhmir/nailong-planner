import { describe, expect, it } from "vitest";
import {
  formatMinutes,
  meridiemOf,
  minutesOfDay,
  nearestSlotIndex,
  parseTypedTime,
  timeSlots,
} from "@/components/calendar/timeSlots";

describe("timeSlots", () => {
  it("lists every quarter hour of the day in order", () => {
    const slots = timeSlots();
    expect(slots).toHaveLength(96);
    expect(slots[0]).toBe("00:00");
    expect(slots[1]).toBe("00:15");
    expect(slots.at(-1)).toBe("23:45");
  });

  it("honours a coarser or finer step", () => {
    expect(timeSlots(30)).toHaveLength(48);
    expect(timeSlots(5)).toHaveLength(288);
  });
});

describe("minutesOfDay / formatMinutes", () => {
  it("round-trips a canonical time", () => {
    expect(minutesOfDay("08:30")).toBe(510);
    expect(formatMinutes(510)).toBe("08:30");
  });

  it("rejects malformed or out-of-range text", () => {
    expect(minutesOfDay("24:00")).toBeNull();
    expect(minutesOfDay("08:60")).toBeNull();
    expect(minutesOfDay("8.30")).toBeNull();
    expect(minutesOfDay("")).toBeNull();
  });

  it("wraps values outside the day instead of throwing", () => {
    expect(formatMinutes(1440)).toBe("00:00");
    expect(formatMinutes(-90)).toBe("22:30");
  });
});

describe("nearestSlotIndex", () => {
  it("focuses the closest quarter hour to an off-grid value", () => {
    expect(nearestSlotIndex("08:37")).toBe(34); // 08:30 is nearer than 08:45
    expect(nearestSlotIndex("08:50")).toBe(35); // 08:45 is nearer than 09:00
    expect(nearestSlotIndex("23:59")).toBe(95); // clamped to the last row
    expect(nearestSlotIndex("nope")).toBe(0);
  });
});

describe("meridiemOf", () => {
  it("reports which half of the day a time falls in", () => {
    expect(meridiemOf("00:30")).toBe("am");
    expect(meridiemOf("11:59")).toBe("am");
    expect(meridiemOf("12:00")).toBe("pm");
    expect(meridiemOf("bad")).toBeNull();
  });
});

describe("parseTypedTime", () => {
  it("reads 24-hour input", () => {
    expect(parseTypedTime("8:37", "24h")).toBe("08:37");
    expect(parseTypedTime("08:37", "24h")).toBe("08:37");
    expect(parseTypedTime("20:37", "24h")).toBe("20:37");
    expect(parseTypedTime("8", "24h")).toBe("08:00");
  });

  it("rejects text a 24-hour household cannot mean", () => {
    expect(parseTypedTime("8:37 PM", "24h")).toBeNull();
    expect(parseTypedTime("25:00", "24h")).toBeNull();
    expect(parseTypedTime("8:75", "24h")).toBeNull();
    expect(parseTypedTime("quarter past", "24h")).toBeNull();
  });

  it("reads 12-hour input with and without a suffix", () => {
    expect(parseTypedTime("8:37 pm", "12h")).toBe("20:37");
    expect(parseTypedTime("8:37 p.m.", "12h")).toBe("20:37");
    expect(parseTypedTime("8:37 AM", "12h")).toBe("08:37");
    expect(parseTypedTime("8:37", "12h")).toBe("08:37");
    expect(parseTypedTime("8:37", "12h", "pm")).toBe("20:37");
    expect(parseTypedTime("12:00 AM", "12h")).toBe("00:00");
    expect(parseTypedTime("12 PM", "12h")).toBe("12:00");
    expect(parseTypedTime("13:00", "12h")).toBeNull();
  });
});
