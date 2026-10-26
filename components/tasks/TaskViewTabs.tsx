"use client";

import type { Ref } from "react";
import { BoardIcon, ListIcon } from "@/components/ui/icons";
import { TASK_BUCKETS, type TaskBucket } from "@/lib/domain/tasks";
import type { TaskLayout } from "@/lib/domain/taskViews";
import type { TaskCounts } from "@/lib/services/tasks";
import { cn } from "@/lib/utils";

/**
 * The four triage scopes, in rail order. Moved here from the deleted
 * `TaskViewSwitcher.tsx`; `TasksShell` reads it for the list's accessible name.
 */
export const TASK_BUCKET_LABELS: Record<TaskBucket, string> = {
  inbox: "Inbox",
  today: "Today",
  week: "Week",
  someday: "Someday",
};

const LAYOUTS: ReadonlyArray<{ layout: TaskLayout; label: string; icon: typeof ListIcon }> = [
  { layout: "list", label: "List", icon: ListIcon },
  { layout: "board", label: "Board", icon: BoardIcon },
];

interface Props {
  view: TaskBucket;
  /**
   * Omitted until `useTasks` has a payload: every scope then renders without a
   * badge, so loading or an error never shows a false row of zeros.
   */
  counts?: TaskCounts;
  layout: TaskLayout;
  onScope(view: TaskBucket): void;
  onLayout(layout: TaskLayout): void;
  /** The current scope's button; the shell focuses it when the view loses its last row. */
  activeRef?: Ref<HTMLButtonElement>;
}

/**
 * The scope tabs (Inbox · Today · Week · Someday with open counts, plus the
 * cross-cutting overdue pill) and the List/Board segmented control. The count
 * badge keeps `data-testid="tasks-count-<bucket>"` from the v0.2.0 switcher.
 *
 * Board layout is selected here and persisted in the URL as `layout=board`;
 * `TasksShell` then renders `TaskBoard` in place of the list, and the toolbar
 * disables its Group control because a board is always grouped by status.
 */
export function TaskViewTabs({ view, counts, layout, onScope, onLayout, activeRef }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Task scopes" className="flex flex-wrap items-center gap-1">
        {TASK_BUCKETS.map((bucket) => {
          const active = bucket === view;
          const label = TASK_BUCKET_LABELS[bucket];
          const count = counts?.[bucket];
          return (
            <button
              key={bucket}
              type="button"
              ref={active ? activeRef : undefined}
              aria-pressed={active}
              aria-label={count === undefined ? label : `${label}, ${count} open`}
              onClick={() => onScope(bucket)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11",
                active
                  ? "border-violet bg-violet-soft font-bold text-violet"
                  : "border-transparent text-ink-soft hover:bg-well hover:text-ink",
              )}
            >
              <span>{label}</span>
              {count === undefined ? null : (
                <span
                  aria-hidden
                  data-testid={`tasks-count-${bucket}`}
                  className={cn(
                    "rounded-pill px-1.5 text-xs font-bold",
                    active ? "bg-violet text-white" : "bg-well text-ink-soft",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {counts !== undefined && counts.overdue > 0 ? (
        <span
          data-testid="tasks-overdue-count"
          className="rounded-pill bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger-ink"
        >
          {counts.overdue} overdue
        </span>
      ) : null}

      <div
        role="group"
        aria-label="Task layout"
        className="flex items-center gap-0.5 rounded-sm border border-line-strong bg-well p-0.5"
      >
        {LAYOUTS.map((option) => {
          const active = option.layout === layout;
          const Icon = option.icon;
          return (
            <button
              key={option.layout}
              type="button"
              aria-pressed={active}
              onClick={() => onLayout(option.layout)}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11",
                active ? "bg-surface font-bold text-violet shadow-menu" : "text-ink-soft hover:text-ink",
              )}
            >
              <Icon size={13} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
