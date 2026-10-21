"use client";

import type {
  CalendarRef,
  DateSelectInfo,
  DatesSetInfo,
  EventClickInfo,
  EventDropInfo,
  EventResizeDoneInfo,
} from "@fullcalendar/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useVisibilityApi } from "@/components/shell/VisibilityProvider";
import {
  PARENT_SHADE_INDEX,
  isHueFamily,
  shadeTokens,
  type HueFamily,
} from "@/lib/color/palette";
import { useCalendars } from "@/lib/query/calendars";
import { parseExdates } from "@/lib/query/eventCache";
import {
  useCreateEvent,
  useDeleteEvent,
  useEvents,
  useUpdateEvent,
  type EventInputPayload,
  type EventRange,
} from "@/lib/query/events";
import { usePreferences } from "@/lib/query/preferences";
import { expandOccurrences } from "@/lib/recurrence/expand";
import type { CalendarNode } from "@/lib/services/calendars";
import type { EventView } from "@/lib/services/events";
import { canWriteCalendar } from "@/lib/services/permissions";
import type { UserPreferences } from "@/lib/services/preferences";
import { formatOccurrenceWhen } from "@/lib/time/format";
import { addDaysToDate, utcToLocalDate, utcToLocalWallTime } from "@/lib/time/zone";
import { pushUndo, undoLast } from "@/lib/ui/undo";
import { useUndoHotkey } from "@/lib/ui/useUndoHotkey";
import { isCalendarVisible } from "@/lib/ui/visibility";
import { CalendarView, type RenderableOccurrence } from "./CalendarView";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { EventDialog, type EventDialogInitial } from "./EventDialog";
import { parseOccurrenceFcId } from "./toFcEvent";
import { Toolbar, type PlannerView } from "./Toolbar";

interface Props {
  timezone: string;
  currentUserId: string;
  weekStartsOn: number;
  preferences: UserPreferences;
}

type SelectInfo = DateSelectInfo & { start: Date; end: Date; allDay: boolean };
type DatesInfo = DatesSetInfo & {
  start: Date;
  end: Date;
  view: { title: string; type: string };
};
type DropInfo = (EventDropInfo | EventResizeDoneInfo) & {
  event: { id: string; start: Date | null; end: Date | null; allDay: boolean };
  revert: () => void;
};

interface EventSelection {
  eventId: string;
  occurrenceStart: string;
  anchorRect: DOMRect;
  anchorElement: HTMLElement | null;
}

