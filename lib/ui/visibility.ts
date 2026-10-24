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

/**
 * The owner that actually applies to a calendar. A sub-calendar inherits its
 * root's owner — the server folds the same way in `getCalendarAccess` — so a
 * stale per-row `ownerId` on a child must not decide its group.
 */
export function effectiveOwnerOf(
  calendar: Pick<CalendarRow, "ownerId">,
  parent?: Pick<CalendarRow, "ownerId"> | null,
): string | null {
  return parent ? (parent.ownerId ?? calendar.ownerId) : calendar.ownerId;
}

export function groupOf(
  calendar: Pick<CalendarRow, "ownerId">,
  viewerId: string,
  parent?: Pick<CalendarRow, "ownerId"> | null,
): GroupKey {
  const ownerId = effectiveOwnerOf(calendar, parent);
  if (ownerId === null) {
    return "ours";
  }
  return ownerId === viewerId ? "me" : "partner";
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
  parent?: Pick<CalendarRow, "id" | "ownerId"> | null,
): boolean {
  if (state.only !== null) {
    return calendar.id === state.only;
  }
  if (!(state.groups[groupOf(calendar, viewerId, parent)] ?? true)) {
    return false;
  }
  if (parent && (state.calendars[parent.id] ?? true) === false) {
    return false;
  }
  return state.calendars[calendar.id] ?? true;
}
