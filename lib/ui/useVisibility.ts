"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_VISIBILITY, type GroupKey, type VisibilityState } from "./visibility";

export interface VisibilityApi {
  state: VisibilityState;
  setGroup: (group: GroupKey, visible: boolean) => void;
  toggleCalendar: (id: string) => void;
  setCalendars: (ids: string[], visible: boolean) => void;
}

/** Visibility state persisted per user in `localStorage`. */
export function useVisibility(userId: string): VisibilityApi {
  const storageKey = `nailong.visibility.${userId}`;
  const [state, setState] = useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<VisibilityState>;
        // Reading persisted preferences must happen after hydration; the server
        // has no localStorage, so this cannot move into useState's initializer.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({
          groups: { ...DEFAULT_VISIBILITY.groups, ...(parsed.groups ?? {}) },
          calendars: parsed.calendars ?? {},
        });
      }
    } catch {
      // Corrupt stored preference: fall back to defaults.
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
    }));
  }, []);

  const toggleCalendar = useCallback((id: string) => {
    setState((previous) => ({
      ...previous,
      calendars: { ...previous.calendars, [id]: !(previous.calendars[id] ?? true) },
    }));
  }, []);

  const setCalendars = useCallback((ids: string[], visible: boolean) => {
    setState((previous) => {
      const next = { ...previous.calendars };
      for (const id of ids) {
        next[id] = visible;
      }
      return { ...previous, calendars: next };
    });
  }, []);

  return { state, setGroup, toggleCalendar, setCalendars };
}
