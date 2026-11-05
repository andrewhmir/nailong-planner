"use client";

import { useEffect } from "react";
import { isTextEntryTarget } from "./shortcutGuards";
import { undoLast } from "./undo";

/**
 * The subset of a keydown the undo gesture needs. `KeyboardEvent` satisfies it
 * structurally, so the hook passes real events and the unit test can pass a
 * plain object without a DOM.
 */
export interface UndoHotkeyEvent {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * True only for Google Calendar's two undo gestures: plain `z`, or `z` with
 * exactly one of Ctrl/Cmd held (holding both is not the gesture). A held-key
 * repeat is excluded for the same reason the sibling key maps exclude it —
 * one hold must undo once, not drain the 20-action stack.
 */
export function isUndoGesture(event: UndoHotkeyEvent): boolean {
  if (event.repeat || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.key.toLowerCase() !== "z") {
    return false;
  }
  const plain = !event.ctrlKey && !event.metaKey;
  // `Ctrl+Z` and `Cmd+Z` are the same gesture; holding both is not.
  const modified = (event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.metaKey);
  return plain || modified;
}

/**
 * Binds Google Calendar's two undo gestures: plain `z` and `Ctrl/Cmd+Z`. Text
 * fields keep their native undo — pressing Ctrl+Z while typing must edit the
 * text, never revert an event. The typing guard is the shared
 * `isTextEntryTarget`, the same predicate every keyboard layer uses.
 */
export function useUndoHotkey(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isTextEntryTarget(event.target)) {
        return;
      }
      if (!isUndoGesture(event)) {
        return;
      }
      event.preventDefault();
      void undoLast();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
