import type { DragTransfer } from "./taskDrag";

/**
 * The status board's HTML5 drag contract. A board card writes its task id under
 * a **third** custom MIME type, separate from the row→day `text/x-nailong-task`
 * payload (`lib/ui/taskDrag.ts`): a board column accepts only this type, so
 * dragging a row onto a column — or dropping a card on a calendar day — cannot
 * accidentally change a status or plan a task. Kept in its own module because
 * the card (source) and the column (target) must agree on the string.
 *
 * The payload is the raw task id (not JSON): a drop never needs anything else,
 * and the column already has the task it is moving because the id must name a
 * card that is currently rendered. The only corruption a plain string can carry
 * is an empty/whitespace value (a browser that exposes the type on `dragover`
 * but withholds the data on `drop`, or a hand-crafted empty `setData`), which
 * reads as `null`; an id that no longer names a rendered card is ignored by the
 * drop handler instead of being PATCHed.
 */
export const BOARD_DRAG_TYPE = "application/x-nailong-task-status";

/** The `DataTransfer` subset both drag helpers accept; shared with `lib/ui/taskDrag.ts`. */
export type BoardDragTransfer = DragTransfer;

/**
 * Source side: stamp the card's task id and advertise a move. The column reads
 * it back with `readBoardDragPayload` and ignores a drop on the card's own
 * column (a same-status PATCH would be a no-op with a lying toast).
 */
export function setBoardDragPayload(transfer: BoardDragTransfer, taskId: string): void {
  transfer.setData(BOARD_DRAG_TYPE, taskId);
  transfer.effectAllowed = "move";
}

/**
 * Target side: the dragged task's id, or `null` for any other drag and for an
 * empty/whitespace payload. The caller resolves the id against the cards it is
 * rendering, so a stale id is a silent no-op rather than a blind PATCH.
 */
export function readBoardDragPayload(
  transfer: BoardDragTransfer | null | undefined,
): string | null {
  if (!transfer || !transfer.types.includes(BOARD_DRAG_TYPE)) {
    return null;
  }
  const taskId = transfer.getData(BOARD_DRAG_TYPE).trim();
  return taskId.length === 0 ? null : taskId;
}
