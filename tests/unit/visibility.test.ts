import { describe, expect, it } from "vitest";
import type { CollectionRow } from "@/lib/db/schema";
import {
  DEFAULT_VISIBILITY,
  groupOf,
  isCollectionVisible,
  parseVisibility,
  type VisibilityState,
} from "@/lib/ui/visibility";

const viewer = "user-a";

function collection(overrides: Partial<CollectionRow>): CollectionRow {
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

describe("collection visibility", () => {
  it("groups collections into ours, mine and partner regardless of kind", () => {
    expect(groupOf(collection({ ownerId: null }), viewer)).toBe("ours");
    expect(groupOf(collection({ ownerId: "user-a" }), viewer)).toBe("me");
    expect(groupOf(collection({ ownerId: "user-b" }), viewer)).toBe("partner");
    expect(groupOf(collection({ ownerId: "user-a", kind: "list" }), viewer)).toBe("me");
  });

  it("shows everything by default", () => {
    expect(isCollectionVisible(DEFAULT_VISIBILITY, collection({}), viewer)).toBe(true);
    expect(isCollectionVisible(DEFAULT_VISIBILITY, collection({ id: "child" }), viewer)).toBe(
      true,
    );
    expect(
      isCollectionVisible(DEFAULT_VISIBILITY, collection({ id: "list-1", kind: "list" }), viewer),
    ).toBe(true);
  });

  it("multiplies the group pill with the per-collection checkbox", () => {
    const hiddenGroup: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ...DEFAULT_VISIBILITY.groups, partner: false },
    };
    expect(isCollectionVisible(hiddenGroup, collection({ ownerId: "user-b" }), viewer)).toBe(false);
    expect(isCollectionVisible(hiddenGroup, collection({ ownerId: "user-a" }), viewer)).toBe(true);

    const unchecked: VisibilityState = { ...DEFAULT_VISIBILITY, collections: { c1: false } };
    expect(isCollectionVisible(unchecked, collection({}), viewer)).toBe(false);
  });

  it("hides a sub-calendar when its parent is hidden", () => {
    const parentHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      collections: { "parent-id": false },
    };
    const child = collection({ id: "child-id", parentId: "parent-id", ownerId: "user-a" });
    const parent = collection({ id: "parent-id" });

    expect(isCollectionVisible(parentHidden, parent, viewer)).toBe(false);
    expect(isCollectionVisible(parentHidden, child, viewer, parent)).toBe(false);
  });

  it("hides a list branch exactly like a calendar branch", () => {
    const listHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      collections: { "work-list": false },
    };
    const workList = collection({ id: "work-list", kind: "list", ownerId: "user-a" });
    const clientList = collection({
      id: "client-list",
      parentId: "work-list",
      kind: "list",
    });
    const school = collection({ id: "school" });

    expect(isCollectionVisible(listHidden, workList, viewer)).toBe(false);
    expect(isCollectionVisible(listHidden, clientList, viewer, workList)).toBe(false);
    // A calendar id's checkbox is untouched by the list override.
    expect(isCollectionVisible(listHidden, school, viewer)).toBe(true);
  });

  it("groups a sub-collection by its parent's owner, not its stale row", () => {
    // A shared child under a person-owned root was the pre-backfill state.
    const staleChild = collection({ id: "child-id", parentId: "root-id", ownerId: null });
    const myRoot = collection({ id: "root-id", ownerId: "user-a" });
    const partnerRoot = collection({ id: "root-id", ownerId: "user-b" });

    expect(groupOf(staleChild, viewer, myRoot)).toBe("me");
    expect(groupOf(staleChild, viewer, partnerRoot)).toBe("partner");
    expect(groupOf(staleChild, viewer, collection({ id: "root-id", ownerId: null }))).toBe("ours");
    // A stray child owner cannot outrank the parent either.
    const strayOwned = collection({ id: "child-id", parentId: "root-id", ownerId: "user-b" });
    expect(groupOf(strayOwned, viewer, myRoot)).toBe("me");
  });

  it("shows a shared sub-calendar under a person-owned parent when Ours is hidden", () => {
    const oursHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: false, me: true, partner: true },
    };
    const myRoot = collection({ id: "root-id", ownerId: "user-a" });
    const staleChild = collection({ id: "child-id", parentId: "root-id", ownerId: null });

    expect(isCollectionVisible(oursHidden, myRoot, viewer)).toBe(true);
    expect(isCollectionVisible(oursHidden, staleChild, viewer, myRoot)).toBe(true);

    // The partner's pill still hides a child of their parent.
    const partnerHidden: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: true, me: true, partner: false },
    };
    expect(
      isCollectionVisible(
        partnerHidden,
        staleChild,
        viewer,
        collection({ id: "root-id", ownerId: "user-b" }),
      ),
    ).toBe(false);
  });

  it("never hides a private row on the client — privacy is the server's filter", () => {
    // A private collection only reaches its owner, and the display rules must
    // not add a second, divergent privacy check.
    const mine = collection({ id: "secret-list", kind: "list", ownerId: viewer, visibility: "private" });

    expect(isCollectionVisible(DEFAULT_VISIBILITY, mine, viewer)).toBe(true);
    expect(groupOf(mine, viewer)).toBe("me");
  });
});

