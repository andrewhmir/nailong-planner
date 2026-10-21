"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserPreferences } from "@/lib/services/preferences";

interface ApiErrorBody {
  error?: { message?: string };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Something went wrong.");
  }
  return payload as T;
}

export const preferencesKey = ["preferences"] as const;

/** Seeded from the server layout, so the first paint already has the right preferences. */
export function usePreferences(initialData: UserPreferences) {
  return useQuery({
    queryKey: preferencesKey,
    queryFn: async () =>
      (await requestJson<{ preferences: UserPreferences }>("/api/settings/preferences"))
        .preferences,
    initialData,
    staleTime: Infinity,
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserPreferences>) =>
      requestJson<{ preferences: UserPreferences }>("/api/settings/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: preferencesKey });
      const previous = queryClient.getQueryData<UserPreferences>(preferencesKey);
      if (previous) {
        queryClient.setQueryData<UserPreferences>(preferencesKey, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(preferencesKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: preferencesKey });
    },
  });
}
