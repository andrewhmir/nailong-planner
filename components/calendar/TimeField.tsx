"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon, ClockIcon } from "@/components/ui/icons";
import type { TimeFormat } from "@/lib/services/preferences";
import { formatWallTime } from "@/lib/time/format";
import { utcToLocalWallTime } from "@/lib/time/zone";
import { cn } from "@/lib/utils";
import {
  SLOT_MINUTES,
  meridiemOf,
  minutesOfDay,
  nearestSlotIndex,
  parseTypedTime,
  timeSlots,
} from "./timeSlots";

interface Props {
  id: string;
  /** Wall clock `HH:MM` in the household zone; `null` = no time chosen yet. */
  value: string | null;
  onChange: (time: string) => void;
  timeFormat: TimeFormat;
  /** Household zone, used only to mark the row that contains "now". */
  timezone: string;
  /** Accessible name of the list, e.g. "Start time". */
  label: string;
  /** Shown instead of a formatted time while `value` is null (e.g. "No time"). */
  placeholder?: string;
  /** Disables the trigger; used when a time needs a date first. */
  disabled?: boolean;
  /** Renders a "Clear time" action inside the picker when a value is set. */
  onClear?: () => void;
}

// The same Canvas field recipe EventDialog's CONTROL uses: 38px box, field
// border, 16px text. Kept as a copy (like CONTROL itself is a copy of the
// settings recipe) so the picker stays a leaf component.
const TRIGGER =
  "w-full cursor-pointer justify-between border-field bg-surface px-3 text-base text-ink transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-ink-soft hover:bg-surface active:border-accent focus-visible:outline-accent data-[state=open]:border-accent data-[state=open]:ring-2 data-[state=open]:ring-accent/20 data-[flash=true]:animate-[field-ack_460ms_ease-out]";

// Shared motion: the surface grows out of the trigger's edge instead of
// appearing instantly, which is what made the old native popups feel abrupt.
const SURFACE =
  "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]";

const SLOTS = timeSlots();

/**
 * The list is split by part of day: 96 undifferentiated rows read as a wall of
 * text, while four labelled bands let the eye land on "Afternoon" first.
 */
const BANDS: Array<{ label: string; from: number; to: number }> = [
  { label: "Morning", from: 0, to: 12 * 60 },
  { label: "Afternoon", from: 12 * 60, to: 17 * 60 },
  { label: "Evening", from: 17 * 60, to: 21 * 60 },
  { label: "Night", from: 21 * 60, to: 24 * 60 },
];

const BANDS_WITH_SLOTS = BANDS.map((band) => ({
  ...band,
  entries: SLOTS.map((slot, index) => ({ slot, index })).filter(({ index }) => {
    const minutes = index * SLOT_MINUTES;
    return minutes >= band.from && minutes < band.to;
  }),
}));

/**
 * The dialog's time control: a field-styled button that opens a quick-pick list
 * of 15-minute rows plus a typed field for the minute in between. Replaces
 * `<input type="time">`, whose browser spinner ignores the household's 12/24-hour
 * preference and cannot be reached from a keyboard in a useful order.
 */
