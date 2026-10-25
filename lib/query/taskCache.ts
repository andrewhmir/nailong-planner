import type { TaskCounts, TaskView } from "@/lib/services/tasks";

/**
 * Pure helpers for the optimistic task cache. Every `useTasks` query under
 * `["tasks", …]` holds one `{ tasks, counts }` payload, so these map a whole
 * payload at a time and the mutation hooks apply them to every cached
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
 * Drops one row by id, keeping the order of the rest and `counts` untouched.
 * The delete hook currently invalidates `["tasks"]` instead of writing this
 * optimistically; the helper stays the symmetric counterpart of
 * {@link updateTaskInData} for callers that already hold a payload.
 */
export function removeTaskFromData(data: TasksCacheData, id: string): TasksCacheData {
  return {
    ...data,
    tasks: data.tasks.filter((task) => task.id !== id),
  };
}
