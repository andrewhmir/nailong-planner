"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "@/components/ui/icons";
import type { TaskStatus } from "@/lib/db/schema";
import { localToday } from "@/lib/domain/tasks";
import { TASK_STATUS_LABELS } from "@/lib/domain/taskViews";
import { useCreateTask } from "@/lib/query/tasks";
import type { TaskView } from "@/lib/services/tasks";
import type { CreateTaskInput } from "@/lib/validation/tasks";
import { cn } from "@/lib/utils";

interface Props {
  /** Household zone, so Shift+Enter schedules the household's today. */
  timezone: string;
  /** Target list; omitted means the server files the task in the Inbox. */
  collectionId?: string;
  /**
   * Board-column status, sent **in the create body** (`POST /api/tasks` accepts
   * the two active states, narrow: a task is never born done or dropped). A
   * closed value is ignored rather than smuggled in through a second PATCH.
   */
  status?: TaskStatus;
  placeholder?: string;
  /**
   * The sr-only label. The board passes `Add a task to <status>` so its columns
   * are distinguishable; a page-level row keeps the plain `Add a task`.
   */
  ariaLabel?: string;
  /**
   * DOM id (also the test id and the label target). The board renders one
   * capture row per column, so it passes `task-capture-<status>` to keep the ids
   * unique; the default keeps the v0.2.0 `#task-capture` contract.
   */
  inputId?: string;
  onCaptured?: (task: TaskView) => void;
}

/**
 * The ClickUp-style add-task row: one input, `Enter` captures into the Inbox
 * (or the supplied list and status), `Shift+Enter` also schedules it for the
 * household's today. The text is cleared only after the create succeeds, so a
 * failed capture never loses what was typed. The id and test id are both
 * `task-capture` by default: the id keeps the v0.2.0 e2e selector working while
 * the spec moves to `getByTestId`, and the board's per-column rows pass their
 * own `inputId` and an `ariaLabel` naming the column so the several inputs do
 * not all announce "Add a task".
 */
export function TaskCaptureRow({
  timezone,
  collectionId,
  status,
  placeholder = "Add a task…",
  ariaLabel = "Add a task",
  inputId = "task-capture",
  onCaptured,
}: Props) {
  const [title, setTitle] = useState("");
  const createTask = useCreateTask();

  // Only the active pair is a create status; the board never renders this row
  // in a Done/Dropped column, but the guard keeps a stray prop non-actionable.
  const columnStatus = status === "open" || status === "in_progress" ? status : null;
  const hintId = `${inputId}-hint`;

  function capture(scheduleToday: boolean): void {
    const value = title.trim();
    if (value.length === 0 || createTask.isPending) {
      return;
    }
    const input: CreateTaskInput = { title: value };
    if (collectionId !== undefined) {
      input.collectionId = collectionId;
    }
    if (columnStatus !== null) {
      input.status = columnStatus;
    }
    if (scheduleToday) {
      input.scheduledOn = localToday(timezone);
    }
    createTask.mutate(input, {
      onSuccess: ({ task }) => {
        setTitle("");
        onCaptured?.(task);
      },
      onError: () => toast.error("Could not add the task."),
    });
  }

  return (
    <div className="rounded-md border border-line-strong bg-surface px-2 py-1.5 focus-within:border-violet">
      <label htmlFor={inputId} className="sr-only">
        {ariaLabel}
      </label>
      <div className="flex items-center gap-2">
        <PlusIcon size={16} className="shrink-0 text-ink-mute" />
        <input
          id={inputId}
          type="text"
          value={title}
          disabled={createTask.isPending}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={200}
          aria-describedby={hintId}
          data-testid={inputId}
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
      <p id={hintId} className="sr-only">
        {columnStatus === null
          ? "Enter adds the task to Inbox. Shift+Enter also schedules it for today."
          : `Enter adds the task to ${TASK_STATUS_LABELS[columnStatus]}. Shift+Enter also schedules it for today.`}
      </p>
    </div>
  );
}
