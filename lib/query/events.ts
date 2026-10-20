"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventView } from "@/lib/services/events";

export interface EventRange {
  from: number;
  to: number;
}

export interface EventInputPayload {
  calendarId?: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  allDay?: boolean;
  startAt?: number | null;
  endAt?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  rrule?: string | null;
  exdates?: string[];
}

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

export function useEvents(range: EventRange | null) {
  return useQuery({
    queryKey: ["events", range?.from ?? 0, range?.to ?? 0],
    enabled: range !== null,
    queryFn: async () => {
      const params = new URLSearchParams({
        from: String(range!.from),
        to: String(range!.to),
      });
      return (await requestJson<{ events: EventView[] }>(`/api/events?${params.toString()}`)).events;
    },
  });
}

function useInvalidateEvents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["events"] });
}

export function useCreateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (input: EventInputPayload) =>
      requestJson<{ event: EventView }>("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & EventInputPayload) =>
      requestJson<{ event: EventView }>(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: async ({
      id,
      scope = "all",
      occurrenceStart,
    }: {
      id: string;
      scope?: "all" | "this";
      occurrenceStart?: string;
    }) => {
      const response = await fetch(`/api/events/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, occurrenceStart }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(payload?.error?.message ?? "Could not delete the event.");
      }
    },
    onSuccess: () => void invalidate(),
  });
}
