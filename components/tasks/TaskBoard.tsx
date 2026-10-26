"use client";

import { PlusIcon } from "@/components/ui/icons";
import type { TaskStatus } from "@/lib/db/schema";
import { isActiveStatus } from "@/lib/domain/tasks";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from "@/lib/domain/taskViews";
import type { TaskView } from "@/lib/services/tasks";
import { BOARD_DRAG_TYPE, readBoardDragPayload } from "@/lib/ui/taskBoardDrag";
import { cn } from "@/lib/utils";
import { TaskBoardCard } from "./TaskBoardCard";
import { TaskCaptureRow } from "./TaskCaptureRow";
import type { TaskActions, WritableList } from "./types";

interface Props {
  /** The shell's `sortTasks(filterTasks(...))` projection: column order is this order. */
  tasks: TaskView[];
  /** Household-local today, for the date chips and the capture rows' Shift+Enter. */
  today: string;
  /** Household zone, for the per-column capture rows' Shift+Enter. */
  timezone: string;
  /** The triage layer's current selection id, so a card can paint `data-selected`. */
  selectedId: string | null;
  /** Show the Done/Dropped columns too (the toolbar's "show closed"). */
  closed: boolean;
  /** Fired by any focus inside a card, so clicking or tabbing selects it. */
  onFocus(id: string): void;
  /**
   * Builds the `TaskActions` bound to one task. A factory, not one shared
   * object: every callback acts on *its own* task and the type carries no task
   * argument (the same reason `TaskList` takes `actionsFor`).
   */
  actionsFor(task: TaskView): TaskActions;
  /** Writable lists a card may move to; the current list is removed per card. */
  moveTargets: WritableList[];
  /**
   * The column's add affordance (its `+` button) — the shell focuses that
   * column's capture row. The capture row itself owns the create request.
   */
  onCreate(status: TaskStatus): void;
}

/**
 * The status board: one column per status — `open` and `in_progress` always,
 * `done` and `dropped` only when closed rows are shown (the server omits them
 * otherwise) — each listing `TaskBoardCard`s in the order the shell passed
 * (its `sortTasks`, so `manual` is `sortOrder`) plus a per-column
 * `TaskCaptureRow` in the active columns. A card dropped on a column calls the
 * shell's `onStatus`, which routes through the same toast + targeted undo as the
 * row's status pill; a same-column drop is ignored, and there is **no
 * within-column reorder** (the reorder API is per list, and the board has no
 * stable order of its own).
 *
 * Drag is an accelerator, never the only path: the compact status pill on every
 * card and its menu reach the same `onStatus`/`onMove`/`onDrop` callbacks, and
 * the empty columns keep the capture row so a column can be filled without a
 * drag. Cards carry `data-task-id` in DOM order, which is what the shell's
 * `j`/`k` traversal (`[data-task-id]` inside the shell's list container) and its
 * `closeEditor` focus return rely on, so keyboard triage works unchanged in
 * board layout.
 */
export function TaskBoard({
  tasks,
  today,
  timezone,
  selectedId,
  closed,
  onFocus,
  actionsFor,
  moveTargets,
  onCreate,
}: Props) {
  // The active pair always renders; the closed pair only when the payload carries
  // them ("show closed" sets includeClosed on the query).
  const columns = TASK_STATUS_ORDER.filter((status) => closed || isActiveStatus(status));
  // The drop target resolves the dragged id against the cards it is rendering,
  // so a stale or foreign id is a no-op rather than a blind PATCH.
  const byId = new Map(tasks.map((task) => [task.id, task]));

  return (
    <div
      data-testid="task-board"
      className="flex items-start gap-3 overflow-x-auto pb-1"
      role="group"
      aria-label="Task status board"
    >
      {columns.map((status) => {
        const label = TASK_STATUS_LABELS[status];
        const active = isActiveStatus(status);
        const cards = tasks.filter((task) => task.status === status);
        return (
          <section
            key={status}
            aria-label={`${label} column`}
            data-testid={`task-board-column-${status}`}
            onDragOver={(event) => {
              // Accept only the board payload: a row→day drag must not change a status.
              if (!event.dataTransfer.types.includes(BOARD_DRAG_TYPE)) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              const taskId = readBoardDragPayload(event.dataTransfer);
              if (taskId === null) {
                return;
              }
              event.preventDefault();
              const dragged = byId.get(taskId);
              // A same-column drop is not a status change; a missing card means
              // the payload is stale, and both are silent no-ops.
              if (!dragged || dragged.status === status) {
                return;
              }
              actionsFor(dragged).onStatus(status);
            }}
            className={cn(
              "flex w-64 shrink-0 flex-col gap-2 rounded-md border border-line-strong p-2",
              active ? "bg-well" : "bg-surface",
            )}
          >
            <header className="flex items-center justify-between gap-1 px-0.5">
              <h2 className="min-w-0 flex-1 truncate text-xs font-bold text-ink-soft">{label}</h2>
              <span
                aria-hidden
                className="rounded-pill bg-surface px-1.5 text-xs text-ink-mute"
                data-testid={`task-board-count-${status}`}
              >
                {cards.length}
              </span>
              {active ? (
                <button
                  type="button"
                  aria-label={`Add a task to ${label}`}
                  onClick={() => onCreate(status)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-mute transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                >
                  <PlusIcon size={14} />
                </button>
              ) : null}
            </header>

            {cards.length === 0 ? (
              <p className="rounded-sm border border-dashed border-line px-2 py-4 text-center text-xs text-ink-mute">
                Nothing here
              </p>
            ) : (
              <ul className="space-y-2">
                {cards.map((task) => (
                  <TaskBoardCard
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
            )}

            {active ? (
              <TaskCaptureRow
                timezone={timezone}
                status={status}
                inputId={`task-capture-${status}`}
                placeholder={`Add to ${label}…`}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
