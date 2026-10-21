"use client";

import { useEffect, useRef } from "react";
import type { PlannerView } from "@/components/calendar/Toolbar";

/**
 * Single-key shortcuts, matching Google Calendar where the gesture exists
 * (spec §7.9 / D7). `Ctrl/Cmd+Z` is deliberately absent: `useUndoHotkey` owns
 * undo, including plain `z`.
 */

export interface ShortcutHandlers {
  /** `c` — the full editor. */
  onCreateFull: () => void;
  /** `Shift+C` — the quick-create bubble at the viewport centre. */
  onCreateAtCursor: () => void;
  /** `/` — focus the search field. */
  onFocusSearch: () => void;
  onToday: () => void;
  onView: (view: PlannerView) => void;
  onPeriod: (direction: 1 | -1) => void;
  onEditSelected: () => void;
  onDeleteSelected: () => void;
  onHelp: () => void;
  onEscape: () => void;
  /** `g` — later tasks add the picker; absent means the key is ignored. */
  onOpenDatePicker?: () => void;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

/** Radix dialogs/popovers/menus own Escape and their own keys. */
function hasOpenOverlay(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"]') !== null;
}

export function useKeyboardShortcuts(enabled: boolean, handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isTextEntryTarget(event.target)) {
        return;
      }
      const current = handlersRef.current;
      const overlayOpen = hasOpenOverlay();
      const key = event.key;

      if (key === "Escape") {
        if (overlayOpen) {
          return;
        }
        current.onEscape();
        return;
      }
      if (overlayOpen) {
        // A dialog/bubble is up: leave every printable key to it.
        return;
      }

      if (key === "?") {
        event.preventDefault();
        current.onHelp();
        return;
      }
      if (key === "/") {
        event.preventDefault();
        current.onFocusSearch();
        return;
      }
      if (event.shiftKey) {
        // Shift+C is the only shifted letter gesture; browsers vary on whether
        // the event key is "C" or "c", so normalise before comparing.
        if (key.toLowerCase() === "c") {
          event.preventDefault();
          current.onCreateAtCursor();
        }
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        event.preventDefault();
        current.onDeleteSelected();
        return;
      }

      switch (key.toLowerCase()) {
        case "c":
          event.preventDefault();
          current.onCreateFull();
          return;
        case "t":
          event.preventDefault();
          current.onToday();
          return;
        case "d":
          event.preventDefault();
          current.onView("timeGridDay");
          return;
        case "w":
          event.preventDefault();
          current.onView("timeGridWeek");
          return;
        case "m":
          event.preventDefault();
          current.onView("dayGridMonth");
          return;
        case "l":
          event.preventDefault();
          current.onView("listMonth");
          return;
        case "j":
        case "n":
          event.preventDefault();
          current.onPeriod(1);
          return;
        case "k":
        case "p":
          event.preventDefault();
          current.onPeriod(-1);
          return;
        case "e":
          event.preventDefault();
          current.onEditSelected();
          return;
        case "g":
          if (current.onOpenDatePicker) {
            event.preventDefault();
            current.onOpenDatePicker();
          }
          return;
        default:
          return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
