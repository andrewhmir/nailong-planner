"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CalendarNode } from "@/lib/services/calendars";
import type { EventView } from "@/lib/services/events";
import { useCreateEvent, useDeleteEvent, useUpdateEvent } from "@/lib/query/events";
import { useUpdatePreferences } from "@/lib/query/preferences";
import { utcToLocalWallTime } from "@/lib/time/zone";
import { pushUndo, undoLast } from "@/lib/ui/undo";
import {
  REPEAT_OPTIONS,
  buildEventPayload,
  deriveRepeat,
  type RepeatRule,
} from "./eventPayload";
import { CalendarPicker } from "./CalendarPicker";

// Canvas form controls (§7): 38px box, 1px field border, 4px radius, 16px text.
// This is a copy of the settings field recipe (SettingsForm.tsx), not a shared
// import. No `outline-none`: Tailwind v4 compiles it to `--tw-outline-style:
// none`, which `outline-2` reads back, collapsing the focus ring.
const CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const TEXTAREA =
  "w-full rounded-md border border-field bg-surface px-3 py-2 text-base text-ink focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LABEL = "block text-base text-ink";

export interface EventDialogInitial {
  event?: EventView;
  /** Wall-clock start in the household timezone (`YYYY-MM-DDTHH:MM`). */
  start: string;
  /** Wall-clock end in the household timezone (`YYYY-MM-DDTHH:MM`). */
  end: string;
  allDay: boolean;
  /** Carried over from the quick-create bubble by "More options". */
  pendingTitle?: string;
}

interface Props {
  mode: "create" | "edit";
  initial: EventDialogInitial;
  /** The existing series rule on edit; preserved verbatim unless the user changes Repeat. */
  initialRule?: string | null;
  timezone: string;
  calendars: CalendarNode[];
  /** Where a new event starts unless the user picks otherwise ("only this calendar"). */
  defaultCalendarId?: string | null;
  /** Success or programmatic close (dirty state is dropped). */
  onClose: () => void;
  /** User asked to close; the shell runs the unsaved-changes guard. */
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function splitWall(wall: string): { date: string; time: string } {
  const [date = "", time = "09:00"] = wall.split("T");
  return { date, time };
}

export function EventDialog({
  mode,
  initial,
  initialRule,
  timezone,
  calendars,
  defaultCalendarId,
  onClose,
  onCancel,
  onDirtyChange,
}: Props) {
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const updatePreferences = useUpdatePreferences();
  const pending = createEvent.isPending || updateEvent.isPending;

  const initialStart = splitWall(initial.start);
  const initialEnd = splitWall(initial.end);

  const fallbackCalendarId = calendars[0]?.id ?? "";
  // On edit the event's own calendar wins; on create the caller's default (the
  // isolated calendar, else the settings default) does, provided it is writable.
  const requestedCalendarId = initial.event?.calendarId ?? defaultCalendarId ?? "";
  const initialCalendarId = calendars.some(
    (root) => root.id === requestedCalendarId || root.children.some((child) => child.id === requestedCalendarId),
  )
    ? requestedCalendarId
    : fallbackCalendarId;

  const [title, setTitle] = useState(
    initial.event?.title ?? initial.pendingTitle ?? "",
  );
  const [calendarId, setCalendarId] = useState(initialCalendarId);

  // Calendars can finish loading after the dialog opens; fall back live instead
  // of freezing an empty selection into the form.
  const selectedCalendarId = calendarId || fallbackCalendarId;
  const [allDay, setAllDay] = useState(initial.event ? initial.event.allDay === 1 : initial.allDay);
  const [startDate, setStartDate] = useState(
    initial.event?.startDate ?? initialStart.date,
  );
  const [startTime, setStartTime] = useState(
    initial.event?.startAt ? utcToLocalWallTime(initial.event.startAt, timezone).split("T")[1]! : initialStart.time,
  );
  const [endDate, setEndDate] = useState(initial.event?.endDate ?? initialEnd.date);
  const [endTime, setEndTime] = useState(
    initial.event?.endAt ? utcToLocalWallTime(initial.event.endAt, timezone).split("T")[1]! : initialEnd.time,
  );
  const [initialRepeat] = useState<RepeatRule>(() => deriveRepeat(initialRule));
  const [repeat, setRepeat] = useState<RepeatRule>(initialRepeat);
  const [description, setDescription] = useState(initial.event?.description ?? "");
  const [location, setLocation] = useState(initial.event?.location ?? "");

  // Any field edit arms the unsaved-changes guard; a successful save disarms it.
  function markDirty(): void {
    onDirtyChange?.(true);
  }

  function buildPayload() {
    return buildEventPayload({
      title,
      calendarId: selectedCalendarId,
      description,
      location,
      allDay,
      startDate,
      startTime,
      endDate,
      endTime,
      repeat,
      initialRepeat,
      initialRule: initialRule ?? null,
      timezone,
    });
  }

  function finishSave(): void {
    updatePreferences.mutate({ lastEventCalendarId: selectedCalendarId });
    onDirtyChange?.(false);
    onClose();
  }

  function submit() {
    const onError = (error: Error) => toast.error(error.message);

    if (mode === "edit" && initial.event) {
      updateEvent.mutate(
        { id: initial.event.id, ...buildPayload() },
        { onSuccess: finishSave, onError },
      );
      return;
    }

    createEvent.mutate(buildPayload(), {
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
        finishSave();
      },
      onError,
    });
  }

