import { describe, expect, it } from "vitest";
import type { CalendarRow } from "@/lib/db/schema";
import { canWriteCalendar, type ViewerContext } from "@/lib/services/permissions";

const viewerA: ViewerContext = { userId: "user-a", householdId: "h1" };
const viewerB: ViewerContext = { userId: "user-b", householdId: "h1" };

function calendar(overrides: Partial<CalendarRow>): CalendarRow {
  return {
    id: "c1",
    householdId: "h1",
    parentId: null,
    name: "School",
    hueFamily: "indigo",
    shadeIndex: 3,
    ownerId: null,
    kind: "calendar",
    visibility: "shared",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("canWriteCalendar", () => {
  it("lets anyone in the household write a shared (ownerless) calendar", () => {
    expect(canWriteCalendar(viewerA, calendar({ ownerId: null }))).toBe(true);
    expect(canWriteCalendar(viewerB, calendar({ ownerId: null }))).toBe(true);
  });

  it("lets anyone write a calendar they do not own when it is not view-only", () => {
    expect(canWriteCalendar(viewerA, calendar({ ownerId: "user-b" }))).toBe(true);
  });

  it("lets the owner write their own view-only calendar", () => {
    expect(
      canWriteCalendar(viewerA, calendar({ ownerId: "user-a", visibility: "view_only" })),
    ).toBe(true);
  });

  it("blocks the partner from writing a view-only calendar they do not own", () => {
    expect(
      canWriteCalendar(viewerB, calendar({ ownerId: "user-a", visibility: "view_only" })),
    ).toBe(false);
  });

  it("blocks everyone from writing a view-only calendar with no owner", () => {
    expect(canWriteCalendar(viewerA, calendar({ ownerId: null, visibility: "view_only" }))).toBe(
      false,
    );
  });
});
