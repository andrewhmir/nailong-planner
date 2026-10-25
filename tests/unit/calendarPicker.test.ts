import { describe, expect, it } from "vitest";
import { PARENT_SHADE_INDEX, shadeTokens } from "@/lib/color/palette";
import type { CollectionRow } from "@/lib/db/schema";
import type { CollectionNode } from "@/lib/services/collections";
import {
  buildPickerRows,
  calendarSwatch,
  expandedForSelection,
  toggleExpanded,
} from "@/lib/ui/calendarPicker";

function row(overrides: Partial<CollectionRow> & Pick<CollectionRow, "id" | "name">): CollectionRow {
  return {
    householdId: "household-1",
    parentId: null,
    hueFamily: "sky",
    shadeIndex: PARENT_SHADE_INDEX,
    ownerId: null,
    kind: "calendar",
    visibility: "shared",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function root(id: string, name: string, extra: Partial<CollectionRow> = {}): CollectionNode {
  return { ...row({ id, name, ...extra }), children: [] };
}

function sub(parentId: string, id: string, name: string, shadeIndex: number): CollectionRow {
  return row({ id, name, parentId, hueFamily: null, shadeIndex });
}

const school = root("c-school", "School");
school.children = [sub("c-school", "c-bio", "Biology", 4), sub("c-school", "c-math", "Math", 2)];
const household = root("c-house", "Household", { hueFamily: "amber" });
const tree: CollectionNode[] = [household, school];

/** A list root with a sub-list, the shape the mixed sidebar tree now produces. */
const errands = root("l-errands", "Errands", { kind: "list", hueFamily: "rose" });
errands.children = [
  row({ id: "l-client", name: "Client A", parentId: "l-errands", hueFamily: null, shadeIndex: 4, kind: "list" }),
];
const mixedTree: CollectionNode[] = [errands, ...tree];

describe("buildPickerRows", () => {
  it("lists every top-level calendar collapsed when nothing is expanded", () => {
    const rows = buildPickerRows(tree, new Set());

    expect(rows.map((pickerRow) => pickerRow.name)).toEqual(["Household", "School"]);
    expect(rows.map((pickerRow) => pickerRow.depth)).toEqual([0, 0]);
    expect(rows.map((pickerRow) => pickerRow.hasChildren)).toEqual([false, true]);
    expect(rows.map((pickerRow) => pickerRow.expanded)).toEqual([false, false]);
  });

  it("skips a list branch, even when that list is expanded", () => {
    // The picker chooses an event target: a list (and its sub-lists) holds
    // tasks, so it must never appear.
    const rows = buildPickerRows(mixedTree, new Set(["l-errands", "c-school"]));

    expect(rows.map((pickerRow) => pickerRow.id)).toEqual([
      "c-house",
      "c-school",
      "c-bio",
      "c-math",
    ]);
    expect(rows.map((pickerRow) => pickerRow.depth)).toEqual([0, 0, 1, 1]);
  });

  it("inserts a calendar's sub-calendars directly beneath it once expanded", () => {
    const rows = buildPickerRows(tree, new Set(["c-school"]));

    expect(rows.map((pickerRow) => pickerRow.name)).toEqual([
      "Household",
      "School",
      "Biology",
      "Math",
    ]);
    expect(rows.map((pickerRow) => pickerRow.depth)).toEqual([0, 0, 1, 1]);
  });

  it("colours a parent with the parent shade and a sub-calendar with its assigned shade", () => {
    const rows = buildPickerRows(tree, new Set(["c-school"]));

    expect(rows[0]?.color).toBe(shadeTokens("amber", PARENT_SHADE_INDEX).mainHex);
    expect(rows[1]?.color).toBe(shadeTokens("sky", PARENT_SHADE_INDEX).mainHex);
    expect(rows[2]?.color).toBe(shadeTokens("sky", 4).mainHex);
    expect(rows[3]?.color).toBe(shadeTokens("sky", 2).mainHex);
  });

  it("falls back to the slate family when a calendar has no usable hue family", () => {
    const rows = buildPickerRows([root("c-plain", "Plain", { hueFamily: null })], new Set());

    expect(rows[0]?.color).toBe(shadeTokens("slate", PARENT_SHADE_INDEX).mainHex);
  });
});

describe("expandedForSelection", () => {
  it("opens the branch that holds a selected sub-calendar", () => {
    expect([...expandedForSelection(tree, "c-math")]).toEqual(["c-school"]);
  });

  it("opens nothing when a top-level calendar or an unknown id is selected", () => {
    expect([...expandedForSelection(tree, "c-school")]).toEqual([]);
    expect([...expandedForSelection(tree, "missing")]).toEqual([]);
  });
});

describe("toggleExpanded", () => {
  it("adds and removes an id without mutating the input set", () => {
    const before = new Set<string>();
    const opened = toggleExpanded(before, "c-school");

    expect([...opened]).toEqual(["c-school"]);
    expect(before.size).toBe(0);
    expect([...toggleExpanded(opened, "c-school")]).toEqual([]);
  });
});

describe("calendarSwatch", () => {
  it("resolves a top-level calendar and a nested sub-calendar", () => {
    expect(calendarSwatch(tree, "c-house")).toEqual({
      name: "Household",
      color: shadeTokens("amber", PARENT_SHADE_INDEX).mainHex,
    });
    expect(calendarSwatch(tree, "c-bio")).toEqual({
      name: "Biology",
      color: shadeTokens("sky", 4).mainHex,
    });
  });

  it("returns null for an id outside the tree", () => {
    expect(calendarSwatch(tree, "missing")).toBeNull();
  });
});
