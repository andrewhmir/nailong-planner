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
});
