"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useId, useState } from "react";
import { DatePickerPopover } from "@/components/calendar/DatePickerPopover";
import { TimeField } from "@/components/calendar/TimeField";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "@/components/ui/icons";
import type { TimeFormat } from "@/lib/services/preferences";
import { formatShortWallDate, formatWallTime } from "@/lib/time/format";
import { cn } from "@/lib/utils";

/** Shared chip recipe: dense, quiet, violet focus ring, 44px on touch. */
const CHIP =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-1.5 text-xs text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11";

interface Props {
  dueOn: string | null;
  dueTime: string | null;
  /** Server-computed (`TaskView.overdue`): the deadline, time included, has passed. */
  overdue: boolean;
  /** Household-local today, for the picker's Today shortcut. */
  today: string;
  /** The task title, so the chip and time field have unique accessible names. */
  title: string;
  /** The household 12/24-hour preference, shared with the calendar's time fields. */
  timeFormat: TimeFormat;
  /** Household zone, for the shared `TimeField` picker's "now" marker. */
  timezone: string;
  onChange: (patch: { dueOn?: string | null; dueTime?: string | null }) => void;
}

/**
 * The one due-date control on a task: a chip that reads `Tue 27 Oct, 18:00`
 * (year only when not the current year; just the calendar icon when unset) and
 * opens a popover holding the shared mini-month plus the calendar's own
 * `TimeField` slot picker for the optional time. Picking a day keeps the popover
 * open so the time is set in the same visit; every edit is one PATCH
 * (`onChange`), so the shell keeps its targeted undo.
 *
 * The task's due date is its only date: there is no separate schedule. A time
 * needs a date, so the time picker is disabled until a day is picked, and
 * `TimeField`'s "Clear time" action drops just the time while "Clear due date"
 * drops both. The overdue colour comes from the server flag, never the device
 * clock.
 */
export function TaskDueChip({
  dueOn,
  dueTime,
  overdue,
  today,
  title,
  timeFormat,
  timezone,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const timeFieldId = useId();

  const dateLabel = dueOn === null ? null : formatShortWallDate(dueOn, today);
  const timeLabel = dueTime === null ? null : formatWallTime(dueTime, timeFormat);
  const label =
    dateLabel === null ? null : timeLabel === null ? dateLabel : `${dateLabel}, ${timeLabel}`;
  const accessibleName =
    dateLabel === null
      ? `Set due date for ${title}`
      : `Due date for ${title}: ${dateLabel}${timeLabel === null ? "" : `, ${timeLabel}`}`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={accessibleName}
          data-testid="task-due"
          className={cn(CHIP, overdue && "font-bold text-danger-ink")}
        >
          <CalendarIcon size={13} className="shrink-0" />
          {label === null ? null : <span>{label}</span>}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          aria-label={`Due date for ${title}`}
          className="z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-md border border-line-strong bg-surface p-3 shadow-menu outline-none data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <DatePickerPopover
            key={dueOn ?? "none"}
            anchorDate={dueOn ?? today}
            selectedDate={dueOn ?? undefined}
            today={today}
            onPick={(date) => onChange({ dueOn: date })}
          />
          <div className="mt-3 border-t border-line pt-2">
            <span className="mb-1 block text-xs font-medium text-ink-soft">Time (optional)</span>
            <TimeField
              id={timeFieldId}
              value={dueTime}
              onChange={(time) => onChange({ dueTime: time })}
              onClear={() => onChange({ dueTime: null })}
              timeFormat={timeFormat}
              timezone={timezone}
              label={`Due time for ${title}`}
              placeholder={dueOn === null ? "Set a date first" : "No time"}
              disabled={dueOn === null}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={dueOn === null}
              data-testid="task-due-clear"
              className="[@media(pointer:coarse)]:min-h-11"
              onClick={() => {
                onChange({ dueOn: null, dueTime: null });
                setOpen(false);
              }}
            >
              Clear due date
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid="task-due-done"
              className="[@media(pointer:coarse)]:min-h-11"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
