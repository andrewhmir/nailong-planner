import type { TaskPriority, TaskRow, TaskStatus } from "@/lib/db/schema";
import { weekdayOfDate } from "@/lib/recurrence/rule";
import { addDaysToDate, utcToLocalDate } from "@/lib/time/zone";

/**
 * Derived task buckets (spec D6). A bucket is never stored: it is recomputed
 * from the task's date-only `YYYY-MM-DD` columns plus the household's `today` /
 * `endOfWeek` and its Inbox id, so it cannot go stale at midnight. `overdue` is
 * a cross-cutting badge (`isOverdue`), not a bucket, and a finished or dropped
 * task belongs to no bucket at all unless the caller asks for closed rows
 * (`bucketOfIncludingClosed`).
 *
 * Pure string date math only: no clock reads except `localToday`'s default, no
 * SQL and no React.
 */

export type TaskBucket = "inbox" | "today" | "week" | "someday";

/** The triage views, in rail order. */
export const TASK_BUCKETS: readonly TaskBucket[] = ["inbox", "today", "week", "someday"];

/**
 * The statuses of an unfinished task: it can be bucketed and can go overdue.
 * Every "still to do" check goes through this list, never a literal `"open"`.
 */
export const TASK_ACTIVE_STATUSES: readonly TaskStatus[] = ["open", "in_progress"];

/** True when `status` is unfinished — `open` or `in_progress`. */
export function isActiveStatus(status: TaskStatus): boolean {
  return TASK_ACTIVE_STATUSES.includes(status);
}

/** Everything a bucket needs beyond the row itself; all dates are household-local. */
export interface BucketContext {
  /** The household's calendar date — `localToday(household.timezone)`. */
  today: string;
  /** Last day of the household week — `endOfWeek(today, household.weekStartsOn)`. */
  endOfWeek: string;
  /** The household's Inbox list id (`ensureInbox`). */
  inboxId: string;
}

/**
 * Last day (inclusive) of the household week that contains `date`. A week is
 * seven days starting on `weekStartsOn` (0 = Sunday, 1 = Monday), so Sunday is
 * the last day of a Monday-started week and `endOfWeek` may return `date`.
 */
export function endOfWeek(date: string, weekStartsOn: 0 | 1): string {
  const offset = (weekdayOfDate(date) - weekStartsOn + 7) % 7;
  return addDaysToDate(date, 6 - offset);
}

/**
 * The bucket a task's dates put it in, ignoring its status. The earliest
 * commitment anchors the task — the earlier of `scheduledOn` and `dueOn` (nulls
 * are absent) — so a task scheduled later but already past due still shows in
 * Today, and a due-only task in a project list reaches Today/Week instead of
 * being stranded. An undated task belongs to the Inbox only if it is in that
 * list; every other undated task is Someday. A task dated beyond this week is in
 * none of the four triage views; it stays on the calendar month grid until its
 * week arrives.
 */
function bucketFromDates(
  task: Pick<TaskRow, "scheduledOn" | "dueOn" | "collectionId">,
  ctx: BucketContext,
): TaskBucket | null {
  const { scheduledOn, dueOn } = task;
  if (scheduledOn === null && dueOn === null) {
    return task.collectionId === ctx.inboxId ? "inbox" : "someday";
  }
  // R2: the earliest commitment wins. A deadline with no schedule is still an
  // anchor (D6 fallback), and a later schedule must never hide a past-due task.
  const effective = [scheduledOn, dueOn]
    .filter((date): date is string => date !== null)
    .reduce((earliest, date) => (date < earliest ? date : earliest));
  if (effective <= ctx.today) {
    return "today";
  }
  if (effective <= ctx.endOfWeek) {
    return "week";
  }
  return null;
}

/**
 * The bucket an active task belongs to, or `null` when it is done/dropped or
 * dated beyond this week. Uses the same date rule as `bucketOfIncludingClosed`.
 */
export function bucketOf(
  task: Pick<TaskRow, "status" | "scheduledOn" | "dueOn" | "collectionId">,
  ctx: BucketContext,
): TaskBucket | null {
  return isActiveStatus(task.status) ? bucketFromDates(task, ctx) : null;
}

/**
 * The bucket a task belongs to regardless of status, for views that show
 * finished rows inside their triage bucket. It applies exactly the same date
 * rule as `bucketOf`: `null` only when the anchor is dated beyond this week.
 */
export function bucketOfIncludingClosed(
  task: Pick<TaskRow, "status" | "scheduledOn" | "dueOn" | "collectionId">,
  ctx: BucketContext,
): TaskBucket | null {
  return bucketFromDates(task, ctx);
}

/** True when an active task's deadline has passed; `dueOn === today` is not overdue. */
export function isOverdue(
  task: Pick<TaskRow, "status" | "dueOn">,
  today: string,
): boolean {
  return isActiveStatus(task.status) && task.dueOn !== null && task.dueOn < today;
}

/** Priority sort ranks, least important first — `none` 0 through `urgent` 4. */
const PRIORITY_RANK: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
};

/**
 * Sort rank of a priority: `none` 0, `low` 1, `normal` 2, `high` 3, `urgent` 4.
 * Grouping/sorting code sorts by this number, never by the priority string.
 */
export function priorityRank(priority: TaskPriority): number {
  return PRIORITY_RANK[priority];
}

/** The household's calendar date (`YYYY-MM-DD`) at `now`; defaults to the clock. */
export function localToday(timeZone: string, now: number = Date.now()): string {
  return utcToLocalDate(now, timeZone);
}
