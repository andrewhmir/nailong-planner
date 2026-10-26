"use client";

import { ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  count: number;
  open: boolean;
  /** The id of the `<ul>` this button expands/collapses. */
  controlsId: string;
  onToggle(): void;
  /** Optional E2E hook (`task-group-<key>`); the accessible name is the label. */
  testId?: string;
}

/**
 * One collapsible group heading: a chevron button with `aria-expanded`/
 * `aria-controls`, the group label and a count pill. `TasksShell` owns the open
 * state (all groups start open); the header only renders and calls back.
 */
export function TaskGroupHeader({ label, count, open, controlsId, onToggle, testId }: Props) {
  return (
    <div className="flex items-center gap-2 px-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controlsId}
        data-testid={testId}
        onClick={onToggle}
        className="inline-flex min-h-7 items-center gap-1.5 rounded-sm px-1 text-xs font-bold uppercase tracking-wide text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11"
      >
        <ChevronDownIcon
          size={14}
          className={cn("shrink-0 transition-transform", open ? null : "-rotate-90")}
        />
        <span>{label}</span>
        <span
          aria-hidden
          className="rounded-pill bg-well px-1.5 text-xs font-normal normal-case tracking-normal text-ink-soft"
        >
          {count}
        </span>
        <span className="sr-only">{count === 1 ? "1 task" : `${count} tasks`}</span>
      </button>
    </div>
  );
}
