"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/ui/icons";
import type { CollectionNode } from "@/lib/services/collections";
import {
  buildPickerRows,
  calendarSwatch,
  expandedForSelection,
  toggleExpanded,
} from "@/lib/ui/calendarPicker";
import { cn } from "@/lib/utils";

interface Props {
  /** Writable calendars: top-level calendars with their sub-calendars. */
  collections: CollectionNode[];
  value: string;
  onChange: (id: string) => void;
  /** `field` draws the 38px form control; `chip` the compact inline trigger. */
  variant?: "chip" | "field";
  id?: string;
}

const FALLBACK_COLOR = "oklch(0.65 0.02 250)";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link";

/**
 * Nested calendar chooser. Top-level calendars are always listed; a row's
 * chevron reveals its sub-calendars indented beneath it, and the list scrolls
 * once it outgrows 320px. The row itself stays selectable, so a top-level
 * calendar that carries events directly is never out of reach.
 */
export function CalendarPicker({ collections, value, onChange, variant = "chip", id }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => buildPickerRows(collections, expanded), [collections, expanded]);

  const selected = calendarSwatch(collections, value);
  const selectedName = selected?.name ?? "Calendar";
  const selectedColor = selected?.color ?? FALLBACK_COLOR;

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      // Reveal the branch that holds the current selection, keeping any branch
      // the user already opened.
      setExpanded((previous) => {
        const merged = new Set(previous);
        for (const rootId of expandedForSelection(collections, value)) {
          merged.add(rootId);
        }
        return merged;
      });
    }
  }

  function pick(nextId: string): void {
    onChange(nextId);
    setOpen(false);
  }

  const trigger =
    variant === "field" ? (
      <Button
        id={id}
        type="button"
        size="md"
        variant="outline"
        aria-haspopup="dialog"
        data-testid="calendar-picker-trigger"
        className="w-full justify-start border-field bg-surface pr-2 text-base hover:bg-surface focus-visible:outline-accent"
      >
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: selectedColor }}
        />
        <span className="min-w-0 flex-1 truncate text-left">{selectedName}</span>
        <ChevronDownIcon size={16} className="shrink-0 text-ink-soft" />
      </Button>
    ) : (
      <Button
        id={id}
        type="button"
        size="sm"
        aria-haspopup="dialog"
        data-testid="calendar-picker-trigger"
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{ background: selectedColor }}
        />
        <span className="max-w-32 truncate">{selectedName}</span>
        <ChevronDownIcon size={14} className="shrink-0 text-ink-soft" />
      </Button>
    );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          // The picker is portalled, so React still bubbles this synthetic event
          // to the quick-create bubble's own Escape handler: closing the list
          // must not also discard the draft event behind it.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
            }
          }}
          className="z-50 w-[264px] origin-[var(--radix-popover-content-transform-origin)] rounded-md border border-line-strong bg-surface p-1 shadow-menu outline-none data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
          // The list is portalled out of the bubble's DOM subtree; this marker
          // keeps an enclosing dismiss-on-outside-click surface from closing
          // when the user is only picking a row.
          data-dismiss-ignore
        >
          <ul data-testid="calendar-picker-list" className="max-h-[320px] list-none overflow-y-auto p-0">
            {rows.map((row) => {
              const isSelected = row.id === value;
              return (
                <li key={row.id}>
                  <div className={cn("flex h-8 items-center rounded-sm", row.depth === 1 && "pl-6")}>
                    {row.hasChildren ? (
                      <button
                        type="button"
                        aria-expanded={row.expanded}
                        aria-label={`${row.expanded ? "Hide" : "Show"} sub-calendars of ${row.name}`}
                        onClick={() => setExpanded((previous) => toggleExpanded(previous, row.id))}
                        className={cn(
                          "grid h-8 w-6 shrink-0 place-items-center rounded-sm text-ink-mute hover:text-ink",
                          FOCUS,
                        )}
                      >
                        <ChevronRightIcon
                          size={14}
                          className={cn("transition-transform", row.expanded && "rotate-90")}
                        />
                      </button>
                    ) : (
                      <span aria-hidden className="h-8 w-6 shrink-0" />
                    )}
                    <button
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => pick(row.id)}
                      className={cn(
                        "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left text-sm text-ink hover:bg-well",
                        isSelected && "bg-well font-medium",
                        FOCUS,
                      )}
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ background: row.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      {isSelected ? (
                        <span aria-hidden className="shrink-0 text-xs text-accent">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </div>
                </li>
              );
            })}
            {rows.length === 0 ? (
              <li className="px-2 py-2 text-sm text-ink-soft">No calendars yet.</li>
            ) : null}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