describe("display only this collection", () => {
  it("draws exactly the isolated calendar and nothing else", () => {
    const only: VisibilityState = { ...DEFAULT_VISIBILITY, only: "c1" };

    expect(isCollectionVisible(only, collection({ id: "c1" }), viewer)).toBe(true);
    expect(isCollectionVisible(only, collection({ id: "c2" }), viewer)).toBe(false);
  });

  it("isolates a list id the same way", () => {
    const only: VisibilityState = { ...DEFAULT_VISIBILITY, only: "list-1" };

    expect(isCollectionVisible(only, collection({ id: "list-1", kind: "list" }), viewer)).toBe(
      true,
    );
    expect(isCollectionVisible(only, collection({ id: "c1" }), viewer)).toBe(false);
  });

  it("outranks the pills and the per-collection checkboxes", () => {
    // Even with every pill off and the isolated calendar's own box unticked, the
    // view the user explicitly asked for is what gets drawn.
    const only: VisibilityState = {
      ...DEFAULT_VISIBILITY,
      groups: { ours: false, me: false, partner: false },
      collections: { c1: false },
      only: "c1",
    };

    expect(isCollectionVisible(only, collection({ id: "c1" }), viewer)).toBe(true);
  });

  it("keeps a parent's sub-calendars hidden — only that one calendar is drawn", () => {
    const only: VisibilityState = { ...DEFAULT_VISIBILITY, only: "parent-id" };
    const parent = collection({ id: "parent-id" });
    const child = collection({ id: "child-id", parentId: "parent-id" });

    expect(isCollectionVisible(only, parent, viewer)).toBe(true);
    expect(isCollectionVisible(only, child, viewer, parent)).toBe(false);
  });

  it("restores the normal view once cleared", () => {
    const cleared: VisibilityState = { ...DEFAULT_VISIBILITY, only: null };

    expect(isCollectionVisible(cleared, collection({ id: "c1" }), viewer)).toBe(true);
    expect(isCollectionVisible(cleared, collection({ id: "c2" }), viewer)).toBe(true);
  });
});

describe("parseVisibility", () => {
  it("round-trips stored state", () => {
    const stored: VisibilityState = {
      groups: { ours: true, me: false, partner: true },
      collections: { "list-1": false, school: true },
      only: "list-1",
    };
    expect(parseVisibility(JSON.stringify(stored))).toEqual(stored);
  });

  it("reads collection ids and ignores the legacy calendars map", () => {
    const parsed = parseVisibility(
      JSON.stringify({
        groups: { me: false },
        collections: { "list-1": false },
        calendars: { school: false },
        only: "list-1",
      }),
    );

    expect(parsed).toEqual({
      groups: { ours: true, me: false, partner: true },
      collections: { "list-1": false },
      only: "list-1",
    });
    // A pre-v0.2 body with only the old key means "nothing overridden".
    expect(parseVisibility(JSON.stringify({ calendars: { school: false } }))).toEqual(
      DEFAULT_VISIBILITY,
    );
  });

  it("falls back to the defaults for missing or corrupt storage", () => {
    for (const raw of [null, "", "{not json", "[]", "null", '"text"', "42"]) {
      expect(parseVisibility(raw)).toEqual(DEFAULT_VISIBILITY);
    }
  });

  it("drops entries that are not booleans or a real id instead of trusting them", () => {
    const parsed = parseVisibility(
      JSON.stringify({
        groups: { me: "hidden", ours: false },
        collections: { school: 0, work: true },
        only: 7,
      }),
    );

    expect(parsed.groups.me).toBe(true);
    expect(parsed.groups.ours).toBe(false);
    expect(parsed.collections).toEqual({ work: true });
    expect(parsed.only).toBeNull();
  });
});
