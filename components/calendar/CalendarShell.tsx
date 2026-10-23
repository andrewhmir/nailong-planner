"use client";

import type {
  CalendarRef,
  DateClickInfo,
  DateSelectInfo,
  DatesSetInfo,
  EventClickInfo,
  EventDropInfo,
  EventResizeDoneInfo,
} from "@fullcalendar/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { readLastView, writeLastView } from "@/lib/ui/lastView";
import { focusSearch, onEventLink } from "@/lib/ui/searchBus";
import { pushUndo, undoLast } from "@/lib/ui/undo";
import { useKeyboardShortcuts } from "@/lib/ui/useKeyboardShortcuts";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { useUndoHotkey } from "@/lib/ui/useUndoHotkey";
import { resolveInitialView } from "@/lib/ui/view";
import { visibleCalendarIds } from "@/lib/ui/visibleCalendars";
import { CalendarView, type RenderableOccurrence } from "./CalendarView";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { EventDialog, type EventDialogInitial } from "./EventDialog";
import { QuickCreatePopover, type QuickCreateDraft } from "./QuickCreatePopover";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";
import {
  defaultRangeForDate,
  defaultRangeFromSelection,
} from "./quickCreateDefaults";
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

interface EventDialogState {
  mode: "create" | "edit";
  initial: EventDialogInitial;
  initialRule: string | null;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledLinkRef = useRef<string | null>(null);
  useUndoHotkey();

