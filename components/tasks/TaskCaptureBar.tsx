"use client";

import { useState } from "react";
import { toast } from "sonner";
import { localToday } from "@/lib/domain/tasks";
import { useCreateTask } from "@/lib/query/tasks";
import type { TaskView } from "@/lib/services/tasks";

interface Props {
  /** Household zone, so Shift+Enter schedules the household's today. */
  timezone: string;
  onCaptured?: (task: TaskView) => void;
}

// The Canvas field recipe (SettingsForm/ImportWizard), one step taller so a
// task title is comfortable to type.
const FIELD =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink placeholder:text-placeholder focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 [@media(pointer:coarse)]:h-11";

/**
 * One input for fast capture. Enter files the task in the Inbox; Shift+Enter
 * also schedules it for the household's today. The text is cleared only after
 * the server accepts it, so a failed capture never loses what was typed.
 */
export function TaskCaptureBar({ timezone, onCaptured }: Props) {
  const [title, setTitle] = useState("");
  const createTask = useCreateTask();

  function capture(scheduleToday: boolean): void {
    const value = title.trim();
    if (value.length === 0 || createTask.isPending) {
      return;
    }
    createTask.mutate(
      scheduleToday ? { title: value, scheduledOn: localToday(timezone) } : { title: value },
      {
        onSuccess: ({ task }) => {
          setTitle("");
          onCaptured?.(task);
        },
        onError: () => toast.error("Could not add the task."),
      },
    );
  }

  return (
    <div>
      <label htmlFor="task-capture" className="sr-only">
        Add a task
      </label>
      <input
        id="task-capture"
        type="text"
        value={title}
        disabled={createTask.isPending}
        placeholder="Add a task…"
        autoComplete="off"
        aria-describedby="task-capture-hint"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }
          event.preventDefault();
          capture(event.shiftKey);
        }}
        className={FIELD}
      />
      <p id="task-capture-hint" className="mt-1 text-sm text-ink-mute">
        Enter adds to Inbox · Shift+Enter schedules it for today
      </p>
    </div>
  );
}
