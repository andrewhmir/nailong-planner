"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  useCreateEvent,
  useDeleteEvent,
  type EventInputPayload,
} from "@/lib/query/events";
import { useUpdatePreferences } from "@/lib/query/preferences";
import type { CollectionNode } from "@/lib/services/collections";
import type { TimeFormat } from "@/lib/services/preferences";
import { calendarSwatch } from "@/lib/ui/calendarPicker";
import { formatWallDate, formatWallTime } from "@/lib/time/format";
import { addDaysToDate, localWallTimeToUtc } from "@/lib/time/zone";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { pushUndo } from "@/lib/ui/undo";
import { undoToast } from "@/lib/ui/undoToast";
import { CalendarPicker } from "./CalendarPicker";
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
  collections: CollectionNode[];
  defaultCollectionId: string | null;
  timezone: string;
  timeFormat: TimeFormat;
  onClose: () => void;
  onMoreOptions: (values: {
    title: string;
    collectionId: string;
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

/** Inclusive all-day dates from FullCalendar's exclusive midnight end. */
function draftPayload(
  draft: QuickCreateDraft,
  title: string,
  collectionId: string,
  timezone: string,
): EventInputPayload {
  if (draft.allDay) {
    const startDate = draft.startWall.slice(0, 10);
    const endDate = addDaysToDate(draft.endWall.slice(0, 10), -1);
    return {
      collectionId,
      title,
      allDay: true,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      rrule: null,
    };
  }
  return {
    collectionId,
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
  collections,
  defaultCollectionId,
  timezone,
  timeFormat,
  onClose,
  onMoreOptions,
}: Props) {
  const isPhone = useMediaQuery("(max-width: 767px)");

  const [title, setTitle] = useState("");
  // Only an explicit pick sticks. `null` follows `defaultCollectionId`, so a
  // change in "display only this calendar" (or in the saved default) reaches a
  // bubble that is already on screen — the shell reuses this instance for the
  // next draft, so a default frozen at mount would go stale.
  const [pickedCollectionId, setPickedCollectionId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const createEvent = useCreateEvent();
  const deleteEvent = useDeleteEvent();
  const updatePreferences = useUpdatePreferences();

  // Clicking anywhere else on the page — toolbar, sidebar, another day — closes
  // the bubble, like GCal. The phone sheet is a Radix Dialog and dismisses
  // itself, and the calendar list is portalled, so it opts out by marker.
  useEffect(() => {
    if (isPhone) {
      return;
    }
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (rootRef.current?.contains(target) || target.closest("[data-dismiss-ignore]")) {
        return;
      }
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isPhone, onClose]);

  // Calendars arrive after the bubble opens; fall back live instead of freezing
  // an empty selection.
  const preferredCollectionId = pickedCollectionId ?? defaultCollectionId;
  const effectiveCollectionId =
    (preferredCollectionId && calendarSwatch(collections, preferredCollectionId)
      ? preferredCollectionId
      : "") ||
    collections[0]?.id ||
    "";

  function save(): void {
    const trimmed = title.trim();
    if (!trimmed || !effectiveCollectionId) {
      return;
    }
    createEvent.mutate(draftPayload(draft, trimmed, effectiveCollectionId, timezone), {
      onSuccess: ({ event }) => {
        const handle = pushUndo({
          label: "Create event",
          undo: async () => {
            await deleteEvent.mutateAsync({ id: event.id, scope: "all" });
          },
        });
        undoToast("Event created", handle);
        // Remember the calendar for next time (spec D3).
        updatePreferences.mutate({ lastEventCalendarId: effectiveCollectionId });
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
        <CalendarPicker
          collections={collections}
          value={effectiveCollectionId}
          onChange={setPickedCollectionId}
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() =>
              onMoreOptions({
                title: title.trim(),
                collectionId: effectiveCollectionId,
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
            disabled={title.trim().length === 0 || !effectiveCollectionId}
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
      ref={rootRef}
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
