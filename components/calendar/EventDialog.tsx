"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CalendarNode } from "@/lib/services/calendars";
import type { EventView } from "@/lib/services/events";
import { useCreateEvent, useDeleteEvent, useUpdateEvent, type EventInputPayload } from "@/lib/query/events";
import { pushUndo, undoLast } from "@/lib/ui/undo";
import { addDaysToDate, localWallTimeToUtc, utcToLocalWallTime } from "@/lib/time/zone";

export type RepeatRule = "none" | "daily" | "weekly" | "monthly" | "yearly";

const REPEAT_OPTIONS: Array<{ value: RepeatRule; label: string }> = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const RRULE_BY_REPEAT: Record<Exclude<RepeatRule, "none">, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

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
}

interface Props {
  mode: "create" | "edit";
  initial: EventDialogInitial;
  /** The existing series rule on edit; preserved verbatim unless the user changes Repeat. */
  initialRule?: string | null;
  timezone: string;
  calendars: CalendarNode[];
  onClose: () => void;
}

function deriveRepeat(rule: string | null | undefined): RepeatRule {
  const value = rule ?? "";
  if (value.includes("FREQ=DAILY")) return "daily";
  if (value.includes("FREQ=WEEKLY")) return "weekly";
  if (value.includes("FREQ=MONTHLY")) return "monthly";
  if (value.includes("FREQ=YEARLY")) return "yearly";
  return "none";
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
  onClose,
}: Props) {
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const pending = createEvent.isPending || updateEvent.isPending;

  const initialStart = splitWall(initial.start);
  const initialEnd = splitWall(initial.end);

  const writableCalendars = calendars.flatMap((root) => [root, ...root.children]);
  const fallbackCalendarId = writableCalendars[0]?.id ?? "";

  const [title, setTitle] = useState(initial.event?.title ?? "");
  const [calendarId, setCalendarId] = useState(
    initial.event?.calendarId ?? fallbackCalendarId,
  );

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

  function buildPayload(): EventInputPayload {
    const repeatChanged = repeat !== initialRepeat;
    const payload: EventInputPayload = {
      title,
      calendarId: selectedCalendarId,
      description: description.trim() ? description : null,
      location: location.trim() ? location : null,
      allDay,
      // Preserve the exact stored rule (BYDAY, INTERVAL, COUNT…) unless the user
      // actually changed the Repeat control.
      rrule: !repeatChanged && initialRule ? initialRule : repeat === "none" ? null : RRULE_BY_REPEAT[repeat],
    };

    if (allDay) {
      payload.startDate = startDate;
      payload.endDate = endDate < startDate ? startDate : endDate;
      payload.startAt = null;
      payload.endAt = null;
    } else {
      payload.startAt = localWallTimeToUtc(`${startDate}T${startTime}`, timezone);
      payload.endAt = localWallTimeToUtc(`${endDate}T${endTime}`, timezone);
      payload.startDate = null;
      payload.endDate = null;
    }
    return payload;
  }

  function submit() {
    const onError = (error: Error) => toast.error(error.message);

    if (mode === "edit" && initial.event) {
      updateEvent.mutate(
        { id: initial.event.id, ...buildPayload() },
        { onSuccess: () => { toast.success("Event updated"); onClose(); }, onError },
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
        onClose();
      },
      onError,
    });
  }

  const isRecurringEdit = mode === "edit" && Boolean(initial.event?.rrule);

  return (
    <form
      className="max-h-[calc(100dvh-12rem)] space-y-4 overflow-y-auto pr-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="space-y-1">
        <label className={LABEL} htmlFor="event-title">
          Title
        </label>
        <input
          id="event-title"
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          className={CONTROL}
        />
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="event-calendar">
          Calendar
        </label>
        <select
          id="event-calendar"
          value={selectedCalendarId}
          onChange={(event) => setCalendarId(event.target.value)}
          className={CONTROL}
        >
          {writableCalendars.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.name}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-base text-ink">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(event) => setAllDay(event.target.checked)}
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
            onChange={(event) => setStartDate(event.target.value)}
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
            onChange={(event) => setEndDate(event.target.value)}
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
              onChange={(event) => setStartTime(event.target.value)}
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
              onChange={(event) => setEndTime(event.target.value)}
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
          onChange={(event) => setRepeat(event.target.value as RepeatRule)}
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
          onChange={(event) => setLocation(event.target.value)}
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
          onChange={(event) => setDescription(event.target.value)}
          className={TEXTAREA}
        />
      </div>

      {isRecurringEdit ? (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink">
          This event repeats. Saving changes every occurrence in the series.
        </p>
      ) : null}

      <div className="flex justify-end gap-3 pt-1">
        <Button variant="outline" onClick={onClose}>
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

/** Helper for the shell: builds a sensible default range for a new event. */
export function defaultEventRange(
  startDate: string,
  endDate?: string,
): { start: string; end: string } {
  return {
    start: `${startDate}T09:00`,
    end: `${endDate ?? addDaysToDate(startDate, 0)}T10:00`,
  };
}