export function TimeField({
  id,
  value,
  onChange,
  timeFormat,
  timezone,
  label,
  placeholder = "No time",
  disabled = false,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => nearestSlotIndex(value ?? "12:00"));
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const flashTimer = useRef<number | null>(null);
  // Frozen when the dialog opens, like the shell's anchors: the "now" marker
  // must not drift mid-edit but should not be read during render either.
  const [nowWall] = useState(() => utcToLocalWallTime(Date.now(), timezone).slice(11, 16));

  const nowMinutes = minutesOfDay(nowWall);
  const nowIndex = nowMinutes === null ? -1 : Math.floor(nowMinutes / SLOT_MINUTES);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) {
        window.clearTimeout(flashTimer.current);
      }
    };
  }, []);

  function acknowledge(): void {
    setFlash(true);
    if (flashTimer.current !== null) {
      window.clearTimeout(flashTimer.current);
    }
    flashTimer.current = window.setTimeout(() => setFlash(false), 460);
  }

  function focusSlot(slot: string): void {
    requestAnimationFrame(() => {
      const element = listRef.current?.querySelector<HTMLElement>(`[data-time-slot="${slot}"]`);
      element?.focus();
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    setTyped("");
    setError(null);
    if (!next) {
      return;
    }
    const index = nearestSlotIndex(value ?? "12:00");
    setActiveIndex(index);
    // Centre the current value instead of opening the list at midnight.
    requestAnimationFrame(() => {
      const list = listRef.current;
      const target = list?.querySelector<HTMLElement>(`[data-time-slot="${SLOTS[index]}"]`);
      if (list && target) {
        list.scrollTop = Math.max(0, target.offsetTop - list.clientHeight / 2);
      }
    });
  }

  function pick(time: string): void {
    acknowledge();
    onChange(time);
    setOpen(false);
  }

  function commitTyped(): void {
    const parsed = parseTypedTime(typed, timeFormat, meridiemOf(value ?? "") ?? "am");
    if (parsed === null) {
      setError(
        timeFormat === "24h"
          ? "Type a 24-hour time, like 08:37."
          : "Type a time, like 8:37 AM.",
      );
      return;
    }
    pick(parsed);
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(SLOTS.length - 1, activeIndex + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, activeIndex - 1);
        break;
      case "PageDown":
        next = Math.min(SLOTS.length - 1, activeIndex + 4);
        break;
      case "PageUp":
        next = Math.max(0, activeIndex - 4);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = SLOTS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const slot = SLOTS[next]!;
    setActiveIndex(next);
    focusSlot(slot);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          id={id}
          type="button"
          size="md"
          variant="outline"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            value === null ? label : `${label}: ${formatWallTime(value, timeFormat)}`
          }
          data-testid="time-field-trigger"
          data-flash={flash ? "true" : undefined}
          className={TRIGGER}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              value === null && "text-placeholder",
            )}
          >
            {value === null ? placeholder : formatWallTime(value, timeFormat)}
          </span>
          <ClockIcon size={16} className="shrink-0 text-ink-soft" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          // The list is portalled, so Escape must close the list without also
          // closing the dialog behind it.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
            }
          }}
          className={cn(
            "z-50 w-[248px] overflow-hidden rounded-md border border-line-strong bg-surface shadow-menu outline-none",
            SURFACE,
          )}
          data-testid="time-field-popover"
        >
          <div
            role="listbox"
            aria-label={`${label} quick pick`}
            ref={listRef}
            onKeyDown={onListKeyDown}
            className="max-h-[252px] overflow-y-auto overscroll-contain px-1"
          >
            {BANDS_WITH_SLOTS.map((band) => (
              <div key={band.label} role="group" aria-label={band.label} className="pb-1">
                <div
                  aria-hidden
                  className="sticky top-0 z-10 bg-surface px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-soft"
                >
                  {band.label}
                </div>
                {band.entries.map(({ slot, index }) => {
                  const selected = slot === value;
                  const active = index === activeIndex;
                  const isNow = index === nowIndex;
                  return (
                    <button
                      key={slot}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={active ? 0 : -1}
                      data-time-slot={slot}
                      data-testid={selected ? "time-field-selected" : undefined}
                      onClick={() => {
                        setActiveIndex(index);
                        pick(slot);
                      }}
                      onFocus={() => setActiveIndex(index)}
                      className={cn(
                        "flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 text-left text-sm transition-[color,background-color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
                        selected
                          ? "bg-accent font-medium text-white shadow-sm active:bg-accent-hover"
                          : "text-ink active:bg-line hover:bg-well",
                      )}
                    >
                      <span className="tabular-nums">{formatWallTime(slot, timeFormat)}</span>
                      {selected ? (
                        <CheckIcon size={15} className="shrink-0" />
                      ) : isNow ? (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                          now
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="border-t border-line bg-well px-2 pb-2 pt-2">
            {onClear !== undefined && value !== null ? (
              <div className="mb-2 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="time-field-clear"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                >
                  Clear time
                </Button>
              </div>
            ) : null}
            <label
              htmlFor={`${id}-typed`}
              className="block text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-soft"
            >
              Type a time
            </label>
            <input
              id={`${id}-typed`}
              value={typed}
              inputMode="numeric"
              autoComplete="off"
              placeholder={timeFormat === "24h" ? "HH:MM" : "H:MM AM"}
              aria-invalid={error !== null}
              aria-describedby={error ? `${id}-typed-error` : undefined}
              onChange={(event) => {
                setTyped(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTyped();
                }
              }}
              onBlur={() => {
                if (typed.trim() && error === null) {
                  const parsed = parseTypedTime(typed, timeFormat, meridiemOf(value ?? "") ?? "am");
                  if (parsed !== null) {
                    pick(parsed);
                  }
                }
              }}
              className="mt-1 h-8 w-full rounded-sm border border-field bg-surface px-2 text-sm text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            {error ? (
              <p id={`${id}-typed-error`} role="alert" className="mt-1 text-xs text-danger-ink">
                {error}
              </p>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
