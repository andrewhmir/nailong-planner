"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { shadeTokens } from "@/lib/color/palette";
import { applyEventPatch, parseExdates, replaceEvent } from "@/lib/query/eventCache";
import type { EventView } from "@/lib/services/events";

export interface EventRange {
  from: number;
  to: number;
}

export type RecurringScope = "this" | "following" | "all";

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
  /** Recurring-edit scope envelope; absent keeps the old all-series PATCH. */
  scope?: RecurringScope;
  occurrenceStart?: string;
  /** Only used by undo to restore an exception under its series. */
  recurrenceParentId?: string | null;
  recurrenceId?: string | null;
}

/** PATCH response: a plain series/exception row, or the split envelope. */
export interface UpdateEventResult {
  event: EventView;
  truncated?: EventView | null;
  relinked?: EventView[];
  relinkedPrevious?: EventView[];
}

/** DELETE response: every row removed (empty for a single-occurrence skip). */
export interface DeleteEventResult {
  deleted?: EventView[];
  truncated?: EventView | null;
}

interface ApiErrorBody {
  error?: { message?: string };
}

type EventSnapshots = Array<[QueryKey, EventView[] | undefined]>;

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

async function snapshotEvents(queryClient: QueryClient): Promise<EventSnapshots> {
  await queryClient.cancelQueries({ queryKey: ["events"] });
  return queryClient.getQueriesData<EventView[]>({ queryKey: ["events"] });
}

function restoreEvents(queryClient: QueryClient, snapshots: EventSnapshots | undefined): void {
  for (const [key, data] of snapshots ?? []) {
    queryClient.setQueryData(key, data);
  }
}

function patchList(patch: EventInputPayload): Partial<EventView> {
  const fields: Partial<EventView> = { updatedAt: Date.now() };
  if (patch.calendarId !== undefined) fields.calendarId = patch.calendarId;
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.location !== undefined) fields.location = patch.location;
  if (patch.allDay !== undefined) fields.allDay = patch.allDay ? 1 : 0;
  if (patch.startAt !== undefined) fields.startAt = patch.startAt;
  if (patch.endAt !== undefined) fields.endAt = patch.endAt;
  if (patch.startDate !== undefined) fields.startDate = patch.startDate;
  if (patch.endDate !== undefined) fields.endDate = patch.endDate;
  if (patch.rrule !== undefined) fields.rrule = patch.rrule;
  if (patch.exdates !== undefined) {
    fields.exdates = patch.exdates ? JSON.stringify(patch.exdates) : null;
  }
  return fields;
}

/** A placeholder row so a new event appears the instant Save is pressed. */
function optimisticEvent(input: EventInputPayload): EventView {
  const now = Date.now();
  const allDay = input.allDay === true;
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    id: `temp-${crypto.randomUUID()}`,
    householdId: "",
    calendarId: input.calendarId ?? "",
    title: input.title ?? "New event",
    description: input.description ?? null,
    location: input.location ?? null,
    allDay: allDay ? 1 : 0,
    startAt: allDay ? null : (input.startAt ?? now),
    endAt: allDay ? null : (input.endAt ?? now + 60 * 60 * 1000),
    startDate: allDay ? (input.startDate ?? day) : null,
    endDate: allDay ? (input.endDate ?? input.startDate ?? day) : null,
    rrule: input.rrule ?? null,
    exdates: input.exdates ? JSON.stringify(input.exdates) : null,
    recurrenceParentId: null,
    recurrenceId: null,
    tzid: null,
    externalSource: null,
    externalUid: null,
    externalRecurrenceId: null,
    externalKey: null,
    externalContentHash: null,
    createdBy: "",
    createdAt: now,
    updatedAt: now,
    // The real colour arrives with the server row; slate is the neutral stand-in.
    color: shadeTokens("slate", 1),
  };
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EventInputPayload) =>
      requestJson<{ event: EventView }>("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      const snapshots = await snapshotEvents(queryClient);
      const temp = optimisticEvent(input);
      queryClient.setQueriesData<EventView[]>({ queryKey: ["events"] }, (old) =>
        old ? [...old, temp] : old,
      );
      return { snapshots, tempId: temp.id };
    },
    onError: (_error, _input, context) => restoreEvents(queryClient, context?.snapshots),
    onSuccess: (payload, _input, context) => {
      const tempId = context?.tempId;
      if (!tempId) {
        return;
      }
      queryClient.setQueriesData<EventView[]>({ queryKey: ["events"] }, (old) =>
        old && old.some((event) => event.id === tempId) ? replaceEvent(old, payload.event) : old,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & EventInputPayload) =>
      requestJson<UpdateEventResult>(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onMutate: async ({ id, ...input }) => {
      if (input.scope !== undefined) {
        // Scoped writes change several rows (or split a series); let the
        // invalidation below render the authoritative result instead of
        // guessing an optimistic shape.
        return { snapshots: undefined };
      }
      const snapshots = await snapshotEvents(queryClient);
      queryClient.setQueriesData<EventView[]>({ queryKey: ["events"] }, (old) =>
        old ? applyEventPatch(old, id, patchList(input)) : old,
      );
      return { snapshots };
    },
    onError: (_error, _input, context) => restoreEvents(queryClient, context?.snapshots),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      scope = "all",
      occurrenceStart,
    }: {
      id: string;
      scope?: RecurringScope;
      occurrenceStart?: string;
    }): Promise<DeleteEventResult> => {
      const response = await fetch(`/api/events/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, occurrenceStart }),
      });
      if (response.status === 204) {
        return {};
      }
      const payload = (await response.json().catch(() => null)) as
        | (DeleteEventResult & ApiErrorBody)
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not delete the event.");
      }
      return payload ?? {};
    },
    onMutate: async ({ id, scope = "all", occurrenceStart }) => {
      const snapshots = await snapshotEvents(queryClient);
      if (scope === "this" && occurrenceStart) {
        queryClient.setQueriesData<EventView[]>({ queryKey: ["events"] }, (old) => {
          const target = old?.find((event) => event.id === id);
          if (!old || !target) {
            return old;
          }
          const exdates = parseExdates(target.exdates);
          if (exdates.includes(occurrenceStart)) {
            return old;
          }
          return applyEventPatch(old, id, {
            exdates: JSON.stringify([...exdates, occurrenceStart]),
          });
        });
      } else if (scope === "all") {
        queryClient.setQueriesData<EventView[]>({ queryKey: ["events"] }, (old) =>
          old
            ? old.filter(
                (event) => event.id !== id && event.recurrenceParentId !== id,
              )
            : old,
        );
      }
      return { snapshots };
    },
    onError: (_error, _input, context) => restoreEvents(queryClient, context?.snapshots),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
