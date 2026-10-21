"use client";

import { useEffect } from "react";
import { undoLast } from "./undo";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Binds Google Calendar's two undo gestures: plain `z` and `Ctrl/Cmd+Z`. Text
 * fields keep their native undo — pressing Ctrl+Z while typing must edit the
 * text, never revert an event.
 */
export function useUndoHotkey(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.key.toLowerCase() !== "z" || event.altKey || event.shiftKey) {
        return;
      }
      const plain = !event.ctrlKey && !event.metaKey;
      // `Ctrl+Z` and `Cmd+Z` are the same gesture; holding both is not.
      const modified = (event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.metaKey);
      if (!plain && !modified) {
        return;
      }
      event.preventDefault();
      void undoLast();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