const VIEW_TYPES: Record<string, PlannerView> = {
  dayGridMonth: "dayGridMonth",
  timeGridWeek: "timeGridWeek",
  timeGridDay: "timeGridDay",
  listMonth: "listMonth",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function familyOf(root: { hueFamily: string | null }): HueFamily {
  return root.hueFamily && isHueFamily(root.hueFamily) ? root.hueFamily : "slate";
}

function seriesStartWall(event: EventView, timezone: string): string {
  if (event.allDay === 1) {
    return `${event.startDate ?? utcToLocalDate(Date.now(), timezone)}T09:00`;
  }
  return event.startAt === null
    ? `${utcToLocalDate(Date.now(), timezone)}T09:00`
    : utcToLocalWallTime(event.startAt, timezone);
}

function seriesEndWall(event: EventView, timezone: string): string {
  if (event.allDay === 1) {
    return `${event.endDate ?? event.startDate ?? utcToLocalDate(Date.now(), timezone)}T10:00`;
  }
  return event.endAt === null
    ? `${utcToLocalDate(Date.now(), timezone)}T10:00`
    : utcToLocalWallTime(event.endAt, timezone);
}

/** Rebuilds the create payload from a row so an undo can restore it verbatim. */
function eventToPayload(event: EventView): EventInputPayload {
  return {
    calendarId: event.calendarId,
    title: event.title,
    description: event.description,
    location: event.location,
    allDay: event.allDay === 1,
    startAt: event.startAt,
    endAt: event.endAt,
    startDate: event.startDate,
    endDate: event.endDate,
    rrule: event.rrule,
    exdates: parseExdates(event.exdates),
  };
}

function occurrenceKey(event: EventView): string {
  return event.allDay === 1
    ? (event.startDate ?? "")
    : new Date(event.startAt ?? Date.now()).toISOString();
}

function undoToast(message: string): void {
  toast.success(message, {
    action: { label: "Undo", onClick: () => void undoLast() },
    duration: 10_000,
  });
}

export function CalendarShell({
  timezone,
  currentUserId,
  weekStartsOn,
  preferences: initialPreferences,
}: Props) {
  const visibility = useVisibilityApi();
  const { data: calendars } = useCalendars();
  const preferences = usePreferences(initialPreferences);
  const calendarRef = useRef<CalendarRef | null>(null);
  useUndoHotkey();

  const [view, setView] = useState<PlannerView>("dayGridMonth");
  const [label, setLabel] = useState("Calendar");
  const [range, setRange] = useState<EventRange | null>(null);
  const [dialog, setDialog] = useState<{
    mode: "create" | "edit";
    initial: EventDialogInitial;
    initialRule: string | null;
  } | null>(null);
  const [selection, setSelection] = useState<EventSelection | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    event: EventView;
    occurrenceStart: string;
  } | null>(null);

  const { data: events } = useEvents(range);
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const visibleCalendarIds = useMemo(() => {
    const ids = new Set<string>();
    for (const root of calendars ?? []) {
      const rootVisible = isCalendarVisible(visibility.state, root, currentUserId);
      if (rootVisible) {
        ids.add(root.id);
        for (const child of root.children) {
          if (isCalendarVisible(visibility.state, child, currentUserId, root)) {
            ids.add(child.id);
          }
        }
      }
    }
    return ids;
  }, [calendars, currentUserId, visibility.state]);

  const visibleEvents = useMemo(
    () => (events ?? []).filter((event) => visibleCalendarIds.has(event.calendarId)),
    [events, visibleCalendarIds],
  );

  const calendarNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const root of calendars ?? []) {
      names.set(root.id, root.name);
      for (const child of root.children) {
        names.set(child.id, child.name);
      }
    }
    return names;
  }, [calendars]);

  const readOnlyCalendarIds = useMemo(() => {
    const ids = new Set<string>();
    const viewer = { userId: currentUserId, householdId: "" };
    for (const root of calendars ?? []) {
      if (!canWriteCalendar(viewer, root)) {
        ids.add(root.id);
      }
      const rootEffective = {
        ownerId: root.ownerId,
        isViewOnlyForPartner: root.isViewOnlyForPartner,
      };
      for (const child of root.children) {
        // Fold the root's flags in: a protected parent protects its children.
        if (
          !canWriteCalendar(viewer, {
            ownerId: rootEffective.ownerId ?? child.ownerId,
            isViewOnlyForPartner: Math.max(
              rootEffective.isViewOnlyForPartner,
              child.isViewOnlyForPartner,
            ),
          })
        ) {
          ids.add(child.id);
        }
      }
    }
    return ids;
  }, [calendars, currentUserId]);

  const [nowAnchor] = useState(() => Date.now());

  const effectiveRange = useMemo<EventRange>(
    () =>
      range ?? {
        from: nowAnchor - 45 * DAY_MS,
        to: nowAnchor + 75 * DAY_MS,
      },
    [range, nowAnchor],
  );

  const occurrences = useMemo<RenderableOccurrence[]>(() => {
    const rendered: RenderableOccurrence[] = [];
    for (const event of visibleEvents) {
      for (const occurrence of expandOccurrences(event, effectiveRange, timezone)) {
        rendered.push({ occurrence, event });
      }
    }
    return rendered;
  }, [visibleEvents, effectiveRange, timezone]);

  const selectedEvent = selection
    ? (visibleEvents.find((event) => event.id === selection.eventId) ?? null)
    : null;
  const selectedIsReadOnly = selectedEvent
    ? readOnlyCalendarIds.has(selectedEvent.calendarId)
    : false;

  const selectedColor = useMemo(() => {
    if (!selectedEvent) {
      return "oklch(0.65 0.02 250)";
    }
    for (const root of calendars ?? []) {
      if (root.id === selectedEvent.calendarId) {
        return shadeTokens(familyOf(root), PARENT_SHADE_INDEX).mainHex;
      }
      const child = root.children.find((entry) => entry.id === selectedEvent.calendarId);
      if (child) {
        return shadeTokens(familyOf(root), child.shadeIndex).mainHex;
      }
    }
    return "oklch(0.65 0.02 250)";
  }, [calendars, selectedEvent]);

  const selectedCalendarName = selectedEvent
    ? (calendarNames.get(selectedEvent.calendarId) ?? "")
    : "";

  const writableCalendars = useMemo<CalendarNode[]>(
    () =>
      (calendars ?? [])
        .filter((root) => !readOnlyCalendarIds.has(root.id))
        .map((root) => ({
          ...root,
          children: root.children.filter((child) => !readOnlyCalendarIds.has(child.id)),
        })),
    [calendars, readOnlyCalendarIds],
  );

  // Every device starts on the month grid: the shell guarantees it fits the
  // viewport, so a phone no longer needs the taller agenda as its landing view.
  // Week, Day and List stay one tap away and scroll inside the calendar panel.

  function changeView(next: PlannerView) {
    calendarRef.current?.getApi().changeView(next);
    setView(next);
  }

  function openCreate(defaults?: { start: string; end: string; allDay: boolean }) {
    const today = utcToLocalDate(Date.now(), timezone);
    setDialog({
      mode: "create",
      initial: defaults ?? { start: `${today}T09:00`, end: `${today}T10:00`, allDay: false },
      initialRule: null,
    });
  }

  function openEdit(event: EventView, occurrenceStart: string) {
    setDialog({
      mode: "edit",
      initial: {
        event,
        start: seriesStartWall(event, timezone),
        end: seriesEndWall(event, timezone),
        allDay: event.allDay === 1,
      },
      initialRule: event.rrule,
    });
    void occurrenceStart;
  }

  function openDuplicate(event: EventView) {
    setDialog({
      mode: "create",
      initial: {
        event,
        start: seriesStartWall(event, timezone),
        end: seriesEndWall(event, timezone),
        allDay: event.allDay === 1,
      },
      // A duplicate starts a fresh series: copy the fields, not the rule.
      initialRule: null,
    });
  }

  function handleDatesSet(info: DatesInfo) {
    setLabel(info.view.title);
    const type = info.view.type;
    if (type && VIEW_TYPES[type]) {
      setView(VIEW_TYPES[type]!);
    }
    setRange({ from: info.start.getTime(), to: info.end.getTime() });
  }

  function handleSelect(info: SelectInfo) {
    if (info.allDay) {
      const startDate = utcToLocalDate(info.start.getTime(), timezone);
      const endDate = utcToLocalDate(new Date(info.end.getTime() - 1).getTime(), timezone);
      setDialog({
        mode: "create",
        initial: { start: `${startDate}T09:00`, end: `${endDate}T10:00`, allDay: true },
        initialRule: null,
      });
      return;
    }
    setDialog({
      mode: "create",
      initial: {
        start: utcToLocalWallTime(info.start.getTime(), timezone),
        end: utcToLocalWallTime(info.end.getTime(), timezone),
        allDay: false,
      },
      initialRule: null,
    });
  }

  function handleEventClick(info: EventClickInfo) {
    const parsed = parseOccurrenceFcId(info.event.id);
    if (!parsed) {
      return;
    }
    const event = visibleEvents.find((candidate) => candidate.id === parsed.eventId);
    if (!event) {
      return;
    }
    const element = info.el as HTMLElement;
    setSelection({
      eventId: event.id,
      occurrenceStart:
        (info.event.extendedProps.occurrenceStart as string | undefined) ?? parsed.startKey,
      anchorRect: element.getBoundingClientRect(),
      anchorElement: element,
    });
  }

  function handleEventMove(info: DropInfo) {
    const parsed = parseOccurrenceFcId(info.event.id);
    const base = parsed ? visibleEvents.find((event) => event.id === parsed.eventId) : undefined;
    if (!base) {
      return;
    }

    // Dragging one occurrence of a series would silently rewrite the series.
    if (base.rrule) {
      info.revert();
      toast("This event repeats. Edit the series to change its time.");
      return;
    }

    const previous: EventInputPayload = {
      allDay: base.allDay === 1,
      startAt: base.startAt,
      endAt: base.endAt,
      startDate: base.startDate,
      endDate: base.endDate,
    };

    const { start, end, allDay } = info.event;
    const payload = allDay
      ? {
          allDay: true,
          startDate: start ? utcToLocalDate(start.getTime(), timezone) : null,
          endDate: end
            ? addDaysToDate(utcToLocalDate(end.getTime(), timezone), -1)
            : start
              ? utcToLocalDate(start.getTime(), timezone)
              : null,
          startAt: null,
          endAt: null,
        }
      : {
          allDay: false,
          startAt: start ? start.getTime() : null,
          endAt: end ? end.getTime() : null,
          startDate: null,
          endDate: null,
        };

    updateEvent.mutate(
      { id: base.id, ...payload },
      {
        onSuccess: (result) => {
          pushUndo({
            label: "Move event",
            undo: async () => {
              await updateEvent.mutateAsync({ id: base.id, ...previous });
            },
          });
          undoToast(
            `Event moved to ${formatOccurrenceWhen(
              result.event,
              occurrenceKey(result.event),
              timezone,
              preferences.timeFormat,
            )}`,
          );
        },
        onError: (error) => {
          info.revert();
          toast.error(error.message);
        },
      },
    );
  }

  function requestDelete() {
    if (!selectedEvent || !selection) {
      return;
    }
    const event = selectedEvent;
    if (event.rrule) {
      setPendingDelete({ event, occurrenceStart: selection.occurrenceStart });
      return;
    }
    deleteEvent.mutate(
      { id: event.id, scope: "all" },
      {
        onSuccess: () => {
          pushUndo({
            label: "Delete event",
            undo: async () => {
              await createEvent.mutateAsync(eventToPayload(event));
            },
          });
          undoToast("Event deleted");
          setSelection(null);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function confirmSeriesDelete(scope: "all" | "this") {
    if (!pendingDelete) {
      return;
    }
    const { event, occurrenceStart } = pendingDelete;
    deleteEvent.mutate(
      {
        id: event.id,
        scope,
        occurrenceStart: scope === "this" ? occurrenceStart : undefined,
      },
      {
        onSuccess: () => {
          if (scope === "all") {
            pushUndo({
              label: "Delete series",
              undo: async () => {
                await createEvent.mutateAsync(eventToPayload(event));
              },
            });
            undoToast("Series deleted");
          } else {
            const remaining = parseExdates(event.exdates).filter(
              (key) => key !== occurrenceStart,
            );
            pushUndo({
              label: "Skip occurrence",
              undo: async () => {
                await updateEvent.mutateAsync({ id: event.id, exdates: remaining });
              },
            });
            undoToast("Occurrence skipped");
          }
          setPendingDelete(null);
          setSelection(null);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        label={label}
        view={view}
        onViewChange={changeView}
        onPrev={() => calendarRef.current?.getApi().prev()}
        onToday={() => calendarRef.current?.getApi().today()}
        onNext={() => calendarRef.current?.getApi().next()}
        onNewEvent={() => openCreate()}
      />

      <CalendarView
        calendarRef={calendarRef}
        timezone={timezone}
        timeFormat={preferences.timeFormat}
        firstDay={weekStartsOn}
        occurrences={occurrences}
        calendarNames={calendarNames}
        readOnlyCalendarIds={readOnlyCalendarIds}
        onDatesSet={handleDatesSet as (info: DatesSetInfo) => void}
        onSelect={handleSelect as (info: DateSelectInfo) => void}
        onEventClick={handleEventClick}
        onEventMove={handleEventMove as never}
      />

      {dialog ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setDialog(null))}>
          <DialogContent
            title={dialog.mode === "edit" ? "Edit event" : "New event"}
            description={`Times are in ${timezone.replace("_", " ")}.`}
          >
            <EventDialog
              mode={dialog.mode}
              initial={dialog.initial}
              initialRule={dialog.initialRule}
              timezone={timezone}
              calendars={writableCalendars}
              onClose={() => setDialog(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {selectedEvent && selection ? (
        <EventDetailsPopover
          event={selectedEvent}
          calendarName={selectedCalendarName}
          color={selectedColor}
          timezone={timezone}
          timeFormat={preferences.timeFormat}
          occurrenceStart={selection.occurrenceStart}
          readOnly={selectedIsReadOnly}
          anchorRect={selection.anchorRect}
          anchorElement={selection.anchorElement}
          onEdit={() => {
            openEdit(selectedEvent, selection.occurrenceStart);
            setSelection(null);
          }}
          onDuplicate={() => {
            openDuplicate(selectedEvent);
            setSelection(null);
          }}
          onDelete={requestDelete}
          onClose={() => setSelection(null)}
        />
      ) : null}

      {pendingDelete ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}>
          <DialogContent
            title="Delete repeating event"
            description="This event repeats. Skip only this one, or delete the series?"
          >
            <div className="flex flex-col gap-2">
              <Button onClick={() => confirmSeriesDelete("this")}>This event</Button>
              <Button variant="primary" onClick={() => confirmSeriesDelete("all")}>
                All events
              </Button>
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
