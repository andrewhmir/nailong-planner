"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { DatePickerPopover } from "./DatePickerPopover";

export type PlannerView = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth";

const VIEWS: Array<{ value: PlannerView; label: string }> = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
  { value: "listMonth", label: "List" },
];

interface Props {
  label: string;
  view: PlannerView;
  /** A date inside the visible range, used to initialise the jump-to-date picker. */
  anchorDate: string;
  onJumpToDate: (date: string) => void;
  onViewChange: (view: PlannerView) => void;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onNewEvent: () => void;
  onShowShortcuts: () => void;
}

export function Toolbar({
  label,
  view,
  anchorDate,
  onJumpToDate,
  onViewChange,
  onPrev,
  onToday,
  onNext,
  onNewEvent,
  onShowShortcuts,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
      {/* The heading keeps the programmatic page title; the button inside it is
          the Google-style jump-to-date affordance. */}
      <PopoverPrimitive.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        <h2 className="mr-auto min-w-0 text-[1.8rem] font-normal leading-tight text-ink">
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              aria-haspopup="dialog"
              className="flex min-w-0 items-center gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
            >
              <span className="truncate">{label}</span>
              <ChevronDownIcon size={18} className="shrink-0 text-ink-soft" />
            </button>
          </PopoverPrimitive.Trigger>
        </h2>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 rounded-md border border-line-strong bg-surface p-3 shadow-menu outline-none"
          >
            <DatePickerPopover
              key={anchorDate}
              anchorDate={anchorDate}
              onPick={(date) => {
                setPickerOpen(false);
                onJumpToDate(date);
              }}
            />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      <div className="flex items-center gap-2">
        <Button
          size="md"
          variant="outline"
          className="w-[38px] px-0"
          aria-label="Previous"
          onClick={onPrev}
        >
          <ChevronLeftIcon size={18} />
        </Button>
        <Button size="md" variant="outline" onClick={onToday}>
          Today
        </Button>
        <Button
          size="md"
          variant="outline"
          className="w-[38px] px-0"
          aria-label="Next"
          onClick={onNext}
        >
          <ChevronRightIcon size={18} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex overflow-hidden rounded-md border border-line-strong bg-surface"
          role="group"
          aria-label="Calendar view"
        >
          {VIEWS.map((option, index) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => onViewChange(option.value)}
              className={cn(
                "h-[38px] px-3 text-base transition-colors",
                index > 0 && "border-l border-line-strong",
                index === 0 && "rounded-l-md",
                index === VIEWS.length - 1 && "rounded-r-md",
                view === option.value ? "bg-accent text-white" : "text-ink hover:bg-well",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Button
          size="md"
          variant="outline"
          aria-label="Keyboard shortcuts"
          onClick={onShowShortcuts}
          className="hidden w-[38px] px-0 md:inline-flex"
        >
          ?
        </Button>

        <Button
          size="md"
          variant="primary"
          onClick={onNewEvent}
          aria-label="New event"
          data-testid="new-event-button"
          className="hidden md:inline-flex"
        >
          + Event
        </Button>
      </div>
    </div>
  );
}
