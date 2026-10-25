"use client";

import FullCalendar from "@fullcalendar/react";
import type {
  CalendarRef,
  DateClickInfo,
  DateSelectInfo,
  DatesSetInfo,
  EventClickInfo,
  EventDropInfo,
  EventInput,
  EventResizeDoneInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import type { RefObject } from "react";
import type { Occurrence } from "@/lib/recurrence/expand";
import type { EventView } from "@/lib/services/events";
import type { TimeFormat } from "@/lib/services/preferences";
import type { TaskView } from "@/lib/services/tasks";
import { fcEventTimeFormat, formatInstant } from "@/lib/time/format";
import { utcToLocalDate } from "@/lib/time/zone";
import { isTaskDrag, readTaskDrag, type TaskDragPayload } from "@/lib/ui/taskDrag";
import { taskChip, type TaskChip } from "./taskChip";
import { occurrenceToFcEvent } from "./toFcEvent";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "./fullcalendar-overrides.css";

export interface RenderableOccurrence {
  occurrence: Occurrence;
  event: EventView;
}

interface Props {
  calendarRef: RefObject<CalendarRef | null>;
  timezone: string;
  timeFormat: TimeFormat;
  showWeekNumbers: boolean;
  /** Wall-clock `HH:MM:SS` the week/day scroll should open at. */
  scrollTime: string;
  firstDay: number;
  occurrences: RenderableOccurrence[];
  /**
   * Scheduled tasks to draw as read-only chips. Mapped here through
   * `taskChip` (not by the shell) so the chip contract has one owner; the shell
   * only filters by visibility and the visible range.
   */
  tasks?: TaskView[];
  collectionNames: ReadonlyMap<string, string>;
  readOnlyCollectionIds: ReadonlySet<string>;
  onDatesSet: (info: DatesSetInfo) => void;
  onDateClick: (info: DateClickInfo) => void;
  onSelect: (info: DateSelectInfo) => void;
  onEventClick: (info: EventClickInfo) => void;
  onEventMove: (info: EventDropInfo | EventResizeDoneInfo) => void;
  /**
   * A task row was dropped on a day cell. The payload carries the row's id and
   * its previous `scheduledOn` (for Undo); `date` is the household-local
   * `YYYY-MM-DD`. Only month-view day cells are drop zones.
   */
  onTaskDrop?: (drag: TaskDragPayload, date: string) => void;
}

export function CalendarView({
  calendarRef,
  timezone,
  timeFormat,
  showWeekNumbers,
  scrollTime,
  firstDay,
  occurrences,
  tasks,
  collectionNames,
  readOnlyCollectionIds,
  onDatesSet,
  onDateClick,
  onSelect,
  onEventClick,
  onEventMove,
  onTaskDrop,
}: Props) {
  const fcEvents = occurrences.map(({ occurrence, event }) => ({
    ...occurrenceToFcEvent(occurrence, event, collectionNames.get(event.collectionId) ?? ""),
    editable: !readOnlyCollectionIds.has(event.collectionId),
  })) as EventInput[];

  // Task chips are ordinary all-day events on the same calendar; their ids are
  // `task:`-prefixed so they can never collide with an occurrence id.
  const taskEvents = (tasks ?? [])
    .map(taskChip)
    .filter((chip): chip is TaskChip => chip !== null);

  // `min-h-0 flex-1` gives FullCalendar a definite height to fill; the shell
  // owns the page frame, so the panel never scrolls the document.
  return (
    <div className="planner-calendar flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface p-2">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]}
        // FullCalendar 7 hashes its own class names; these generators restore
        // the semantic hooks that `fullcalendar-overrides.css` (and the Canvas
        // spec) target, so no v6 options are involved.
        className="fc"
        viewClass={(info) => (info.view.type === "listMonth" ? "fc-view fc-view-list" : "fc-view")}
        dayCellClass={(info) =>
          ["fc-daygrid-day", info.isToday ? "fc-day-today" : "", info.isOther ? "fc-day-other" : ""]
            .filter(Boolean)
            .join(" ")
        }
        dayCellTopInnerClass="fc-daygrid-day-number"
        dayHeaderClass="fc-col-header-cell"
        eventClass="fc-event"
        eventInnerClass="fc-event-inner"
        eventTimeClass="fc-event-time"
        eventTitleClass="fc-event-title"
        listItemEventClass="fc-list-event"
        listDayClass="fc-list-day"
        listDayHeaderClass="fc-list-table-header"
        moreLinkClass="fc-more-link"
        rowMoreLinkClass="fc-more-link"
        columnMoreLinkClass="fc-more-link"
        slotHeaderClass="fc-timegrid-slot-label"
        dayCellDidMount={(info) => {
          if (!onTaskDrop) {
            return;
          }
          // Month-view day cells accept a dragged task row. `preventDefault`
          // only for the task MIME type keeps event drags, files and text out.
          // The date is household-local, exactly like `dateClick`'s.
          const element = info.el;
          const date = utcToLocalDate(info.date.getTime(), timezone);
          element.addEventListener("dragover", (event) => {
            if (!isTaskDrag(event.dataTransfer)) {
              return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = "move";
            }
            element.dataset.taskDropActive = "true";
          });
          element.addEventListener("dragleave", (event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && element.contains(next)) {
              return;
            }
            delete element.dataset.taskDropActive;
          });
          element.addEventListener("drop", (event) => {
            const drag = readTaskDrag(event.dataTransfer);
            delete element.dataset.taskDropActive;
            if (!isTaskDrag(event.dataTransfer)) {
              return;
            }
            event.preventDefault();
            if (drag) {
              onTaskDrop(drag, date);
            }
          });
        }}
        eventDidMount={(info) => {
          const extended = info.event.extendedProps as {
            kind?: string;
            taskId?: string;
            ariaLabel?: string;
            accent?: string;
            calendarName?: string;
            eventId?: string;
            occurrenceStart?: string;
          };
          // v7 dropped `borderColor`; the saturated bar is painted directly.
          info.el.style.borderLeftColor = String(extended.accent ?? "transparent");
          // Task chips are calendar citizens but NOT events: they carry their
          // own data hook and label, and a click routes to the task editor.
          if (extended.kind === "task") {
            if (extended.taskId) {
              info.el.setAttribute("data-task-id", extended.taskId);
            }
            info.el.setAttribute(
              "aria-label",
              extended.ariaLabel ?? `Task: ${info.event.title}`,
            );
            return;
          }
          // Deep links and notification links find the clicked block by these.
          if (extended.eventId) {
            info.el.setAttribute("data-event-id", extended.eventId);
          }
          if (extended.occurrenceStart) {
            info.el.setAttribute("data-occurrence-start", extended.occurrenceStart);
          }
          // FullCalendar 7 already gives every event `role="button" tabindex="0"`;
          // the label is what turns that focus stop into a spoken summary.
          const labelParts = [info.event.title];
          if (info.event.allDay) {
            labelParts.push("all day");
          } else if (info.event.start) {
            labelParts.push(formatInstant(info.event.start.getTime(), timezone, timeFormat));
          }
          if (extended.calendarName) {
            labelParts.push(extended.calendarName);
          }
          info.el.setAttribute("aria-label", labelParts.filter(Boolean).join(", "));
        }}
        initialView="dayGridMonth"
        headerToolbar={false}
        timeZone={timezone}
        firstDay={firstDay}
        weekNumbers={showWeekNumbers}
        // Fill the panel the shell hands down: `expandRows` shares the leftover
        // height across the month's week rows, so the whole month is visible at
        // any viewport and week/list views scroll inside the panel instead.
        height="100%"
        expandRows
        fixedWeekCount={false}
        dayMaxEventRows={3}
        eventMaxStack={3}
        // Google Calendar opens the time grid around "now", not at midnight.
        scrollTime={scrollTime}
        snapDuration="00:15:00"
        slotDuration="00:30:00"
        // Google Calendar lays overlapping events side by side, never stacked
        // on top of each other.
        slotEventOverlap={false}
        longPressDelay={300}
        noEventsText="No events"
        nowIndicator
        selectable
        selectMirror
        editable
        eventResizableFromStart
        events={[...fcEvents, ...taskEvents]}
        datesSet={onDatesSet}
        dateClick={onDateClick}
        select={onSelect}
        eventClick={onEventClick}
        eventDrop={onEventMove}
        eventResize={onEventMove}
        eventTimeFormat={fcEventTimeFormat(timeFormat)}
        // The slot gutter has room for a clock, not a clock plus minutes in
        // 12-hour mode; 24-hour keeps the minute so "09:30" stays readable.
        slotHeaderFormat={
          timeFormat === "12h"
            ? { hour: "numeric", hour12: true }
            : { hour: "2-digit", minute: "2-digit", hour12: false }
        }
      />
    </div>
  );
}
