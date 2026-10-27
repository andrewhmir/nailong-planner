"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { TaskScope } from "@/lib/domain/tasks";
import { patchTasksEntry, type TasksCacheData } from "@/lib/query/taskCache";
import type { TaskCountSummary, TaskView } from "@/lib/services/tasks";
import type { CreateTaskInput, ReorderTasksInput, UpdateTaskInput } from "@/lib/validation/tasks";

interface ApiErrorBody {
  error?: { message?: string };
}

type TaskSnapshots = Array<[QueryKey, TasksCacheData | undefined]>;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Something went wrong.");
  }
  return payload as T;
}

/**
 * Every task the viewer may see for a scope (or one list), plus the rail counts.
 * `view` defaults to `"all"` (the bare `/tasks` and the calendar grid);
 * `includeClosed` opts into `done`/`dropped` rows. The key always carries the
 * effective values, so an omitted filter and `"all"` share one cache entry and
 * the open and closed-row variants never overwrite each other.
 */
export function useTasks(
  view?: TaskScope,
  collectionId?: string,
  includeClosed?: boolean,
) {
  return useQuery({
    queryKey: ["tasks", view ?? "all", collectionId ?? null, includeClosed ? "closed" : "open"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (view !== undefined) {
        params.set("view", view);
      }
      if (collectionId !== undefined) {
        params.set("collectionId", collectionId);
      }
      if (includeClosed) {
        params.set("includeClosed", "true");
      }
      const query = params.toString();
      return requestJson<TasksCacheData>(`/api/tasks${query ? `?${query}` : ""}`);
    },
  });
}

/**
 * The rail counts plus the active-task total of every list that has one. The
 * sidebar enables it only on `/tasks` (and passes the counts into the rows only
 * while the pathname is still `/tasks`), so the calendar does not pay for a
 * second request and a cached payload cannot paint a badge on a calendar row.
 * The key shares the `["tasks"]` prefix, which is what makes every task
 * mutation's invalidation refresh the badges too.
 */
export function useTaskCounts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["tasks", "counts"],
    queryFn: () => requestJson<TaskCountSummary>("/api/tasks/counts"),
    enabled: options?.enabled ?? true,
  });
}

async function snapshotTasks(queryClient: QueryClient): Promise<TaskSnapshots> {
  await queryClient.cancelQueries({ queryKey: ["tasks"] });
  return queryClient.getQueriesData<TasksCacheData>({ queryKey: ["tasks"] });
}

function restoreTasks(queryClient: QueryClient, snapshots: TaskSnapshots | undefined): void {
  for (const [key, data] of snapshots ?? []) {
    queryClient.setQueryData(key, data);
  }
}

/**
 * Maps a PATCH payload onto a cached row. Nullish dates and notes mean "clear",
 * while an omitted key is skipped so the optimistic row keeps the stored value;
 * the checklist is flattened to views with placeholder ids (the settle refetch
 * replaces them with the server-generated ones). Exported for the optimistic
 * cache test, which drives it without mounting a renderer.
 */
export function patchTask(input: UpdateTaskInput): Partial<TaskView> {
  const patch: Partial<TaskView> = { updatedAt: Date.now() };
  if (input.title !== undefined) {
    patch.title = input.title.trim();
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes ?? null;
  }
  if (input.dueOn !== undefined) {
    patch.dueOn = input.dueOn ?? null;
    if (patch.dueOn === null) {
      // Mirrors the service: clearing the date clears the time it belonged to.
      patch.dueTime = null;
    }
  }
  if (input.dueTime !== undefined) {
    patch.dueTime = input.dueTime ?? null;
  }
  if (input.sortOrder !== undefined) {
    patch.sortOrder = input.sortOrder;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.priority !== undefined) {
    patch.priority = input.priority;
  }
  if (input.collectionId !== undefined) {
    patch.collectionId = input.collectionId;
  }
  if (input.checklist !== undefined) {
    patch.checklist = input.checklist.map((item, index) => ({
      id: `temp-${index}`,
      title: item.title.trim(),
      done: item.done,
    }));
  }
  return patch;
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      requestJson<{ task: TaskView }>("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/**
 * The only optimistic hook: every cached `["tasks", …]` payload is patched in
 * place, snapshotted for rollback, and refreshed on settle so bucket membership
 * and counts come back from the server.
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateTaskInput) =>
      requestJson<{ task: TaskView }>(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onMutate: async ({ id, ...input }) => {
      const snapshots = await snapshotTasks(queryClient);
      queryClient.setQueriesData<unknown>({ queryKey: ["tasks"] }, (old: unknown) =>
        // The counts query shares the prefix but holds `{ counts, byCollection }`,
        // not a task list, so it is skipped instead of being mapped as one.
        patchTasksEntry(old, id, patchTask(input)),
      );
      return { snapshots };
    },
    onError: (_error, _input, context) => restoreTasks(queryClient, context?.snapshots),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(payload?.error?.message ?? "Could not delete the task.");
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useReorderTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReorderTasksInput) =>
      requestJson<{ tasks: TaskView[] }>("/api/tasks/order", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
