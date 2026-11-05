"use client";
import { requestJson } from "@/lib/query/request";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { UserPreferences } from "@/lib/services/preferences";



export const preferencesKey = ["preferences"] as const;

/** Seeded from the server layout, so the first paint already has the right preferences. */
export function usePreferences(initialData: UserPreferences): UserPreferences {
  const { data } = useQuery({
    queryKey: preferencesKey,
    queryFn: async () =>
      (await requestJson<{ preferences: UserPreferences }>("/api/settings/preferences"))
        .preferences,
    initialData,
    staleTime: Infinity,
  });
  return data ?? initialData;
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  // Rapid toggles overlap: responses can arrive out of order, and only the most
  // recently issued patch may overwrite the optimistic cache.
  const latestIssued = useRef(0);
  // Which request last wrote each field optimistically. A stale failure may
  // only undo fields no later request has touched since.
  const touchedAt = useRef(new Map<keyof UserPreferences, number>());

  return useMutation({
    mutationFn: (patch: Partial<UserPreferences>) =>
      requestJson<{ preferences: UserPreferences }>("/api/settings/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onMutate: async (patch) => {
      latestIssued.current += 1;
      const sequence = latestIssued.current;
      await queryClient.cancelQueries({ queryKey: preferencesKey });
      const previous = queryClient.getQueryData<UserPreferences>(preferencesKey);
      if (previous) {
        for (const key of Object.keys(patch) as (keyof UserPreferences)[]) {
          touchedAt.current.set(key, sequence);
        }
        queryClient.setQueryData<UserPreferences>(preferencesKey, { ...previous, ...patch });
      }
      return { previous, sequence };
    },
    onError: (_error, patch, context) => {
      const previous = context?.previous;
      if (!context || !previous) {
        return;
      }
      // The latest request owns the whole rollback: its snapshot predates every
      // later optimistic merge.
      if (context.sequence === latestIssued.current) {
        queryClient.setQueryData(preferencesKey, previous);
        return;
      }
      // A stale failure must not clobber a newer cache value — a newer PATCH may
      // already have written the canonical row. Drop only the fields this
      // failing request touched and no later request has touched since.
      queryClient.setQueryData<UserPreferences>(preferencesKey, (current) => {
        if (!current) {
          return current;
        }
        const restored: Partial<UserPreferences> = {};
        for (const key of Object.keys(patch) as (keyof UserPreferences)[]) {
          if (touchedAt.current.get(key) === context.sequence) {
            Object.assign(restored, { [key]: previous[key] });
          }
        }
        return Object.keys(restored).length > 0 ? { ...current, ...restored } : current;
      });
    },
    // The response is the canonical row; applying it instead of refetching keeps
    // a rapid second toggle from being overwritten by an in-flight GET.
    onSuccess: (payload, _patch, context) => {
      if (context?.sequence === latestIssued.current) {
        queryClient.setQueryData<UserPreferences>(preferencesKey, payload.preferences);
      }
    },
  });
}
