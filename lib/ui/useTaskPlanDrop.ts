"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import type { TasksCacheData } from "@/lib/query/taskCache";
import { useUpdateTask } from "@/lib/query/tasks";
import type { TaskView } from "@/lib/services/tasks";
import { pushUndo } from "./undo";
import { undoToast } from "./undoToast";

interface TaskPayload {
  task?: TaskView;
  error?: { message?: string };
}

/**
 * The one "plan a task by dropping it on a day" mutation path. Both drop
 * surfaces call it: the sidebar mini month (the target that exists on `/tasks`,
 * where the task rows live) and the full month grid's day cells. It PATCHes
 * `scheduledOn`, tells the truth with a `Task planned` toast whose Undo restores
 * the exact previous date (a drop that changes nothing is a silent no-op), and
 * toasts `Could not schedule the task.` on failure.
 *
 * The previous date must be known before the PATCH so the undo closure can put
 * it back. Every drag source is a rendered task row, so the row is in some
 * `["tasks", …]` cache entry; if this tab never loaded it (a fresh mount, a
 * second tab) the hook reads `GET /api/tasks/{id}` once instead of guessing.
 */
export function useTaskPlanDrop(): (taskId: string, date: string) => void {
  const queryClient = useQueryClient();
  const updateTask = useUpdateTask();

  return useCallback(
    (taskId: string, date: string) => {
      function plan(task: TaskView): void {
        if (task.scheduledOn === date) {
          return;
        }
        updateTask.mutate(
          { id: task.id, scheduledOn: date },
          {
            onSuccess: ({ task: saved }) => {
              // The server echoes an unchanged row; an Undo for it would be a lie.
              if (saved.scheduledOn === task.scheduledOn) {
                return;
              }
              const handle = pushUndo({
                label: "Schedule task",
                undo: async () => {
                  await updateTask.mutateAsync({
                    id: task.id,
                    scheduledOn: task.scheduledOn,
                  });
                },
              });
              undoToast("Task planned", handle);
            },
            onError: () => toast.error("Could not schedule the task."),
          },
        );
      }

      function cached(): TaskView | null {
        const entries = queryClient.getQueriesData<TasksCacheData>({ queryKey: ["tasks"] });
        for (const [, data] of entries) {
          const found = data?.tasks.find((task) => task.id === taskId);
          if (found) {
            return found;
          }
        }
        return null;
      }

      const known = cached();
      if (known) {
        plan(known);
        return;
      }

      // Nothing cached: read the row so Undo has a real previous date. A PATCH
      // without it would restore the wrong value (or clear a date it never had).
      void (async () => {
        try {
          const response = await fetch(`/api/tasks/${taskId}`);
          const payload = (await response.json().catch(() => null)) as TaskPayload | null;
          if (!response.ok || !payload?.task) {
            throw new Error(payload?.error?.message ?? "Could not schedule the task.");
          }
          plan(payload.task);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not schedule the task.");
        }
      })();
    },
    [queryClient, updateTask],
  );
}
