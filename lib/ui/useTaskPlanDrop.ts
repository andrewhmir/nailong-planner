"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useUpdateTask } from "@/lib/query/tasks";
import { pushUndo } from "./undo";
import { undoToast } from "./undoToast";
import type { TaskDragPayload } from "./taskDrag";

/**
 * The one "re-date a task by dropping it on a day" mutation path. Both drop
 * surfaces call it: the sidebar mini month (the target that exists on `/tasks`,
 * where the task rows live) and the full month grid's day cells. It PATCHes
 * `dueOn` (the time of day stays untouched), tells the truth with a `Due date
 * set` toast whose Undo restores the exact previous date (a drop that changes
 * nothing is a silent no-op), and toasts `Could not set the due date.` on
 * failure.
 *
 * The previous date comes **from the drag payload**, stamped at `dragstart` by
 * the row the user actually saw (`lib/ui/taskDrag.ts`). It is not read back from
 * a `["tasks", …]` cache entry at drop time: several cached views can disagree
 * (an optimistic row here, a settle refetch there), and a cache miss would need
 * a fallback `GET` before the Undo closure could even be built.
 */
export function useTaskPlanDrop(): (drag: TaskDragPayload, date: string) => void {
  const updateTask = useUpdateTask();

  return useCallback(
    ({ id, dueOn }: TaskDragPayload, date: string) => {
      // A drop onto the row's own due day changes nothing.
      if (dueOn === date) {
        return;
      }
      updateTask.mutate(
        { id, dueOn: date },
        {
          onSuccess: ({ task: saved }) => {
            // The server echoes an unchanged row; an Undo for it would be a lie.
            if (saved.dueOn === dueOn) {
              return;
            }
            const handle = pushUndo({
              label: "Set due date",
              undo: async () => {
                await updateTask.mutateAsync({ id, dueOn });
              },
            });
            undoToast("Due date set", handle);
          },
          onError: () => toast.error("Could not set the due date."),
        },
      );
    },
    [updateTask],
  );
}
