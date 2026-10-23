import { describe, expect, it } from "vitest";
import {
  anchorRepeat,
  formatRepeatRule,
  newRepeatOptions,
  parseRepeatRule,
  validateRepeat,
  weekdayOfDate,
  weekdayOrder,
  type RepeatContext,
  type RepeatOptions,
} from "@/lib/recurrence/rule";

const TAIPEI: RepeatContext = { allDay: false, timezone: "Asia/Taipei" };
const LONDON: RepeatContext = { allDay: false, timezone: "Europe/London" };
const ALL_DAY: RepeatContext = { allDay: true, timezone: "Asia/Taipei" };

/** Wednesday 21 October 2026. */
const WED = "2026-10-21";
/** Monday 26 October 2026. */
const MON = "2026-10-26";

function options(overrides: Partial<RepeatOptions> = {}): RepeatOptions {
  return {
    frequency: "WEEKLY",
    interval: 1,
    weekdays: [3],
    monthly: { mode: "weekday", ordinal: 3, weekday: 3 },
    end: { mode: "never" },
    weekStart: "MO",
    advanced: false,
    ...overrides,
  };
}

describe("formatRepeatRule", () => {
  it("writes each Google Calendar shape", () => {
    expect(formatRepeatRule(options({ frequency: "DAILY" }), WED, TAIPEI)).toBe("FREQ=DAILY");
    expect(formatRepeatRule(options(), WED, TAIPEI)).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(
      formatRepeatRule(options({ weekdays: [1, 3], interval: 2 }), WED, TAIPEI),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
    expect(
      formatRepeatRule(options({ weekdays: [1, 2, 3, 4, 5] }), WED, TAIPEI),
    ).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(
      formatRepeatRule(
        options({ frequency: "MONTHLY", monthly: { mode: "dayOfMonth", day: 24 }, interval: 3 }),
        WED,
        TAIPEI,
      ),
    ).toBe("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=24");
    expect(
      formatRepeatRule(
        options({ frequency: "MONTHLY", monthly: { mode: "weekday", ordinal: 2, weekday: 2 } }),
        WED,
        TAIPEI,
      ),
    ).toBe("FREQ=MONTHLY;BYDAY=2TU");
    expect(
      formatRepeatRule(
        options({ frequency: "MONTHLY", monthly: { mode: "weekday", ordinal: -1, weekday: 5 } }),
        WED,
        TAIPEI,
      ),
    ).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    expect(
      formatRepeatRule(options({ frequency: "YEARLY", interval: 3 }), WED, TAIPEI),
    ).toBe("FREQ=YEARLY;INTERVAL=3");
  });

  it("keeps a Sunday week start only on a weekly rule", () => {
    expect(formatRepeatRule(options({ weekStart: "SU" }), WED, TAIPEI)).toBe(
      "FREQ=WEEKLY;BYDAY=WE;WKST=SU",
    );
    expect(formatRepeatRule(options({ frequency: "DAILY", weekStart: "SU" }), WED, TAIPEI)).toBe(
      "FREQ=DAILY",
    );
  });

  it("writes an inclusive end date the way Google does per event shape", () => {
    expect(
      formatRepeatRule(options({ end: { mode: "on", date: "2027-12-31" } }), WED, ALL_DAY),
    ).toBe("FREQ=WEEKLY;BYDAY=WE;UNTIL=20271231");
    expect(
      formatRepeatRule(options({ end: { mode: "on", date: "2027-12-31" } }), WED, TAIPEI),
    ).toBe("FREQ=WEEKLY;BYDAY=WE;UNTIL=20271231T155959Z");
    expect(
      formatRepeatRule(options({ end: { mode: "on", date: "2027-12-31" } }), WED, LONDON),
    ).toBe("FREQ=WEEKLY;BYDAY=WE;UNTIL=20271231T235959Z");
  });

  it("writes a count for After N occurrences", () => {
    expect(formatRepeatRule(options({ end: { mode: "after", count: 5 } }), WED, TAIPEI)).toBe(
      "FREQ=WEEKLY;BYDAY=WE;COUNT=5",
    );
  });
});

describe("parseRepeatRule", () => {
  it("round-trips every rule the editor can write", () => {
    const cases: Array<[RepeatOptions, RepeatContext]> = [
      [options({ frequency: "DAILY", end: { mode: "after", count: 10 } }), TAIPEI],
      [options({ weekdays: [1, 3], interval: 2, weekStart: "SU" }), TAIPEI],
      [options({ end: { mode: "on", date: "2027-12-31" } }), ALL_DAY],
      [options({ end: { mode: "on", date: "2027-12-31" } }), TAIPEI],
      [options({ frequency: "MONTHLY", monthly: { mode: "dayOfMonth", day: 24 } }), TAIPEI],
      [
        options({ frequency: "MONTHLY", monthly: { mode: "weekday", ordinal: -1, weekday: 5 } }),
        TAIPEI,
      ],
      [options({ frequency: "YEARLY", interval: 3 }), TAIPEI],
    ];

    for (const [value, context] of cases) {
      const rule = formatRepeatRule(value, WED, context);
      const parsed = parseRepeatRule(rule, WED, context);
      expect(parsed, rule).not.toBeNull();
      expect({ ...parsed, advanced: false }, rule).toMatchObject({
        ...value,
        advanced: false,
      });
    }
  });

  it("reads Google Calendar's real export shapes in any part order", () => {
    expect(parseRepeatRule("FREQ=WEEKLY;WKST=SU;COUNT=26;INTERVAL=2;BYDAY=TH", WED, TAIPEI)).toMatchObject({
      frequency: "WEEKLY",
      interval: 2,
      weekdays: [4],
      weekStart: "SU",
      end: { mode: "after", count: 26 },
    });
    expect(
      parseRepeatRule("FREQ=MONTHLY;BYDAY=1WE;UNTIL=20090701T150000Z;WKST=SU", WED, TAIPEI),
    ).toMatchObject({
      frequency: "MONTHLY",
      monthly: { mode: "weekday", ordinal: 1, weekday: 3 },
      weekStart: "SU",
      end: { mode: "on", date: "2009-07-01" },
    });
    expect(parseRepeatRule("FREQ=WEEKLY", MON, TAIPEI)).toMatchObject({ weekdays: [1] });
    expect(parseRepeatRule("FREQ=MONTHLY", WED, TAIPEI)).toMatchObject({
      monthly: { mode: "dayOfMonth", day: 21 },
    });
  });

  it("converts a timed UNTIL into the series zone's date", () => {
    // 09:59:59 BST is the floating cut-off for a London 09:00 series on 6 Apr 2027.
    expect(
      parseRepeatRule("FREQ=WEEKLY;BYDAY=TU;UNTIL=20270406T085959Z", WED, LONDON),
    ).toMatchObject({ end: { mode: "on", date: "2027-04-06" } });
  });

  it("returns null for a frequency the editor cannot express and flags unmodelled parts", () => {
    expect(parseRepeatRule("FREQ=HOURLY", WED, TAIPEI)).toBeNull();
    expect(parseRepeatRule("", WED, TAIPEI)).toBeNull();
    expect(parseRepeatRule("FREQ=WEEKLY;BYYEARDAY=100", WED, TAIPEI)).toMatchObject({
      advanced: true,
    });
  });
});

describe("weekday helpers", () => {
  it("orders the toggle row by the household week start", () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOfDate(WED)).toBe(3);
  });
});

