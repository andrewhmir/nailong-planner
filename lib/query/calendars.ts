"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalendarRow } from "@/lib/db/schema";
import type { CalendarNode } from "@/lib/services/calendars";

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

export interface CalendarInput {
  name: string;
  parentId?: string | null;
  hueFamily?: string;
  ownerId?: string | null;
  isViewOnlyForPartner?: boolean;
}

export function useCalendars() {
  return useQuery({
    queryKey: ["calendars"],
    queryFn: async () => (await requestJson<{ calendars: CalendarNode[] }>("/api/calendars")).calendars,
  });
}

export function useCreateCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarInput) =>
      requestJson<{ calendar: CalendarRow }>("/api/calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendars"] }),
  });
}

export function useUpdateCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<CalendarInput> & { sortOrder?: number }) =>
      requestJson<{ calendar: CalendarRow }>(`/api/calendars/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendars"] }),
  });
}

export function useDeleteCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/calendars/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(payload?.error?.message ?? "Could not delete the calendar.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendars"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
