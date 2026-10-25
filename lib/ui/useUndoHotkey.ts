"use client";

import { useEffect } from "react";
import { isTextEntryTarget } from "./shortcutGuards";
import { undoLast } from "./undo";

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
