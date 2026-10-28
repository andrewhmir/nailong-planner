"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CollectionNode } from "@/lib/services/collections";
import type { EventView } from "@/lib/services/events";
import type { TimeFormat } from "@/lib/services/preferences";
import {
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
  type EventInputPayload,
} from "@/lib/query/events";
import { useUpdatePreferences } from "@/lib/query/preferences";
import { utcToLocalDate, utcToLocalWallTime } from "@/lib/time/zone";
import { pushUndo } from "@/lib/ui/undo";
import { undoToast } from "@/lib/ui/undoToast";
import { describeRrule } from "@/lib/recurrence/label";
import {
  anchorRepeat,
  formatRepeatRule,
  monthlyAnchor,
  newRepeatOptions,
  parseRepeatRule,
  validateRepeat,
  weekStartOf,
  weekdayOfDate,
  type Frequency,
  type RepeatOptions,
} from "@/lib/recurrence/rule";
import {
  buildEventPayload,
  deriveRepeat,
} from "./eventPayload";
import { CalendarPicker } from "./CalendarPicker";
import { DateField } from "./DateField";
import { RecurrenceFields } from "./RecurrenceFields";
import { TimeField } from "./TimeField";

// Canvas form controls (§7): 38px box, 1px field border, 4px radius, 16px text.
// This is a copy of the settings field recipe (SettingsForm.tsx), not a shared
// import. No `outline-none`: Tailwind v4 compiles it to `--tw-outline-style:
// none`, which `outline-2` reads back, collapsing the focus ring.
const CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const TEXTAREA =
  "w-full rounded-md border border-field bg-surface px-3 py-2 text-base text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LABEL = "block text-base text-ink";

export interface EventDialogInitial {
  event?: EventView;
  /** The occurrence that was clicked (a local date or an ISO instant). */
  occurrenceStart?: string;
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
  /** The household's 12/24-hour preference: the time control renders it. */
  timeFormat: TimeFormat;
  /** Household week start (0 = Sunday), so the weekday picker matches the grid. */
  weekStartsOn: number;
  collections: CollectionNode[];
  /** Where a new event starts unless the user picks otherwise ("only this calendar"). */
  defaultCollectionId?: string | null;
  /** Success or programmatic close (dirty state is dropped). */
  onClose: () => void;
  /** User asked to close; the shell runs the unsaved-changes guard. */
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Recurring edits go through the shell, which asks for the scope before it
   * writes. Absent means the dialog performs the plain series PATCH itself.
   */
  onSaveRequest?: (
    payload: EventInputPayload,
    meta: { repeatTouched: boolean },
  ) => void;
  /** A scoped save (owned by the shell) is in flight; keep Save disabled. */
  externalPending?: boolean;
}

function splitWall(wall: string): { date: string; time: string } {
  const [date = "", time = "09:00"] = wall.split("T");
  return { date, time };
}

/** True when a weekly rule selects exactly Monday–Friday. */
function isWeekdaySelection(weekdays: number[]): boolean {
  return weekdays.length === 5 && [1, 2, 3, 4, 5].every((day) => weekdays.includes(day));
}

