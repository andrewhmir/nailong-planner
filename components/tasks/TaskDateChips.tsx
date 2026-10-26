"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useState } from "react";
import { DatePickerPopover } from "@/components/calendar/DatePickerPopover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, ClockIcon, type IconProps } from "@/components/ui/icons";
import { formatWallDate } from "@/lib/time/format";
import { cn } from "@/lib/utils";

/** Shared chip recipe: dense, quiet, violet focus ring, 44px on touch. */
const CHIP =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-1.5 text-xs text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11";

/** The one popover shell both chips share: a mini-month plus its clear action. */
function DateChip({
  icon: Icon,
  date,
  today,
  title,
  label,
  clearLabel,
  testId,
  danger = false,
  onPick,
}: {
  icon: (props: IconProps) => React.ReactElement;
  date: string | null;
  today: string;
  title: string;
  /** Accessible name when no date is set ("Set scheduled date"). */
  label: string;
  clearLabel: string;
  testId: string;
  danger?: boolean;
  onPick: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(next: string | null): void {
    setOpen(false);
    onPick(next);
  }

  const accessibleName =
    date === null ? `${label} for ${title}` : `${label} for ${title}: ${formatWallDate(date)}`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={accessibleName}
          data-testid={testId}
          className={cn(CHIP, danger && "font-bold text-danger-ink")}
        >
          <Icon size={13} className="shrink-0" />
          {date === null ? null : <span>{formatWallDate(date)}</span>}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          aria-label={`${label} for ${title}`}
          className="z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-md border border-line-strong bg-surface p-3 shadow-menu outline-none data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <DatePickerPopover
            key={date ?? "none"}
            anchorDate={date ?? today}
            selectedDate={date ?? undefined}
            today={today}
            onPick={(next) => pick(next)}
          />
          <div className="mt-2 flex justify-end border-t border-line pt-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={date === null}
              data-testid={`${testId}-clear`}
              onClick={() => pick(null)}
            >
              {clearLabel}
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

interface Props {
  scheduledOn: string | null;
  dueOn: string | null;
  /** Household-local today, for the picker's Today button and the overdue cue. */
  today: string;
  /** The task title, so both chips have a unique accessible name. */
  title: string;
  onChange: (patch: { scheduledOn?: string | null; dueOn?: string | null }) => void;
}

/**
 * The row's two inline date fields: a scheduled chip (calendar icon) and a due
 * chip (clock icon), each a Radix popover around the shared `DatePickerPopover`
 * plus a Clear action. A set chip shows `formatWallDate`; an overdue due chip is
 * danger-coloured. Dates are date-only household-local strings; the caller owns
 * the PATCH and its targeted undo.
 */
export function TaskDateChips({ scheduledOn, dueOn, today, title, onChange }: Props) {
  const overdue = dueOn !== null && dueOn < today;

  return (
    <>
      <DateChip
        icon={CalendarIcon}
        date={scheduledOn}
        today={today}
        title={title}
        label="Scheduled date"
        clearLabel="Clear date"
        testId="task-date-scheduled"
        onPick={(date) => onChange({ scheduledOn: date })}
      />
      <DateChip
        icon={ClockIcon}
        date={dueOn}
        today={today}
        title={title}
        label="Due date"
        clearLabel="Clear due date"
        testId="task-date-due"
        danger={overdue}
        onPick={(date) => onChange({ dueOn: date })}
      />
    </>
  );
}