  const [view, setView] = useState<PlannerView>("dayGridMonth");
  const [label, setLabel] = useState("Calendar");
  const [anchorDate, setAnchorDate] = useState(() => utcToLocalDate(Date.now(), timezone));
  const narrow = useMediaQuery("(max-width: 767px)");
  // Open the week/day grid around "now" instead of 06:00 (F30).
  const [scrollTime] = useState(
    () => `${utcToLocalWallTime(Date.now(), timezone).slice(11)}:00`,
  );
  const viewChosenByUser = useRef(false);
  const [range, setRange] = useState<EventRange | null>(null);
  const [dialog, setDialog] = useState<EventDialogState | null>(null);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [quickDraft, setQuickDraft] = useState<QuickCreateDraft | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [selection, setSelection] = useState<EventSelection | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    event: EventView;
    occurrenceStart: string;
  } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);
  // Bumped by every surface that replaces the details popover. The search deep
  // link lands asynchronously (it polls for the event block), so the poll needs
  // to know whether the user opened something *after* picking the result: the
  // most recent action wins instead of stacking two popups.
  const overlaySeqRef = useRef(0);
  const linkSeqRef = useRef<{ key: string; seq: number } | null>(null);

  // The search box announces the click before it navigates, so the baseline is
  // the click, not the moment `useSearchParams()` finally reflects the URL.
  useEffect(
    () =>
      onEventLink(({ date, eventId }) => {
        linkSeqRef.current = { key: `${date}|${eventId}`, seq: overlaySeqRef.current };
      }),
    [],
  );

  const { data: events } = useEvents(range);
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const visibleIds = useMemo(
    () =>
      visibleCalendarIds(
        (calendars ?? []) as CalendarNode[],
        visibility.state,
        currentUserId,
      ),
    [calendars, currentUserId, visibility.state],
  );

  const visibleEvents = useMemo(
    () => (events ?? []).filter((event) => visibleIds.has(event.calendarId)),
    [events, visibleIds],
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

  // Search results navigate here as `/?date=…&event=…`: move the grid, wait for
  // the range to load the event, then open its details anchored to its block.
  useEffect(() => {
    const dateParam = searchParams.get("date");
    const eventParam = searchParams.get("event");
    if (!dateParam && !eventParam) {
      return;
    }
    const linkKey = `${dateParam ?? ""}|${eventParam ?? ""}`;
    if (handledLinkRef.current === linkKey) {
      return;
    }
    // Re-runs caused by `visibleEvents` changes must keep the baseline taken when
    // the result was clicked, or a surface opened mid-poll would look "newer".
    if (linkSeqRef.current?.key !== linkKey) {
      linkSeqRef.current = { key: linkKey, seq: overlaySeqRef.current };
    }
    const linkSeq = linkSeqRef.current.seq;
    if (dateParam) {
      calendarRef.current?.getApi().gotoDate(dateParam);
    }
    if (!eventParam) {
      handledLinkRef.current = linkKey;
      return;
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      // The user started a new event / delete prompt after picking the result:
      // their newer surface wins, so drop the deep link instead of stacking
      // details on top of it.
      if (overlaySeqRef.current !== linkSeq) {
        window.clearInterval(timer);
        handledLinkRef.current = linkKey;
        router.replace("/", { scroll: false });
        return;
      }
      const element = document.querySelector<HTMLElement>(
        `[data-event-id="${CSS.escape(eventParam)}"]`,
      );
      const target = visibleEvents.find((candidate) => candidate.id === eventParam);
      if (element && target) {
        window.clearInterval(timer);
        handledLinkRef.current = linkKey;
        // The result click is the newest action: it supersedes a quick-create
        // bubble that was already up (the bubble also dismisses itself on an
        // outside click, but this covers the same render).
        setQuickDraft(null);
        setSelection({
          eventId: target.id,
          occurrenceStart:
            element.dataset.occurrenceStart ??
            (target.allDay === 1
              ? (target.startDate ?? "")
              : new Date(target.startAt ?? Date.now()).toISOString()),
          anchorRect: element.getBoundingClientRect(),
          anchorElement: element,
        });
        router.replace("/", { scroll: false });
        return;
      }
      if (attempts > 100) {
        window.clearInterval(timer);
        handledLinkRef.current = linkKey;
        router.replace("/", { scroll: false });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [searchParams, visibleEvents, router]);

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

  // "Display only this calendar" also sets where new events land — but only
  // when that calendar is writable; isolating a view-only one leaves creation
  // on the settings default.
  const defaultEventCalendarId = useMemo(() => {
    const only = visibility.state.only;
    if (only) {
      const writable = writableCalendars.some(
        (root) => root.id === only || root.children.some((child) => child.id === only),
      );
      if (writable) {
        return only;
      }
    }
    return preferences.lastEventCalendarId;
  }, [preferences.lastEventCalendarId, visibility.state.only, writableCalendars]);

  function changeView(next: PlannerView) {
    viewChosenByUser.current = true;
    calendarRef.current?.getApi().changeView(next);
    setView(next);
    writeLastView(currentUserId, next);
  }

  function jumpToDate(date: string): void {
    calendarRef.current?.getApi().gotoDate(date);
  }

  // First visit: the device's last view, else the preference (`auto` resolves to
  // the agenda on phones). Re-runs while the user has not picked a view yet so
  // the phone/desktop media query can settle after hydration.
  useEffect(() => {
    if (viewChosenByUser.current) {
      return;
    }
    const desired =
      readLastView(currentUserId) ?? resolveInitialView(preferences.defaultView, narrow);
    if (desired === view) {
      return;
    }
    // FullCalendar echoes the change back through `datesSet`, which owns state.
    calendarRef.current?.getApi().changeView(desired);
  }, [currentUserId, narrow, preferences.defaultView, view]);

  function rememberOpener(): void {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function openDialog(next: EventDialogState, dirty = false): void {
    rememberOpener();
    overlaySeqRef.current += 1;
    setDialogDirty(dirty);
    setQuickDraft(null);
    // One surface at a time: never leave the details popover under the form.
    setSelection(null);
    setDialog(next);
  }

  function openCreate() {
    const today = utcToLocalDate(Date.now(), timezone);
    openDialog({
      mode: "create",
      initial: { start: `${today}T09:00`, end: `${today}T10:00`, allDay: false },
      initialRule: null,
    });
  }

  function openEdit(event: EventView) {
    openDialog({
      mode: "edit",
      initial: {
        event,
        start: seriesStartWall(event, timezone),
        end: seriesEndWall(event, timezone),
        allDay: event.allDay === 1,
      },
      initialRule: event.rrule,
    });
  }

  function openDuplicate(event: EventView) {
    openDialog({
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

  function finishCloseDialog(): void {
    setDialog(null);
    setConfirmDiscard(false);
    setDialogDirty(false);
    openerRef.current?.focus();
    openerRef.current = null;
  }

  /** Close request from Escape, an outside click, Cancel or the X. */
  function requestCloseDialog(): void {
    if (dialogDirty) {
      setConfirmDiscard(true);
      return;
    }
    finishCloseDialog();
  }

  function keepEditing(): void {
    setConfirmDiscard(false);
  }

  function discardChanges(): void {
    finishCloseDialog();
  }

  function openQuickCreate(draft: QuickCreateDraft): void {
    overlaySeqRef.current += 1;
    setDialog(null);
    // Clicking the grid to create dismisses the details popover even if its
    // Radix outside-interaction did not fire.
    setSelection(null);
    setQuickDraft(draft);
  }

  function openQuickAtCentre(): void {
    const today = utcToLocalDate(Date.now(), timezone);
    openQuickCreate({
      ...defaultRangeForDate(today, null, new Date(), timezone),
      dateWall: today,
      anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    });
  }

  function handleMoreOptions(values: {
    title: string;
    calendarId: string;
    startWall: string;
    endWall: string;
    allDay: boolean;
  }): void {
    openDialog(
      {
        mode: "create",
        initial: {
          start: values.startWall,
          end: values.endWall,
          allDay: values.allDay,
          pendingTitle: values.title,
        },
        initialRule: null,
      },
      // The typed title must not be lost silently.
      values.title.trim().length > 0,
    );
  }

  function handleDatesSet(info: DatesInfo) {
    setLabel(info.view.title);
    setAnchorDate(utcToLocalDate(info.view.currentStart.getTime(), timezone));
    const type = info.view.type;
    if (type && VIEW_TYPES[type]) {
      setView(VIEW_TYPES[type]!);
    }
    setRange({ from: info.start.getTime(), to: info.end.getTime() });
  }

  function handleDateClick(info: DateClickInfo) {
    const dateWall = utcToLocalDate(info.date.getTime(), timezone);
    const timeWall = info.allDay
      ? null
      : utcToLocalWallTime(info.date.getTime(), timezone).slice(11);
    const pointer = info.jsEvent;
    openQuickCreate({
      ...defaultRangeForDate(dateWall, timeWall, new Date(), timezone),
      dateWall,
      anchor: {
        x: pointer?.clientX ?? window.innerWidth / 2,
        y: pointer?.clientY ?? window.innerHeight / 2,
      },
    });
  }

  function handleSelect(info: SelectInfo) {
    const selectionRange = defaultRangeFromSelection(
      info.start.getTime(),
      info.end.getTime(),
      info.allDay,
      timezone,
    );
    const pointer = info.jsEvent as MouseEvent | null;
    openQuickCreate({
      ...selectionRange,
      dateWall: selectionRange.startWall.slice(0, 10),
      anchor: {
        x: pointer?.clientX ?? window.innerWidth / 2,
        y: pointer?.clientY ?? window.innerHeight / 2,
      },
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
    // Clicking an event supersedes a quick-create bubble: the bubble dismisses
    // itself on the pointerdown, and this keeps the state change explicit.
    overlaySeqRef.current += 1;
    setQuickDraft(null);
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

  function focusedEvent(): { event: EventView; occurrenceStart: string } | null {
    const element =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>("[data-event-id]")
        : null;
    const id = element?.dataset.eventId;
    const event = id
      ? visibleEvents.find((candidate) => candidate.id === id)
      : undefined;
    if (!event) {
      return null;
    }
    return {
      event,
      occurrenceStart:
        element?.dataset.occurrenceStart ??
        (event.allDay === 1
          ? (event.startDate ?? "")
          : new Date(event.startAt ?? Date.now()).toISOString()),
    };
  }

  function requestDeleteFor(event: EventView, occurrenceStart: string) {
    if (event.rrule) {
      // The scope prompt replaces the details popover; it must not sit under it.
      overlaySeqRef.current += 1;
      setSelection(null);
      setPendingDelete({ event, occurrenceStart });
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
          setAnnouncement("Event deleted, press z to undo");
          setSelection(null);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function requestDelete() {
    if (!selectedEvent || !selection) {
      return;
    }
    requestDeleteFor(selectedEvent, selection.occurrenceStart);
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

  // Mounted once: the hook reads the latest handlers through a ref.
  useKeyboardShortcuts(preferences.shortcutsEnabled, {
    onCreateFull: openCreate,
    onCreateAtCursor: openQuickAtCentre,
    onFocusSearch: focusSearch,
    onToday: () => calendarRef.current?.getApi().today(),
    onView: changeView,
    onPeriod: (direction) => {
      if (direction === 1) {
        calendarRef.current?.getApi().next();
      } else {
        calendarRef.current?.getApi().prev();
      }
    },
    onEditSelected: () => {
      const target = focusedEvent();
      if (target) {
        openEdit(target.event);
        setSelection(null);
        return;
      }
      if (selectedEvent && selection) {
        openEdit(selectedEvent);
        setSelection(null);
      }
    },
    onDeleteSelected: () => {
      const target = focusedEvent();
      if (target) {
        requestDeleteFor(target.event, target.occurrenceStart);
        gridRef.current?.focus();
        return;
      }
      if (selectedEvent && selection) {
        requestDeleteFor(selectedEvent, selection.occurrenceStart);
        gridRef.current?.focus();
      }
    },
    onHelp: () => {
      overlaySeqRef.current += 1;
      setHelpOpen(true);
    },
    onEscape: () => {
      if (selection) {
        setSelection(null);
      } else if (quickDraft) {
        setQuickDraft(null);
      }
    },
  });

  return (
    <section
      ref={gridRef}
      tabIndex={-1}
      aria-label="Calendar"
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <Toolbar
        label={label}
        view={view}
        anchorDate={anchorDate}
        onJumpToDate={jumpToDate}
        onViewChange={changeView}
        onPrev={() => calendarRef.current?.getApi().prev()}
        onToday={() => calendarRef.current?.getApi().today()}
        onNext={() => calendarRef.current?.getApi().next()}
        onNewEvent={openCreate}
        onShowShortcuts={() => setHelpOpen(true)}
      />

      <CalendarView
        calendarRef={calendarRef}
        timezone={timezone}
        timeFormat={preferences.timeFormat}
        showWeekNumbers={preferences.showWeekNumbers}
        scrollTime={scrollTime}
        firstDay={weekStartsOn}
        occurrences={occurrences}
        calendarNames={calendarNames}
        readOnlyCalendarIds={readOnlyCalendarIds}
        onDatesSet={handleDatesSet as (info: DatesSetInfo) => void}
        onDateClick={handleDateClick}
        onSelect={handleSelect as (info: DateSelectInfo) => void}
        onEventClick={handleEventClick}
        onEventMove={handleEventMove as never}
      />

      {/* Phones create from here: the toolbar's + Event is md-and-up. */}
      <button
        type="button"
        aria-label="New event"
        onClick={openQuickAtCentre}
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        className="fixed right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-accent text-2xl leading-none text-white shadow-dialog md:hidden"
      >
        +
      </button>

      <ShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      {quickDraft ? (
        <QuickCreatePopover
          draft={quickDraft}
          calendars={writableCalendars}
          defaultCalendarId={defaultEventCalendarId}
          timezone={timezone}
          timeFormat={preferences.timeFormat}
          onClose={() => setQuickDraft(null)}
          onMoreOptions={handleMoreOptions}
        />
      ) : null}

      {dialog ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (open) {
              return;
            }
            if (confirmDiscard) {
              keepEditing();
              return;
            }
            requestCloseDialog();
          }}
        >
          <DialogContent
            title={
              confirmDiscard
                ? "Discard this event?"
                : dialog.mode === "edit"
                  ? "Edit event"
                  : "New event"
            }
            description={
              confirmDiscard
                ? "Your changes will be lost."
                : `Times are in ${timezone.replace("_", " ")}.`
            }
            sheet
          >
            {/* The form stays mounted while the confirm is shown, so "Keep
                editing" returns with every keystroke intact. */}
            <div className={confirmDiscard ? "hidden" : undefined} aria-hidden={confirmDiscard}>
              <EventDialog
                mode={dialog.mode}
                initial={dialog.initial}
                initialRule={dialog.initialRule}
                timezone={timezone}
                timeFormat={preferences.timeFormat}
                weekStartsOn={weekStartsOn}
                calendars={writableCalendars}
                defaultCalendarId={defaultEventCalendarId}
                onClose={finishCloseDialog}
                onCancel={requestCloseDialog}
                onDirtyChange={setDialogDirty}
              />
            </div>
            {confirmDiscard ? (
              <div className="flex justify-end gap-3">
                <Button onClick={keepEditing}>Keep editing</Button>
                <Button variant="primary" onClick={discardChanges}>
                  Discard
                </Button>
              </div>
            ) : null}
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
            openEdit(selectedEvent);
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