export function EventDialog({
  mode,
  initial,
  initialRule,
  timezone,
  timeFormat,
  weekStartsOn,
  collections,
  defaultCollectionId,
  onClose,
  onCancel,
  onDirtyChange,
  onSaveRequest,
  externalPending = false,
}: Props) {
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const updatePreferences = useUpdatePreferences();
  const pending = createEvent.isPending || updateEvent.isPending || externalPending;

  const initialStart = splitWall(initial.start);
  const initialEnd = splitWall(initial.end);
  // Household-local "today", so both month pickers ring the same day the grid
  // does instead of the device's day. Frozen at open, like the shell's anchors.
  const [today] = useState(() => utcToLocalDate(Date.now(), timezone));

  // Events live in calendars; a list is never a valid target. Filtering here as
  // well as in the shell keeps the fallback and the picker calendar-only even
  // if a caller hands this dialog the mixed tree.
  const calendars = useMemo(
    () => collections.filter((root) => root.kind === "calendar"),
    [collections],
  );

  const fallbackCollectionId = calendars[0]?.id ?? "";
  // On edit the event's own calendar wins; on create the caller's default (the
  // isolated calendar, else the settings default) does, provided it is writable.
  const requestedCollectionId = initial.event?.collectionId ?? defaultCollectionId ?? "";
  const initialCollectionId = calendars.some(
    (root) => root.id === requestedCollectionId || root.children.some((child) => child.id === requestedCollectionId),
  )
    ? requestedCollectionId
    : fallbackCollectionId;

  const [title, setTitle] = useState(
    initial.event?.title ?? initial.pendingTitle ?? "",
  );
  const [collectionId, setCollectionId] = useState(initialCollectionId);

  // Calendars can finish loading after the dialog opens; fall back live instead
  // of freezing an empty selection into the form.
  const selectedCollectionId = collectionId || fallbackCollectionId;
  // Repeating events open on the clicked occurrence, not on the series' first
  // block; non-recurring rows and creates seed from the event/initial walls.
  const occurrenceSeeded = Boolean(initial.occurrenceStart);
  const initialAllDay = occurrenceSeeded
    ? initial.allDay
    : initial.event
      ? initial.event.allDay === 1
      : initial.allDay;
  const initialStartDate = occurrenceSeeded
    ? initialStart.date
    : (initial.event?.startDate ?? initialStart.date);
  const [allDay, setAllDay] = useState(initialAllDay);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [startTime, setStartTime] = useState(
    occurrenceSeeded
      ? initialStart.time
      : initial.event?.startAt
        ? utcToLocalWallTime(initial.event.startAt, timezone).split("T")[1]!
        : initialStart.time,
  );
  const [endDate, setEndDate] = useState(
    occurrenceSeeded ? initialEnd.date : (initial.event?.endDate ?? initialEnd.date),
  );
  const [endTime, setEndTime] = useState(
    occurrenceSeeded
      ? initialEnd.time
      : initial.event?.endAt
        ? utcToLocalWallTime(initial.event.endAt, timezone).split("T")[1]!
        : initialEnd.time,
  );
  // The stored rule parsed into the structured editor. Null when the editor
  // cannot represent it — its text is then kept verbatim until Repeat changes.
  const [initialParse] = useState(() =>
    initialRule
      ? parseRepeatRule(initialRule, initialStartDate, { allDay: initialAllDay, timezone })
      : null,
  );
  const [recurrence, setRecurrence] = useState<RepeatOptions | null>(initialParse ?? null);
  const [repeatTouched, setRepeatTouched] = useState(false);
  const [description, setDescription] = useState(initial.event?.description ?? "");
  const [location, setLocation] = useState(initial.event?.location ?? "");

  const weekStart = weekStartOf(weekStartsOn);
  // The stored rule reaches the server byte-identical only while the controls
  // still describe it; any repeat edit (or a moved DTSTART / all-day switch)
  // rebuilds it from the structured state.
  const keepInitialRule =
    Boolean(initialRule) && !repeatTouched && startDate === initialStartDate && allDay === initialAllDay;
  const repeatError = recurrence
    ? validateRepeat(recurrence, startDate, { allDay, timezone })
    : null;

  const presetLabels = useMemo(() => {
    const context = { allDay, timezone };
    const label = (candidate: RepeatOptions) =>
      describeRrule(
        formatRepeatRule({ ...candidate, end: { mode: "never" } }, startDate, context),
        context,
      );
    const base = (frequency: Frequency) =>
      recurrence?.frequency === frequency
        ? recurrence
        : newRepeatOptions(frequency, startDate, weekStart);
    return {
      daily: label(base("DAILY")),
      weekly: label(base("WEEKLY")),
      monthly: label(base("MONTHLY")),
      yearly: label(base("YEARLY")),
    };
  }, [recurrence, startDate, allDay, timezone, weekStart]);

  function changeRepeatPreset(next: string): void {
    setRepeatTouched(true);
    markDirty();
    if (next === "none") {
      setRecurrence(null);
      return;
    }
    const base = recurrence ?? newRepeatOptions("WEEKLY", startDate, weekStart);
    if (next === "weekdays") {
      setRecurrence({ ...base, frequency: "WEEKLY", weekdays: [1, 2, 3, 4, 5] });
      return;
    }
    const frequency = next.toUpperCase() as Frequency;
    setRecurrence({
      ...base,
      frequency,
      weekdays: base.weekdays.length > 0 ? base.weekdays : [weekdayOfDate(startDate)],
      monthly:
        frequency === "MONTHLY" && recurrence?.frequency !== "MONTHLY"
          ? monthlyAnchor(startDate)
          : base.monthly,
    });
  }

  function changeRecurrence(next: RepeatOptions): void {
    setRepeatTouched(true);
    markDirty();
    setRecurrence(next);
  }

  const repeatValue = recurrence
    ? recurrence.frequency === "WEEKLY" && isWeekdaySelection(recurrence.weekdays)
      ? "weekdays"
      : recurrence.frequency.toLowerCase()
    : initialRule
      ? deriveRepeat(initialRule)
      : "none";

  // Any field edit arms the unsaved-changes guard; a successful save disarms it.
  function markDirty(): void {
    onDirtyChange?.(true);
  }

  function buildPayload() {
    return buildEventPayload({
      title,
      collectionId: selectedCollectionId,
      description,
      location,
      allDay,
      startDate,
      startTime,
      endDate,
      endTime,
      recurrence,
      keepInitialRule,
      initialRule: initialRule ?? null,
      timezone,
    });
  }

  function finishSave(): void {
    updatePreferences.mutate({ lastEventCalendarId: selectedCollectionId });
    onDirtyChange?.(false);
    onClose();
  }

  function submit() {
    const onError = (error: Error) => toast.error(error.message);

    if (mode === "edit" && initial.event) {
      const payload = buildPayload();
      if (onSaveRequest) {
        // The shell asks for the recurring scope before it writes.
        onSaveRequest(payload, { repeatTouched });
        return;
      }
      updateEvent.mutate(
        { id: initial.event.id, ...payload },
        { onSuccess: finishSave, onError },
      );
      return;
    }

    createEvent.mutate(buildPayload(), {
      onSuccess: ({ event }) => {
        const handle = pushUndo({
          label: "Create event",
          undo: async () => {
            await deleteEvent.mutateAsync({ id: event.id, scope: "all" });
          },
        });
        undoToast("Event created", handle);
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
            collections={calendars}
            value={selectedCollectionId}
            onChange={(nextId) => {
              setCollectionId(nextId);
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
            <DateField
              id="event-start-date"
              label="Starts"
              value={startDate}
              today={today}
              onChange={(date) => {
                setStartDate(date);
                markDirty();
                // Moving DTSTART re-anchors an uncustomised weekly/monthly
                // pattern, so the saved start date is always an occurrence.
                if (recurrence && !repeatTouched) {
                  setRecurrence(anchorRepeat(recurrence, date));
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="event-end-date">
              Ends
            </label>
            <DateField
              id="event-end-date"
              label="Ends"
              value={endDate}
              today={today}
              onChange={(date) => {
                setEndDate(date);
                markDirty();
              }}
            />
          </div>
        </div>

        {!allDay ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="event-start-time">
                Start time
              </label>
              <TimeField
                id="event-start-time"
                label="Start time"
                value={startTime}
                timeFormat={timeFormat}
                timezone={timezone}
                onChange={(time) => {
                  setStartTime(time);
                  markDirty();
                }}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="event-end-time">
                End time
              </label>
              <TimeField
                id="event-end-time"
                label="End time"
                value={endTime}
                timeFormat={timeFormat}
                timezone={timezone}
                onChange={(time) => {
                  setEndTime(time);
                  markDirty();
                }}
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
            value={repeatValue}
            onChange={(event) => changeRepeatPreset(event.target.value)}
            className={CONTROL}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">{presetLabels.daily}</option>
            <option value="weekdays">Every weekday (Monday to Friday)</option>
            <option value="weekly">{presetLabels.weekly}</option>
            <option value="monthly">{presetLabels.monthly}</option>
            <option value="yearly">{presetLabels.yearly}</option>
          </select>
        </div>

        {recurrence ? (
          <RecurrenceFields
            value={recurrence}
            startDate={startDate}
            allDay={allDay}
            timezone={timezone}
            weekStartsOn={weekStartsOn}
            today={today}
            error={repeatError}
            onChange={changeRecurrence}
          />
        ) : initialRule && !initialParse ? (
          <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink">
            This series uses a repeat rule the editor can’t display. Its stored rule is kept
            unless you change Repeat.
          </p>
        ) : null}

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
            This event repeats. When you save, choose whether the change applies to this event,
            this and following events, or the whole series.
          </p>
        ) : null}
      </div>

      {/* The footer is sticky at every size so Save stays reachable above an open keyboard (F26). */}
      <div
        className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-surface pt-3"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Button variant="outline" type="button" onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={pending || title.trim().length === 0 || !selectedCollectionId || Boolean(repeatError)}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
