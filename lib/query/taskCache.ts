import type { TaskCounts, TaskView } from "@/lib/services/tasks";

/**
 * Pure helper for the optimistic task cache. Every `useTasks` query under
 * `["tasks", …]` holds one `{ tasks, counts }` payload, so the helper maps a
 * whole payload at a time and the update hook applies it to every cached
 * `(view, collectionId)` pair.
 */

/** The payload of `GET /api/tasks` — one cache entry per view/collection pair. */
export interface TasksCacheData {
  tasks: TaskView[];
  counts: TaskCounts;
}

/**
 * Patches one row by id. A missing id is a no-op, and `counts` is returned by
 * reference: the rail badges cover every visible open task, so a single row
 * patch never changes them (the settle refetch owns any real recount).
 */
export function updateTaskInData(
  data: TasksCacheData,
  id: string,
  patch: Partial<TaskView>,
): TasksCacheData {
  return {
    ...data,
    tasks: data.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
  };
}

/**
 * Applies an optimistic row patch to one `["tasks", …]` cache entry, or returns
 * the entry untouched when it does not hold a task list. `setQueriesData` reaches
 * every entry under the prefix, and the counts query (`["tasks", "counts"]`)
 * stores a `TaskCountSummary` — mapping it as a task list would throw.
 */
export function patchTasksEntry(
  entry: unknown,
  id: string,
  patch: Partial<TaskView>,
): unknown {
  if (
    typeof entry !== "object" ||
    entry === null ||
    !Array.isArray((entry as TasksCacheData).tasks)
  ) {
    return entry;
  }
  return updateTaskInData(entry as TasksCacheData, id, patch);
}
