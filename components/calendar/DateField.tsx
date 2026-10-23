"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "@/components/ui/icons";
import { formatWallDate } from "@/lib/time/format";
import { cn } from "@/lib/utils";
import { DatePickerPopover } from "./DatePickerPopover";

interface Props {
  id: string;
  /** `YYYY-MM-DD` in the household zone. */
  value: string;
  onChange: (date: string) => void;
  /** Accessible name of the field, e.g. "Starts". */
  label: string;
  /** Household-local today, so the picker's Today button matches the grid. */
  today?: string;
  /** Dates carrying a visible event, rendered as neutral dots. */
  eventDates?: ReadonlySet<string>;
}

// The same Canvas field recipe EventDialog's CONTROL uses (see TimeField).
const TRIGGER =
  "w-full cursor-pointer justify-between border-field bg-surface px-3 text-base text-ink transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-ink-soft hover:bg-surface active:border-accent focus-visible:outline-accent data-[state=open]:border-accent data-[state=open]:ring-2 data-[state=open]:ring-accent/20 data-[flash=true]:animate-[field-ack_460ms_ease-out]";

const SURFACE =
  "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]";

/**
 * The dialog's date control: a field-styled button showing a readable date
 * ("Mon, 26 Oct 2026") that opens the shared MiniMonth grid. Replaces
 * `<input type="date">`, whose browser calendar renders 10/26/2026 and cannot be
 * styled or translated to the household's wording.
 */
export function DateField({ id, value, onChange, label, today, eventDates }: Props) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) {
        window.clearTimeout(flashTimer.current);
      }
    };
  }, []);

  function pick(date: string): void {
    // Acknowledge the click on the field itself: the popover closes, and the
    // field pulses once so the pick registers as an action.
    setFlash(true);
    if (flashTimer.current !== null) {
      window.clearTimeout(flashTimer.current);
    }
    flashTimer.current = window.setTimeout(() => setFlash(false), 460);
    onChange(date);
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          id={id}
          type="button"
          size="md"
          variant="outline"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${formatWallDate(value)}`}
          data-testid="date-field-trigger"
          data-flash={flash ? "true" : undefined}
          className={TRIGGER}
        >
          <span className="min-w-0 flex-1 truncate text-left">{formatWallDate(value)}</span>
          <CalendarIcon size={16} className="shrink-0 text-ink-soft" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          // Portalled content escapes the dialog's subtree, so Escape must
          // close the calendar without also closing the dialog.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
            }
          }}
          className={cn(
            "z-50 rounded-md border border-line-strong bg-surface p-3 shadow-menu outline-none",
            SURFACE,
          )}
          data-testid="date-field-popover"
        >
          <DatePickerPopover
            key={value}
            anchorDate={value}
            selectedDate={value}
            eventDates={eventDates}
            today={today}
            onPick={pick}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
