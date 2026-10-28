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
import type { TaskView } from "@/lib/services/tasks";
import type { TimeFormat } from "@/lib/services/preferences";
import { setTaskDragPayload } from "@/lib/ui/taskDrag";
import { cn } from "@/lib/utils";
import { TaskDueChip } from "./TaskDueChip";
import { TaskListPicker } from "./TaskListPicker";
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
  /** True when this row is the triage layer's current selection. */
  selected: boolean;
  /** Fired by any focus inside the row, so clicking or tabbing selects it. */
  onFocus(): void;
  /** Task-bound callbacks built by the shell. */
  actions: TaskActions;
  /**
   * Every writable list the task may be filed under, the current one included.
   * The List cell's inline picker shows them all (current checked); the overflow
   * menu's `Move to list…` drops the current one before rendering its submenu.
   */
  lists: WritableList[];
}

/**
 * One dense ClickUp-style row: completion checkbox, clickable title, the owning
 * list's dot and name as an inline picker (`TaskListPicker`, whose LIST menu
 * files the task under another list), the inline status/priority/date pickers
 * and the overflow menu (`Open`, `Move to list…`, `Drop`, `Delete`).
 *
 * **Columns.** The row is a wrapping flex row on narrow screens and a seven-track
 * grid from `md` up — `md:task-row-cols` (checkbox · title · list · status ·
 * priority · due date · menu) — so every metadata chip starts at the same x as
 * its neighbours' and lines up with `TaskList`'s column header. The tracks are
 * declared once in `app/globals.css` because the header and the row must agree;
 * the two 44px end tracks also fit the coarse-pointer (touch) targets without a
 * separate layout. Under `md` the row keeps wrapping, which is the only sane
 * layout for a phone (the list name is `sr-only` there too).
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
export function TaskRow({
  task,
  today,
  timeFormat,
  timezone,
  selected,
  onFocus,
  actions,
  lists,
}: Props) {
  const done = task.status === "done";
  // The overflow menu's `Move to list…` only offers lists other than this one.
  const otherLists = lists.filter((target) => target.id !== task.collectionId);

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
        // ClickUp-style aligned columns from `md` up; the template lives in
        // `app/globals.css` and is shared with `TaskList`'s header row.
        "md:task-row-cols md:grid md:items-center md:justify-items-start md:gap-x-2 md:gap-y-0",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet",
        selected
          ? "bg-violet-soft shadow-[inset_2px_0_0_0_var(--color-violet)]"
          : "md:hover:bg-well/60",
      )}
    >
      <Checkbox
        label={task.title}
        checked={done}
        onCheckedChange={actions.onToggleDone}
        className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 md:justify-self-center"
      />

      <button
        type="button"
        onClick={actions.onOpen}
        className={cn(
          "min-w-0 flex-1 truncate rounded-sm px-0.5 text-left text-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
          // The primary open affordance must be a 44px target on touch too: the
          // text-sm line box alone is ~20px.
          "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2",
          // In the grid the title owns the flexible track; `w-full` keeps that
          // whole track clickable instead of shrinking to the text.
          "md:w-full",
          done ? "text-ink-mute line-through" : "text-ink",
        )}
      >
        {task.title}
      </button>

      <TaskListPicker
        current={task.collection}
        lists={lists}
        onMove={actions.onMove}
        dotTestId={`task-collection-dot-${task.id}`}
        nameClassName="max-w-32 max-sm:sr-only"
      />

      <TaskStatusPill status={task.status} onChange={actions.onStatus} />
      <TaskPriorityFlag priority={task.priority} onChange={actions.onPriority} />
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

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${task.title}`}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-mute transition-opacity",
            "opacity-0 hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            "[@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
            "md:justify-self-center",
          )}
        >
          <MoreVerticalIcon size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={actions.onOpen}>Open</DropdownMenuItem>
          {otherLists.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to list…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherLists.map((target) => (
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
