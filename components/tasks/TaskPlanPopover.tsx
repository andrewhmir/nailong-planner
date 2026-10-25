"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useState } from "react";
import { DatePickerPopover } from "@/components/calendar/DatePickerPopover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "@/components/ui/icons";
import type { TaskView } from "@/lib/services/tasks";
import { formatWallDate } from "@/lib/time/format";

interface Props {
  task: TaskView;
  /** Household-local today, so the picker's Today button matches the buckets. */
  today: string;
  /** `null` clears the scheduled date. */
  onPick: (date: string | null) => void;
}

/**
 * The row's Plan action: an anchored mini-month (the same neutral grid the
 * toolbar and date fields use) that sets `scheduledOn`, plus Clear date. Radix
 * owns Escape, outside-click and focus return; the caller owns the PATCH.
 */
export function TaskPlanPopover({ task, today, onPick }: Props) {
  const [open, setOpen] = useState(false);

  function pick(date: string | null): void {
    setOpen(false);
    onPick(date);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Plan ${task.title}`}
          className="shrink-0 text-ink-soft [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        >
          <CalendarIcon size={14} />
          <span aria-hidden>Plan</span>
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={12}
          aria-label={`Schedule ${task.title}`}
          data-testid="task-plan-popover"
          className="z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-md border border-line-strong bg-surface p-3 shadow-menu outline-none data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <DatePickerPopover
            key={task.scheduledOn ?? "none"}
            anchorDate={task.scheduledOn ?? today}
            selectedDate={task.scheduledOn ?? undefined}
            today={today}
            onPick={(date) => pick(date)}
          />
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2">
            <Button size="sm" variant="ghost" disabled={!task.scheduledOn} onClick={() => pick(null)}>
              Clear date
            </Button>
            <span className="text-sm text-ink-mute">
              {task.scheduledOn ? formatWallDate(task.scheduledOn) : "No date"}
            </span>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
