"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "@/components/ui/icons";
import type { TaskStatus } from "@/lib/db/schema";
import { localToday } from "@/lib/domain/tasks";
import { useCreateTask, useUpdateTask } from "@/lib/query/tasks";
import type { TaskView } from "@/lib/services/tasks";
import type { CreateTaskInput } from "@/lib/validation/tasks";
import { cn } from "@/lib/utils";

interface Props {
  /** Household zone, so Shift+Enter schedules the household's today. */
  timezone: string;
  /** Target list; omitted means the server files the task in the Inbox. */
  collectionId?: string;
  /**
   * Board-column status. `POST /api/tasks` does not accept `status` (the create
   * schema predates the field), so a non-default status costs one follow-up
   * PATCH; the row keeps its typed text until the create itself succeeds.
   */
  status?: TaskStatus;
  placeholder?: string;
  onCaptured?: (task: TaskView) => void;
}

/**
 * The ClickUp-style add-task row: one input, `Enter` captures into the Inbox
 * (or the supplied list), `Shift+Enter` also schedules it for the household's
 * today. The text is cleared only after the create succeeds, so a failed
 * capture never loses what was typed. The id and test id are both
 * `task-capture`: the id keeps the v0.2.0 e2e selector working while the spec
 * moves to `getByTestId`.
 */
export function TaskCaptureRow({
  timezone,
  collectionId,
  status,
  placeholder = "Add a task…",
  onCaptured,
}: Props) {
  const [title, setTitle] = useState("");
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  function capture(scheduleToday: boolean): void {
    const value = title.trim();
    if (value.length === 0 || createTask.isPending) {
      return;
    }
    const input: CreateTaskInput = { title: value };
    if (collectionId !== undefined) {
      input.collectionId = collectionId;
    }
    if (scheduleToday) {
      input.scheduledOn = localToday(timezone);
    }
    createTask.mutate(input, {
      onSuccess: ({ task }) => {
        setTitle("");
        onCaptured?.(task);
        if (status !== undefined && status !== "open" && status !== task.status) {
          updateTask.mutate(
            { id: task.id, status },
            {
              // The task exists by now; only its column placement failed. Say so
              // instead of reusing the create-failure copy, which would invite a
              // duplicate retry.
              onError: () => toast.error("Task added, but its status could not be set."),
            },
          );
        }
      },
      onError: () => toast.error("Could not add the task."),
    });
  }

  return (
    <div className="rounded-md border border-line-strong bg-surface px-2 py-1.5 focus-within:border-violet">
      <label htmlFor="task-capture" className="sr-only">
        Add a task
      </label>
      <div className="flex items-center gap-2">
        <PlusIcon size={16} className="shrink-0 text-ink-mute" />
        <input
          id="task-capture"
          type="text"
          value={title}
          disabled={createTask.isPending}
          placeholder={placeholder}
          autoComplete="off"
          aria-describedby="task-capture-hint"
          data-testid="task-capture"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            capture(event.shiftKey);
          }}
          className={cn(
            "h-7 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-placeholder disabled:opacity-60",
            "[@media(pointer:coarse)]:min-h-11",
          )}
        />
      </div>
      <p id="task-capture-hint" className="sr-only">
        Enter adds the task to Inbox. Shift+Enter also schedules it for today.
      </p>
    </div>
  );
}
