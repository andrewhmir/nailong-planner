/**
 * Guards shared by every single-key keyboard layer: the calendar's page-local
 * shortcuts, the task triage layer and the global `Shift+K` capture. Keeping one
 * copy means typing guards and overlay detection cannot drift between them.
 *
 * Both functions touch browser globals at call time only, so importing this
 * module from a test (or from a server component that never calls them) is safe.
 */

/** True for the four element shapes that own their keystrokes while focused. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

/**
 * Radix dialogs, popovers and menus own Escape and their own keys. Task 9's
 * task keys and the global capture treat any open overlay as a hard stop too, so
 * a dialog can never leak `j`/`x` to the page underneath.
 */
export function hasOpenOverlay(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"]') !== null;
}
