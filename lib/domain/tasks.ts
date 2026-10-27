import type { TaskPriority, TaskRow, TaskStatus } from "@/lib/db/schema";
import { weekdayOfDate } from "@/lib/recurrence/rule";
import { addDaysToDate, utcToLocalDate, utcToLocalWallTime } from "@/lib/time/zone";

/**
 * Derived task buckets and the scope tabs' time horizons (spec D6, plus the
 * post-review scope rework in ruling 29 and the due-date-only follow-up). A
 * bucket is never stored: it is recomputed from the task's due date (`dueOn`,
 * plus its optional `dueTime`) and the household's `today` / `endOfWeek`, so it
 * cannot go stale at midnight. A task has one deadline, not a schedule and a
 * deadline.
 *
 * `all` is a **scope**, not a bucket: it is every visible active task, including
 * the ones dated beyond this week that no bucket holds. `overdue` is a
 * cross-cutting badge (`isOverdue`), not a bucket, and a finished or dropped task
 * belongs to no bucket at all unless the caller asks for closed rows
 * (`bucketOfIncludingClosed`).
 *
 * The Inbox stays a real list (capture target, sidebar row, `ensureInbox`) but it
 * is **not** a bucket: an undated active task is Someday whichever list holds it.
 *
 * Pure string date math only: no clock reads except `localToday`'s default, no
 * SQL and no React.
 */

export type TaskBucket = "today" | "week" | "someday";

/** The time buckets the scope tabs filter by, in rail order. */
export const TASK_BUCKETS: readonly TaskBucket[] = ["today", "week", "someday"];

/** A scope is either one time bucket or `all` (every visible active task). */
export type TaskScope = "all" | TaskBucket;

/** The scope tabs, in rail order: All first and the default. */
export const TASK_SCOPES: readonly TaskScope[] = ["all", "today", "week", "someday"];

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
 * The bucket a task's deadline puts it in, ignoring its status. The due date is
 * the task's only date, so it is the anchor: no date is Someday, today or
 * earlier is Today, and a deadline up to the end of the week is Week. An undated
 * task is Someday in every list: the Inbox is not a bucket. A task due beyond
 * this week is in none of the three buckets; the `all` scope shows it, and it
 * stays on the calendar month grid until its week arrives.
 */
function bucketFromDue(task: Pick<TaskRow, "dueOn">, ctx: BucketContext): TaskBucket | null {
  const { dueOn } = task;
  if (dueOn === null) {
    return "someday";
  }
  if (dueOn <= ctx.today) {
    return "today";
  }
  if (dueOn <= ctx.endOfWeek) {
    return "week";
  }
  return null;
}

/**
 * The bucket an active task belongs to, or `null` when it is done/dropped or due
 * beyond this week. Uses the same date rule as `bucketOfIncludingClosed`.
 */
export function bucketOf(
  task: Pick<TaskRow, "status" | "dueOn">,
  ctx: BucketContext,
): TaskBucket | null {
  return isActiveStatus(task.status) ? bucketFromDue(task, ctx) : null;
}

/**
 * The bucket a task belongs to regardless of status, for views that show
 * finished rows inside their time bucket. It applies exactly the same date rule
 * as `bucketOf`: `null` only when the due date is beyond this week.
 */
export function bucketOfIncludingClosed(
  task: Pick<TaskRow, "status" | "dueOn">,
  ctx: BucketContext,
): TaskBucket | null {
  return bucketFromDue(task, ctx);
}

/**
 * True when an active task's deadline has passed. A date-only deadline covers
 * the whole day, so it is overdue from the next day; a timed deadline is overdue
 * the moment the household wall clock passes its minute (equality is on time).
 */
export function isOverdue(
  task: Pick<TaskRow, "status" | "dueOn" | "dueTime">,
  today: string,
  nowTime: string,
): boolean {
  if (!isActiveStatus(task.status) || task.dueOn === null) {
    return false;
  }
  if (task.dueOn < today) {
    return true;
  }
  return task.dueOn === today && task.dueTime !== null && task.dueTime < nowTime;
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

/** The household's wall-clock time (`HH:MM`) at `now`; defaults to the clock. */
export function localTimeOfDay(timeZone: string, now: number = Date.now()): string {
  return utcToLocalWallTime(now, timeZone).slice(11, 16);
}
