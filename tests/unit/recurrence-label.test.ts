import { describe, expect, it } from "vitest";
import { describeRrule } from "@/lib/recurrence/label";

describe("describeRrule", () => {
  it("describes common Google Calendar rules", () => {
    expect(describeRrule("FREQ=WEEKLY;BYDAY=TU")).toBe("Weekly on Tuesday");
    expect(describeRrule("FREQ=WEEKLY;INTERVAL=2")).toBe("Every 2 weeks");
    expect(describeRrule("FREQ=MONTHLY;BYDAY=1MO")).toBe("Monthly on the first Monday");
    expect(describeRrule("FREQ=DAILY")).toBe("Daily");
  });

  it("keeps the interval and the weekday together", () => {
    expect(describeRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")).toBe("Every 2 weeks on Tuesday");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Weekly on Monday and Wednesday");
    expect(describeRrule("FREQ=MONTHLY;BYDAY=-1FR")).toBe("Monthly on the last Friday");
    expect(describeRrule("FREQ=YEARLY;INTERVAL=3")).toBe("Every 3 years");
  });

  it("never throws on an unknown rule and returns an empty string", () => {
    expect(describeRrule("FREQ=SOMETHING")).toBe("");
    expect(describeRrule("")).toBe("");
    expect(describeRrule("BYDAY=TU")).toBe("");
  });

  it("describes a day-of-month monthly rule", () => {
    expect(describeRrule("FREQ=MONTHLY;BYMONTHDAY=21")).toBe("Monthly on the 21st");
    expect(describeRrule("FREQ=MONTHLY;BYMONTHDAY=1")).toBe("Monthly on the 1st");
    expect(describeRrule("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=22")).toBe(
      "Every 3 months on the 22nd",
    );
  });

  it("describes the end of a bounded series", () => {
    expect(describeRrule("FREQ=WEEKLY;COUNT=5")).toBe("Weekly, 5 times");
    expect(describeRrule("FREQ=DAILY;COUNT=1")).toBe("Daily, 1 time");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=TU;UNTIL=20271231T155959Z", { timezone: "Asia/Taipei" })).toMatch(
      /^Weekly on Tuesday, until .*31 Dec 2027$/,
    );
    // All-day rules carry a DATE-only UNTIL with no zone.
    expect(describeRrule("FREQ=WEEKLY;BYDAY=TU;UNTIL=20271231", { allDay: true })).toMatch(
      /^Weekly on Tuesday, until .*31 Dec 2027$/,
    );
  });

  it("turns a timed UNTIL into the household's local date", () => {
    // 23:30Z on 30 Jun is already 1 Jul in Taipei (UTC+8).
    expect(describeRrule("FREQ=DAILY;UNTIL=20270630T233000Z", { timezone: "Asia/Taipei" })).toMatch(
      /until .*1 Jul 2027$/,
    );
    expect(describeRrule("FREQ=DAILY;UNTIL=20270630T233000Z", { timezone: "UTC" })).toMatch(
      /until .*30 Jun 2027$/,
    );
  });
});
