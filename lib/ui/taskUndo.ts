import type { TaskView } from "@/lib/services/tasks";
import type { CreateTaskInput, UpdateTaskInput } from "@/lib/validation/tasks";

/**
 * The two payloads behind "delete + undo". There is no trash table, so undoing a
 * delete re-creates the row: `POST /api/tasks` carries everything a create
 * accepts, and one PATCH restores what a create cannot — the checklist, the
 * original list position and a closed status (the service stamps
 * `completedAt`/`droppedAt` on that transition).
 *
 * Pure and renderer-free on purpose: `TasksShell.deleteTaskWithUndo` owns the
 * requests and `tests/unit/task-undo.test.ts` pins the payloads without mounting
 * the workspace.
 */

/**
 * The create body for a deleted task. `priority` always travels — an urgent task
 * deleted and undone must come back urgent, not `none`. `status` is sent only
 * for `in_progress`: `POST /api/tasks` accepts the two active states and `open`
 * is the server default, while `done`/`dropped` are closed states that must go
 * through `deletedTaskRestorePatch` so the audit timestamps are stamped.
 */
export function deletedTaskCreateInput(task: TaskView): CreateTaskInput {
  const input: CreateTaskInput = {
    title: task.title,
    notes: task.notes,
    collectionId: task.collectionId,
    scheduledOn: task.scheduledOn,
    dueOn: task.dueOn,
    priority: task.priority,
  };
  if (task.status === "in_progress") {
    input.status = "in_progress";
  }
  return input;
}

/**
 * The PATCH that finishes a re-created task, or `{}` when the create body already
 * said everything. `sortOrder` is replayed only when the row was not at position
 * 0: the create appends (`nextSortOrder`), so a moved position must be restored,
 * while a row that sat at the top of its list was almost certainly the only row
 * there — the rare "first of several" delete comes back last rather than paying
 * a PATCH that would only re-order an already appended row.
 */
export function deletedTaskRestorePatch(task: TaskView): UpdateTaskInput {
  const patch: UpdateTaskInput = {};
  if (task.checklist.length > 0) {
    // The create body has no checklist field, and the service regenerates item
    // ids from the whole array (Task 5's replace contract).
    patch.checklist = task.checklist.map((item) => ({ title: item.title, done: item.done }));
  }
  if (task.sortOrder > 0) {
    patch.sortOrder = task.sortOrder;
  }
  if (task.status === "done" || task.status === "dropped") {
    patch.status = task.status;
  }
  return patch;
}
