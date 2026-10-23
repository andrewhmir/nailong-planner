"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { addDaysToDate } from "@/lib/time/zone";
import { cn } from "@/lib/utils";

export interface MiniMonthProps {
  /** `YYYY-MM-DD` in the household zone; the month it names is the month shown. */
  anchorDate: string;
  selectedDate?: string;
  /** Dates that have at least one visible event (renders the neutral dot). */
  eventDates?: ReadonlySet<string>;
  onSelectDate: (date: string) => void;
  /** First of the newly shown month. */
  onAnchorChange: (date: string) => void;
  labelledBy?: string;
}

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parts(date: string): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(date);
  return {
    year: Number(match?.[1] ?? 1970),
    month: Number(match?.[2] ?? 1),
    day: Number(match?.[3] ?? 1),
  };
}

function weekdayIndex(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(anchor: string, delta: number): string {
  const { year, month } = parts(anchor);
  const total = year * 12 + (month - 1) + delta;
  return iso(Math.floor(total / 12), (total % 12) + 1, 1);
}

function shiftMonthKeepingDay(date: string, delta: number): string {
  const { year, month, day } = parts(date);
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return iso(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

function localToday(): string {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * A calm, neutral month grid (Google's sidebar calendar): event dots are always
 * neutral so the mini-month never competes with the coloured grid. Keyboard
 * model is a standard single-tab-stop grid with roving tabindex.
 */
export function MiniMonth({
  anchorDate,
  selectedDate,
  eventDates,
  onSelectDate,
  onAnchorChange,
  labelledBy,
}: MiniMonthProps) {
  const { year, month } = parts(anchorDate);
  const today = localToday();
  const firstWeekday = weekdayIndex(year, month, 1);
  const total = daysInMonth(year, month);

  // Adjacent-month days fill the grid instead of leaving holes: a blank first
  // week makes the month look like it starts mid-grid. They are decorative
  // (`aria-hidden`, not gridcells), so the roving-tabindex model is unchanged.
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  for (let index = firstWeekday; index > 0; index -= 1) {
    cells.push({ date: addDaysToDate(iso(year, month, 1), -index), inMonth: false });
  }
  for (let day = 1; day <= total; day += 1) {
    cells.push({ date: iso(year, month, day), inMonth: true });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let index = 1; index <= trailing; index += 1) {
    cells.push({ date: addDaysToDate(iso(year, month, total), index), inMonth: false });
  }

  const monthPrefix = `${year}-${pad(month)}`;
  const fallbackFocus = today.startsWith(monthPrefix) ? today : iso(year, month, 1);
  const [focusDate, setFocusDate] = useState(selectedDate ?? fallbackFocus);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function moveFocus(date: string): void {
    setFocusDate(date);
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-mini-date="${date}"]`)
        ?.focus();
    });
  }

  function ensureMonthVisible(date: string): void {
    const next = parts(date);
    if (`${next.year}-${pad(next.month)}` !== monthPrefix) {
      onAnchorChange(iso(next.year, next.month, 1));
    }
  }

  function onDayKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, date: string): void {
    const { day } = parts(date);
    const weekday = weekdayIndex(year, month, day);
    let next: string | null = null;
    switch (event.key) {
      case "ArrowLeft":
        next = addDaysToDate(date, -1);
        break;
      case "ArrowRight":
        next = addDaysToDate(date, 1);
        break;
      case "ArrowUp":
        next = addDaysToDate(date, -7);
        break;
      case "ArrowDown":
        next = addDaysToDate(date, 7);
        break;
      case "Home":
        next = addDaysToDate(date, -weekday);
        break;
      case "End":
        next = addDaysToDate(date, 6 - weekday);
        break;
      case "PageUp":
        next = shiftMonthKeepingDay(date, -1);
        break;
      case "PageDown":
        next = shiftMonthKeepingDay(date, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    ensureMonthVisible(next);
    moveFocus(next);
  }

  return (
    <div
      ref={containerRef}
      role="grid"
      aria-label={`Mini calendar, ${MONTH_NAMES[month - 1]} ${year}`}
      aria-labelledby={labelledBy}
      className="w-full select-none"
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous month"
          onClick={() => onAnchorChange(shiftMonth(anchorDate, -1))}
        >
          <ChevronLeftIcon size={16} />
        </Button>
        <span className="text-sm font-bold text-ink" aria-hidden>
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next month"
          onClick={() => onAnchorChange(shiftMonth(anchorDate, 1))}
        >
          <ChevronRightIcon size={16} />
        </Button>
      </div>

      <div role="row" className="grid grid-cols-7">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span
            key={`${initial}-${index}`}
            aria-hidden
            className="py-1 text-center text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft"
          >
            {initial}
          </span>
        ))}
      </div>

      {Array.from({ length: cells.length / 7 }, (_, weekIndex) => (
        <div role="row" key={weekIndex} className="grid grid-cols-7">
          {cells.slice(weekIndex * 7, weekIndex * 7 + 7).map((cell, dayIndex) => {
            if (!cell.inMonth) {
              return (
                <span
                  key={`outside-${weekIndex}-${dayIndex}`}
                  aria-hidden
                  className="mx-auto flex h-8 w-8 items-center justify-center text-xs text-ink-mute/45"
                >
                  {parts(cell.date).day}
                </span>
              );
            }
            const date = cell.date;
            const { day } = parts(date);
            const hasEvents = eventDates?.has(date) ?? false;
            const selected = selectedDate === date;
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                role="gridcell"
                data-mini-date={date}
                aria-label={`${WEEKDAY_NAMES[weekdayIndex(year, month, day)]} ${day} ${MONTH_NAMES[month - 1]}, ${hasEvents ? "has events" : "no events"}`}
                aria-selected={selected}
                aria-current={isToday ? "date" : undefined}
                tabIndex={date === focusDate ? 0 : -1}
                onClick={() => {
                  setFocusDate(date);
                  onSelectDate(date);
                }}
                onKeyDown={(event) => onDayKeyDown(event, date)}
                className={cn(
                  "relative mx-auto my-0.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm text-xs transition-[color,background-color,transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-link active:scale-95",
                  selected
                    ? "bg-accent font-medium text-white shadow-sm active:bg-accent-hover"
                    : isToday
                      ? "font-bold text-link ring-1 ring-inset ring-link/35 hover:bg-well active:bg-line"
                      : "text-ink hover:bg-well active:bg-line",
                )}
              >
                {day}
                {hasEvents ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute bottom-1 h-1 w-1 rounded-full",
                      selected ? "bg-white" : "bg-ink-soft",
                    )}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
