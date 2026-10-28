"use client";

import { Button } from "@/components/ui/button";
import type { TaskGroup } from "@/lib/domain/taskViews";
import type { TaskView } from "@/lib/services/tasks";
import type { TimeFormat } from "@/lib/services/preferences";
import { TaskGroupHeader } from "./TaskGroupHeader";
import { TaskRow } from "./TaskRow";
import type { TaskActions, WritableList } from "./types";

interface Props {
  /** `sortTasks` output already split by `groupTasks`; empty groups are omitted. */
  groups: TaskGroup<TaskView>[];
  today: string;
  /** The household 12/24-hour preference, forwarded to every row's due chip. */
  timeFormat: TimeFormat;
  /** Household zone, for every row's shared time picker. */
  timezone: string;
  selectedId: string | null;
  onFocus(id: string): void;
  /**
   * Builds the `TaskActions` bound to one row. It is a factory rather than one
   * shared object because every `TaskActions` callback acts on *its own* task
   * and the type carries no task argument; each row gets the closures the shell
   * built for it.
   */
  actionsFor(task: TaskView): TaskActions;
  /** Every writable list a task may be filed under; each row's picker gets them all. */
  lists: WritableList[];
  /**
   * Which groups are collapsed. The shell owns this because a collapsed group's
   * rows must leave the keyboard-traversal projection (`visibleRows`); `TaskList`
   * only paints the result.
   */
  collapsedGroups: Record<string, boolean>;
  /** Collapse/expand one group by its `groupTasks` key. */
  onToggleGroup(key: string): void;
  /** Shown when there are no groups at all (empty view or an over-filtered one). */
  emptyMessage: string;
  /** `null` when no filter is active; otherwise the Clear-filters affordance. */
  onClearFilters: (() => void) | null;
}

/**
 * The ClickUp-style column header for the aligned list. It is one shared row
 * above the groups rather than one per group (the groups are separated by their
 * own `TaskGroupHeader`s); every group's `<ul>` is the same width, so a single
 * header lines up with all of them.
 *
 * The wrapper repeats the group `<ul>`'s box exactly — a transparent 1px border
 * plus `px-1` — and the inner grid repeats a row's `px-1.5` + `task-row-cols`, so
 * the label's x equals the cell's x by construction rather than by tuned
 * numbers. It is `aria-hidden` (the pickers already announce their own state,
 * "Status: To do", "Priority: High", "Due date for …"), and it only renders from
 * `md` up, where `TaskRow` is a grid; below that the row wraps and there are no
 * columns to label.
 */
function TaskListHeader() {
  return (
    <div aria-hidden className="hidden border border-transparent px-1 md:block">
      <div
        data-testid="task-list-header"
        className="task-row-cols grid items-center gap-x-2 px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-mute"
      >
        <span className="col-start-2">Task</span>
        <span>List</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Due date</span>
      </div>
    </div>
  );
}

/**
 * The grouped task list: one `TaskGroupHeader` plus a `<ul>` per group, a shared
 * column header above them, and the empty state when there are no groups at all.
 * Collapse state is owned by `TasksShell` (it must also drop collapsed rows from
 * keyboard traversal); this component only paints it. Groups never render when
 * empty — `groupTasks` already omits them — and zero groups render the empty
 * state, with a Clear-filters button only when the shell says a filter is active.
 */
export function TaskList({
  groups,
  today,
  timeFormat,
  timezone,
  selectedId,
  onFocus,
  actionsFor,
  lists,
  collapsedGroups,
  onToggleGroup,
  emptyMessage,
  onClearFilters,
}: Props) {
  if (groups.length === 0) {
    return (
      <div data-testid="task-list">
        <div className="rounded-md border border-dashed border-line-strong bg-surface px-4 py-10 text-center">
          <p className="text-base text-ink-soft">{emptyMessage}</p>
          {onClearFilters === null ? null : (
            <Button
              variant="outline"
              className="mt-3 [@media(pointer:coarse)]:min-h-11"
              onClick={onClearFilters}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="task-list" className="space-y-2">
      <TaskListHeader />
      {groups.map((group) => {
        const open = !collapsedGroups[group.key];
        const listId = `task-group-${group.key}`;
        return (
          <section key={group.key} aria-label={`${group.label} tasks`} className="space-y-1">
            <TaskGroupHeader
              label={group.label}
              count={group.tasks.length}
              open={open}
              controlsId={listId}
              onToggle={() => onToggleGroup(group.key)}
              testId={`task-group-${group.key}`}
            />
            <ul
              id={listId}
              hidden={!open}
              className="rounded-md border border-line-strong bg-surface px-1"
            >
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  timeFormat={timeFormat}
                  timezone={timezone}
                  selected={task.id === selectedId}
                  onFocus={() => onFocus(task.id)}
                  actions={actionsFor(task)}
                  lists={lists}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
