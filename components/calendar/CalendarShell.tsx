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
import { useCollections } from "@/lib/query/collections";
import { parseExdates } from "@/lib/query/eventCache";
import {
  useCreateEvent,
  useDeleteEvent,
  useEvents,
  useUpdateEvent,
  type EventInputPayload,
  type EventRange,
  type UpdateEventResult,
} from "@/lib/query/events";
import { usePreferences, useUpdatePreferences } from "@/lib/query/preferences";
import { expandOccurrences } from "@/lib/recurrence/expand";
import { isShiftableRule } from "@/lib/recurrence/scopes";
import type { CollectionNode } from "@/lib/services/collections";
import type { EventView } from "@/lib/services/events";
import { canWriteCollection, foldCollectionPermission } from "@/lib/services/permissions";
import type { UserPreferences } from "@/lib/services/preferences";
import { formatOccurrenceWhen } from "@/lib/time/format";
import { addDaysToDate, utcToLocalDate, utcToLocalWallTime } from "@/lib/time/zone";
import { readLastView, writeLastView } from "@/lib/ui/lastView";
import { focusSearch, onEventLink } from "@/lib/ui/searchBus";
import { pushUndo } from "@/lib/ui/undo";
import { undoToast } from "@/lib/ui/undoToast";
import { useKeyboardShortcuts } from "@/lib/ui/useKeyboardShortcuts";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { useTaskPlanDrop } from "@/lib/ui/useTaskPlanDrop";
import { useUndoHotkey } from "@/lib/ui/useUndoHotkey";
import { stepWheel, wheelNavAllowed } from "@/lib/ui/wheelNav";
import { resolveInitialView } from "@/lib/ui/view";
import { visibleCollectionIds } from "@/lib/ui/visibleCollections";
import { CalendarView, type RenderableOccurrence } from "./CalendarView";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { EventDialog, type EventDialogInitial } from "./EventDialog";
import { QuickCreatePopover, type QuickCreateDraft } from "./QuickCreatePopover";
import { ScopeDialog, type RecurringScope } from "./ScopeDialog";
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

/** The moved occurrence's new timing, as FullCalendar reported it. */
interface MoveTiming {
  allDay: boolean;
  startAt: number | null;
  endAt: number | null;
  startDate: string | null;
  endDate: string | null;
}

/** An occurrence drag/resize or delete waiting for its scope choice. */
interface PendingScope {
  kind: "move" | "delete";
  event: EventView;
  occurrenceStart: string;
  move?: MoveTiming;
  /** False when the rule cannot be shifted/continued (custom pattern). */
  seriesShiftable: boolean;
}

/** A repeating edit whose form values wait for the scope choice. */
interface PendingEdit {
  event: EventView;
  occurrenceStart: string;
  payload: EventInputPayload;
  repeatTouched: boolean;
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

function daysBetweenDates(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / DAY_MS) + 1);
}

/**
 * The Edit dialog's wall-clock values for one clicked occurrence. A series row
 * stores its first block, so editing “this Tuesday” must seed from the clicked
 * occurrence, not from the stored series start.
 */
function occurrenceWalls(
  event: EventView,
  occurrenceStart: string,
  timezone: string,
): { start: string; end: string } {
  if (event.allDay === 1) {
    const startDate = occurrenceStart.slice(0, 10);
    const days = daysBetweenDates(
      event.startDate ?? startDate,
      event.endDate ?? event.startDate ?? startDate,
    );
    return { start: `${startDate}T09:00`, end: `${addDaysToDate(startDate, days - 1)}T10:00` };
  }
  const startMs = Date.parse(occurrenceStart);
  const seriesStart = event.startAt ?? startMs;
  const duration = (event.endAt ?? seriesStart) - seriesStart;
  return {
    start: utcToLocalWallTime(startMs, timezone),
    end: utcToLocalWallTime(startMs + duration, timezone),
  };
}

