"use client";

import { useCallback, useEffect, useState } from "react";
import type { GroupKey } from "./visibility";
import {
  DEFAULT_TREE_FOLD,
  isCalendarOpen,
  isGroupOpen,
  parseTreeFold,
  setCalendarOpen,
  setGroupOpen,
  type TreeFoldState,
} from "./treeFold";

/**
 * Which branches of the calendar sidebar are open. Persisted per user, in
 * `localStorage`, separately from visibility: folding a branch only changes how
 * the tree is displayed, never which calendars are drawn.
 */
export interface TreeFoldApi {
  isGroupOpen: (group: GroupKey) => boolean;
  isCalendarOpen: (id: string) => boolean;
  toggleGroup: (group: GroupKey) => void;
  toggleCalendar: (id: string) => void;
  /** Opens the group a created or re-owned calendar landed in. */
  expandGroup: (group: GroupKey) => void;
  /** Opens a root so a newly added sub-calendar is not created hidden. */
  expandCalendar: (id: string) => void;
}

export function useTreeFold(userId: string): TreeFoldApi {
  const storageKey = `nailong.treeFold.${userId}`;
  const [state, setState] = useState<TreeFoldState>(DEFAULT_TREE_FOLD);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      // Storage can be blocked (private mode); the tree then starts expanded.
    }
    // Reading persisted preferences must happen after hydration: the server has
    // no localStorage, so this cannot move into useState's initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(parseTreeFold(stored));
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    // Gate on the key that was actually loaded. A user change re-reads first, so
    // the previous person's state is never written under the new key.
    if (loadedKey !== storageKey) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage can be blocked (private mode); folding is then session-only.
    }
  }, [loadedKey, state, storageKey]);

  const toggleGroup = useCallback((group: GroupKey) => {
    setState((previous) => setGroupOpen(previous, group, !isGroupOpen(previous, group)));
  }, []);

  const toggleCalendar = useCallback((id: string) => {
    setState((previous) => setCalendarOpen(previous, id, !isCalendarOpen(previous, id)));
  }, []);

  const expandGroup = useCallback((group: GroupKey) => {
    setState((previous) => setGroupOpen(previous, group, true));
  }, []);

  const expandCalendar = useCallback((id: string) => {
    setState((previous) => setCalendarOpen(previous, id, true));
  }, []);

  const groupOpen = useCallback((group: GroupKey) => isGroupOpen(state, group), [state]);
  const calendarOpen = useCallback((id: string) => isCalendarOpen(state, id), [state]);

  return {
    isGroupOpen: groupOpen,
    isCalendarOpen: calendarOpen,
    toggleGroup,
    toggleCalendar,
    expandGroup,
    expandCalendar,
  };
}