  const isRecurringEdit = mode === "edit" && Boolean(initial.event?.rrule);
  const cancel = onCancel ?? onClose;

  return (
    <form
      className="flex max-h-[calc(100dvh-12rem)] flex-col gap-4 max-md:max-h-[calc(92dvh-9rem)]"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* Horizontal padding is load-bearing: `overflow-y-auto` clips at the
          padding box, and the focused field's 2px outline sits 2px outside its
          border box, so a flush-left field loses the left stroke of its ring. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="event-title">
            Title
          </label>
          <input
            id="event-title"
            value={title}
            autoFocus
            onChange={(event) => {
              setTitle(event.target.value);
              markDirty();
            }}
            className={CONTROL}
          />
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="event-calendar">
            Calendar
          </label>
          <CalendarPicker
            id="event-calendar"
            variant="field"
            calendars={calendars}
            value={selectedCalendarId}
            onChange={(nextId) => {
              setCalendarId(nextId);
              markDirty();
            }}
          />
        </div>

        <label className="flex items-center gap-2 text-base text-ink">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(event) => {
              setAllDay(event.target.checked);
              markDirty();
            }}
            className="h-4 w-4 rounded-sm border border-field accent-accent"
          />
          All day
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="event-start-date">
              Starts
            </label>
            <input
              id="event-start-date"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                markDirty();
              }}
              className={CONTROL}
            />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="event-end-date">
              Ends
            </label>
            <input
              id="event-end-date"
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                markDirty();
              }}
              className={CONTROL}
            />
          </div>
        </div>

        {!allDay ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="event-start-time">
                Start time
              </label>
              <input
                id="event-start-time"
                type="time"
                value={startTime}
                onChange={(event) => {
                  setStartTime(event.target.value);
                  markDirty();
                }}
                className={CONTROL}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="event-end-time">
                End time
              </label>
              <input
                id="event-end-time"
                type="time"
                value={endTime}
                onChange={(event) => {
                  setEndTime(event.target.value);
                  markDirty();
                }}
                className={CONTROL}
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          <label className={LABEL} htmlFor="event-repeat">
            Repeat
          </label>
          <select
            id="event-repeat"
            value={repeat}
            onChange={(event) => {
              setRepeat(event.target.value as RepeatRule);
              markDirty();
            }}
            className={CONTROL}
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="event-location">
            Location
          </label>
          <input
            id="event-location"
            value={location}
            onChange={(event) => {
              setLocation(event.target.value);
              markDirty();
            }}
            className={CONTROL}
          />
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="event-notes">
            Notes
          </label>
          <textarea
            id="event-notes"
            value={description}
            rows={2}
            onChange={(event) => {
              setDescription(event.target.value);
              markDirty();
            }}
            className={TEXTAREA}
          />
        </div>

        {isRecurringEdit ? (
          <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink">
            This event repeats. Saving changes every occurrence in the series.
          </p>
        ) : null}
      </div>

      {/* The footer is sticky on phones so Save is never below the fold (F26). */}
      <div
        className="flex justify-end gap-3 border-t border-line pt-3 max-md:sticky max-md:bottom-0 max-md:bg-surface"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Button variant="outline" type="button" onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={pending || title.trim().length === 0 || !selectedCalendarId}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
