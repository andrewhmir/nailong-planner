"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

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
  onViewChange: (view: PlannerView) => void;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onNewEvent: () => void;
}

export function Toolbar({ label, view, onViewChange, onPrev, onToday, onNext, onNewEvent }: Props) {
  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
      <h2
        className="mr-auto min-w-0 truncate text-[1.8rem] font-normal leading-tight text-ink"
        aria-live="polite"
      >
        {label}
      </h2>

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
          variant="primary"
          onClick={onNewEvent}
          aria-label="New event"
          data-testid="new-event-button"
        >
          + Event
        </Button>
      </div>
    </div>
  );
}
