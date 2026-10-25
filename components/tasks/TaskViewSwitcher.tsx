"use client";

import { TASK_BUCKETS, type TaskBucket } from "@/lib/domain/tasks";
import type { TaskCounts } from "@/lib/services/tasks";
import { cn } from "@/lib/utils";

/** The four triage views, in rail order. Shared with `TasksShell`'s list label. */
export const TASK_BUCKET_LABELS: Record<TaskBucket, string> = {
  inbox: "Inbox",
  today: "Today",
  week: "Week",
  someday: "Someday",
};

interface Props {
  view: TaskBucket;
  /**
   * Omitted until `useTasks` has a payload. The switcher then renders every
   * button without a badge, so loading/error never shows a false row of zeros.
   */
  counts?: TaskCounts;
  onChange: (view: TaskBucket) => void;
}

/**
 * Segmented Inbox · Today · Week · Someday control. Each button carries
 * `aria-pressed` and, once counts exist, its open count; the overdue count is
 * intentionally a separate cross-cutting badge because an overdue task can sit
 * in Today or in Week — it is not a fifth bucket.
 */
export function TaskViewSwitcher({ view, counts, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Task views" className="flex flex-wrap items-center gap-1">
        {TASK_BUCKETS.map((bucket) => {
          const active = bucket === view;
          const label = TASK_BUCKET_LABELS[bucket];
          const count = counts?.[bucket];
          return (
            <button
              key={bucket}
              type="button"
              aria-pressed={active}
              aria-label={count === undefined ? label : `${label}, ${count} open`}
              onClick={() => onChange(bucket)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link [@media(pointer:coarse)]:min-h-11",
                active
                  ? "border-accent bg-accent text-white"
                  : "border-line-strong bg-surface text-ink-soft hover:bg-well",
              )}
            >
              <span>{label}</span>
              {count === undefined ? null : (
                <span
                  aria-hidden
                  data-testid={`tasks-count-${bucket}`}
                  className={cn(
                    "rounded-pill px-1.5 text-xs font-bold",
                    active ? "bg-white/20 text-white" : "bg-well text-ink-soft",
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
          className="rounded-pill bg-danger-soft px-2 py-0.5 text-sm font-bold text-danger-ink"
        >
          {counts.overdue} overdue
        </span>
      ) : null}
    </div>
  );
}
