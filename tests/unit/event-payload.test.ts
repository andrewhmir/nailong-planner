import { describe, expect, it } from "vitest";
import {
  buildEventPayload,
  type EventFormValues,
} from "@/components/calendar/eventPayload";

const TZ = "Asia/Taipei";

function values(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    title: "Weekly class",
    calendarId: "cal-1",
    description: "",
    location: "",
    allDay: false,
    startDate: "2026-10-21",
    startTime: "19:00",
    endDate: "2026-10-21",
    endTime: "20:30",
    repeat: "weekly",
    initialRepeat: "weekly",
    initialRule: "FREQ=WEEKLY;BYDAY=TU;INTERVAL=2",
    timezone: TZ,
    ...overrides,
  };
}

describe("buildEventPayload", () => {
  it("keeps a complex rule byte-identical when only other fields change (review focus 4)", () => {
    const payload = buildEventPayload(values({ title: "Renamed", location: "Hall" }));
    expect(payload.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;INTERVAL=2");
  });

  it("writes a preset rule only when the Repeat control actually changed", () => {
    expect(buildEventPayload(values({ repeat: "none" })).rrule).toBeNull();
    expect(buildEventPayload(values({ repeat: "monthly" })).rrule).toBe("FREQ=MONTHLY");
    expect(buildEventPayload(values({ repeat: "daily", initialRepeat: "weekly" })).rrule).toBe(
      "FREQ=DAILY",
    );
  });

  it("clears the rule on create when the initial rule is null", () => {
    expect(buildEventPayload(values({ initialRule: null })).rrule).toBe("FREQ=WEEKLY");
  });

  it("turns an all-day form into inclusive dates with no instants", () => {
    const payload = buildEventPayload(
      values({ allDay: true, startDate: "2026-10-21", endDate: "2026-10-23" }),
    );
    expect(payload).toMatchObject({
      allDay: true,
      startDate: "2026-10-21",
      endDate: "2026-10-23",
      startAt: null,
      endAt: null,
    });
  });

  it("keeps an inverted all-day range from reaching the server", () => {
    const payload = buildEventPayload(
      values({ allDay: true, startDate: "2026-10-23", endDate: "2026-10-21" }),
    );
    expect(payload.endDate).toBe("2026-10-23");
  });

  it("trims empty optional text to null", () => {
    const payload = buildEventPayload(values({ description: "  ", location: "" }));
    expect(payload.description).toBeNull();
    expect(payload.location).toBeNull();
  });
});
