import { describe, expect, it } from "vitest";
import type { CalendarRow } from "@/lib/db/schema";
import { DEFAULT_VISIBILITY, groupOf, isCalendarVisible, type VisibilityState } from "@/lib/ui/visibility";

const viewer = "user-a";

function calendar(overrides: Partial<CalendarRow>): CalendarRow {
  return {
    id: "c1",
    householdId: "h1",
    parentId: null,
    name: "School",
    hueFamily: "indigo",
    shadeIndex: 3,
    ownerId: null,
    isViewOnlyForPartner: 0,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("calendar visibility", () => {
  it("groups calendars into ours, mine and partner", () => {
    expect(groupOf(calendar({ ownerId: null }), viewer)).toBe("ours");
    expect(groupOf(calendar({ ownerId: "user-a" }), viewer)).toBe("me");
    expect(groupOf(calendar({ ownerId: "user-b" }), viewer)).toBe("partner");
  });

  it("shows everything by default", () => {
    expect(isCalendarVisible(DEFAULT_VISIBILITY, calendar({}), viewer)).toBe(true);
    expect(isCalendarVisible(DEFAULT_VISIBILITY, calendar({ id: "child" }), viewer)).toBe(true);
  });

  it("multiplies the group pill with the per-calendar checkbox", () => {
    const hiddenGroup: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ...DEFAULT_VISIBILITY.groups, partner: false },
    };
    expect(isCalendarVisible(hiddenGroup, calendar({ ownerId: "user-b" }), viewer)).toBe(false);
    expect(isCalendarVisible(hiddenGroup, calendar({ ownerId: "user-a" }), viewer)).toBe(true);

    const unchecked: VisibilityState = { ...DEFAULT_VISIBILITY, calendars: { c1: false } };
    expect(isCalendarVisible(unchecked, calendar({}), viewer)).toBe(false);
  });

  it("hides a sub-calendar when its parent is hidden", () => {
    const parentHidden: VisibilityState = { ...DEFAULT_VISIBILITY, calendars: { "parent-id": false } };
    const child = calendar({ id: "child-id", parentId: "parent-id", ownerId: "user-a" });
    const parent = calendar({ id: "parent-id" });

    expect(isCalendarVisible(parentHidden, parent, viewer)).toBe(false);
    expect(isCalendarVisible(parentHidden, child, viewer, parent)).toBe(false);
  });
});

describe("display only this calendar", () => {
  it("draws exactly the isolated calendar and nothing else", () => {
    const only: VisibilityState = { ...DEFAULT_VISIBILITY, only: "c1" };

    expect(isCalendarVisible(only, calendar({ id: "c1" }), viewer)).toBe(true);
    expect(isCalendarVisible(only, calendar({ id: "c2" }), viewer)).toBe(false);
  });

  it("outranks the pills and the per-calendar checkboxes", () => {
    // Even with every pill off and the isolated calendar's own box unticked, the
    // view the user explicitly asked for is what gets drawn.
    const only: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: false, me: false, partner: false },
      calendars: { c1: false },
      only: "c1",
    };

    expect(isCalendarVisible(only, calendar({ id: "c1" }), viewer)).toBe(true);
  });

  it("keeps a parent's sub-calendars hidden — only that one calendar is drawn", () => {
    const only: VisibilityState = { ...DEFAULT_VISIBILITY, only: "parent-id" };
    const parent = calendar({ id: "parent-id" });
    const child = calendar({ id: "child-id", parentId: "parent-id" });

    expect(isCalendarVisible(only, parent, viewer)).toBe(true);
    expect(isCalendarVisible(only, child, viewer, parent)).toBe(false);
  });

  it("restores the normal view once cleared", () => {
    const cleared: VisibilityState = { ...DEFAULT_VISIBILITY, only: null };

    expect(isCalendarVisible(cleared, calendar({ id: "c1" }), viewer)).toBe(true);
    expect(isCalendarVisible(cleared, calendar({ id: "c2" }), viewer)).toBe(true);
  });
});
