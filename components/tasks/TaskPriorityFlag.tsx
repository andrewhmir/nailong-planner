"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FlagIcon } from "@/components/ui/icons";
import type { TaskPriority } from "@/lib/db/schema";
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_ORDER } from "@/lib/domain/taskViews";
import { cn } from "@/lib/utils";

/**
 * Flag colour by priority. Urgent/high use the callout tokens, normal uses the
 * accent and the two quiet levels stay muted; `none` is the same muted flag at
 * lower emphasis, so an unprioritised row still has a reachable picker.
 *
 * Only the **icon** is coloured. The priority word stays `text-ink-soft`
 * because a coloured `text-xs` label did not meet WCAG AA on the row's surface;
 * `none`'s dimming is on the icon (revealed by hovering the button) rather than
 * the whole control, so the label keeps its contrast.
 */
const PRIORITY_ICONS: Record<TaskPriority, string> = {
  urgent: "text-danger",
  high: "text-warning",
  normal: "text-accent",
  low: "text-ink-mute",
  none: "text-ink-mute opacity-60 group-hover:opacity-100",
};

interface Props {
  priority: TaskPriority;
  onChange: (priority: TaskPriority) => void;
}

/**
 * The inline priority picker: a coloured `FlagIcon` plus the priority word that
 * opens a Radix radio menu of `TASK_PRIORITY_ORDER`. The trigger is a plain
 * dense button with a violet focus ring and a 44px coarse-pointer target; the
 * caller owns the PATCH and its undo toast.
 */
export function TaskPriorityFlag({ priority, onChange }: Props) {
  const label = TASK_PRIORITY_LABELS[priority];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Priority: ${label}`}
          data-testid={`task-priority-${priority}`}
          className={cn(
            "group inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-ink-soft transition-colors",
            "hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
            "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center",
          )}
        >
          <FlagIcon size={13} className={cn("shrink-0", PRIORITY_ICONS[priority])} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={priority}
          onValueChange={(value) => {
            if (value !== priority) {
              onChange(value as TaskPriority);
            }
          }}
        >
          {TASK_PRIORITY_ORDER.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {TASK_PRIORITY_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
