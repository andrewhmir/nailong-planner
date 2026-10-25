"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_VISIBILITY, parseVisibility, type GroupKey, type VisibilityState } from "./visibility";

export interface VisibilityApi {
  state: VisibilityState;
  setGroup: (group: GroupKey, visible: boolean) => void;
  toggleCollection: (id: string) => void;
  setCollections: (ids: string[], visible: boolean) => void;
  /** `null` clears "display only this calendar". */
  setOnly: (id: string | null) => void;
}

/** Visibility state persisted per user in `localStorage`. */
export function useVisibility(userId: string): VisibilityApi {
  const storageKey = `nailong.visibility.${userId}`;
  const [state, setState] = useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      // Reading persisted preferences must happen after hydration; the server
      // has no localStorage, so this cannot move into useState's initializer.
      // `parseVisibility` owns the pre-v0.2 `calendars` fallback and the
      // boolean/type defence, so a corrupt value cannot hide anything.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(parseVisibility(window.localStorage.getItem(storageKey)));
    } catch {
      // Storage unavailable (private mode): keep the defaults for this session.
    } finally {
      setLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage may be unavailable (private mode); visibility is then session-only.
    }
  }, [loaded, state, storageKey]);

  const setGroup = useCallback((group: GroupKey, visible: boolean) => {
    setState((previous) => ({
      ...previous,
      groups: { ...previous.groups, [group]: visible },
      // Touching the pills is how you leave the isolated view.
      only: null,
    }));
  }, []);

  const toggleCollection = useCallback((id: string) => {
    setState((previous) => ({
      ...previous,
      collections: { ...previous.collections, [id]: !(previous.collections[id] ?? true) },
      only: null,
    }));
  }, []);

  const setCollections = useCallback((ids: string[], visible: boolean) => {
    setState((previous) => {
      const next = { ...previous.collections };
      for (const id of ids) {
        next[id] = visible;
      }
      return { ...previous, collections: next, only: null };
    });
  }, []);

  const setOnly = useCallback((id: string | null) => {
    setState((previous) => ({ ...previous, only: id }));
  }, []);

  return { state, setGroup, toggleCollection, setCollections, setOnly };
}
