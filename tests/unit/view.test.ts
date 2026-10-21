import { describe, expect, it } from "vitest";
import { resolveInitialView } from "@/lib/ui/view";

describe("resolveInitialView", () => {
  it("resolves auto to the agenda on phones and the month grid elsewhere", () => {
    expect(resolveInitialView("auto", true)).toBe("listMonth");
    expect(resolveInitialView("auto", false)).toBe("dayGridMonth");
  });

  it("passes an explicit preference through untouched", () => {
    expect(resolveInitialView("timeGridWeek", true)).toBe("timeGridWeek");
    expect(resolveInitialView("timeGridDay", false)).toBe("timeGridDay");
    expect(resolveInitialView("listMonth", false)).toBe("listMonth");
    expect(resolveInitialView("dayGridMonth", true)).toBe("dayGridMonth");
  });
});
