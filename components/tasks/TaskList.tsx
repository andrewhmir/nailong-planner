"use client";

import { Button } from "@/components/ui/button";
import type { TaskGroup } from "@/lib/domain/taskViews";
import type { TaskView } from "@/lib/services/tasks";
import { TaskGroupHeader } from "./TaskGroupHeader";
import { TaskRow } from "./TaskRow";
import type { TaskActions, WritableList } from "./types";

interface Props {
  /** `sortTasks` output already split by `groupTasks`; empty groups are omitted. */
  groups: TaskGroup<TaskView>[];
  today: string;
  selectedId: string | null;
  onFocus(id: string): void;
  /**
   * Builds the `TaskActions` bound to one row. It is a factory rather than one
   * shared object because every `TaskActions` callback acts on *its own* task
   * and the type carries no task argument; each row gets the closures the shell
   * built for it.
   */
  actionsFor(task: TaskView): TaskActions;
  /** Writable lists a task may move to; the current list is removed per row. */
  moveTargets: WritableList[];
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
 * The grouped task list: one `TaskGroupHeader` plus a `<ul>` per group. Collapse
 * state is owned by `TasksShell` (it must also drop collapsed rows from keyboard
 * traversal); this component only paints it. Groups never render when empty —
 * `groupTasks` already omits them — and zero groups render the empty state, with
 * a Clear-filters button only when the shell says a filter is active.
 */
export function TaskList({
  groups,
  today,
  selectedId,
  onFocus,
  actionsFor,
  moveTargets,
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
                  selected={task.id === selectedId}
                  onFocus={() => onFocus(task.id)}
                  actions={actionsFor(task)}
                  moveTargets={moveTargets.filter((target) => target.id !== task.collectionId)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
