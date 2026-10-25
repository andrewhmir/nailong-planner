import type { CalendarRow } from "@/lib/db/schema";

export interface ViewerContext {
  userId: string;
  householdId: string;
}

/**
 * The one write-permission rule for collections and the events inside them.
 *
 * Every collection is visible to both household members. A `view_only` (or
 * `private`) collection may only be written by its owner; `shared` ("Ours")
 * collections are always writable. An ownerless non-shared collection is
 * writable by nobody — validation prevents that state, and if it somehow exists
 * this predicate fails closed.
 */
export function canWriteCalendar(
  viewer: ViewerContext,
  calendar: Pick<CalendarRow, "ownerId" | "visibility">,
): boolean {
  if (calendar.visibility === "shared") {
    return true;
  }
  return calendar.ownerId !== null && calendar.ownerId === viewer.userId;
}
