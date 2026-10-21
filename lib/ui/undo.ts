import { toast } from "sonner";

/**
 * Session-scoped undo stack (spec D5). It lives in module state, so a reload
 * clears it — the durable "recently deleted" bin is a later release. Actions are
 * pushed by the UI after a mutation succeeds; `undoLast` is what the toast action
 * and the `z` / `Ctrl+Z` hotkeys call.
 */

export interface UndoAction {
  label: string;
  undo: () => Promise<void> | void;
}

const MAX_UNDO = 20;
const stack: UndoAction[] = [];

export function pushUndo(action: UndoAction): void {
  stack.push(action);
  while (stack.length > MAX_UNDO) {
    stack.shift();
  }
}

/** Returns the label of the next undoable action, or null when the stack is empty. */
export function peekUndo(): string | null {
  return stack[stack.length - 1]?.label ?? null;
}

export async function undoLast(): Promise<boolean> {
  const action = stack.pop();
  if (!action) {
    return false;
  }
  try {
    await action.undo();
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not undo that change.");
    return false;
  }
}

/** Test seam: drop every pending action. */
export function clearUndo(): void {
  stack.length = 0;
}
