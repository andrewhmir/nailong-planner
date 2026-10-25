import { toast } from "sonner";

/**
 * Session-scoped undo stack (spec D5). It lives in module state, so a reload
 * clears it — the durable "recently deleted" bin is a later release. Actions are
 * pushed by the UI after a mutation succeeds.
 *
 * Two ways in: the `z` / `Ctrl+Z` hotkeys call `undoLast()` (LIFO, whatever is
 * newest), while a Sonner toast holds the `UndoHandle` that `pushUndo` returned
 * so its button reverts exactly the change the toast describes — even when a
 * newer action landed in the 10-second toast window.
 */

export interface UndoAction {
  label: string;
  undo: () => Promise<void> | void;
}

/**
 * An opaque token for one pushed action. Callers must treat it as a value they
 * only hand back to `undoAction`; it is the action object itself, so identity is
 * the handle — a structurally equal copy is *not* a match.
 */
export type UndoHandle = UndoAction;

const MAX_UNDO = 20;
const stack: UndoAction[] = [];

/**
 * Appends an action and returns its handle. The oldest actions are dropped once
 * the stack is over `MAX_UNDO`; a dropped action's handle no longer matches.
 */
export function pushUndo(action: UndoAction): UndoHandle {
  stack.push(action);
  while (stack.length > MAX_UNDO) {
    stack.shift();
  }
  return action;
}

/** Returns the label of the next undoable action, or null when the stack is empty. */
export function peekUndo(): string | null {
  return stack[stack.length - 1]?.label ?? null;
}

async function run(action: UndoAction): Promise<boolean> {
  try {
    await action.undo();
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not undo that change.");
    return false;
  }
}

/** Pops and runs the newest action (Google Calendar's `z` / `Ctrl+Z` gesture). */
export async function undoLast(): Promise<boolean> {
  const action = stack.pop();
  if (!action) {
    return false;
  }
  return run(action);
}

/**
 * Runs one specific pushed action and removes it from the stack. This is what a
 * toast's Undo button calls: the line it names is reverted even if newer actions
 * were pushed after it (the press is a no-op once the action has been undone,
 * dropped by the cap, or was never pushed).
 */
export async function undoAction(handle: UndoHandle): Promise<boolean> {
  const index = stack.indexOf(handle);
  if (index === -1) {
    return false;
  }
  stack.splice(index, 1);
  return run(handle);
}

/** Test seam: drop every pending action. */
export function clearUndo(): void {
  stack.length = 0;
}