describe("newRepeatOptions", () => {
  it("anchors a new weekly rule on the start weekday", () => {
    expect(newRepeatOptions("WEEKLY", WED, "MO")).toMatchObject({
      frequency: "WEEKLY",
      weekdays: [3],
      interval: 1,
      end: { mode: "never" },
    });
  });

  it("anchors a new monthly rule on the nth weekday, like Google", () => {
    expect(newRepeatOptions("MONTHLY", WED, "MO")).toMatchObject({
      monthly: { mode: "weekday", ordinal: 3, weekday: 3 },
    });
  });
});

describe("anchorRepeat", () => {
  it("moves the weekday when the start date moves", () => {
    expect(anchorRepeat(options({ weekdays: [3] }), MON)).toMatchObject({ weekdays: [1] });
  });

  it("re-derives the monthly day or ordinal from the new start date", () => {
    expect(
      anchorRepeat(
        options({ frequency: "MONTHLY", monthly: { mode: "dayOfMonth", day: 21 } }),
        MON,
      ),
    ).toMatchObject({ monthly: { mode: "dayOfMonth", day: 26 } });
    expect(
      anchorRepeat(
        options({
          frequency: "MONTHLY",
          monthly: { mode: "weekday", ordinal: 3, weekday: 3 },
        }),
        "2026-11-01",
      ),
    ).toMatchObject({ monthly: { mode: "weekday", ordinal: 1, weekday: 0 } });
  });
});

describe("validateRepeat", () => {
  it("accepts a bounded, well-formed rule", () => {
    expect(
      validateRepeat(options({ end: { mode: "on", date: WED } }), WED, TAIPEI),
    ).toBeNull();
    expect(
      validateRepeat(options({ end: { mode: "after", count: 730 } }), WED, TAIPEI),
    ).toBeNull();
  });

  it("rejects an end before the first occurrence", () => {
    expect(
      validateRepeat(options({ end: { mode: "on", date: "2026-10-20" } }), WED, TAIPEI),
    ).toMatch(/end/i);
  });

  it("rejects a weekly rule with no weekday", () => {
    expect(validateRepeat(options({ weekdays: [] }), WED, TAIPEI)).toMatch(/day/i);
  });

  it("rejects impossible monthly and interval values", () => {
    expect(
      validateRepeat(
        options({ frequency: "MONTHLY", monthly: { mode: "dayOfMonth", day: 32 } }),
        WED,
        TAIPEI,
      ),
    ).toMatch(/day/i);
    expect(validateRepeat(options({ interval: 0 }), WED, TAIPEI)).toMatch(/repeat every/i);
    expect(
      validateRepeat(options({ end: { mode: "after", count: 731 } }), WED, TAIPEI),
    ).toMatch(/730/);
  });

  it("rejects an end date that would exceed Google's 730-occurrence cap", () => {
    expect(
      validateRepeat(options({ frequency: "DAILY", end: { mode: "on", date: "2029-10-21" } }), WED, TAIPEI),
    ).toMatch(/730/);
  });
});
