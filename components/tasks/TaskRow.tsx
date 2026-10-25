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
import { isOverdue } from "@/lib/domain/tasks";
import type { TaskView } from "@/lib/services/tasks";
import { formatWallDate } from "@/lib/time/format";
import { cn } from "@/lib/utils";
import { TaskPlanPopover } from "./TaskPlanPopover";

interface Props {
  task: TaskView;
  /** Household-local today, for `Overdue` and the Plan popover's Today button. */
  today: string;
  /** Writable lists this task may move to, with the current list already removed. */
  moveTargets: ReadonlyArray<{ id: string; name: string }>;
  onToggleDone: (done: boolean) => void;
  onPlan: (date: string | null) => void;
  onMove: (collectionId: string) => void;
  onDrop: () => void;
  onDelete: () => void;
}

/**
 * One task row: completion checkbox, title, due badge, the owning list's shade
 * dot, Plan and the row menu. The row itself is focusable and draggable — the
 * keyboard triage layer (Task 9) and the calendar chips (Task 11) read
 * `data-task-id` / the `text/x-nailong-task` payload from it.
 */
export function TaskRow({
  task,
  today,
  moveTargets,
  onToggleDone,
  onPlan,
  onMove,
  onDrop,
  onDelete,
}: Props) {
  const done = task.status === "done";
  const overdue = isOverdue(task, today);
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
      onDragStart={(event) => {
        event.dataTransfer.setData("text/x-nailong-task", task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="group relative flex items-center gap-3 border-b border-line px-2 py-1.5 outline-none last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
    >
      <Checkbox
        label={task.title}
        checked={done}
        onCheckedChange={onToggleDone}
        className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-base",
          done ? "text-ink-mute line-through" : "text-ink",
        )}
      >
        {task.title}
      </span>

      <span
        aria-hidden
        data-testid={`task-collection-dot-${task.id}`}
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ background: dot }}
      />
      <span className="sr-only">{task.collection.name}</span>

      {task.dueOn !== null ? (
        <span
          className={cn(
            "shrink-0 rounded-pill px-2 py-0.5 text-xs",
            overdue ? "bg-danger-soft font-bold text-danger-ink" : "bg-well text-ink-soft",
          )}
        >
          {overdue ? "Overdue" : formatWallDate(task.dueOn)}
        </span>
      ) : null}

      <TaskPlanPopover task={task} today={today} onPick={onPlan} />

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
          {moveTargets.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to list…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {moveTargets.map((target) => (
                  <DropdownMenuItem key={target.id} onSelect={() => onMove(target.id)}>
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
          <DropdownMenuItem onSelect={onDrop}>Drop</DropdownMenuItem>
          <DropdownMenuItem danger onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
