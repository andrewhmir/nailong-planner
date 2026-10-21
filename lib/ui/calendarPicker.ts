import {
  PARENT_SHADE_INDEX,
  isHueFamily,
  shadeTokens,
  type HueFamily,
} from "@/lib/color/palette";
import type { CalendarRow } from "@/lib/db/schema";
import type { CalendarNode } from "@/lib/services/calendars";

/** One rendered line of the nested calendar picker. */
export interface PickerRow {
  id: string;
  name: string;
  /** 0 for a top-level calendar, 1 for one of its sub-calendars. */
  depth: 0 | 1;
  hasChildren: boolean;
  expanded: boolean;
  /** Swatch colour: the family's parent shade for roots, the assigned shade for sub-calendars. */
  color: string;
}

function familyOf(calendar: CalendarRow): HueFamily {
  return calendar.hueFamily && isHueFamily(calendar.hueFamily) ? calendar.hueFamily : "slate";
}

/**
 * Flattens the two-level calendar tree into the rows the picker draws: every
 * top-level calendar is always listed, and a calendar's sub-calendars appear
 * only once that calendar is expanded.
 */
export function buildPickerRows(
  calendars: CalendarNode[],
  expandedIds: ReadonlySet<string>,
): PickerRow[] {
  const rows: PickerRow[] = [];

  for (const root of calendars) {
    const family = familyOf(root);
    const expanded = expandedIds.has(root.id);

    rows.push({
      id: root.id,
      name: root.name,
      depth: 0,
      hasChildren: root.children.length > 0,
      expanded,
      color: shadeTokens(family, PARENT_SHADE_INDEX).mainHex,
    });

    if (!expanded) {
      continue;
    }

    for (const child of root.children) {
      rows.push({
        id: child.id,
        name: child.name,
        depth: 1,
        hasChildren: false,
        expanded: false,
        color: shadeTokens(family, child.shadeIndex).mainHex,
      });
    }
  }

  return rows;
}

/**
 * The single branch that must be open for `selectedId` to be visible. Selecting
 * a top-level calendar needs no branch open, so the result is empty.
 */
export function expandedForSelection(
  calendars: CalendarNode[],
  selectedId: string,
): Set<string> {
  for (const root of calendars) {
    if (root.id !== selectedId && root.children.some((child) => child.id === selectedId)) {
      return new Set([root.id]);
    }
  }
  return new Set();
}

/** Immutable toggle, so React state updates never mutate the previous set. */
export function toggleExpanded(expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/** Name and swatch for the trigger, wherever in the tree the calendar sits. */
export function calendarSwatch(
  calendars: CalendarNode[],
  id: string,
): { name: string; color: string } | null {
  for (const root of calendars) {
    const family = familyOf(root);
    if (root.id === id) {
      return { name: root.name, color: shadeTokens(family, PARENT_SHADE_INDEX).mainHex };
    }
    const child = root.children.find((row) => row.id === id);
    if (child) {
      return { name: child.name, color: shadeTokens(family, child.shadeIndex).mainHex };
    }
  }
  return null;
}
