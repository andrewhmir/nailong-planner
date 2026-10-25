import { toast } from "sonner";
import { undoAction, type UndoHandle } from "./undo";

/**
 * The one success-toast-with-Undo helper: a 10-second Sonner toast whose action
 * reverts exactly the action that produced the message. Every call site follows
 * the same shape — push the compensating action, keep the returned handle, then
 * call this — so a newer undoable change can never hijack an older toast's
 * button. `z` / `Ctrl+Z` still consume the shared stack LIFO (see `undo.ts`).
 */
export function undoToast(message: string, handle: UndoHandle): void {
  toast.success(message, {
    action: { label: "Undo", onClick: () => void undoAction(handle) },
    duration: 10_000,
  });
}
