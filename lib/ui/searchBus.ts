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

/**
 * The second bus: "the user just picked this search result". The calendar shell
 * opens the event from a URL deep link, but `useSearchParams()` only updates
 * after the navigation commits — long enough for the user to start a new event
 * in the meantime. Announcing the click at its source gives the shell the true
 * reference point, so "most recent action wins" is decided by the click order
 * rather than by when Next.js exposes the URL.
 */
const EVENT_LINK = "nailong:event-link";

export interface EventLink {
  /** `YYYY-MM-DD` to jump the grid to. */
  date: string;
  eventId: string;
}

export function announceEventLink(link: EventLink): void {
  window.dispatchEvent(new CustomEvent<EventLink>(EVENT_LINK, { detail: link }));
}

export function onEventLink(callback: (link: EventLink) => void): () => void {
  function handler(event: Event): void {
    callback((event as CustomEvent<EventLink>).detail);
  }
  window.addEventListener(EVENT_LINK, handler);
  return () => window.removeEventListener(EVENT_LINK, handler);
}
