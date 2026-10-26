import type { TaskPriority, TaskStatus } from "@/lib/db/schema";

/**
 * The callbacks every task surface (row, board card, slide-over panel) uses to
 * change one task. Each surface receives an `actions` object already bound to
 * *its* task, so a control never has to know which row it belongs to.
 *
 * The shell owns the mutations, toasts and undo; a surface only calls these.
 */
export interface TaskActions {
  /** Open the task's detail surface (row/card title, menu "Open", `Enter`). */
  onOpen(): void;
  /**
   * The slide-over panel's inline title. Deliberately silent: no success toast
   * and no undo handle, because retyping the old title is the revert. Errors
   * still toast.
   */
  onTitle(title: string): void;
  onStatus(status: TaskStatus): void;
  onPriority(priority: TaskPriority): void;
  /** One or both date fields; `null` clears the field that is present. */
  onDates(patch: { scheduledOn?: string | null; dueOn?: string | null }): void;
  onMove(collectionId: string): void;
  onDrop(): void;
  onDelete(): void;
  /** The completion checkbox; `done` is the checkbox's next state. */
  onToggleDone(done: boolean): void;
}

/** A list a task may be moved to (or filtered by): id plus display name. */
export interface WritableList {
  id: string;
  name: string;
}
