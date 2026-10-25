import { describe, expect, it } from "vitest";
import type { CollectionRow } from "@/lib/db/schema";
import type { CollectionNode } from "@/lib/services/collections";
import { DEFAULT_VISIBILITY, type VisibilityState } from "@/lib/ui/visibility";
import { visibleCollectionIds } from "@/lib/ui/visibleCollections";

const viewer = "user-a";

function calendar(overrides: Partial<CollectionRow> & Pick<CollectionRow, "id" | "name">): CollectionRow {
  return {
    householdId: "h1",
    parentId: null,
    hueFamily: "sky",
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

const school = calendar({ id: "school", name: "School", ownerId: viewer });
const math = calendar({ id: "math", name: "Math", parentId: "school", ownerId: viewer });
const household = calendar({ id: "household", name: "Household" });

const roots: CollectionNode[] = [
  { ...household, children: [] },
  { ...school, children: [math] },
];

describe("visibleCollectionIds", () => {
  it("includes every root and child by default", () => {
    expect([...visibleCollectionIds(roots, DEFAULT_VISIBILITY, viewer)].sort()).toEqual([
      "household",
      "math",
      "school",
    ]);
  });

  it("surfaces an isolated sub-calendar even though its parent is filtered out", () => {
    // Regression: an early `continue` on the hidden parent used to prune the
    // branch, leaving the grid with no visible calendar at all.
    const onlyChild: VisibilityState = { ...DEFAULT_VISIBILITY, only: "math" };

    expect([...visibleCollectionIds(roots, onlyChild, viewer)]).toEqual(["math"]);
  });

  it("surfaces only the isolated root, not its sub-calendars", () => {
    const onlyRoot: VisibilityState = { ...DEFAULT_VISIBILITY, only: "school" };

    expect([...visibleCollectionIds(roots, onlyRoot, viewer)]).toEqual(["school"]);
  });

  it("hides a sub-calendar when its parent's checkbox is cleared", () => {
    const parentHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      collections: { school: false },
    };

    // Clearing the root hides the root itself and everything beneath it.
    expect([...visibleCollectionIds(roots, parentHidden, viewer)]).toEqual(["household"]);
  });

  it("draws a stale shared sub-calendar under a person-owned root when Ours is off", () => {
    // Legacy rows: the child kept owner_id NULL after its parent was re-owned.
    const staleMath = calendar({ id: "stale-math", name: "Algebra", parentId: "school" });
    const legacyRoots: CollectionNode[] = [{ ...school, children: [staleMath] }];
    const oursHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: false, me: true, partner: true },
    };

    expect([...visibleCollectionIds(legacyRoots, oursHidden, viewer)].sort()).toEqual([
      "school",
      "stale-math",
    ]);
  });
});
