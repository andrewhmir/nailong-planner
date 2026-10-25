/**
 * The task-row HTML5 drag contract. The row writes the task id under a custom
 * MIME type; the month grid's day cells and the sidebar mini-month accept only
 * that type, so an event drag, a file, or a text selection can never plan a
 * task by accident. Kept in one module because three components (the row as the
 * source, the two grids as targets) have to agree on the string.
 */
export const TASK_DRAG_TYPE = "text/x-nailong-task";

/** Structural subset of `DataTransfer` so the pure helpers are testable. */
export interface DragTransfer {
  readonly types: readonly string[];
  getData(type: string): string;
  setData(type: string, value: string): void;
  effectAllowed: string;
  dropEffect: string;
}

/** True when a drag carries a task id (used to decide `preventDefault`). */
export function isTaskDrag(transfer: Pick<DragTransfer, "types"> | null | undefined): boolean {
  return transfer?.types.includes(TASK_DRAG_TYPE) ?? false;
}

/** Source side: stamp the row's payload and advertise a move. */
export function setTaskDragPayload(transfer: DragTransfer, taskId: string): void {
  transfer.setData(TASK_DRAG_TYPE, taskId);
  transfer.effectAllowed = "move";
}

/** Target side: the dragged task id, or `null` for any other drag. */
export function readTaskDrag(transfer: DragTransfer | null | undefined): string | null {
  if (!isTaskDrag(transfer)) {
    return null;
  }
  const taskId = transfer!.getData(TASK_DRAG_TYPE);
  return taskId.length > 0 ? taskId : null;
}
