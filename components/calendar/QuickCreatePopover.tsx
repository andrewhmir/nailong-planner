"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCreateEvent,
  useDeleteEvent,
  type EventInputPayload,
} from "@/lib/query/events";
import { useUpdatePreferences } from "@/lib/query/preferences";
import type { CalendarRow } from "@/lib/db/schema";
import type { CalendarNode } from "@/lib/services/calendars";
import type { TimeFormat } from "@/lib/services/preferences";
import {
  PARENT_SHADE_INDEX,
  isHueFamily,
  shadeTokens,
  type HueFamily,
} from "@/lib/color/palette";
import { formatWallDate, formatWallTime } from "@/lib/time/format";
import { addDaysToDate, localWallTimeToUtc } from "@/lib/time/zone";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { pushUndo, undoLast } from "@/lib/ui/undo";
import type { QuickCreateRange } from "./quickCreateDefaults";

export interface QuickCreateDraft extends QuickCreateRange {
  /** `YYYY-MM-DD` in the household zone. */
  dateWall: string;
  /** Viewport coordinates of the click, used to place the bubble. */
  anchor: { x: number; y: number };
}

interface Props {
  draft: QuickCreateDraft;
  /** Writable calendars only. */
  calendars: CalendarNode[];
  defaultCalendarId: string | null;
  timezone: string;
  timeFormat: TimeFormat;
  onClose: () => void;
  onMoreOptions: (values: {
    title: string;
    calendarId: string;
    startWall: string;
    endWall: string;
    allDay: boolean;
  }) => void;
}

const CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CARD_WIDTH = 320;
const MARGIN = 16;
const CARD_HEIGHT_ESTIMATE = 260;

interface CalendarChoice {
  calendar: CalendarRow;
  family: HueFamily;
  shade: number;
}

/** Inclusive all-day dates from FullCalendar's exclusive midnight end. */
function draftPayload(
  draft: QuickCreateDraft,
  title: string,
  calendarId: string,
  timezone: string,
): EventInputPayload {
  if (draft.allDay) {
    const startDate = draft.startWall.slice(0, 10);
    const endDate = addDaysToDate(draft.endWall.slice(0, 10), -1);
    return {
      calendarId,
      title,
      allDay: true,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      rrule: null,
    };
  }
  return {
    calendarId,
    title,
    allDay: false,
    startAt: localWallTimeToUtc(draft.startWall, timezone),
    endAt: localWallTimeToUtc(draft.endWall, timezone),
    rrule: null,
  };
}

/**
 * GCal's bubble: type a title, pick a calendar, Save. "More options" escalates
 * to the full dialog with the typed title, and Escape closes without saving.
 */
export function QuickCreatePopover({
  draft,
  calendars,
  defaultCalendarId,
  timezone,
  timeFormat,
  onClose,
  onMoreOptions,
}: Props) {
  const isPhone = useMediaQuery("(max-width: 767px)");
  const choices = useMemo<CalendarChoice[]>(
    () =>
      calendars.flatMap((root) => {
        const rootFamily: HueFamily =
          root.hueFamily && isHueFamily(root.hueFamily) ? root.hueFamily : "slate";
        return [
          { calendar: root, family: rootFamily, shade: PARENT_SHADE_INDEX },
          ...root.children.map((child) => ({
            calendar: child,
            family: rootFamily,
            shade: child.shadeIndex,
          })),
        ];
      }),
    [calendars],
  );

  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState(() =>
    defaultCalendarId && choices.some((choice) => choice.calendar.id === defaultCalendarId)
      ? defaultCalendarId
      : "",
  );
  const titleRef = useRef<HTMLInputElement | null>(null);

  const createEvent = useCreateEvent();
  const deleteEvent = useDeleteEvent();
  const updatePreferences = useUpdatePreferences();

  // Calendars arrive after the bubble opens; fall back live instead of freezing
  // an empty selection.
  const effectiveCalendarId = calendarId || choices[0]?.calendar.id || "";
  const selected =
    choices.find((choice) => choice.calendar.id === effectiveCalendarId) ?? choices[0];
  const selectedColor = selected
    ? shadeTokens(selected.family, selected.shade).mainHex
    : "oklch(0.65 0.02 250)";

  function save(): void {
    const trimmed = title.trim();
    if (!trimmed || !effectiveCalendarId) {
      return;
    }
    createEvent.mutate(draftPayload(draft, trimmed, effectiveCalendarId, timezone), {
      onSuccess: ({ event }) => {
        pushUndo({
          label: "Create event",
          undo: async () => {
            await deleteEvent.mutateAsync({ id: event.id, scope: "all" });
          },
        });
        toast.success("Event created", {
          action: { label: "Undo", onClick: () => void undoLast() },
          duration: 10_000,
        });
        // Remember the calendar for next time (spec D3).
        updatePreferences.mutate({ lastEventCalendarId: effectiveCalendarId });
        onClose();
      },
      onError: (error) => toast.error(error.message),
    });
  }

  const dateLabel = formatWallDate(draft.dateWall);
  const timeLabel = draft.allDay
    ? "All day"
    : `${formatWallTime(draft.startWall, timeFormat)} – ${formatWallTime(draft.endWall, timeFormat)}`;

  const body = (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-ink-soft">{dateLabel}</p>
          <p className="text-sm text-ink">{timeLabel}</p>
        </div>
        <Button size="sm" variant="ghost" type="button" aria-label="Close" onClick={onClose}>
          ×
        </Button>
      </div>

      <div>
        <label className="mb-1 block text-sm text-ink" htmlFor="quick-create-title">
          Title
        </label>
        <input
          id="quick-create-title"
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            // FullCalendar keeps a document-level keyboard map, so rely on an
            // explicit Enter handler rather than implicit form submission.
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          placeholder="Add a title"
          className={CONTROL}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" type="button">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: selectedColor }}
              />
              <span className="max-w-32 truncate">{selected?.calendar.name ?? "Calendar"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {choices.map((choice) => (
              <DropdownMenuItem
                key={choice.calendar.id}
                onSelect={() => setCalendarId(choice.calendar.id)}
              >
                {choice.calendar.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() =>
              onMoreOptions({
                title: title.trim(),
                calendarId: effectiveCalendarId,
                startWall: draft.startWall,
                endWall: draft.endWall,
                allDay: draft.allDay,
              })
            }
          >
            More options
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            disabled={title.trim().length === 0 || !effectiveCalendarId}
          >
            Save
          </Button>
        </div>
      </div>
    </form>
  );

  if (isPhone) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <DialogContent title="New event" sheet>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  const left = Math.min(
    Math.max(draft.anchor.x, MARGIN),
    Math.max(MARGIN, window.innerWidth - CARD_WIDTH - MARGIN),
  );
  const top = Math.min(
    Math.max(draft.anchor.y, MARGIN),
    Math.max(MARGIN, window.innerHeight - CARD_HEIGHT_ESTIMATE - MARGIN),
  );

  return (
    <div
      role="dialog"
      aria-label="New event"
      style={{ position: "fixed", left, top, width: CARD_WIDTH }}
      className="z-50 rounded-md border border-line-strong bg-surface p-4 shadow-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {body}
    </div>
  );
}
