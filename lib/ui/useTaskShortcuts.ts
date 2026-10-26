"use client";

import { useEffect, useRef } from "react";
import type { TaskBucket } from "@/lib/domain/tasks";
import { hasOpenOverlay, isTextEntryTarget } from "./shortcutGuards";

/**
 * The `/tasks` keyboard triage layer (spec §7.9): `j`/`k` move the selected row,
 * `1`/`2`/`3` triage it into Today / the end of this week / Someday, `4` moves
 * it to the next writable list, `x` completes it, `Enter` opens it, `?` shows the
 * shortcut list and `Escape` clears the selection.
 *
 * The calendar's `useKeyboardShortcuts` owns the same letters on `/`; both hooks
 * are page-scoped, so only the page currently mounted sees them. The key map is
 * split into the pure `resolveTaskShortcut` so it can be unit-tested without a
 * DOM; the guards (typing target, open overlay) are applied by the hook.
 */

export type TaskShortcutAction =
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "bucket"; bucket: 1 | 2 | 3 }
  | { kind: "next-list" }
  | { kind: "complete" }
  | { kind: "open" }
  | { kind: "help" }
  | { kind: "escape" };

export interface TaskShortcutHandlers {
  /** `j` (next) / `k` (previous), clamped to the current view's rows. */
  onMoveSelection(delta: 1 | -1): void;
  /** `1` Today, `2` this week's last day, `3` clear dates / file an Inbox row. */
  onBucket(bucket: 1 | 2 | 3): void;
  /** `4` move the selection to the next writable list. */
  onNextList(): void;
  /** `x` complete the selected task. */
  onComplete(): void;
  /** `Enter` — opens the selected task; the editor is Task 10's hand-off. */
  onOpen(): void;
  /** `?` open the shortcut list. */
  onHelp(): void;
  /** `Escape` clear the selection (no overlay is open when this fires). */
  onEscape(): void;
}

/**
 * Pure key map. No DOM reads and no side effects: it decides only what a
 * keydown means, then `useTaskShortcuts` applies the guards and dispatches.
 * Modifiers (Ctrl/Cmd/Alt), held-key repeats and shifted letters (except `?`,
 * which needs Shift on most layouts) are ignored. Caps Lock's uppercase letters
 * still map because the letter comparison is lower-cased.
 */
export function resolveTaskShortcut(event: KeyboardEvent): TaskShortcutAction | null {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  const key = event.key;
  if (key === "?") {
    return { kind: "help" };
  }
  if (key === "Escape") {
    return { kind: "escape" };
  }
  // Every other task gesture is unshifted; Shift+letter belongs to the page's
  // own shifted gestures (the calendar's `Shift+C`), not to triage.
  if (event.shiftKey) {
    return null;
  }

  switch (key) {
    case "1":
      return { kind: "bucket", bucket: 1 };
    case "2":
      return { kind: "bucket", bucket: 2 };
    case "3":
      return { kind: "bucket", bucket: 3 };
    case "4":
      return { kind: "next-list" };
    case "Enter":
      return { kind: "open" };
    default:
      break;
  }

  switch (key.toLowerCase()) {
    case "j":
      return { kind: "move", delta: 1 };
    case "k":
      return { kind: "move", delta: -1 };
    case "x":
      return { kind: "complete" };
    default:
      return null;
  }
}

export type SomedayTriageAction =
  | { kind: "clear-dates" }
  | { kind: "file-to-list" }
  | { kind: "already-someday" }
  | { kind: "already-unscheduled" };

/**
 * What `3` ("Someday") should do to the selected row. A dated task is cleared
 * back to its list. An undated task in the Inbox is already "Someday" by
 * definition, so `3` has to file it into another list to move it out of the
 * Inbox; with no other writable list the gesture says so instead of silently
 * doing nothing. An undated task outside the Inbox is already in Someday.
 */
export function resolveSomedayTriage(input: {
  scheduledOn: string | null;
  dueOn: string | null;
  view: TaskBucket;
  hasOtherWritableList: boolean;
}): SomedayTriageAction {
  if (input.scheduledOn !== null || input.dueOn !== null) {
    return { kind: "clear-dates" };
  }
  if (input.view !== "inbox") {
    return { kind: "already-someday" };
  }
  return input.hasOtherWritableList
    ? { kind: "file-to-list" }
    : { kind: "already-unscheduled" };
}

function runAction(handlers: TaskShortcutHandlers, action: TaskShortcutAction): void {
  switch (action.kind) {
    case "move":
      handlers.onMoveSelection(action.delta);
      return;
    case "bucket":
      handlers.onBucket(action.bucket);
      return;
    case "next-list":
      handlers.onNextList();
      return;
    case "complete":
      handlers.onComplete();
      return;
    case "open":
      handlers.onOpen();
      return;
    case "help":
      handlers.onHelp();
      return;
    case "escape":
      handlers.onEscape();
      return;
  }
}

/**
 * A button, link, menu item or checkbox already owns Enter/click activation. The
 * row's status/priority/date chips, its Options menu and its completion checkbox
 * are all buttons, so letting triage swallow Enter would open the task panel
 * instead of the control the user actually focused.
 */
function isActivatableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a, [role='button'], [role='menuitem'], [role='checkbox']") !== null
  );
}

export function useTaskShortcuts(enabled: boolean, handlers: TaskShortcutHandlers): void {
  // The handlers close over the current rows/selection, so mirror them into a
  // ref: the listener itself only re-subscribes when `enabled` flips.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (isTextEntryTarget(event.target) || hasOpenOverlay()) {
        return;
      }
      const action = resolveTaskShortcut(event);
      if (!action) {
        return;
      }
      if (action.kind === "open" && isActivatableTarget(event.target)) {
        // Leave native activation (row chips, Options, the completion checkbox,
        // the scope tabs, "Try again") to the focused control.
        return;
      }
      event.preventDefault();
      runAction(handlersRef.current, action);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
