import { describe, expect, it } from "vitest";
import { buildEventPayload, type EventFormValues } from "@/components/calendar/eventPayload";
import { newRepeatOptions, type RepeatOptions } from "@/lib/recurrence/rule";

const TZ = "Asia/Taipei";
/** Wednesday 21 October 2026. */
const WED = "2026-10-21";

function options(overrides: Partial<RepeatOptions> = {}): RepeatOptions {
  return { ...newRepeatOptions("WEEKLY", WED, "MO"), ...overrides };
}

function values(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    title: "Weekly class",
    collectionId: "cal-1",
    description: "",
    location: "",
    allDay: false,
    startDate: WED,
    startTime: "19:00",
    endDate: WED,
    endTime: "20:30",
    recurrence: options(),
    keepInitialRule: false,
    initialRule: null,
    timezone: TZ,
    ...overrides,
  };
}

describe("buildEventPayload", () => {
  it("keeps a complex rule byte-identical when the repeat controls were not touched (review focus 4)", () => {
    const payload = buildEventPayload(
      values({
        title: "Renamed",
        location: "Hall",
        initialRule: "FREQ=WEEKLY;BYDAY=TU;INTERVAL=2",
        keepInitialRule: true,
        recurrence: options({ weekdays: [2], interval: 2 }),
      }),
    );
    expect(payload.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;INTERVAL=2");
  });

  it("rebuilds the rule from the controls once they are edited", () => {
    const payload = buildEventPayload(
      values({
        initialRule: "FREQ=WEEKLY;BYDAY=TU;INTERVAL=2",
        keepInitialRule: false,
        recurrence: options({
          weekdays: [2, 4],
          interval: 2,
          end: { mode: "after", count: 5 },
        }),
      }),
    );
    expect(payload.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5");
  });

  it("clears the rule when the repeat control is set to none", () => {
    expect(
      buildEventPayload(values({ recurrence: null, initialRule: "FREQ=WEEKLY", keepInitialRule: false }))
        .rrule,
    ).toBeNull();
  });

  it("builds a rule on create, where there is no initial rule to preserve", () => {
    expect(buildEventPayload(values({ recurrence: options({ frequency: "MONTHLY" }) })).rrule).toBe(
      "FREQ=MONTHLY;BYDAY=3WE",
    );
  });

  it("writes an all-day end as a DATE and a timed end as UTC", () => {
    const weekly = options({ end: { mode: "on", date: "2026-12-31" } });
    expect(
      buildEventPayload(
        values({ allDay: true, recurrence: weekly, startDate: WED, endDate: WED }),
      ).rrule,
    ).toBe("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231");
    expect(buildEventPayload(values({ recurrence: weekly })).rrule).toBe(
      "FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T155959Z",
    );
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
