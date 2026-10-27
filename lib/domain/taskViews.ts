import type { TaskPriority, TaskStatus } from "@/lib/db/schema";
import { priorityRank } from "@/lib/domain/tasks";

/**
 * Task-view layout, grouping, sorting and filtering (spec: List/Board views).
 *
 * The task views are pure projections of the rows `lib/services/tasks.ts`
 * already returns, so everything here works on readonly arrays and returns new
 * arrays: no React, no SQL, no clock reads. The type constraints are structural
 * (`SortableTask`/`GroupableTask`), so a `TaskView` satisfies them without this
 * module importing the service, and the exported order/label tables are the one
 * source of truth the UI and `lib/ui/taskViewParams.ts` read.
 */

export type TaskLayout = "list" | "board";
export type GroupBy = "status" | "priority" | "list";
export type TaskSort = "manual" | "priority" | "due" | "created" | "title";

/** Statuses in workflow order — the order grouped-list sections and board columns use. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = ["open", "in_progress", "done", "dropped"];

/** The words the UI shows for a status: `open` is "To do", never "Open". */
export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  open: "To do",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

/** Priorities in display order: most urgent first, `none` last. */
export const TASK_PRIORITY_ORDER: readonly TaskPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
  "none",
];

/** The words the UI shows for a priority. */
export const TASK_PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
  none: "None",
};

/**
 * Sort rank per priority: `none` 0 through `urgent` 4, derived from
 * `priorityRank` so the two tables cannot drift. Never compare priority strings.
 */
export const TASK_PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
  none: priorityRank("none"),
  low: priorityRank("low"),
  normal: priorityRank("normal"),
  high: priorityRank("high"),
  urgent: priorityRank("urgent"),
};

/** The fields every sort reads; `TaskView` satisfies this structurally. */
export interface SortableTask {
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: string | null;
  dueTime: string | null;
  sortOrder: number;
  createdAt: number;
  title: string;
  id: string;
}

/** A sortable task that also knows its list, so it can be grouped by list. */
export interface GroupableTask extends SortableTask {
  collection: { id: string; name: string };
}

/** One rendered group; `key` is the status/priority/list id, `label` is what it shows. */
export interface TaskGroup<T> {
  key: string;
  label: string;
  tasks: T[];
}

/** Toolbar filter state; an empty list or a `null` list id means "no constraint". */
export interface TaskFilters {
  status: TaskStatus[];
  priority: TaskPriority[];
  collectionId: string | null;
}

/**
 * Ascending deadlines: `dueOn` first, then `dueTime` within one day. A date-only
 * deadline means "any time that day", so it sorts after a timed deadline on the
 * same date; an undated task sorts after every dated one.
 */
function compareDue(a: SortableTask, b: SortableTask): number {
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  if (a.dueOn === null) {
    return 0;
  }
  if (a.dueTime === b.dueTime) {
    return 0;
  }
  if (a.dueTime === null) return 1;
  if (b.dueTime === null) return -1;
  return a.dueTime < b.dueTime ? -1 : 1;
}

function compareIds(a: SortableTask, b: SortableTask): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function comparePriority(a: SortableTask, b: SortableTask): number {
  return priorityRank(b.priority) - priorityRank(a.priority);
}

/** `sortOrder` first, then the same `createdAt`/`id` tie-break every sort ends with. */
function byManual(a: SortableTask, b: SortableTask): number {
  return a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || compareIds(a, b);
}

/** Urgent first; within one priority the earliest deadline first, undated last. */
function byPriority(a: SortableTask, b: SortableTask): number {
  return (
    comparePriority(a, b) ||
    compareDue(a, b) ||
    a.createdAt - b.createdAt ||
    compareIds(a, b)
  );
}

/** Earliest deadline first (date, then time; undated last); ties break by priority. */
function byDue(a: SortableTask, b: SortableTask): number {
  return (
    compareDue(a, b) ||
    comparePriority(a, b) ||
    a.createdAt - b.createdAt ||
    compareIds(a, b)
  );
}

/** Newest first, so a freshly captured task appears at the top. */
function byCreated(a: SortableTask, b: SortableTask): number {
  return b.createdAt - a.createdAt || compareIds(a, b);
}

function byTitle(a: SortableTask, b: SortableTask): number {
  return a.title.localeCompare(b.title) || a.createdAt - b.createdAt || compareIds(a, b);
}

const SORT_COMPARATORS: Readonly<
  Record<TaskSort, (a: SortableTask, b: SortableTask) => number>
> = {
  manual: byManual,
  priority: byPriority,
  due: byDue,
  created: byCreated,
  title: byTitle,
};

/**
 * Orders a copy of `tasks` for the selected sort. Ties always fall back to
 * `createdAt` then `id`, so the rendered order is deterministic and rows do not
 * jump between renders.
 */
export function sortTasks<T extends SortableTask>(tasks: readonly T[], sort: TaskSort): T[] {
  return [...tasks].sort(SORT_COMPARATORS[sort]);
}

/** Fixed-order groups for statuses/priorities; empty groups are omitted. */
function groupByStatus<T extends SortableTask>(tasks: readonly T[]): TaskGroup<T>[] {
  const groups: TaskGroup<T>[] = [];
  for (const status of TASK_STATUS_ORDER) {
    const members = tasks.filter((task) => task.status === status);
    if (members.length > 0) {
      groups.push({ key: status, label: TASK_STATUS_LABELS[status], tasks: members });
    }
  }
  return groups;
}

/** Priority groups in `TASK_PRIORITY_ORDER` (urgent to none); empty groups are omitted. */
function groupByPriority<T extends SortableTask>(tasks: readonly T[]): TaskGroup<T>[] {
  const groups: TaskGroup<T>[] = [];
  for (const priority of TASK_PRIORITY_ORDER) {
    const members = tasks.filter((task) => task.priority === priority);
    if (members.length > 0) {
      groups.push({ key: priority, label: TASK_PRIORITY_LABELS[priority], tasks: members });
    }
  }
  return groups;
}

/** One group per collection, ordered by list name so the sections read alphabetically. */
function groupByList<T extends GroupableTask>(tasks: readonly T[]): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T>>();
  for (const task of tasks) {
    const { id, name } = task.collection;
    const group = groups.get(id);
    if (group) {
      group.tasks.push(task);
    } else {
      groups.set(id, { key: id, label: name, tasks: [task] });
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Splits `tasks` into ordered groups and omits every group with no tasks, so an
 * empty Done column or an unused priority never renders a header. The order
 * inside a group is the input order — feed `sortTasks` output to sort rows.
 */
export function groupTasks<T extends GroupableTask>(
  tasks: readonly T[],
  by: GroupBy,
): TaskGroup<T>[] {
  switch (by) {
    case "list":
      return groupByList(tasks);
    case "priority":
      return groupByPriority(tasks);
    case "status":
      return groupByStatus(tasks);
    default: {
      const exhaustive: never = by;
      return exhaustive;
    }
  }
}

/**
 * Keeps the tasks that match every active filter. An empty status or priority
 * list, and a `null` collection id, mean "no constraint" rather than "match
 * nothing", so the default toolbar state passes every row through.
 */
export function filterTasks<T extends SortableTask & { collectionId: string }>(
  tasks: readonly T[],
  filters: TaskFilters,
): T[] {
  const statuses = new Set(filters.status);
  const priorities = new Set(filters.priority);
  return tasks.filter(
    (task) =>
      (statuses.size === 0 || statuses.has(task.status)) &&
      (priorities.size === 0 || priorities.has(task.priority)) &&
      (filters.collectionId === null || task.collectionId === filters.collectionId),
  );
}
