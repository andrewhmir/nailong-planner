import { describe, expect, it } from "vitest";
import type { CollectionRow } from "@/lib/db/schema";
import type { CollectionNode } from "@/lib/services/collections";
import { DEFAULT_VISIBILITY, type VisibilityState } from "@/lib/ui/visibility";
import { hiddenCollectionIds, visibleCollectionIds } from "@/lib/ui/visibleCollections";

const viewer = "user-a";

function collection(
  overrides: Partial<CollectionRow> & Pick<CollectionRow, "id" | "name">,
): CollectionRow {
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

const school = collection({ id: "school", name: "School", ownerId: viewer });
const math = collection({ id: "math", name: "Math", parentId: "school", ownerId: viewer });
const household = collection({ id: "household", name: "Household" });

const workList = collection({ id: "work-list", name: "Work", kind: "list", ownerId: viewer });
const clientList = collection({
  id: "client-list",
  name: "Client A",
  parentId: "work-list",
  kind: "list",
  shadeIndex: 0,
});
const inbox = collection({ id: "inbox", name: "Inbox", kind: "list", ownerId: viewer });

const roots: CollectionNode[] = [
  { ...household, children: [] },
  { ...school, children: [math] },
];

/** A mixed tree: calendars and lists side by side, plus a private list. */
const mixedRoots: CollectionNode[] = [
  { ...household, children: [] },
  { ...school, children: [math] },
  { ...workList, children: [clientList] },
  { ...inbox, children: [] },
];

describe("visibleCollectionIds", () => {
  it("includes every root and child by default", () => {
    expect([...visibleCollectionIds(roots, DEFAULT_VISIBILITY, viewer)].sort()).toEqual([
      "household",
      "math",
      "school",
    ]);
  });

  it("draws list ids alongside calendar ids", () => {
    expect([...visibleCollectionIds(mixedRoots, DEFAULT_VISIBILITY, viewer)].sort()).toEqual([
      "client-list",
      "household",
      "inbox",
      "math",
      "school",
      "work-list",
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

  it("hides a list branch exactly like a calendar branch", () => {
    const listHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      collections: { "work-list": false },
    };

    expect([...visibleCollectionIds(mixedRoots, listHidden, viewer)].sort()).toEqual([
      "household",
      "inbox",
      "math",
      "school",
    ]);
  });

  it("isolates a list child like a calendar child", () => {
    const onlyListChild: VisibilityState = { ...DEFAULT_VISIBILITY, only: "client-list" };

    expect([...visibleCollectionIds(mixedRoots, onlyListChild, viewer)]).toEqual(["client-list"]);
  });

  it("hides a private list when the owner's me pill is off", () => {
    // The server already drops a partner's private rows; the display layer only
    // applies the same pill/checkbox rules to the owner's copy.
    const meHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: true, me: false, partner: true },
    };

    expect([...visibleCollectionIds(mixedRoots, meHidden, viewer)]).toEqual(["household"]);
  });

  it("draws a stale shared sub-calendar under a person-owned root when Ours is off", () => {
    // Legacy rows: the child kept owner_id NULL after its parent was re-owned.
    const staleMath = collection({ id: "stale-math", name: "Algebra", parentId: "school" });
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

/**
 * The tasks workspace asks the server to omit these ids, so the pill/checkbox
 * state reaches `/api/tasks` as a plain collection-id list. It must be the exact
 * complement of the drawn set: a stale extra id would hide rows the sidebar
 * still shows, and a missing id would leak a hidden person's tasks and counts.
 */
describe("hiddenCollectionIds", () => {
  it("is empty when every root and child is drawn", () => {
    expect(hiddenCollectionIds(mixedRoots, DEFAULT_VISIBILITY, viewer)).toEqual([]);
  });

  it("lists every id the person pills hide, in stable sorted order", () => {
    const meHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: true, me: false, partner: true },
    };

    // "Ours" stays drawn; every owner-tagged root (and its child) is hidden.
    expect(hiddenCollectionIds(mixedRoots, meHidden, viewer)).toEqual([
      "client-list",
      "inbox",
      "math",
      "school",
      "work-list",
    ]);
  });

  it("hides a root's whole branch when its checkbox is off", () => {
    const workHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      collections: { "work-list": false },
    };

    expect(hiddenCollectionIds(mixedRoots, workHidden, viewer)).toEqual([
      "client-list",
      "work-list",
    ]);
  });

  it("hides everything but the isolated collection in only mode", () => {
    const onlyMath: VisibilityState = { ...DEFAULT_VISIBILITY, only: "math" };

    expect(hiddenCollectionIds(roots, onlyMath, viewer)).toEqual(["household", "school"]);
  });

  it("returns ids for an empty tree without throwing", () => {
    expect(hiddenCollectionIds([], DEFAULT_VISIBILITY, viewer)).toEqual([]);
  });
});
