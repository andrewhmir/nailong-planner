"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon } from "@/components/ui/icons";
import { collectionDot } from "@/lib/color/palette";
import type { TaskView } from "@/lib/services/tasks";
import { cn } from "@/lib/utils";
import type { WritableList } from "./types";

interface Props {
  /** The task's current list; its summary is the dot fallback when the list is not writable. */
  current: TaskView["collection"];
  /**
   * Every writable collection the task may be filed under, the current one
   * included: calendars and lists alike, in the same tree order the calendar
   * sidebar shows (roots first, then their sub-collections). Colours are folded
   * from each root.
   */
  lists: WritableList[];
  /** Move the task to one list. Picking the current one is a no-op by contract. */
  onMove(collectionId: string): void;
  /** Trigger classes: the row/card cell default, or the panel's chip recipe. */
  triggerClassName?: string;
  /** Name-span classes (truncation; the row hides the name below `sm`). */
  nameClassName?: string;
  /** The panel chip shows a chevron affordance; the row/card cell does not. */
  showChevron?: boolean;
  /** The row/card keep their `task-collection-dot-<id>` debugging hook. */
  dotTestId?: string;
  /** The panel keeps its `task-panel-list` hook. */
  testId?: string;
}

/**
 * The inline list picker: the task's list renders as a trigger (dot + name, the
 * same anatomy the row already had), and clicking it opens a **LIST** menu of
 * every writable collection — the same calendars, sub-calendars, lists and
 * sub-lists the calendar sidebar shows — with the task's current one checked, so
 * it reads as "where this falls under", not just "move somewhere else".
 *
 * A calendar is a valid task home on purpose: the household files a task under
 * the subject its events use (School / Math, Work / On-call). Filing a task does
 * **not** turn it into an event — a task is always a `task` row and only ever
 * shows on the grid as the read-only due-date chip it already had.
 *
 * It is a `DropdownMenu` rather than a bespoke popover so Radix owns the
 * keyboard contract the workspace already relies on: arrow keys/typeahead move
 * between lists, `Escape` and outside-click close, the page-scoped triage keys
 * are gated by `hasOpenOverlay`, and focus returns to the trigger. Choosing a
 * different list calls the shell's `onMove`, which is the same optimistic PATCH
 * + targeted-undo path as the overflow menu's `Move to list…`; the shell's
 * same-collection guard makes re-picking the current list a no-op.
 *
 * The trigger's dot is taken from the matching `WritableList` when one exists,
 * because a sub-list row stores `hueFamily: null` and inherits its root's family
 * — the picker must not paint grey where the calendar sidebar paints the family
 * shade.
 */
export function TaskListPicker({
  current,
  lists,
  onMove,
  triggerClassName,
  nameClassName,
  showChevron = false,
  dotTestId,
  testId,
}: Props) {
  const currentEntry = lists.find((list) => list.id === current.id);
  const dot = collectionDot(currentEntry ?? current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`List: ${current.name}`}
        data-testid={testId}
        className={cn(
          "-mx-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs text-ink-mute transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
          triggerClassName,
        )}
      >
        <span
          aria-hidden
          data-testid={dotTestId}
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: dot }}
        />
        <span className={cn("min-w-0 truncate", nameClassName)}>{current.name}</span>
        {showChevron ? <ChevronDownIcon size={12} className="shrink-0" /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(70vh,420px)] overflow-y-auto">
        <DropdownMenuLabel>
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">List</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current.id}
          onValueChange={(id) => {
            if (id !== current.id) {
              onMove(id);
            }
          }}
        >
          {lists.map((list) => (
            <DropdownMenuRadioItem
              key={list.id}
              value={list.id}
              className="data-[state=checked]:bg-violet-soft"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: collectionDot(list) }}
                />
                <span className="min-w-0 truncate">{list.name}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
