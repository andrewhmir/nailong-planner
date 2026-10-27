/**
 * The task-row HTML5 drag contract. The row writes its id **and its current due
 * date** under a custom MIME type; the month grid's day cells and the sidebar
 * mini-month accept only that type, so an event drag, a file, or a text selection
 * can never re-date a task by accident. Kept in one module because three
 * components (the row as the source, the two grids as targets) have to agree on
 * the string and the payload shape.
 *
 * The previous due date travels **with the drag**, taken from the dragged row at
 * `dragstart`, rather than being looked up in a cache at drop time: cached
 * `["tasks", …]` payloads can disagree (an optimistic row in one view, the
 * settle refetch in another), and Undo must restore the date the user actually
 * saw on the row they dragged.
 */
export const TASK_DRAG_TYPE = "text/x-nailong-task";

/** A dragged task row: what the drop handler needs to re-date it and undo it. */
export interface TaskDragPayload {
  /** The dragged row's task id. */
  id: string;
  /** The row's `dueOn` when the drag started; the Undo's restore value. */
  dueOn: string | null;
}

/** Structural subset of `DataTransfer` so the pure helpers are testable. */
export interface DragTransfer {
  readonly types: readonly string[];
  getData(type: string): string;
  setData(type: string, value: string): void;
  effectAllowed: string;
  dropEffect: string;
}

/** The source row, structurally: anything with an id and an optional due date. */
export interface TaskDragSource {
  id: string;
  dueOn: string | null;
}

/** `YYYY-MM-DD`, the only shape a `dueOn` restore value may have. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True when a drag carries a task payload (used to decide `preventDefault`). */
export function isTaskDrag(transfer: Pick<DragTransfer, "types"> | null | undefined): boolean {
  return transfer?.types.includes(TASK_DRAG_TYPE) ?? false;
}

/**
 * Source side: stamp the row's id + current due date and advertise a move. The
 * payload is JSON so a null date (`undefined` under `setData`, which stringifies
 * nothing useful) survives the round trip and so a malformed drag is rejectable.
 */
export function setTaskDragPayload(transfer: DragTransfer, task: TaskDragSource): void {
  transfer.setData(TASK_DRAG_TYPE, JSON.stringify({ id: task.id, dueOn: task.dueOn }));
  transfer.effectAllowed = "move";
}

/**
 * Target side: the dragged task, or `null` for any other drag and for a payload
 * that does not match the contract (an old raw-id payload, corrupt JSON, an
 * empty id, a date that is not `YYYY-MM-DD`). Rejecting instead of trusting the
 * string keeps a bad payload from being PATCHed into `dueOn` by Undo.
 */
export function readTaskDrag(
  transfer: DragTransfer | null | undefined,
): TaskDragPayload | null {
  if (!isTaskDrag(transfer)) {
    return null;
  }
  const raw = transfer!.getData(TASK_DRAG_TYPE);
  if (raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const { id, dueOn } = parsed as { id?: unknown; dueOn?: unknown };
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  if (dueOn !== undefined && dueOn !== null && (typeof dueOn !== "string" || !DATE_ONLY.test(dueOn))) {
    return null;
  }
  return { id, dueOn: dueOn ?? null };
}
