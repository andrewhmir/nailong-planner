"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskStatus } from "@/lib/db/schema";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from "@/lib/domain/taskViews";
import { cn } from "@/lib/utils";

/** The pill's fill: the v0.2.1 status tokens for the active pair, existing tokens for closed. */
const STATUS_STYLES: Record<TaskStatus, string> = {
  open: "bg-status-todo-soft text-status-todo",
  in_progress: "bg-status-progress-soft text-status-progress",
  done: "bg-success-soft text-success-ink",
  dropped: "bg-well text-ink-mute",
};

/** The leading dot, so the pill keeps a colour cue when it renders compact. */
const STATUS_DOTS: Record<TaskStatus, string> = {
  open: "bg-status-todo",
  in_progress: "bg-status-progress",
  done: "bg-success",
  dropped: "bg-ink-mute",
};

interface Props {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  /** Dot only (no label), for a board card or a narrow slot. */
  compact?: boolean;
}

/**
 * The inline status picker: a small pill styled with the status tokens that
 * opens a Radix radio menu of `TASK_STATUS_ORDER`. The trigger is a plain
 * button (not `Button`) so the dense `text-xs` pill keeps its own padding, violet
 * focus ring and 44px coarse-pointer target. The caller owns the PATCH.
 */
export function TaskStatusPill({ status, onChange, compact = false }: Props) {
  const label = TASK_STATUS_LABELS[status];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${label}`}
          data-testid={`task-status-${status}`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-bold transition-colors",
            "hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
            "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center",
            STATUS_STYLES[status],
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-pill",
              compact ? "h-2 w-2" : null,
              STATUS_DOTS[status],
            )}
          />
          {compact ? null : <span>{label}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={(value) => {
            if (value !== status) {
              onChange(value as TaskStatus);
            }
          }}
        >
          {TASK_STATUS_ORDER.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {TASK_STATUS_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
