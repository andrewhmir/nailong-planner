import type { CollectionKind, TaskPriority, TaskStatus } from "@/lib/db/schema";

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
  /**
   * The single due field: a date and/or its optional time. `null` clears that
   * field; clearing the date also clears the time (the chip sends both).
   */
  onDue(patch: { dueOn?: string | null; dueTime?: string | null }): void;
  onMove(collectionId: string): void;
  onDrop(): void;
  onDelete(): void;
  /** The completion checkbox; `done` is the checkbox's next state. */
  onToggleDone(done: boolean): void;
}

/**
 * A collection a task may be filed under (moved to, or filtered by): its id,
 * display names, kind, tree position and the colour its dot needs.
 */
export interface WritableList {
  id: string;
  /** Display name, parent-prefixed for a sub-collection (`School / Math`). */
  name: string;
  /** The collection's own name (`Math`), for tree menus that show the parent. */
  label: string;
  /** What the collection holds; the toolbar's filter groups by it. */
  kind: CollectionKind;
  /** The root's id for a sub-collection; `null` for a root. */
  rootId: string | null;
  /** The root's palette family; `null` for an uncoloured list such as the Inbox. */
  hueFamily: string | null;
  /** The shade inside that family. */
  shadeIndex: number;
}