/** Rebuilds the create payload from a row so an undo can restore it verbatim. */
function eventToPayload(event: EventView): EventInputPayload {
  return {
    collectionId: event.collectionId,
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
    recurrenceParentId: event.recurrenceParentId,
    recurrenceId: event.recurrenceId,
  };
}

function occurrenceKey(event: EventView): string {
  return event.allDay === 1
    ? (event.startDate ?? "")
    : new Date(event.startAt ?? Date.now()).toISOString();
}

export function CalendarShell({
  timezone,
  currentUserId,
  weekStartsOn,
  preferences: initialPreferences,
}: Props) {
  const visibility = useVisibilityApi();
  const { data: collections } = useCollections();
  const preferences = usePreferences(initialPreferences);
  const updatePreferences = useUpdatePreferences();
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
  const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);
  // Wheel navigation: carry sub-threshold trackpad deltas across events, and
  // stamp the last navigation so one flick advances exactly one period.
  const wheelAccumulatorRef = useRef(0);
  const lastWheelNavAt = useRef(0);
  const wheelAnimationRef = useRef<Animation | null>(null);
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

  /**
   * Google-Calendar-style period change for a wheel gesture: the current grid
   * slides sideways out and fades, the next period slides in from the other
   * side. Users who ask for less motion get the instant change instead.
   */
  function animateWheelNavigation(direction: 1 | -1): void {
    const api = calendarRef.current?.getApi();
    if (!api) {
      return;
    }
    const panel = gridRef.current?.querySelector<HTMLElement>(".fc");
    if (!panel || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (direction > 0) {
        api.next();
      } else {
        api.prev();
      }
      return;
    }

    wheelAnimationRef.current?.cancel();
    const exit = panel.animate(
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: `translateX(${-direction * 20}px)`, opacity: 0.35 },
      ],
      { duration: 100, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    );
    wheelAnimationRef.current = exit;

    exit.finished
      .then(() => {
        if (direction > 0) {
          api.next();
        } else {
          api.prev();
        }
        // Hold the exit transform for two frames while the new period mounts,
        // then slide it in, so the change never flashes at its final position.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const enter = panel.animate(
              [
                { transform: `translateX(${direction * 28}px)`, opacity: 0.35 },
                { transform: "translateX(0)", opacity: 1 },
              ],
              { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
            );
            wheelAnimationRef.current = enter;
            exit.cancel();
            enter.finished
              .then(() => {
                enter.cancel();
                if (wheelAnimationRef.current === enter) {
                  wheelAnimationRef.current = null;
                }
              })
              .catch(() => {});
          });
        });
      })
      .catch(() => {});
  }

  // Google Calendar's scroll-to-navigate: a deliberate wheel gesture over the
  // grid moves one period (month → month, week → week, day → day). Panes that
  // scroll vertically on their own (week/day hours, list view), an open
  // popup/dialog, and a drag in progress keep the wheel for themselves.
  useEffect(() => {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    function onWheel(event: WheelEvent): void {
      const step = stepWheel(wheelAccumulatorRef.current, event);
      wheelAccumulatorRef.current = step.accumulator;
      if (step.direction === 0) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const scroller = target?.closest(".fc-scroller");
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
        return;
      }
      if (
        document.querySelector('[role="dialog"]') ||
        document.querySelector(".fc-event-dragging, .fc-event-resizing")
      ) {
        return;
      }
      if (!wheelNavAllowed(lastWheelNavAt.current, Date.now())) {
        return;
      }
      event.preventDefault();
      lastWheelNavAt.current = Date.now();
      animateWheelNavigation(step.direction);
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      wheelAnimationRef.current?.cancel();
    };
  }, []);

  const { data: events } = useEvents(range);
  const planTaskDrop = useTaskPlanDrop();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const visibleIds = useMemo(
    () =>
      visibleCollectionIds(
        (collections ?? []) as CollectionNode[],
        visibility.state,
        currentUserId,
      ),
    [collections, currentUserId, visibility.state],
  );

  const visibleEvents = useMemo(
    () => (events ?? []).filter((event) => visibleIds.has(event.collectionId)),
    [events, visibleIds],
  );

  const collectionNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const root of collections ?? []) {
      names.set(root.id, root.name);
      for (const child of root.children) {
        names.set(child.id, child.name);
      }
    }
    return names;
  }, [collections]);

  const readOnlyCollectionIds = useMemo(() => {
    const ids = new Set<string>();
    const viewer = { userId: currentUserId, householdId: "" };
    for (const root of collections ?? []) {
      if (!canWriteCollection(viewer, foldCollectionPermission(root))) {
        ids.add(root.id);
      }
      for (const child of root.children) {
        // Fold the root's flags in: a protected parent protects its children.
        if (!canWriteCollection(viewer, foldCollectionPermission(child, root))) {
          ids.add(child.id);
        }
      }
    }
    return ids;
  }, [collections, currentUserId]);

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
    ? readOnlyCollectionIds.has(selectedEvent.collectionId)
    : false;

  const selectedColor = useMemo(() => {
    if (!selectedEvent) {
      return "oklch(0.65 0.02 250)";
    }
    for (const root of collections ?? []) {
      if (root.id === selectedEvent.collectionId) {
        return shadeTokens(familyOf(root), PARENT_SHADE_INDEX).mainHex;
      }
      const child = root.children.find((entry) => entry.id === selectedEvent.collectionId);
      if (child) {
        return shadeTokens(familyOf(root), child.shadeIndex).mainHex;
      }
    }
    return "oklch(0.65 0.02 250)";
  }, [collections, selectedEvent]);

  const selectedCollectionName = selectedEvent
    ? (collectionNames.get(selectedEvent.collectionId) ?? "")
    : "";

  // Events live only in calendars: a list is a task home, so it must never reach
  // the event dialog or the quick-create bubble as a target.
  const writableCollections = useMemo<CollectionNode[]>(
    () =>
      (collections ?? [])
        .filter((root) => root.kind === "calendar" && !readOnlyCollectionIds.has(root.id))
        .map((root) => ({
          ...root,
          children: root.children.filter(
            (child) => child.kind === "calendar" && !readOnlyCollectionIds.has(child.id),
          ),
        })),
    [collections, readOnlyCollectionIds],
  );

  // "Display only this calendar" also sets where new events land — but only
  // when that calendar is writable; isolating a view-only one leaves creation
  // on the settings default. `lastEventCalendarId` is not validated against the
  // collection table, so it may name a list or a deleted collection: resolve it
  // inside the writable calendars instead of trusting it.
  const defaultEventCollectionId = useMemo(() => {
    const writableCalendar = (id: string | null): string | null =>
      id !== null &&
      writableCollections.some(
        (root) => root.id === id || root.children.some((child) => child.id === id),
      )
        ? id
        : null;

    return (
      writableCalendar(visibility.state.only) ??
      writableCalendar(preferences.lastEventCalendarId)
    );
  }, [preferences.lastEventCalendarId, visibility.state.only, writableCollections]);

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
    setPendingEdit(null);
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

  function openEdit(event: EventView, occurrenceStart: string) {
    const walls = occurrenceWalls(event, occurrenceStart, timezone);
    openDialog({
      mode: "edit",
      initial: {
        event,
        occurrenceStart,
        start: walls.start,
        end: walls.end,
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

  /** Close the Edit dialog after a scoped (or plain) save. */
  function finishScopedEdit(payload: EventInputPayload): void {
    updatePreferences.mutate({ lastEventCalendarId: payload.collectionId });
    setDialogDirty(false);
    finishCloseDialog();
  }

  /** EventDialog hands edit saves here so the shell can ask for the scope. */
  function handleEditSaveRequest(
    payload: EventInputPayload,
    meta: { repeatTouched: boolean },
  ): void {
    const state = dialog;
    if (!state || state.mode !== "edit" || !state.initial.event) {
      return;
    }
    const event = state.initial.event;
    if (!event.rrule) {
      // A single event (or an exception row) has nothing to choose.
      updateEvent.mutate(
        { id: event.id, ...payload },
        {
          onSuccess: () => finishScopedEdit(payload),
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    setPendingEdit({
      event,
      occurrenceStart: state.initial.occurrenceStart ?? occurrenceKey(event),
      payload,
      repeatTouched: meta.repeatTouched,
    });
  }

  function confirmEditScope(scope: RecurringScope): void {
    const pending = pendingEdit;
    if (!pending) {
      return;
    }
    const { event, occurrenceStart, payload } = pending;
    const onError = (error: Error) => toast.error(error.message);
    setPendingEdit(null);

    if (scope === "this") {
      updateEvent.mutate(
        { id: event.id, scope: "this", occurrenceStart, ...payload },
        {
          onSuccess: ({ event: exception }) => {
            const previousExdates = parseExdates(event.exdates);
            const handle = pushUndo({
              label: "Change occurrence",
              undo: async () => {
                await deleteEvent.mutateAsync({ id: exception.id, scope: "all" });
                await updateEvent.mutateAsync({ id: event.id, exdates: previousExdates });
              },
            });
            undoToast("This occurrence changed", handle);
            finishScopedEdit(payload);
          },
          onError,
        },
      );
      return;
    }

    if (scope === "following") {
      updateEvent.mutate(
        { id: event.id, scope: "following", occurrenceStart, ...payload },
        {
          onSuccess: (result) => {
            const handle = pushUndo({
              label: "Change following events",
              undo: async () => {
                let oldSeriesId = result.truncated?.id ?? null;
                if (!oldSeriesId) {
                  const recreated = await createEvent.mutateAsync(eventToPayload(event));
                  oldSeriesId = recreated.event.id;
                }
                for (const previousException of result.relinkedPrevious ?? []) {
                  await createEvent.mutateAsync({
                    ...eventToPayload(previousException),
                    recurrenceParentId: oldSeriesId,
                  });
                }
                await deleteEvent.mutateAsync({ id: result.event.id, scope: "all" });
                if (result.truncated) {
                  await updateEvent.mutateAsync({
                    id: event.id,
                    rrule: event.rrule,
                    exdates: parseExdates(event.exdates),
                  });
                }
              },
            });
            undoToast("Following events changed", handle);
            finishScopedEdit(payload);
          },
          onError,
        },
      );
      return;
    }

    updateEvent.mutate(
      { id: event.id, scope: "all", occurrenceStart, ...payload },
      {
        onSuccess: (result) => {
          const previous = eventToPayload(event);
          const handle = pushUndo({
            label: "Change series",
            undo: async () => {
              await restoreShiftedExceptions(event, result);
              await updateEvent.mutateAsync({ id: result.event.id, ...previous });
            },
          });
          undoToast("Series changed", handle);
          finishScopedEdit(payload);
        },
        onError,
      },
    );
  }

  function finishCloseDialog(): void {
    setDialog(null);
    setConfirmDiscard(false);
    setDialogDirty(false);
    setPendingEdit(null);
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
    collectionId: string;
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
    if (!parsed || !base) {
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

    if (base.rrule) {
      // The chooser replaces the grid's optimistic drop: revert now and apply
      // the move once the user picks a scope.
      info.revert();
      openScope("move", base, parsed.startKey, payload);
      return;
    }

    updateEvent.mutate(
      { id: base.id, ...payload },
      {
        onSuccess: (result) => {
          const handle = pushUndo({
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
            handle,
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

  /** True when the rule can be shifted by a whole-series move. */
  function canShiftSeries(event: EventView): boolean {
    if (!event.rrule) {
      return false;
    }
    const startDate =
      event.allDay === 1
        ? (event.startDate ?? utcToLocalDate(Date.now(), timezone))
        : utcToLocalDate(event.startAt ?? Date.now(), timezone);
    return isShiftableRule(event.rrule, startDate, {
      allDay: event.allDay === 1,
      timezone,
    });
  }

  function openScope(
    kind: "move" | "delete",
    event: EventView,
    occurrenceStart: string,
    move?: MoveTiming,
  ): void {
    // The chooser is a surface: it replaces the details popover/quick create.
    overlaySeqRef.current += 1;
    setSelection(null);
    setQuickDraft(null);
    setPendingScope({
      kind,
      event,
      occurrenceStart,
      move,
      seriesShiftable: kind === "delete" || canShiftSeries(event),
    });
  }

  /** Recreates rows the server deleted, parents before their exceptions. */
  async function recreateDeleted(rows: EventView[]): Promise<void> {
    const ids = new Set(rows.map((row) => row.id));
    const ordered = [...rows].sort((left, right) => {
      const leftParent = left.recurrenceParentId && ids.has(left.recurrenceParentId) ? 1 : 0;
      const rightParent = right.recurrenceParentId && ids.has(right.recurrenceParentId) ? 1 : 0;
      return leftParent - rightParent;
    });
    const remap = new Map<string, string>();
    for (const row of ordered) {
      const oldParent =
        row.recurrenceParentId && ids.has(row.recurrenceParentId) ? row.recurrenceParentId : null;
      const created = await createEvent.mutateAsync({
        ...eventToPayload(row),
        recurrenceParentId: oldParent ? (remap.get(oldParent) ?? null) : null,
        recurrenceId: oldParent ? row.recurrenceId : null,
      });
      remap.set(row.id, created.event.id);
    }
  }

  /** The timing/rule fields an all-events move or edit can be undone from. */
  function seriesRestorePayload(event: EventView): EventInputPayload {
    return {
      allDay: event.allDay === 1,
      startAt: event.startAt,
      endAt: event.endAt,
      startDate: event.startDate,
      endDate: event.endDate,
      rrule: event.rrule,
      exdates: parseExdates(event.exdates),
    };
  }

  /**
   * Restores a series' exceptions after an “All events” move/edit: recreate the
   * pre-change rows under the series, then delete the shifted ones.
   */
  async function restoreShiftedExceptions(
    series: EventView,
    result: UpdateEventResult,
  ): Promise<void> {
    for (const row of result.relinkedPrevious ?? []) {
      await createEvent.mutateAsync({
        ...eventToPayload(row),
        recurrenceParentId: series.id,
      });
    }
    for (const row of result.relinked ?? []) {
      await deleteEvent.mutateAsync({ id: row.id, scope: "all" });
    }
  }

  function requestDeleteFor(event: EventView, occurrenceStart: string) {
    if (event.rrule) {
      openScope("delete", event, occurrenceStart);
      return;
    }
    deleteEvent.mutate(
      { id: event.id, scope: "all" },
      {
        onSuccess: (result) => {
          const handle = pushUndo({
            label: "Delete event",
            undo: async () => {
              await recreateDeleted(result.deleted ?? [event]);
            },
          });
          undoToast("Event deleted", handle);
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

  function confirmDeleteScope(pending: PendingScope, scope: RecurringScope): void {
    const { event, occurrenceStart } = pending;
    if (scope === "this") {
      deleteEvent.mutate(
        { id: event.id, scope: "this", occurrenceStart },
        {
          onSuccess: () => {
            const remaining = parseExdates(event.exdates).filter(
              (key) => key !== occurrenceStart,
            );
            const handle = pushUndo({
              label: "Skip occurrence",
              undo: async () => {
                await updateEvent.mutateAsync({ id: event.id, exdates: remaining });
              },
            });
            undoToast("Occurrence skipped", handle);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    if (scope === "following") {
      deleteEvent.mutate(
        { id: event.id, scope: "following", occurrenceStart },
        {
          onSuccess: (result) => {
            const handle = pushUndo({
              label: "Delete following events",
              undo: async () => {
                const segmentId = result.segmentId;
                const children = (result.deleted ?? []).filter(
                  (row) => row.id !== segmentId && row.id !== event.id,
                );
                let seriesId = event.id;
                if (!result.truncated) {
                  const recreated = await createEvent.mutateAsync(eventToPayload(event));
                  seriesId = recreated.event.id;
                }
                for (const child of children) {
                  await createEvent.mutateAsync({
                    ...eventToPayload(child),
                    recurrenceParentId: seriesId,
                  });
                }
                if (result.truncated) {
                  await updateEvent.mutateAsync({
                    id: seriesId,
                    rrule: event.rrule,
                    exdates: parseExdates(event.exdates),
                  });
                }
              },
            });
            undoToast("Following events deleted", handle);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    deleteEvent.mutate(
      { id: event.id, scope: "all" },
      {
        onSuccess: (result) => {
          const handle = pushUndo({
            label: "Delete series",
            undo: async () => {
              await recreateDeleted(result.deleted ?? [event]);
            },
          });
          undoToast("Series deleted", handle);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function confirmMoveScope(pending: PendingScope, scope: RecurringScope): void {
    const { event, occurrenceStart, move } = pending;
    if (!move) {
      return;
    }

    if (scope === "this") {
      updateEvent.mutate(
        { id: event.id, scope: "this", occurrenceStart, ...move },
        {
          onSuccess: ({ event: exception }) => {
            const previousExdates = parseExdates(event.exdates);
            const handle = pushUndo({
              label: "Move occurrence",
              undo: async () => {
                await deleteEvent.mutateAsync({ id: exception.id, scope: "all" });
                await updateEvent.mutateAsync({ id: event.id, exdates: previousExdates });
              },
            });
            undoToast(
              `Occurrence moved to ${formatOccurrenceWhen(
                exception,
                occurrenceKey(exception),
                timezone,
                preferences.timeFormat,
              )}`,
              handle,
            );
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    if (scope === "following") {
      updateEvent.mutate(
        { id: event.id, scope: "following", occurrenceStart, ...move },
        {
          onSuccess: (result) => {
            const previous = event;
            const handle = pushUndo({
              label: "Move following events",
              undo: async () => {
                let oldSeriesId = result.truncated?.id ?? null;
                if (!oldSeriesId) {
                  const recreated = await createEvent.mutateAsync(eventToPayload(previous));
                  oldSeriesId = recreated.event.id;
                }
                for (const previousException of result.relinkedPrevious ?? []) {
                  await createEvent.mutateAsync({
                    ...eventToPayload(previousException),
                    recurrenceParentId: oldSeriesId,
                  });
                }
                await deleteEvent.mutateAsync({ id: result.event.id, scope: "all" });
                if (result.truncated) {
                  await updateEvent.mutateAsync({
                    id: previous.id,
                    rrule: previous.rrule,
                    exdates: parseExdates(previous.exdates),
                  });
                }
              },
            });
            undoToast(
              `Following events moved to ${formatOccurrenceWhen(
                result.event,
                occurrenceKey(result.event),
                timezone,
                preferences.timeFormat,
              )}`,
              handle,
            );
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    updateEvent.mutate(
      { id: event.id, scope: "all", occurrenceStart, ...move },
      {
        onSuccess: (result) => {
          const moved = result.event;
          const previous = seriesRestorePayload(event);
          const handle = pushUndo({
            label: "Move series",
            undo: async () => {
              await restoreShiftedExceptions(event, result);
              await updateEvent.mutateAsync({ id: moved.id, ...previous });
            },
          });
          undoToast(
            `Series moved to ${formatOccurrenceWhen(
              moved,
              occurrenceKey(moved),
              timezone,
              preferences.timeFormat,
            )}`,
            handle,
          );
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function confirmScope(scope: RecurringScope): void {
    const pending = pendingScope;
    if (!pending) {
      return;
    }
    setPendingScope(null);
    setSelection(null);
    if (pending.kind === "delete") {
      confirmDeleteScope(pending, scope);
    } else {
      confirmMoveScope(pending, scope);
    }
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
        openEdit(target.event, target.occurrenceStart);
        setSelection(null);
        return;
      }
      if (selectedEvent && selection) {
        openEdit(selectedEvent, selection.occurrenceStart);
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
        collectionNames={collectionNames}
        readOnlyCollectionIds={readOnlyCollectionIds}
        onDatesSet={handleDatesSet as (info: DatesSetInfo) => void}
        onDateClick={handleDateClick}
        onSelect={handleSelect as (info: DateSelectInfo) => void}
        onEventClick={handleEventClick}
        onEventMove={handleEventMove as never}
        onTaskDrop={planTaskDrop}
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
          collections={writableCollections}
          defaultCollectionId={defaultEventCollectionId}
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
            if (pendingEdit) {
              // Escape/Cancel returns to the form with its edits intact.
              setPendingEdit(null);
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
              pendingEdit
                ? "Change repeating event"
                : confirmDiscard
                  ? "Discard this event?"
                  : dialog.mode === "edit"
                    ? "Edit event"
                    : "New event"
            }
            description={
              pendingEdit
                ? "This event repeats. What should change?"
                : confirmDiscard
                  ? "Your changes will be lost."
                  : `Times are in ${timezone.replace("_", " ")}.`
            }
            sheet
          >
            {/* The form stays mounted while the confirm/prompt is shown, so
                Cancel returns with every keystroke intact. */}
            <div
              className={confirmDiscard || pendingEdit ? "hidden" : undefined}
              aria-hidden={confirmDiscard || Boolean(pendingEdit)}
            >
              <EventDialog
                mode={dialog.mode}
                initial={dialog.initial}
                initialRule={dialog.initialRule}
                timezone={timezone}
                timeFormat={preferences.timeFormat}
                weekStartsOn={weekStartsOn}
                collections={writableCollections}
                defaultCollectionId={defaultEventCollectionId}
                onClose={finishCloseDialog}
                onCancel={requestCloseDialog}
                onDirtyChange={setDialogDirty}
                onSaveRequest={handleEditSaveRequest}
                externalPending={updateEvent.isPending || createEvent.isPending}
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
            {pendingEdit ? (
              <ScopeDialog
                description="Choose whether the edits apply to this event only, this and following events, or the whole series."
                disabled={pendingEdit.repeatTouched ? ["this"] : []}
                note={
                  pendingEdit.repeatTouched
                    ? "Changing the repeat applies to the series. Choose This and following events or All events."
                    : undefined
                }
                onChoose={confirmEditScope}
                onCancel={() => setPendingEdit(null)}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}

      {selectedEvent && selection ? (
        <EventDetailsPopover
          event={selectedEvent}
          calendarName={selectedCollectionName}
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

      {pendingScope ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setPendingScope(null))}>
          <DialogContent
            title={pendingScope.kind === "move" ? "Move repeating event" : "Delete repeating event"}
            description={
              pendingScope.kind === "move"
                ? "This event repeats. What should change?"
                : "This event repeats. What should be deleted?"
            }
          >
            <ScopeDialog
              description={
                pendingScope.kind === "move"
                  ? "Choose whether the new day and time apply to this occurrence only, this and later occurrences, or the whole series."
                  : "Choose whether to remove this occurrence only, this and later occurrences, or the whole series."
              }
              disabled={pendingScope.seriesShiftable ? [] : ["following", "all"]}
              note={
                pendingScope.seriesShiftable
                  ? undefined
                  : "This series uses a custom repeat rule the app can't shift, so only this event can be changed here."
              }
              onChoose={confirmScope}
              onCancel={() => setPendingScope(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
