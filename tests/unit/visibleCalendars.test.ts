import { describe, expect, it } from "vitest";
import type { CalendarRow } from "@/lib/db/schema";
import type { CalendarNode } from "@/lib/services/calendars";
import { DEFAULT_VISIBILITY, type VisibilityState } from "@/lib/ui/visibility";
import { visibleCalendarIds } from "@/lib/ui/visibleCalendars";

const viewer = "user-a";

function calendar(overrides: Partial<CalendarRow> & Pick<CalendarRow, "id" | "name">): CalendarRow {
  return {
    householdId: "h1",
    parentId: null,
    hueFamily: "sky",
    shadeIndex: 3,
    ownerId: null,
    isViewOnlyForPartner: 0,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const school = calendar({ id: "school", name: "School", ownerId: viewer });
const math = calendar({ id: "math", name: "Math", parentId: "school", ownerId: viewer });
const household = calendar({ id: "household", name: "Household" });

const roots: CalendarNode[] = [
  { ...household, children: [] },
  { ...school, children: [math] },
];

describe("visibleCalendarIds", () => {
  it("includes every root and child by default", () => {
    expect([...visibleCalendarIds(roots, DEFAULT_VISIBILITY, viewer)].sort()).toEqual([
      "household",
      "math",
      "school",
    ]);
  });

  it("surfaces an isolated sub-calendar even though its parent is filtered out", () => {
    // Regression: an early `continue` on the hidden parent used to prune the
    // branch, leaving the grid with no visible calendar at all.
    const onlyChild: VisibilityState = { ...DEFAULT_VISIBILITY, only: "math" };

    expect([...visibleCalendarIds(roots, onlyChild, viewer)]).toEqual(["math"]);
  });

  it("surfaces only the isolated root, not its sub-calendars", () => {
    const onlyRoot: VisibilityState = { ...DEFAULT_VISIBILITY, only: "school" };

    expect([...visibleCalendarIds(roots, onlyRoot, viewer)]).toEqual(["school"]);
  });

  it("hides a sub-calendar when its parent's checkbox is cleared", () => {
    const parentHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      calendars: { school: false },
    };

    // Clearing the root hides the root itself and everything beneath it.
    expect([...visibleCalendarIds(roots, parentHidden, viewer)]).toEqual(["household"]);
  });

  it("draws a stale shared sub-calendar under a person-owned root when Ours is off", () => {
    // Legacy rows: the child kept owner_id NULL after its parent was re-owned.
    const staleMath = calendar({ id: "stale-math", name: "Algebra", parentId: "school" });
    const legacyRoots: CalendarNode[] = [{ ...school, children: [staleMath] }];
    const oursHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: false, me: true, partner: true },
    };

    expect([...visibleCalendarIds(legacyRoots, oursHidden, viewer)].sort()).toEqual([
      "school",
      "stale-math",
    ]);
  });
});
