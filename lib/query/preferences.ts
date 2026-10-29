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
        queryClient.setQueryData<UserPreferences>(preferencesKey, { ...previous, ...patch });
      }
      return { previous, sequence };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(preferencesKey, context.previous);
      }
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
