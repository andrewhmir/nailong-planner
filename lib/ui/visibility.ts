import type { CalendarRow } from "@/lib/db/schema";

export type GroupKey = "ours" | "me" | "partner";

export interface VisibilityState {
  /** The three person pills. */
  groups: Record<GroupKey, boolean>;
  /** Per-calendar checkbox overrides; missing means visible. */
  calendars: Record<string, boolean>;
  /**
   * Google Calendar's "display only this calendar", kept separate from the
   * checkboxes so leaving the view restores them untouched. While set, only
   * this calendar is drawn and new events default to it.
   */
  only: string | null;
}

export const GROUP_ORDER: readonly GroupKey[] = ["ours", "me", "partner"];

export const DEFAULT_VISIBILITY: VisibilityState = {
  groups: { ours: true, me: true, partner: true },
  calendars: {},
  only: null,
};

export function groupOf(calendar: Pick<CalendarRow, "ownerId">, viewerId: string): GroupKey {
  if (calendar.ownerId === null) {
    return "ours";
  }
  return calendar.ownerId === viewerId ? "me" : "partner";
}

/**
 * A calendar is drawn only when its person pill, its parent's checkbox and its
 * own checkbox all agree. This is what makes the pills a one-click cross-check
 * while individual calendars stay independently togglable.
 *
 * "Display only this calendar" outranks all of that: exactly the chosen
 * calendar is drawn, so a parent's sub-calendars stay hidden until one of them
 * is isolated in turn.
 */
export function isCalendarVisible(
  state: VisibilityState,
  calendar: Pick<CalendarRow, "id" | "ownerId">,
  viewerId: string,
  parent?: Pick<CalendarRow, "id"> | null,
): boolean {
  if (state.only !== null) {
    return calendar.id === state.only;
  }
  if (!(state.groups[groupOf(calendar, viewerId)] ?? true)) {
    return false;
  }
  if (parent && (state.calendars[parent.id] ?? true) === false) {
    return false;
  }
  return state.calendars[calendar.id] ?? true;
}
