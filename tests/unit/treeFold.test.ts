import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_FOLD,
  isCalendarOpen,
  isGroupOpen,
  parseTreeFold,
  setCalendarOpen,
  setGroupOpen,
  type TreeFoldState,
} from "@/lib/ui/treeFold";

describe("tree fold defaults", () => {
  it("starts every group and calendar expanded", () => {
    expect(isGroupOpen(DEFAULT_TREE_FOLD, "ours")).toBe(true);
    expect(isGroupOpen(DEFAULT_TREE_FOLD, "me")).toBe(true);
    expect(isGroupOpen(DEFAULT_TREE_FOLD, "partner")).toBe(true);
    // A calendar with no stored entry is expanded: folding is opt-in.
    expect(isCalendarOpen(DEFAULT_TREE_FOLD, "cal-1")).toBe(true);
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
    const next = setCalendarOpen(DEFAULT_TREE_FOLD, "school", false);
    expect(isCalendarOpen(next, "school")).toBe(false);
    expect(isCalendarOpen(next, "work")).toBe(true);
  });

  it("does not mutate the state it was given", () => {
    const state: TreeFoldState = DEFAULT_TREE_FOLD;
    setGroupOpen(state, "me", false);
    setCalendarOpen(state, "school", false);
    expect(state).toEqual(DEFAULT_TREE_FOLD);
  });
});

describe("parseTreeFold", () => {
  it("round-trips stored state", () => {
    const stored = setCalendarOpen(setGroupOpen(DEFAULT_TREE_FOLD, "partner", false), "school", false);
    expect(parseTreeFold(JSON.stringify(stored))).toEqual(stored);
  });

  it("falls back to all-expanded defaults for missing or corrupt storage", () => {
    for (const raw of [null, "", "{not json", "[]", "null"]) {
      expect(parseTreeFold(raw)).toEqual(DEFAULT_TREE_FOLD);
    }
  });

  it("drops entries that are not booleans instead of trusting them", () => {
    const parsed = parseTreeFold(
      JSON.stringify({ groups: { me: "folded", ours: false }, calendars: { school: 0, work: true } }),
    );
    expect(isGroupOpen(parsed, "me")).toBe(true);
    expect(isGroupOpen(parsed, "ours")).toBe(false);
    expect(isCalendarOpen(parsed, "school")).toBe(true);
    expect(isCalendarOpen(parsed, "work")).toBe(true);
  });
});
