"use client";

import { Checkbox } from "@/components/ui/checkbox";
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
import { setTaskDragPayload } from "@/lib/ui/taskDrag";
import { cn } from "@/lib/utils";
import { TaskDateChips } from "./TaskDateChips";
import { TaskPriorityFlag } from "./TaskPriorityFlag";
import { TaskStatusPill } from "./TaskStatusPill";
import type { TaskActions, WritableList } from "./types";

interface Props {
  task: TaskView;
  /** Household-local today, for the date chips' pickers and overdue cue. */
  today: string;
  /** True when this row is the triage layer's current selection. */
  selected: boolean;
  /** Fired by any focus inside the row, so clicking or tabbing selects it. */
  onFocus(): void;
  /** Task-bound callbacks built by the shell. */
  actions: TaskActions;
  /** Writable lists this task may move to, with the current list already removed. */
  moveTargets: WritableList[];
}

/**
 * One dense ClickUp-style row: completion checkbox, clickable title, owning
 * list's dot and name, the inline status/priority/date pickers and the overflow
 * menu (`Open`, `Move to list…`, `Drop`, `Delete`).
 *
 * The row stays the triage layer's selection unit and the drag source: it is
 * `tabIndex={0}`, `aria-label={title}`, carries `data-task-id`,
 * `data-selected`/`aria-current` when selected, reports focus upward through
 * `onFocus` and writes the `text/x-nailong-task` payload on `dragstart` (the
 * month grid and sidebar mini-month read it). The title is a real button so a
 * click — or `Enter` on it, which the shortcut layer deliberately leaves to the
 * control — opens the task; the pickers and menu are plain buttons with violet
 * focus rings and 44px coarse-pointer targets.
 */
export function TaskRow({ task, today, selected, onFocus, actions, moveTargets }: Props) {
  const done = task.status === "done";
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
      onDragStart={(event) => setTaskDragPayload(event.dataTransfer, task)}
      className={cn(
        "group relative flex flex-wrap items-center gap-1.5 border-b border-line px-1.5 py-1 outline-none last:border-b-0",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet",
        selected && "bg-violet-soft shadow-[inset_2px_0_0_0_var(--color-violet)]",
      )}
    >
      <Checkbox
        label={task.title}
        checked={done}
        onCheckedChange={actions.onToggleDone}
        className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      />

      <button
        type="button"
        onClick={actions.onOpen}
        className={cn(
          "min-w-0 flex-1 truncate rounded-sm px-0.5 text-left text-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
          // The primary open affordance must be a 44px target on touch too: the
          // text-sm line box alone is ~20px.
          "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2",
          done ? "text-ink-mute line-through" : "text-ink",
        )}
      >
        {task.title}
      </button>

      <span
        aria-hidden
        data-testid={`task-collection-dot-${task.id}`}
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ background: dot }}
      />
      <span className="max-w-32 truncate text-xs text-ink-mute max-sm:sr-only">
        {task.collection.name}
      </span>

      <TaskStatusPill status={task.status} onChange={actions.onStatus} />
      <TaskPriorityFlag priority={task.priority} onChange={actions.onPriority} />
      <TaskDateChips
        scheduledOn={task.scheduledOn}
        dueOn={task.dueOn}
        today={today}
        title={task.title}
        onChange={actions.onDates}
      />

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
    </li>
  );
}
