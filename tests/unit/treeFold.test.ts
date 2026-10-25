import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_FOLD,
  isCollectionOpen,
  isGroupOpen,
  parseTreeFold,
  setCollectionOpen,
  setGroupOpen,
  type TreeFoldState,
} from "@/lib/ui/treeFold";

describe("tree fold defaults", () => {
  it("starts every group and collection expanded", () => {
    expect(isGroupOpen(DEFAULT_TREE_FOLD, "ours")).toBe(true);
    expect(isGroupOpen(DEFAULT_TREE_FOLD, "me")).toBe(true);
    expect(isGroupOpen(DEFAULT_TREE_FOLD, "partner")).toBe(true);
    // A collection with no stored entry is expanded: folding is opt-in.
    expect(isCollectionOpen(DEFAULT_TREE_FOLD, "cal-1")).toBe(true);
    expect(isCollectionOpen(DEFAULT_TREE_FOLD, "list-1")).toBe(true);
  });
});

describe("tree fold toggles", () => {
  it("folds one group without touching the others", () => {
    const next = setGroupOpen(DEFAULT_TREE_FOLD, "me", false);
    expect(isGroupOpen(next, "me")).toBe(false);
    expect(isGroupOpen(next, "ours")).toBe(true);
    expect(isGroupOpen(next, "partner")).toBe(true);
  });

  it("folds one calendar without touching its siblings", () => {
    const next = setCollectionOpen(DEFAULT_TREE_FOLD, "school", false);
    expect(isCollectionOpen(next, "school")).toBe(false);
    expect(isCollectionOpen(next, "work")).toBe(true);
  });

  it("folds a list id exactly like a calendar id", () => {
    // Fold state is keyed by collection id only; a mixed tree must not care
    // which kind the id names.
    const next = setCollectionOpen(DEFAULT_TREE_FOLD, "inbox-list", false);
    expect(isCollectionOpen(next, "inbox-list")).toBe(false);
    expect(isCollectionOpen(next, "school")).toBe(true);

    const mixed = setCollectionOpen(next, "school", false);
    expect(isCollectionOpen(mixed, "inbox-list")).toBe(false);
    expect(isCollectionOpen(mixed, "school")).toBe(false);
    expect(isCollectionOpen(mixed, "work-list")).toBe(true);
  });

  it("does not mutate the state it was given", () => {
    const state: TreeFoldState = DEFAULT_TREE_FOLD;
    setGroupOpen(state, "me", false);
    setCollectionOpen(state, "school", false);
    expect(state).toEqual(DEFAULT_TREE_FOLD);
  });
});

describe("parseTreeFold", () => {
  it("round-trips stored state", () => {
    const stored = setCollectionOpen(
      setGroupOpen(DEFAULT_TREE_FOLD, "partner", false),
      "school",
      false,
    );
    expect(parseTreeFold(JSON.stringify(stored))).toEqual(stored);
  });

  it("round-trips a folded list id", () => {
    const stored = setCollectionOpen(DEFAULT_TREE_FOLD, "inbox-list", false);
    const parsed = parseTreeFold(JSON.stringify(stored));
    expect(isCollectionOpen(parsed, "inbox-list")).toBe(false);
    expect(isCollectionOpen(parsed, "school")).toBe(true);
  });

  it("ignores a legacy calendars map and reads only collection ids", () => {
    const parsed = parseTreeFold(
      JSON.stringify({ groups: { me: false }, calendars: { school: false } }),
    );

    expect(isGroupOpen(parsed, "me")).toBe(false);
    expect(isCollectionOpen(parsed, "school")).toBe(true);

    const migrated = parseTreeFold(JSON.stringify({ collections: { "list-1": false } }));
    expect(isCollectionOpen(migrated, "list-1")).toBe(false);
  });

  it("falls back to all-expanded defaults for missing or corrupt storage", () => {
    for (const raw of [null, "", "{not json", "[]", "null"]) {
      expect(parseTreeFold(raw)).toEqual(DEFAULT_TREE_FOLD);
    }
  });

  it("drops entries that are not booleans instead of trusting them", () => {
    const parsed = parseTreeFold(
      JSON.stringify({
        groups: { me: "folded", ours: false },
        collections: { school: 0, work: true },
      }),
    );
    expect(isGroupOpen(parsed, "me")).toBe(true);
    expect(isGroupOpen(parsed, "ours")).toBe(false);
    expect(isCollectionOpen(parsed, "school")).toBe(true);
    expect(isCollectionOpen(parsed, "work")).toBe(true);
  });
});
