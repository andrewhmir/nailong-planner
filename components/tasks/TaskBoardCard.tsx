"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVerticalIcon } from "@/components/ui/icons";
import { isHueFamily, shadeTokens } from "@/lib/color/palette";
import type { TaskView } from "@/lib/services/tasks";
import type { TimeFormat } from "@/lib/services/preferences";
import { setBoardDragPayload } from "@/lib/ui/taskBoardDrag";
import { cn } from "@/lib/utils";
import { TaskDueChip } from "./TaskDueChip";
import { TaskPriorityFlag } from "./TaskPriorityFlag";
import { TaskStatusPill } from "./TaskStatusPill";
import type { TaskActions, WritableList } from "./types";

interface Props {
  task: TaskView;
  /** Household-local today, for the due chip's picker and compact date. */
  today: string;
  /** The household 12/24-hour preference for the due chip's time label. */
  timeFormat: TimeFormat;
  /** Household zone, for the due chip's shared time picker. */
  timezone: string;
  /** True when this card is the triage layer's current selection. */
  selected: boolean;
  /** Fired by any focus inside the card, so clicking or tabbing selects it. */
  onFocus(): void;
  /** Task-bound callbacks built by the shell. */
  actions: TaskActions;
  /** Writable lists this card may move to, with the current list already removed. */
  moveTargets: WritableList[];
}

/**
 * One status-board card: clickable title, the list dot and name, the compact
 * status pill, priority flag and date chips, and the overflow menu (`Open`,
 * `Move to list…`, `Drop`, `Delete`).
 *
 * It reuses the row's triage/selection contract so `j`/`k`, the selection
 * coherence effect and `closeEditor`'s focus return work unchanged in board
 * layout: the `<li>` is `tabIndex={0}`, `aria-label={title}`, carries
 * `data-task-id`, `data-selected`/`aria-current` while selected and reports focus
 * upward through `onFocus`. It is the status board's drag source: `dragstart`
 * writes the id under `application/x-nailong-task-status` (`lib/ui/taskBoardDrag.ts`)
 * — deliberately not the row's `text/x-nailong-task` payload, which plans a task
 * on a day. A column drop calls the shell's `onStatus`; the card never PATCHes.
 */
export function TaskBoardCard({
  task,
  today,
  timeFormat,
  timezone,
  selected,
  onFocus,
  actions,
  moveTargets,
}: Props) {
  const hue = task.collection.hueFamily;
  const dot =
    hue !== null && isHueFamily(hue)
      ? shadeTokens(hue, task.collection.shadeIndex).main
      : "var(--color-ink-mute)";

  return (
    <li
      tabIndex={0}
      draggable
      data-task-id={task.id}
      data-selected={selected ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      aria-label={task.title}
      onFocus={onFocus}
      onDragStart={(event) => setBoardDragPayload(event.dataTransfer, task.id)}
      className={cn(
        "group relative flex cursor-grab flex-col gap-1 rounded-md border border-line-strong bg-surface p-2 outline-none",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet",
        "active:cursor-grabbing",
        selected && "border-violet bg-violet-soft shadow-[inset_2px_0_0_0_var(--color-violet)]",
      )}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={actions.onOpen}
          className={cn(
            "min-w-0 flex-1 rounded-sm px-0.5 text-left text-sm leading-snug hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
            // 44px coarse target for the card's primary open affordance.
            "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2",
            task.status === "done" ? "text-ink-mute line-through" : "text-ink",
          )}
        >
          {task.title}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Options for ${task.title}`}
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-mute transition-opacity",
              "opacity-0 hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100",
              "group-hover:opacity-100 group-focus-within:opacity-100",
              "[@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
            )}
          >
            <MoreVerticalIcon size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={actions.onOpen}>Open</DropdownMenuItem>
            {moveTargets.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to list…</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {moveTargets.map((target) => (
                    <DropdownMenuItem key={target.id} onSelect={() => actions.onMove(target.id)}>
                      {target.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem disabled onSelect={() => undefined}>
                Move to list…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={actions.onDrop}>Drop</DropdownMenuItem>
            <DropdownMenuItem danger onSelect={actions.onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span
          aria-hidden
          data-testid={`task-collection-dot-${task.id}`}
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: dot }}
        />
        <span className="max-w-24 truncate text-xs text-ink-mute">{task.collection.name}</span>
        <TaskStatusPill status={task.status} onChange={actions.onStatus} compact />
        <TaskPriorityFlag priority={task.priority} onChange={actions.onPriority} />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <TaskDueChip
          dueOn={task.dueOn}
          dueTime={task.dueTime}
          overdue={task.overdue}
          today={today}
          title={task.title}
          timeFormat={timeFormat}
          timezone={timezone}
          onChange={actions.onDue}
        />
      </div>
    </li>
  );
}
