import type { CalendarNode } from "@/lib/services/calendars";
import { isCalendarVisible, type VisibilityState } from "./visibility";

/**
 * The ids currently drawn in the grid: a root contributes only when its person
 * pill and its own checkbox agree, and a child additionally needs its parent's
 * checkbox. One implementation so the sidebar mini-month and the grid cannot
 * disagree about what "visible" means.
 */
export function visibleCalendarIds(
  roots: CalendarNode[],
  state: VisibilityState,
  userId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const root of roots) {
    if (!isCalendarVisible(state, root, userId)) {
      continue;
    }
    ids.add(root.id);
    for (const child of root.children) {
      if (isCalendarVisible(state, child, userId, root)) {
        ids.add(child.id);
      }
    }
  }
  return ids;
}
