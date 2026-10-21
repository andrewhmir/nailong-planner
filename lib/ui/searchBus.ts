"use client";

/**
 * Tiny event bus for "focus the search field". The `/` shortcut, the mobile
 * search button and any future command palette all call the same function, so
 * no component needs a prop drilled through the shell.
 */

const FOCUS_EVENT = "nailong:focus-search";

export function focusSearch(): void {
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT));
}

export function onFocusSearch(callback: () => void): () => void {
  window.addEventListener(FOCUS_EVENT, callback);
  return () => window.removeEventListener(FOCUS_EVENT, callback);
}
