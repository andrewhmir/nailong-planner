import type { CalendarRow } from "@/lib/db/schema";

export type GroupKey = "ours" | "me" | "partner";

export interface VisibilityState {
  /** The three person pills. */
  groups: Record<GroupKey, boolean>;
  /** Per-calendar checkbox overrides; missing means visible. */
  calendars: Record<string, boolean>;
}

export const GROUP_ORDER: readonly GroupKey[] = ["ours", "me", "partner"];

export const DEFAULT_VISIBILITY: VisibilityState = {
  groups: { ours: true, me: true, partner: true },
  calendars: {},
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
 */
export function isCalendarVisible(
  state: VisibilityState,
  calendar: Pick<CalendarRow, "id" | "ownerId">,
  viewerId: string,
  parent?: Pick<CalendarRow, "id"> | null,
): boolean {
  if (!(state.groups[groupOf(calendar, viewerId)] ?? true)) {
    return false;
  }
  if (parent && (state.calendars[parent.id] ?? true) === false) {
    return false;
  }
  return state.calendars[calendar.id] ?? true;
}
