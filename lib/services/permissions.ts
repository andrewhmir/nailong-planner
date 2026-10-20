import type { CalendarRow } from "@/lib/db/schema";

export interface ViewerContext {
  userId: string;
  householdId: string;
}

/**
 * The one write-permission rule for calendars and the events inside them.
 *
 * Every calendar is visible to both household members. A calendar can be marked
 * view-only for the partner, in which case only its owner may write it. Shared
 * ("Ours") calendars are never view-only — validation prevents that state, and
 * if it somehow exists this predicate fails closed.
 */
export function canWriteCalendar(
  viewer: ViewerContext,
  calendar: Pick<CalendarRow, "ownerId" | "isViewOnlyForPartner">,
): boolean {
  if (!calendar.isViewOnlyForPartner) {
    return true;
  }
  return calendar.ownerId !== null && calendar.ownerId === viewer.userId;
}
