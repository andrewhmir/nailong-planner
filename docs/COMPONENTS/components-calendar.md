# Calendar UI

This area is the calendar page itself: the FullCalendar grid, the toolbar and date navigation, quick create, the event dialog and details surfaces, search, and the pure converters that turn domain rows into FullCalendar events. Read it before changing anything a household member clicks or drags on the calendar, or when a rendered event, date, colour, or save payload is wrong.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, add/move/delete its section and run `npm run docs:check`.

| File | Role |
|---|---|
| `components/calendar/CalendarShell.tsx` | Client orchestrator for the page: data, dialogs, selection, shortcuts, undo |
| `components/calendar/Toolbar.tsx` | Page title/date picker, prev/today/next, view switch, + Event |
| `components/calendar/CalendarView.tsx` | FullCalendar 7 instance and its Canvas class hooks |
| `components/calendar/QuickCreatePopover.tsx` | GCal-style title-and-calendar bubble with "More options" |
| `components/calendar/quickCreateDefaults.ts` | Pure default start/end rules for a quick-create draft |
| `components/calendar/CalendarPicker.tsx` | Nested calendar chooser (chip and form-field variants) |
| `components/calendar/EventDetails.tsx` | Presentational event facts plus Edit/Duplicate/Delete/Close |
| `components/calendar/EventDetailsPopover.tsx` | Desktop popover / phone dialog wrapper around `EventDetails` |
| `components/calendar/EventDialog.tsx` | Full create/edit form (title, time, repeat, calendar, notes) |
| `components/calendar/DateField.tsx` | Dialog date control: field button plus popover month grid |
| `components/calendar/TimeField.tsx` | Dialog time control: 15-minute quick-pick list plus typed time |
| `components/calendar/timeSlots.ts` | Pure slot grid and format-aware typed-time parser |
| `components/calendar/SearchBox.tsx` | Header search combobox plus `/` focus handling |
| `components/calendar/SearchResultsOverlay.tsx` | Grouped result list with month headers and highlighting |
| `components/calendar/MiniMonth.tsx` | Keyboard-navigable month grid with neutral event dots |
| `components/calendar/DatePickerPopover.tsx` | Mini month plus "Today" shortcut for the toolbar title |
| `components/calendar/ShortcutHelpDialog.tsx` | Static `?` shortcut reference sheet |
| `components/calendar/eventPayload.ts` | Pure form→API payload builder and repeat-rule helpers |
| `components/calendar/toFcEvent.ts` | Occurrence→FullCalendar event mapping and occurrence ids |
| `components/calendar/taskChip.ts` | Scheduled task→FullCalendar chip mapping, `task:` ids and the read-only contract |
| `components/calendar/fullcalendar-overrides.css` | Canvas palette and sizing overrides for FullCalendar |

## Shell and layout

### components/calendar/CalendarShell.tsx

**Purpose** — The client-side brain of the calendar route. It loads calendars, a date-range slice of events and the household's open tasks, expands recurrences into renderable occurrences, asks the Google-style “This event / This and following events / All events” scope for repeating edits, draws scheduled tasks as read-only chips, and owns every overlay: toolbar, grid, quick create, event dialog, details popover, scope chooser and shortcut sheet.

**Public API** — `export function CalendarShell(props: Props)`. Props: `timezone: string`, `currentUserId: string`, `weekStartsOn: number`, `preferences: UserPreferences`. Internal (not exported) types: `EventSelection`, `EventDialogState`, `MoveTiming`, `PendingScope`, `PendingEdit`, `SelectInfo`, `DatesInfo`, `DropInfo`. Helpers in module scope: `familyOf`, `seriesStartWall`, `seriesEndWall`, `daysBetweenDates`, `occurrenceWalls`, `eventToPayload`, `occurrenceKey`. Constants: `VIEW_TYPES` (FullCalendar view type → `PlannerView`), `DAY_MS`.

**State & side effects** — Local state: `view`, `label`, `anchorDate`, `scrollTime` (frozen once from "now"), `range`, `dialog`/`dialogDirty`/`confirmDiscard`, `quickDraft`, `helpOpen`, `announcement`, `selection`, `pendingScope`/`pendingEdit`, `nowAnchor`. Refs: `calendarRef`, `handledLinkRef`, `viewChosenByUser`, `openerRef`, `gridRef`, `overlaySeqRef`, `linkSeqRef`, `wheelAccumulatorRef`, `lastWheelNavAt`. Overlay rule: at most one surface is up — `openDialog`, `openQuickCreate`, a recurring `requestDeleteFor` prompt and `handleEventClick` each bump `overlaySeqRef` and clear the other states. The desktop quick-create bubble also dismisses itself on an outside pointerdown, but these explicit clears are the same-render guarantee for keyboard paths and the search deep link. Queries: `useCollections()`, `useEvents(range)` (`["events", from, to]`; `effectiveRange` falls back to now−45 d … now+75 d until `datesSet` fires), `useTasks("all")`, `usePreferences(initialPreferences)`, `useVisibilityApi()`. **Task chips:** `visibleTasks` keeps the **open** tasks (`status === "open"`; the optimistic cache can hold a done/dropped row for a beat after `x`/Drop) whose `scheduledOn` falls inside the grid's current `range` window and whose `collectionId` is in `visibleIds`; `CalendarView` maps them through `taskChip` into the same `events` array as the event occurrences (their `task:`-prefixed ids cannot collide). Because that array is shared with the week/day/list grids too, chips are accepted to render there as a read-only superset (controller ruling) — only the month view has drop listeners. `useTaskPlanDrop()` supplies `onTaskDrop`, the shared PATCH + targeted-undo + `Task planned` path that the sidebar mini month also uses; it receives the drag payload (`{ id, scheduledOn }`) so Undo restores the date the dragged row showed. `handleEventClick` branches on `extendedProps.kind === "task"` and `router.push("/tasks?task=<id>")` after clearing quick-create/details, so a chip is a task open, never event details or the event form. Mutations: `useCreateEvent`, `useUpdateEvent`, `useDeleteEvent`. Persistence: `writeLastView(currentUserId, view)` / `readLastView` in `localStorage`; `pushUndo` for move, delete, series delete and skip-occurrence, each paired with `undoToast` from `lib/ui/undoToast`. URL: reads `?date=` and `?event=` from `useSearchParams()` and then `router.replace("/", { scroll: false })`. DOM: a `window.setInterval` that polls every 100 ms for `[data-event-id]` (max 100 attempts) to open a deep-linked event, and a global keydown binding through `useKeyboardShortcuts` plus `useUndoHotkey`. A `wheel` listener on the grid (`gridRef`, `{ passive: false }`) adds Google Calendar's scroll-to-navigate: `lib/ui/wheelNav.ts` accumulates `deltaY` past 40 and, at most once per 500 ms, runs `animateWheelNavigation` — a 100 ms horizontal slide-out/fade (20 px in the travel direction), FullCalendar `next()`/`prev()`, then a 220 ms slide-in from the opposite side (28 px, `cubic-bezier(0.16, 1, 0.3, 1)`), skipped entirely under `prefers-reduced-motion: reduce`. It yields to vertically scrollable `.fc-scroller` panes (week/day hours, list view), an open `role="dialog"`, and an event being dragged/resized; horizontal swipes and pinch-zoom are ignored. The poll is sequence-guarded: `SearchBox` announces the chosen result on `lib/ui/searchBus`, and that announcement stores `overlaySeqRef` in `linkSeqRef` at click time, so the deep link is **dropped** (URL cleared) if the user opens a create surface after picking the result, while an already-open bubble is closed when the details finally open. `defaultEventCollectionId` (memo) is the isolated calendar while "display only" is active and that calendar is writable, else `preferences.lastEventCalendarId` when that id is a writable calendar, else `null`; the preference is not validated against the collection table, so a stale, deleted or list id is ignored. `writableCollections` keeps only `kind === "calendar"` roots and their calendar children, so a list is never offered as an event target; both it and the default feed `QuickCreatePopover` and `EventDialog`.

**Depends on / Used by** — `@fullcalendar/react` types, `next/navigation`, `sonner`, `components/ui/button`, `components/ui/dialog`, `components/shell/VisibilityProvider` (`useVisibilityApi`), `lib/color/palette` (`shadeTokens`, `PARENT_SHADE_INDEX`, `isHueFamily`), `lib/query/collections`, `lib/query/events` (`EventInputPayload`, `EventRange`), `lib/query/tasks` (`useTasks("all")`), `lib/query/preferences`, `lib/query/eventCache` (`parseExdates`), `lib/recurrence/expand` (`expandOccurrences`), `lib/services/permissions` (`canWriteCollection`, `foldCollectionPermission`), `lib/time/zone`, `lib/time/format`, `lib/ui/lastView`, `lib/ui/searchBus` (`focusSearch`), `lib/ui/undo` (`pushUndo`), `lib/ui/undoToast`, `lib/ui/useKeyboardShortcuts`, `lib/ui/useUndoHotkey`, `lib/ui/useMediaQuery`, `lib/ui/useTaskPlanDrop`, `lib/ui/view` (`resolveInitialView`), `lib/ui/wheelNav` (`stepWheel`, `wheelNavAllowed`), `lib/ui/visibleCollections`, and its five sibling calendar components. Rendered only by `app/(app)/page.tsx`.

**Debugging** —
- Event opens then the URL never clears -> the poll found the element from a stale render -> check `handleDatesSet` set `range` and that `visibleEvents` contains the id (`CalendarShell` deep-link effect).
- Two surfaces at once (event details over a quick-create bubble, or a bubble over details) -> one opener did not dismiss the other, or the search deep link landed after the user started creating -> `openQuickCreate`/`openDialog`/`requestDeleteFor`/`handleEventClick` clear the other states; the poll drops the link when `overlaySeqRef` moved since the result click (`linkSeqRef`).
- A searched event's details never opens -> you started a new event or opened the shortcut sheet while the 100 ms poll was still running; the newer action wins by design (the link is dropped and the URL cleared).
- A partner's event is editable -> `readOnlyCollectionIds` folding missed the child -> inspect the `foldCollectionPermission` loop (it builds `{ userId, householdId: "" }`, so only `userId` matters).
- Escape deletes the on-screen draft instead of just closing details -> `onEscape` order in `useKeyboardShortcuts` -> check `quickDraft`/`selection` branches, then `QuickCreatePopover` stopPropagation.
- Drag/resize on a repeating event opens the scope chooser instead of snapping back -> by design: `handleEventMove` reverts the visual drop and stores a `PendingScope`; confirming runs the scoped PATCH, Cancel leaves the series untouched. A toast no longer explains the block.
- “All events” is disabled on a repeating drag -> the rule is unparseable or `advanced` so `canShiftSeries` refuses to rewrite it; the chooser shows the custom-rule note, and the server would answer `VALIDATION` too. “This event” still works.
- A save on a repeating event shows no chooser and writes the whole series -> the event opened is an exception (no `rrule`) so `handleEditSaveRequest` takes the plain single-event path, or `onSaveRequest` was not passed to `EventDialog`.
- “All events” from a later occurrence removes the earlier blocks -> the Edit save must send `scope: "all"` **with** `occurrenceStart` (the clicked occurrence) so the service applies a delta; sending the absolute form start through the plain PATCH moves DTSTART.
- Undoing an “All events” move/edit leaves exceptions at their shifted or old times -> `restoreShiftedExceptions` must recreate `relinkedPrevious` under the series and delete the post-change `relinked` rows before the series PATCH.
- A following-delete undo shows duplicate later occurrences -> the undo recreated the response's later segment as well as restoring the old rule; filter `result.deleted` by `segmentId` and `event.id`.
- “All events” is disabled on a rule that looks ordinary -> `canShiftSeries` now uses `isShiftableRule` (round-trip gate), so a known-but-unmodelled rule (e.g. `FREQ=DAILY;BYDAY=…`) is refused instead of rewritten.
- The Edit dialog shows the series' first block instead of the clicked one -> `openEdit` was called without the clicked `occurrenceStart`; `occurrenceWalls`/`EventDialog`'s `occurrenceSeeded` then fall back to the stored start.
- Undoing a scoped edit leaves a stray row -> the undo closure must delete the later segment / new exception after recreating the previous exceptions; a missing `relinkedPrevious` handle means the response was not the split envelope (`result.truncated` undefined).
- Two surfaces at once (scope chooser over details, or chooser over the edit form) -> every opener must clear the others; `openScope`/`openDialog` clear `selection`, `quickDraft` and the sibling pending state.
- The dialog's time control shows 12-hour text while the grid shows 24-hour -> `preferences.timeFormat` was not passed down -> the `timeFormat={preferences.timeFormat}` prop on `<EventDialog>` in this file.
- The mouse wheel does nothing over the month grid -> the wheel effect did not attach (`gridRef` was not rendered) or a `role="dialog"` is open -> the wheel effect in this file; the gesture maths is `lib/ui/wheelNav.ts`.
- Wheel navigation changes the period but with no slide -> `prefers-reduced-motion: reduce` is on, or the `.fc` panel was not found so the instant branch ran -> `animateWheelNavigation` in this file.
- One wheel flick skips several months -> the cooldown was dropped or `stepWheel` no longer resets its accumulator -> `lib/ui/wheelNav.ts` + `lastWheelNavAt`.
- Week/day view no longer scrolls its hours -> the `.fc-scroller` escape hatch was removed from the wheel handler -> the wheel effect in this file.
- The event dialog or quick-create bubble offers a task list as a calendar -> the `kind === "calendar"` filter was dropped from `writableCollections` -> this file; the server still answers 400 "Events live in calendars.".
- A task chip opens event details or the event form -> `handleEventClick` lost its `extendedProps.kind === "task"` branch (the branch must come before `parseOccurrenceFcId`) -> this file and `taskChip.ts`.
- A task chip drags or resizes -> `taskChip` stopped setting `editable: false`/`durationEditable: false` -> `components/calendar/taskChip.ts`.
- A scheduled task is missing from the grid -> `visibleTasks` filtered it out: the task is not `status === "open"` anymore, the date is outside the grid's `range`, its list is not visible, or `useTasks("all")` is still loading -> this file's `visibleTasks`.
- A chip lingers on the grid after `x` / Drop -> the `status === "open"` filter was dropped from `visibleTasks` and the optimistic task cache still holds the finished row -> this file.
- Dropping a task row on a day does nothing -> the task MIME type is not in `dataTransfer.types`, no `onTaskDrop` reached the cell, or the PATCH failed (read the toast) -> `CalendarView`'s `dayCellDidMount`, `useTaskPlanDrop`.
- A dropped task's Undo restores the wrong date -> the payload's `scheduledOn` was not the value the dragged row rendered (a cache lookup crept back in) or the drop ignored `readTaskDrag`'s payload -> `components/tasks/TaskRow.tsx`, `lib/ui/taskDrag.ts`, `lib/ui/useTaskPlanDrop.ts`.
- Chips also show in Week/Day/List -> intended: a chip is an all-day event on the shared `events` array (read-only superset accepted by the controller); those views are not drop zones -> `taskChip.ts`.

**Tests** — `tests/e2e/events.spec.ts` (chip stacking and "+N more" alongside a live event drag), `tests/e2e/recurring-scope.spec.ts`, `tests/e2e/quick-create.spec.ts`, `tests/e2e/shortcuts.spec.ts`, `tests/e2e/undo.spec.ts`, `tests/e2e/details.spec.ts`, `tests/e2e/search.spec.ts`, `tests/e2e/mini-month.spec.ts`, `tests/e2e/view-preference.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`, `tests/e2e/tasks.spec.ts` (task chips, chip click deep link, day-drop handler).

### components/calendar/Toolbar.tsx

**Purpose** — The calendar header row: a Google-style title button that opens a date picker, previous/today/next buttons, the four-way view switch, the `?` shortcut button and `+ Event`.

**Public API** — `export type PlannerView = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth"`; `export function Toolbar(props: Props)`. Props: `label`, `view`, `anchorDate`, `onJumpToDate(date)`, `onViewChange(view)`, `onPrev()`, `onToday()`, `onNext()`, `onNewEvent()`, `onShowShortcuts()`. `VIEWS` maps the four `PlannerView` values to Month/Week/Day/List.

**State & side effects** — One state: `pickerOpen` for the Radix popover. No queries, no storage, no URL writes; every action is a callback into `CalendarShell`. `DatePickerPopover` is keyed by `anchorDate` so the picker's month re-seeds whenever the visible range changes. The portalled content carries the shared enter animation: `origin-[var(--radix-popover-content-transform-origin)]` plus `data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]`.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/button`, `components/ui/icons`, `lib/utils` (`cn`), `./DatePickerPopover`. Rendered by `CalendarShell`. `PlannerView` is imported by `lib/ui/lastView.ts`, `lib/ui/view.ts` and `lib/ui/useKeyboardShortcuts.ts`, so this file is a type dependency of the client-state layer.

**Debugging** —
- Clicking the title opens the picker at last month -> `DatePickerPopover` was not remounted -> confirm the `key={anchorDate}` prop in `Toolbar`.
- `+ Event` missing on a phone -> expected (`hidden md:inline-flex`); the shell's floating `+` button is the phone path -> check `CalendarShell`'s `md:hidden` button.
- View switch does not stick after reload -> `changeView` in `CalendarShell` writes `localStorage`; `Toolbar` itself never persists.

**Tests** — `tests/e2e/events.spec.ts`, `tests/e2e/mini-month.spec.ts`, `tests/e2e/calendar-style.spec.ts`, `tests/e2e/shortcuts.spec.ts`.

## Views and grid

### components/calendar/CalendarView.tsx

**Purpose** — The only file that mounts FullCalendar 7. It maps `RenderableOccurrence[]` and scheduled `TaskView[]` to FullCalendar inputs, restores the semantic CSS hooks v7 replaced with generators, and forwards grid events to the shell.

**Public API** — `export interface RenderableOccurrence { occurrence: Occurrence; event: EventView }`; `export function CalendarView(props: Props)`. Props: `calendarRef: RefObject<CalendarRef | null>`, `timezone`, `timeFormat: TimeFormat`, `showWeekNumbers`, `scrollTime: string`, `firstDay: number`, `occurrences`, `tasks?: TaskView[]`, `collectionNames: ReadonlyMap<string,string>`, `readOnlyCollectionIds: ReadonlySet<string>`, and the handlers `onDatesSet`, `onDateClick`, `onSelect`, `onEventClick`, `onEventMove(info: EventDropInfo | EventResizeDoneInfo)`, `onTaskDrop?: (drag: TaskDragPayload, date: string) => void`.

**State & side effects** — No React state. Builds `fcEvents` on every render, spreading `occurrenceToFcEvent(...)` and adding `editable: !readOnlyCollectionIds.has(event.collectionId)`. It also maps the incoming `tasks` through `taskChip` (dropping unscheduled rows) and concatenates both arrays into `events`, so task chips inherit `dayMaxEventRows`/`eventMaxStack` and the built-in "+N more"; task ids are `task:`-prefixed and cannot collide with an `<eventId>::<startKey>` occurrence id. `eventDidMount` writes `data-event-id`, `data-occurrence-start`, an `aria-label` (`title`, "all day"/formatted start, calendar name), and `info.el.style.borderLeftColor` from `extendedProps.accent` (v7 dropped `borderColor`); a task chip takes a separate branch that writes `data-task-id` and the `extendedProps.ariaLabel` (`Task: <title>`) and skips the event hooks. `dayCellDidMount` is the month-view drop zone: it attaches `dragover` (calls `preventDefault` only when `dataTransfer.types` includes `text/x-nailong-task`; sets `data-task-drop-active` for the CSS affordance and `dropEffect = "move"`), `dragleave` (clears the attribute when the pointer leaves the cell) and `drop` (reads the payload — `{ id, scheduledOn }` via `readTaskDrag`, clears the attribute, calls `onTaskDrop(drag, household-local YYYY-MM-DD)`). The cell date is computed with `utcToLocalDate(info.date.getTime(), timezone)`, exactly like `dateClick`, so it cannot drift by a timezone. The listeners exist only while `onTaskDrop` is supplied and only on dayGrid cells. FullCalendar config that matters: `initialView="dayGridMonth"`, `headerToolbar={false}`, `timeZone={timezone}`, `firstDay`, `weekNumbers`, `height="100%"`, `expandRows`, `fixedWeekCount={false}`, `dayMaxEventRows={3}`, `eventMaxStack={3}`, `scrollTime`, `snapDuration="00:15:00"`, `slotDuration="00:30:00"`, `slotEventOverlap={false}`, `longPressDelay={300}`, `nowIndicator`, `selectable`, `selectMirror`, `editable`, `eventResizableFromStart`; `slotHeaderFormat` drops minutes in 12-hour mode. Imports `@fullcalendar/react/skeleton.css`, the classic theme CSS/palette and `./fullcalendar-overrides.css`.

**Depends on / Used by** — `@fullcalendar/react` plus the `daygrid`, `timegrid`, `list`, `interaction` and `themes/classic` plugins, `lib/time/format` (`fcEventTimeFormat`, `formatInstant`), `lib/time/zone` (`utcToLocalDate`), `lib/ui/taskDrag` (`isTaskDrag`, `readTaskDrag`, `TaskDragPayload`), `./taskChip` (`taskChip`, `TaskChip`), `./toFcEvent`. Rendered by `CalendarShell`; the theme CSS is what `fullcalendar-overrides.css` targets.

**Debugging** —
- Event blocks lose their left colour bar -> `extendedProps.accent` missing or `eventDidMount` did not run -> check `occurrenceToFcEvent`/`taskChip` and `fullcalendar-overrides.css` `.fc-event` rules.
- A month renders six empty week rows or scrolls the page -> `height`/`expandRows`/`fixedWeekCount` changed, or the parent lost `min-h-0 flex-1` -> check this file's wrapper classes and `viewport-fit.spec.ts`.
- Deep links and drag callbacks report an unknown id -> the `data-event-id` attribute or the `id::startKey` format changed -> `eventDidMount` and `parseOccurrenceFcId`.
- Week view opens at midnight -> `scrollTime` prop is not `HH:MM:SS` -> check the shell's `scrollTime` initialiser.
- A task chip shows the event aria-label or no `data-task-id` -> the `extendedProps.kind === "task"` branch in `eventDidMount` was removed -> this file.
- A drop lands one day off -> the cell date was built from a timestamp instead of `utcToLocalDate` -> the `dayCellDidMount` date line.
- A drag of an event or a file is accepted by a day cell -> `preventDefault` was moved out of the `isTaskDrag` guard -> this file's `dragover`/`drop` listeners.

**Tests** — `tests/e2e/events.spec.ts` (including the regression that four chips on a quiet day fold into "+N more" while an event drag still works), `tests/e2e/calendar-style.spec.ts`, `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/view-preference.spec.ts`, `tests/e2e/tasks.spec.ts` (chip visibility, `data-task-id`/aria label, chip click; the mini-month drag leg covers the shared PATCH).

## Quick create

### components/calendar/QuickCreatePopover.tsx

**Purpose** — The click-a-day bubble: type a title, pick a writable calendar, Save, or escalate to the full dialog with "More options". It becomes a bottom sheet below 768 px.

**Public API** — `export interface QuickCreateDraft extends QuickCreateRange { dateWall: string; anchor: { x: number; y: number } }`; `export function QuickCreatePopover(props: Props)`. Props: `draft`, `collections: CollectionNode[]` (writable only), `defaultCollectionId: string | null`, `timezone`, `timeFormat`, `onClose()`, `onMoreOptions(values: { title; collectionId; startWall; endWall; allDay })`. Module constants: `CARD_WIDTH = 320`, `MARGIN = 16`, `CARD_HEIGHT_ESTIMATE = 260`, `CONTROL` (38 px field recipe).

**State & side effects** — State: `title`, `pickedCollectionId` (`null` until the user picks a row in the list). `effectiveCollectionId` is derived on every render: `pickedCollectionId ?? defaultCollectionId` when `calendarSwatch` finds it, else `collections[0]?.id`, else `""` — so a changed default (the shell reuses this mounted bubble for the next draft) is never frozen at mount. While the desktop bubble is up, a capture-phase `document` `pointerdown` listener calls `onClose()` on any click outside its own DOM; the portalled calendar list is exempt via `data-dismiss-ignore` on `CalendarPicker`'s content, and the phone sheet skips the listener because its Radix `Dialog` dismisses itself. `useMediaQuery("(max-width: 767px)")` selects dialog vs bubble. Mutations: `useCreateEvent` (optimistic row via `["events"]` cache), `useDeleteEvent` for the undo action, `useUpdatePreferences` writing `lastEventCalendarId`. On success it pushes an undo entry, shows a 10 s "Event created" toast with Undo, remembers the calendar and closes. `draftPayload` converts wall time with `localWallTimeToUtc` and, for all-day drafts, subtracts one day from the exclusive end. The bubble is `position: fixed` at the click point clamped into the viewport, and its own keydown handler closes on Escape with `stopPropagation`.

**Depends on / Used by** — `@/lib/query/events`, `@/lib/query/preferences`, `@/lib/services/collections`, `@/lib/ui/calendarPicker` (`calendarSwatch`), `@/lib/time/format` (`formatWallDate`, `formatWallTime`), `@/lib/time/zone`, `@/lib/ui/undo`, `@/lib/ui/useMediaQuery`, `components/ui/dialog`, and `./CalendarPicker`. Rendered by `CalendarShell` whenever `quickDraft` is set (day click, drag-select, `Shift+C`, or the phone `+`).

**Debugging** —
- Save does nothing -> `effectiveCollectionId` is empty because every collection is read-only and `collections` is empty -> check `writableCollections` in `CalendarShell`.
- Bubble appears off-screen on a phone in landscape -> `CARD_HEIGHT_ESTIMATE` clamp used the wrong assumption -> the phone path should be the dialog; check the media query.
- The bubble stays up after clicking a toolbar/sidebar control -> the outside-click listener was dropped, or a page-wide element carries `data-dismiss-ignore` -> this file's `pointerdown` effect.
- Clicking a row in the calendar list dismisses the bubble -> the portalled content lost its `data-dismiss-ignore` marker -> `CalendarPicker`'s `PopoverPrimitive.Content`.
- The bubble proposes the previous default right after "display only this calendar" changes -> the default was frozen in state instead of derived -> `effectiveCollectionId` (`pickedCollectionId ?? defaultCollectionId`), `defaultEventCollectionId` in `CalendarShell`.
- Bubble stays up after clicking an event / opening the form -> those handlers clear `quickDraft` explicitly in addition to the outside-click dismissal -> `handleEventClick` and `openDialog` in `CalendarShell`.
- Escape from the calendar list discards the typed title -> a picker Escape was not stopped -> `CalendarPicker`'s `onKeyDown`.
- New all-day event is one day too long -> exclusive-end subtraction -> `draftPayload`.
- Calendar choice not remembered -> `updatePreferences` failed silently (error only toasts on the create mutation).

**Tests** — `tests/e2e/quick-create.spec.ts`, `tests/e2e/calendar-picker.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`.

### components/calendar/quickCreateDefaults.ts

**Purpose** — Pure rules for where a quick-create draft starts: a week/day slot keeps (snapped) clicked time, a month click on another day starts at 09:00, a month click on today starts at the next half hour, and every bubble lasts 60 minutes.

**Public API** — `export interface QuickCreateRange { startWall: string; endWall: string; allDay: boolean }`; `defaultRangeForDate(dateWall: string, timeWall: string | null, now: Date, timezone: string): QuickCreateRange`; `defaultRangeFromSelection(startMs: number, endMs: number, allDay: boolean, timezone: string): QuickCreateRange`. Constants: `SNAP_MINUTES = 15`, `DURATION_MINUTES = 60`, `MORNING_START_MINUTES = 540`; helpers `minutesFromWall`, `wallFromMinutes`, `rangeFromMinutes`.

**State & side effects** — None: pure functions over `now` and the household `timezone`. `wallFromMinutes` rolls across midnight by adding/subtracting days, so a 23:30 slot ends at `…T00:30` on the next date while `dateWall` in the draft stays the clicked day.

**Depends on / Used by** — `lib/time/zone` (`addDaysToDate`, `utcToLocalDate`, `utcToLocalWallTime`). Called by `CalendarShell` (`handleDateClick`, `handleSelect`, `openQuickAtCentre`); `QuickCreateRange` is extended by `QuickCreateDraft`.

**Debugging** —
- Slot click gives 09:00 instead of the clicked hour -> `timeWall` arrived `null` -> check `handleDateClick`'s `info.allDay` branch.
- Instant-create start is a quarter hour early -> intended floor snap -> `defaultRangeForDate`.
- Draft lands on the wrong day for a late-night click -> `dateWall` kept the clicked day while `endWall` rolled over -> consumers must use `startWall.slice(0,10)` (`QuickCreatePopover.draftPayload`).

**Tests** — `tests/unit/quick-create-defaults.test.ts`.

### components/calendar/CalendarPicker.tsx

**Purpose** — Nested calendar chooser used wherever an event needs a calendar. Top-level calendars always list; a row's chevron reveals its sub-calendars; the list scrolls past 320 px. Only `kind === "calendar"` collections ever appear: `buildPickerRows` drops list branches, so a list passed by mistake is invisible.

**Public API** — `export function CalendarPicker(props: Props)`. Props: `collections: CollectionNode[]` (writable calendars; a `kind: "list"` branch is never drawn), `value: string`, `onChange(id: string)`, `variant?: "chip" | "field"` (default `"chip"`), `id?: string`. Constants: `FALLBACK_COLOR = "oklch(0.65 0.02 250)"`, `FOCUS`. Trigger carries `data-testid="calendar-picker-trigger"`; the list carries `data-testid="calendar-picker-list"`.

**State & side effects** — `open` and `expanded: ReadonlySet<string>`; rows come from `buildPickerRows(collections, expanded)`. On open it merges `expandedForSelection(collections, value)` into the expanded set so the selected branch is visible. Selecting a row calls `onChange` and closes. The portalled content stops Escape propagation so closing the list cannot also cancel the draft bubble behind it, and it carries `data-dismiss-ignore` so an enclosing dismiss-on-outside-click surface (the quick-create bubble) survives a row click. Its content also carries the shared `popover-in` enter animation (`origin-[var(--radix-popover-content-transform-origin)]`, `data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]`). No queries or storage; the trigger swatch/name come from `calendarSwatch`.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/button`, `components/ui/icons`, `lib/services/collections` (`CollectionNode`), `lib/ui/calendarPicker`, `lib/utils`. Rendered by `EventDialog` (`variant="field"`) and `QuickCreatePopover` (`chip`).

**Debugging** —
- Selected sub-calendar is scrolled out of view on open -> `expandedForSelection` returned no branch -> check the parent/child ids in the `CollectionNode[]` passed in.
- Escape closes the bubble and loses the title -> the `onKeyDown` stopPropagation was removed -> this file's `PopoverPrimitive.Content`.
- Swatch is grey for a real calendar -> `calendarSwatch` did not find the id (e.g. a read-only collection filtered out of `collections`) -> `FALLBACK_COLOR`.

**Tests** — `tests/e2e/calendar-picker.spec.ts`; helper module covered by `tests/unit/calendarPicker.test.ts`.

## Dialog date and time fields

### components/calendar/DateField.tsx

**Purpose** — The event dialog's date control: a field-styled button showing `formatWallDate(value)` ("Wed, 28 Oct 2026") that opens the shared `MiniMonth` grid in a Radix popover. It replaces `<input type="date">`, whose browser calendar cannot be styled or worded the way the household reads dates.

**Public API** — `export function DateField(props: Props)`. Props: `id: string`, `value: string` (`YYYY-MM-DD` in the household zone), `onChange(date: string)`, `label: string` (accessible name), `today?: string` (household-local today, forwarded to the picker's Today button), `eventDates?: ReadonlySet<string>` (dates with a visible event, rendered as neutral dots). Module constants `TRIGGER` (field recipe) and `SURFACE` (enter-animation recipe). The trigger carries `data-testid="date-field-trigger"`, `aria-haspopup="dialog"`, `aria-expanded`, and an `aria-label` of `label: <formatWallDate(value)>` (for example "Starts: Wed, 28 Oct 2026"); the portalled content carries `data-testid="date-field-popover"`.

**State & side effects** — State: `open` for the Radix popover plus `flash`/`flashTimer`. `pick(date)` calls `onChange`, closes the popover, and sets `data-flash="true"` on the trigger for 460 ms, which runs the global `field-ack` box-shadow animation; the timer is cleared on unmount. The body is `DatePickerPopover` keyed by `value`, with `anchorDate` and `selectedDate` both `value`, so a new value reseeds the shown month. The content's bubble `onKeyDown` stops Escape propagation, but that is defence in depth rather than the mechanism: while it is open the popover is the topmost Radix `DismissableLayer`, whose `document` **capture** listener consumes Escape before any bubble handler, so the calendar closes and the dialog stays. It also carries the shared `popover-in` enter animation (`origin-[var(--radix-popover-content-transform-origin)]`, `data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]`). No queries, storage or URL writes.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/button`, `components/ui/icons` (`CalendarIcon`), `lib/time/format` (`formatWallDate`), `lib/utils` (`cn`), `./DatePickerPopover`. Rendered twice by `EventDialog` (`event-start-date`, `event-end-date`).

**Debugging** —
- Escape closes the whole event dialog, not just the calendar -> the popover is not the topmost Radix `DismissableLayer` (it must be portalled inside its own `PopoverPrimitive.Root` and actually open), so the dialog's layer took the key; the bubble `stopPropagation` is not the mechanism -> this file's `PopoverPrimitive.Root`/`Content`.
- The calendar opens on the wrong month -> the `key={value}` remount was dropped, or `value` is not the picked date -> `DatePickerPopover`'s `anchorDate`.
- A pick does not pulse the field -> `data-flash`, the `field-ack` keyframes in `app/globals.css`, or the `pick` timer was removed -> `TRIGGER` and `pick`.
- The popover appears instantly instead of growing from the trigger -> `SURFACE`'s `data-[state=open]:animate-[popover-in_…]` class was dropped -> this file and `app/globals.css`.

**Tests** — `tests/e2e/event-fields.spec.ts` ("the date field opens the mini calendar and picks a day").

### components/calendar/TimeField.tsx

**Purpose** — The event dialog's time control: a field-styled button that opens a quick-pick list of 15-minute rows grouped by part of day, plus a typed field for a minute in between. It replaces `<input type="time">`, whose browser spinner ignores the household's 12/24-hour preference.

**Public API** — `export function TimeField(props: Props)`. Props: `id: string`, `value: string` (`HH:MM` in the household zone), `onChange(time: string)`, `timeFormat: TimeFormat`, `timezone: string` (used only to mark the row containing "now"), `label: string` (accessible name). Module constants: `SLOTS = timeSlots()` (96 rows), `BANDS` (Morning 00:00–11:45, Afternoon 12:00–16:45, Evening 17:00–20:45, Night 21:00–23:45), `BANDS_WITH_SLOTS`, `TRIGGER`, `SURFACE`. Test ids: `time-field-trigger`, `time-field-popover`, `time-field-selected` (on the selected row). The listbox is labelled `label` + " quick pick" (for example "Start time quick pick"); the trigger's accessible name is `label: <formatWallTime(value, timeFormat)>` (for example "Start time: 09:00").

**State & side effects** — State: `open`, `activeIndex` (seeded from `nearestSlotIndex(value)`), `typed`, `error`, `flash`, `listRef`, `flashTimer`, and `nowWall`, frozen at mount in a `useState` initialiser as `utcToLocalWallTime(Date.now(), timezone).slice(11, 16)`. `handleOpenChange` clears `typed`/`error` on every open and close, reseeds `activeIndex`, and centres the current value by setting the list's `scrollTop`. Each band renders `role="group"` with a sticky, `aria-hidden` header (10px, uppercase, ink-soft); rows are `role="option"` buttons with roving tabindex (only `activeIndex` is `tabIndex={0}`). Keyboard on the list: ArrowUp/ArrowDown move ±1 row, PageUp/PageDown ±4, Home/End jump to 00:00/23:45; `focusSlot` focuses and scrolls the row. Enter/Space activate the focused button, and `pick` calls `onChange`, closes, and pulses the trigger for 460 ms (`data-flash`, `field-ack`). The selected row (`slot === value`) is accent-filled with a `CheckIcon`; otherwise the row whose index equals the frozen "now" shows a "now" label. The footer input (label "Type a time") commits on Enter through `parseTypedTime(typed, timeFormat, meridiemOf(value) ?? "am")`; when that returns null it sets a `role="alert"` hint ("Type a 24-hour time, like 08:37." for `24h`, "Type a time, like 8:37 AM." for `12h`). On blur it commits only when the text is non-empty, no error is showing, and the text parses, so unreadable text reports only via Enter. The portalled content also stops Escape propagation in a bubble handler (defence in depth, not the mechanism) — the list closes without the dialog because, while open, the popover is the topmost Radix `DismissableLayer` and its `document` **capture** listener consumes Escape first — and it carries the shared `popover-in` enter animation.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/button`, `components/ui/icons` (`CheckIcon`, `ClockIcon`), `lib/services/preferences` (`TimeFormat`), `lib/time/format` (`formatWallTime`), `lib/time/zone` (`utcToLocalWallTime`), `lib/utils` (`cn`), and `./timeSlots` (`SLOT_MINUTES`, `meridiemOf`, `minutesOfDay`, `nearestSlotIndex`, `parseTypedTime`, `timeSlots`). Rendered by `EventDialog` for the start and end times when the event is not all-day.

**Debugging** —
- A typed time that looks valid is rejected -> `parseTypedTime` is format-aware: a 24-hour household rejects "8:37 PM" instead of guessing -> `commitTyped` and `components/calendar/timeSlots.ts`.
- The list opens at midnight for an existing off-grid value -> `nearestSlotIndex`/`handleOpenChange` did not run -> `nearestSlotIndex(value)`.
- The "now" marker sits on the wrong row or disappears -> `timezone` is wrong, or the marker was made live instead of frozen at mount -> `utcToLocalWallTime(Date.now(), timezone)`.
- Escape closes the event dialog as well -> the popover is not the topmost Radix `DismissableLayer` (portalled inside its own `PopoverPrimitive.Root`, actually open), so the dialog's layer took the key -> this file's `PopoverPrimitive.Root`/`Content`.
- Typing an invalid time and leaving the field does nothing -> intended: the alert is raised by Enter; blur only commits parseable text -> `onBlur`/`commitTyped`.

**Tests** — `tests/e2e/event-fields.spec.ts`; the slot grid and parser are unit-tested in `tests/unit/timeSlots.test.ts`.

### components/calendar/timeSlots.ts

**Purpose** — Pure rules behind the dialog's time control: the 15-minute quick-pick grid, the canonical `HH:MM` string form, and the parser for the typed-time field. Kept outside the component so the 12/24-hour matrix is unit-tested without rendering.

**Public API** — `export const SLOT_MINUTES = 15`; `export type Meridiem = "am" | "pm"`; `minutesOfDay(time: string): number | null`; `formatMinutes(total: number): string`; `timeSlots(stepMinutes?: number): string[]`; `nearestSlotIndex(time: string, stepMinutes?: number): number`; `meridiemOf(time: string): Meridiem | null`; `parseTypedTime(input: string, format: TimeFormat, meridiemFallback?: Meridiem): string | null`. Internal: `MINUTES_IN_DAY`, `HHMM`, `TYPED`, `pad`, `stepOf`.

**State & side effects** — None; every export is deterministic. `stepOf` falls back to `SLOT_MINUTES` for a non-finite or `< 1` step and rounds anything else. `minutesOfDay` accepts only `H:MM`/`HH:MM` with exactly two minute digits and hours ≤ 23, minutes ≤ 59; anything else is null. `formatMinutes` wraps totals outside the day into `00:00`–`23:59` rather than throwing. `timeSlots(step)` emits `00:00` up to but excluding `24:00`, so the default is 96 rows. `nearestSlotIndex` rounds the wall time to the nearest step, clamps into the available row range, and returns `0` for unparseable input. `meridiemOf` returns `"am"` before 12:00 and `"pm"` from 12:00, null when unparseable. `parseTypedTime` trims and lowercases, then accepts `H`, `H:MM` (one- or two-digit minutes) and an optional `am`/`pm`/`a.m.`/`p.m.` suffix. Minutes > 59 → null. In `24h` mode any suffix and any hour > 23 → null; otherwise it formats `hours * 60 + minutes`. In `12h` mode the hour must be 1–12; the suffix wins, a missing suffix inherits `meridiemFallback`, hour 12 becomes 0, and `pm` adds 720 minutes before formatting.

**Depends on / Used by** — `lib/services/preferences` (`TimeFormat`). Imported by `TimeField` and `tests/unit/timeSlots.test.ts`.

**Debugging** —
- "8:37 PM" is rejected although it looks valid -> the household preference is `24h`, where a suffix is not a reading -> `parseTypedTime`'s `format === "24h"` branch.
- A 12-hour value without am/pm lands in the wrong half of the day -> the caller passed no `meridiemFallback` (or a null `meridiemOf(value)` collapsed to the default) -> `TimeField.commitTyped`.
- `timeSlots(30)` still yields 96 rows -> the explicit step argument was ignored -> `stepOf`.
- An off-grid value focuses the wrong row -> `nearestSlotIndex` rounds rather than floors (08:37 → index 34, 08:50 → 35) -> this file.

**Tests** — `tests/unit/timeSlots.test.ts`.

## Event details and editing

### components/calendar/EventDetails.tsx

**Purpose** — The presentational facts-and-actions body shared by the desktop popover and the phone dialog: title, when, repeat summary, calendar row, map link, clamped notes and the action buttons.

**Public API** — `export interface EventDetailsProps` with `event: EventView`, `calendarName`, `color`, `timezone`, `timeFormat: TimeFormat`, `occurrenceStart`, `readOnly`, `onEdit()`, `onDelete()`, `onDuplicate()`, `onClose()`; `export function EventDetails(props)`. Constant `CLAMPED_DESCRIPTION_LENGTH = 140`.

**State & side effects** — One state: `expanded` for the notes clamp. Derived text via `formatOccurrenceHeading`, `formatOccurrenceWhen` and `describeRrule`. Location renders as a Google Maps search link (`https://www.google.com/maps/search/?api=1&query=…`, `target="_blank"`). `readOnly` hides Edit, Duplicate and Delete and shows a "View only" note. It owns no dialog semantics, focus management, queries or storage.

**Depends on / Used by** — `components/ui/button`, `lib/recurrence/label` (`describeRrule`), `lib/services/events` (`EventView`), `lib/services/preferences` (`TimeFormat`), `lib/time/format`. Rendered by `EventDetailsPopover`; not rendered directly by the shell.

**Debugging** —
- A later occurrence shows the series start date -> the wrong `occurrenceStart` key reached this component -> trace `selection.occurrenceStart` in `CalendarShell` (`eventClick` uses `extendedProps.occurrenceStart`).
- "Show more" never appears on long notes -> the 3-line CSS clamp hides it at a different length than 140 chars -> both conditions gate the button; check `CLAMPED_DESCRIPTION_LENGTH`.
- Edit/Delete missing for the owner -> `readOnly` was computed from a collection id missing in `collections` -> `readOnlyCollectionIds` in `CalendarShell`.

**Tests** — `tests/e2e/details.spec.ts`, `tests/e2e/viewonly.spec.ts`.

### components/calendar/EventDetailsPopover.tsx

**Purpose** — Anchors `EventDetails` to the clicked event block on desktop and renders the same body in a dialog below 768 px, where a popover would be clipped.

**Public API** — `export function EventDetailsPopover(props: Props)` where `Props extends EventDetailsProps` plus `anchorRect: DOMRect` and `anchorElement: HTMLElement | null`.

**State & side effects** — `useMediaQuery("(max-width: 767px)")` picks the surface; `contentRef` drives the autofocus choice. Radix owns Escape, outside-click and focus return. The desktop branch is a **non-modal** Popover, so it does **not** trap focus; only Escape, an outside click or the explicit close action dismisses it, and `onCloseAutoFocus` returns focus to the anchor. `onOpenAutoFocus` prevents the default and focuses `[data-action="edit"]` (falling back to the first button); `onCloseAutoFocus` returns focus to `anchorElement`. Closing calls `details.onClose()`. The desktop anchor is a 1 px fixed-position `span` at `anchorRect.left/top`, so the popover survives grid re-renders.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/dialog`, `lib/ui/useMediaQuery`, `./EventDetails`. Rendered by `CalendarShell` when `selectedEvent && selection`.

**Debugging** —
- Popover appears in the wrong corner after scrolling -> the stored `anchorRect` is stale -> `handleEventClick` captured it at click time; re-select the event.
- Focus does not return to the event block -> `anchorElement` was null (block re-rendered) -> check the `info.el` passed from `CalendarShell`.
- On a tablet the popover is clipped by the grid -> the 768 px breakpoint no longer matches the layout -> `useMediaQuery` string in this file and `AppShell`'s `md`.

**Tests** — `tests/e2e/details.spec.ts`.

### components/calendar/RecurrenceFields.tsx

**Purpose** — Google Calendar's "Custom recurrence" panel, rendered inline under the Repeat select: interval, weekly weekday picker, monthly day/nth-weekday pattern, Never / On date / After N ends, a live human summary and inline validation.

**Public API** — `export function RecurrenceFields(props: Props)`. Props: `value: RepeatOptions`, `startDate: string`, `allDay: boolean`, `timezone: string`, `weekStartsOn: number`, `today: string`, `error: string | null`, `onChange(next: RepeatOptions)`. No exported types.

**State & side effects** — None: fully controlled by `EventDialog`, and renders only while a repeat exists. Every control emits a whole new `RepeatOptions`. The weekly row is `Button`s with `aria-pressed` in household week-start order; unticking the last checked day is refused (Google keeps at least one). The monthly radios switch between `dayOfMonth` and `weekday` modes, re-deriving the other mode's default from `startDate`. Ends: `Never` / `On` (a `DateField`, defaulting to the start date) / `After` (1–730). The summary is `describeRrule(formatRepeatRule(...))` in an `aria-live="polite"` paragraph; `error` renders as `role="alert"`. An `advanced` parsed rule shows a note that editing these controls replaces its extra parts.

**Depends on / Used by** — `components/ui/button`, `lib/recurrence/label` (`describeRrule`), `lib/recurrence/rule` (`clampInt`, `dayOfMonthOf`, `formatRepeatRule`, `monthlyAnchor`, `weekdayOfDate`, `weekdayOrder`, `RepeatOptions`), `./DateField`. Rendered by `EventDialog`.

**Debugging** —
- A weekday cannot be unticked -> the last checked day is intentionally locked (`toggleWeekday`).
- The summary disagrees with the controls -> `formatRepeatRule`/`describeRrule` received a different `allDay`/`timezone` context -> check the props `EventDialog` passes.
- Save is disabled with no visible field error -> the error paragraph is inside this panel; check `validateRepeat` through `EventDialog`'s `repeatError`.

**Tests** — `tests/e2e/repeat.spec.ts`; the rule maths in `tests/unit/recurrence-rule.test.ts`.

### components/calendar/EventDialog.tsx

**Purpose** — The full create/edit form: title, calendar (nested picker), all-day, start/end date and time, repeat controls (preset plus the custom-recurrence panel), location, notes, and a save guard. On edit it opens on the clicked occurrence; saving a repeating event hands the payload to `CalendarShell`, which asks for the scope before writing.

**Public API** — `export interface EventDialogInitial { event?: EventView; occurrenceStart?: string; start: string; end: string; allDay: boolean; pendingTitle?: string }`; `export function EventDialog(props: Props)`. Props: `mode: "create" | "edit"`, `initial`, `initialRule?: string | null`, `timezone`, `timeFormat: TimeFormat`, `weekStartsOn: number`, `collections: CollectionNode[]`, `defaultCollectionId?: string | null`, `onClose()` (success/programmatic), `onCancel?()` (runs the shell's unsaved guard), `onDirtyChange?(dirty)`, `onSaveRequest?(payload, { repeatTouched })` (the shell owns the scope chooser and mutation), `externalPending?: boolean`. Module constants `CONTROL`, `TEXTAREA`, `LABEL`; helpers `splitWall`, `isWeekdaySelection`.

**State & side effects** — Field state: `title`, `collectionId`, `allDay`, `startDate`, `startTime`, `endDate`, `endTime`, `description`, `location`, plus the repeat state: `recurrence: RepeatOptions | null` (parsed once from `initialRule` through `parseRepeatRule`, frozen as `initialParse`), `repeatTouched`, and `presetLabels`. The `collections` prop is filtered once into `calendars` (`kind === "calendar"`), which drives both the picker and the defaults: `fallbackCollectionId` is `calendars[0]?.id` and a requested default is only accepted when it names a calendar, so a list can never become the selection. `selectedCollectionId` falls back live to `calendars[0]?.id` while the list loads. `occurrenceSeeded` is true when the shell passed the clicked `occurrenceStart`: the date/time fields then seed from the clicked occurrence (not the stored series start, and not the event's own `startAt`), while a non-recurring edit or a create keeps the previous event/initial seeding. `keepInitialRule` is computed (`initialRule` present, `!repeatTouched`, start date and all-day unchanged) and decides whether the server receives the stored rule byte-identically or a rule rebuilt by `formatRepeatRule`; `repeatError` comes from `validateRepeat` and also disables Save. Changing the Repeat preset installs defaults anchored on the start date (weekly → its weekday, monthly → the nth weekday, "Every weekday" → Mon–Fri), preserving the interval and end. Moving the start date re-anchors a still-uncustomised weekly/monthly pattern (`anchorRepeat`). `today` is frozen once per open with `useState(() => utcToLocalDate(Date.now(), timezone))` and passed to the `DateField`s, so their pickers' Today button uses the household's day rather than the device's. The date fields are `DateField` and the time fields are `TimeField` (not native `<input type="date">`/`<input type="time">`); `CONTROL` and `TEXTAREA` carry `transition-colors duration-150` and `hover:border-ink-soft` in addition to the accent focus ring. Every setter calls `markDirty()`. Mutations: `useCreateEvent` (pushes an undo that deletes the new row and shows a 10 s Undo toast), `useUpdateEvent` (PATCH of the whole series), `useDeleteEvent` (only for that undo), `useUpdatePreferences({ lastEventCalendarId })`. Save is disabled while `pending`, with an empty title, no calendar, or a repeat-control error. On a recurring edit it shows a "saves every occurrence" notice. The form caps its height (`max-h-[calc(100dvh-12rem)]`) and makes the footer sticky below `md`; its scroll area pads 4px horizontally (`px-1`) because `overflow-y-auto` clips at the padding box and the focused field's 2px outline sits 2px outside its border box (a flush-left field loses its ring's left side).

**Depends on / Used by** — `sonner`, `components/ui/button`, `lib/query/events` (`useCreateEvent`, `useDeleteEvent`, `useUpdateEvent`, `EventInputPayload`), `lib/query/preferences`, `lib/services/preferences` (`TimeFormat`), `lib/time/zone` (`utcToLocalDate`, `utcToLocalWallTime`), `lib/recurrence/label` (`describeRrule`), `lib/recurrence/rule` (`anchorRepeat`, `formatRepeatRule`, `monthlyAnchor`, `newRepeatOptions`, `parseRepeatRule`, `validateRepeat`, `weekStartOf`, `weekdayOfDate`), `lib/ui/undo`, `./eventPayload`, `./CalendarPicker`, `./DateField`, `./RecurrenceFields`, `./TimeField`. Rendered by `CalendarShell` inside its `Dialog`; the shell keeps it mounted under `hidden` while the discard prompt or scope chooser shows.

**Debugging** —
- Saving an untouched weekly rule turns into `FREQ=WEEKLY` -> `keepInitialRule` is false: a repeat control was touched, or the start date / all-day toggle moved since the dialog opened -> this file's `keepInitialRule`.
- A series' first block appears days after its start date -> the stored `BYDAY`/`BYMONTHDAY` disagrees with `DTSTART` (the pre-editor bug, or an import); moving the start date re-anchors it, and picking the days explicitly rewrites it.
- "Does not repeat" shows for a series that does repeat -> `parseRepeatRule` returned `null` because `FREQ` is outside DAILY/WEEKLY/MONTHLY/YEARLY (e.g. `FREQ=HOURLY` from an import); the stored rule is preserved until Repeat changes and the dialog shows the unsupported-rule note.
- The end date picker rejects an earlier date -> `validateRepeat` requires the repeat end to be on/after the start date and under Google's 730-occurrence cap.
- The form shows the series' first date/time after clicking a later occurrence -> `occurrenceStart` was not passed to `openEdit`, or `occurrenceSeeded` read a falsy id -> `CalendarShell.openEdit`/`occurrenceWalls`.
- Saving a repeating edit does nothing -> `onSaveRequest` was omitted, so the dialog fell back to its own series PATCH and closed without a chooser -> the shell's `<EventDialog>` props.
- The repeat controls are changed but “This event” is clickable in the scope chooser -> the shell must disable it when `repeatTouched` (a single occurrence cannot carry a series rule) -> `confirmEditScope`/the `ScopeDialog` `disabled` prop.
- Editing an exception (a moved instance) still asks for a scope -> expected: the exception row has `rrule: null`, so `handleEditSaveRequest` takes the plain single-event path.

## Recurring scope chooser

### components/calendar/ScopeDialog.tsx

**Purpose** — Google Calendar's recurring-scope body: the three stackable actions (“This event”, “This and following events”, “All events”) plus Cancel, with an optional explanation note and disabled options. The surrounding `DialogContent` (drag/resize/delete) or the Edit dialog's prompt supplies the title.

**Public API** — `export type RecurringScope = "this" | "following" | "all"`; `export interface ScopeDialogProps { description: string; note?: string; disabled?: RecurringScope[]; onChoose(scope): void; onCancel(): void }`; `export function ScopeDialog(props)`. Internal constant `OPTIONS` holds the labels in Google's order; “All events” is the primary button.

**State & side effects** — Stateless/presentational. `useId()` names the note paragraph for `aria-describedby`; disabled buttons point at that note. Every button calls back into `CalendarShell`; nothing is mutated here.

**Depends on / Used by** — `components/ui/button`; rendered by `components/calendar/CalendarShell.tsx` for drag/resize/delete and for the Edit-form scope prompt.

**Debugging** —
- A chooser option is offered but the server refuses it -> the `disabled` prop was not wired for a custom repeat rule (`canShiftSeries`) or a touched repeat control; keep the client gate and the service `VALIDATION` in sync.
- The note is not announced with the disabled option -> the `aria-describedby` target (`useId`) was dropped.

**Tests** — `tests/e2e/recurring-scope.spec.ts` (all three scopes, cancel, undo, custom-rule disabled options).

## Search

### components/calendar/SearchBox.tsx

**Purpose** — Header combobox over the household event search. It debounces the query, exposes the results list, and navigates by pushing `/?date=…&event=…` so the shell owns the deep link.

**Public API** — `export function SearchBox(props: Props)`. Props: `timezone`, `timeFormat: TimeFormat`, `inline?: boolean` (results in flow, for the phone dialog), `autoFocus?: boolean`, `onNavigate?: () => void`. No exported types.

**State & side effects** — State: `query`, `open`, `activeIndex`; `useId()` for the listbox id. `useDebouncedValue(query, 150)` feeds `useSearchEvents(debounced)` (`["events","search",normalized]`, enabled at ≥2 trimmed chars, `keepPreviousData`). `activeRow` clamps rather than resetting. Effects: subscribes to the `nailong:focus-search` bus via `onFocusSearch`, adds a `window` keydown for `/` (ignored in inputs/textareas/selects/contentEditable, and when Ctrl/Meta/Alt is held), and adds a `document` mousedown listener while open to close on outside clicks. Keyboard: ArrowDown/ArrowUp move, Enter opens the active (or first) row, Escape clears the query first and only then closes/blurs. Choosing calls `announceEventLink({ date, eventId })` **before** `router.push`, so the shell knows the click time rather than the moment the URL commits, then resets query/open.

**Depends on / Used by** — `next/navigation`, `components/ui/icons`, `lib/query/search` (`useSearchEvents`, `navigableDateFor`), `lib/ui/useDebouncedValue`, `lib/ui/searchBus`, `./SearchResultsOverlay`. Rendered by `BreadcrumbBar` (desktop inline block at `lg`, phone dialog with `inline autoFocus`).

**Debugging** —
- `/` types a slash into a field -> `isTextEntryTarget` missed the element type -> this file's guard, and the same guard in `useKeyboardShortcuts`.
- Results stay for the previous query -> `keepPreviousData` is intentional; check `isFetching` is passed to the overlay for the "Searching…" state.
- Picking a result does not move the grid -> the pushed URL lost `date` or `event` -> `choose`/`navigableDateFor`.
- Results panel is clipped on a phone -> the caller did not pass `inline` -> `BreadcrumbBar`.
- The field widens as soon as it is focused/clicked -> the panel's `26rem` width was on an in-flow wrapper inside this shrink-to-fit header block, so the `w-full` field grew to match it -> keep the width on the floating panel (`SearchResultsOverlay`), never on a flow wrapper. Regression: `tests/e2e/search.spec.ts` "does not resize the search field".

**Tests** — `tests/e2e/search.spec.ts`, `tests/e2e/shell.spec.ts` (search button placement).

### components/calendar/SearchResultsOverlay.tsx

**Purpose** — The result panel: month-grouped rows with day/month, highlighted title, time + calendar name and a colour swatch, plus hint/empty/searching states.

**Public API** — `export function SearchResultsOverlay(props: Props)`. Props: `id` (listbox id), `query`, `results: EventView[] | undefined`, `isFetching`, `activeIndex`, `timezone`, `timeFormat`, `inline?: boolean`, `onSelect(event)`, `onActiveIndexChange(index)`. Internal helpers `highlight`, `monthLabel`, `dayNumber`, `rowTime`.

**State & side effects** — No state. Reads `useCollections()` for id→name, groups rows by `monthLabel(navigableDateFor(event, timezone))` (insertion order), and renders `role="listbox"`/`role="option"` with `aria-selected`, `aria-activedescendant` targets and an `aria-live` result count. `highlight` marks the first case-insensitive match for queries of 2+ chars. With fewer than 2 trimmed characters it shows the hint instead of an empty list. `inline` switches `absolute left-0 top-full` (which carries the floating `w-[26rem] max-w-[calc(100vw-2rem)]` width — the panel is out of flow, so the width must live here and never on an in-flow wrapper) to `mt-2`.

**Depends on / Used by** — `lib/query/collections`, `lib/query/search` (`navigableDateFor`), `lib/time/format`, `lib/utils` (`cn`). Rendered only by `SearchBox`.

**Debugging** —
- Rows group under the wrong month -> `monthLabel` parses `formatWallDate` by spaces -> changing that format breaks the split here.
- Highlight marks the wrong substring -> only the first match is wrapped -> `highlight`.
- Calendar name column empty -> `useCollections` cache is cold or the event's calendar was deleted -> `collectionNames` map.

**Tests** — `tests/e2e/search.spec.ts`, `tests/e2e/screenshot.spec.ts` (visual).

## Mini month and date navigation

### components/calendar/MiniMonth.tsx

**Purpose** — A neutral month grid with roving-tabindex keyboard navigation and a dot for days that have visible events; used by the sidebar, the toolbar's date picker and the dialog's `DateField`. Every week row is padded with muted days from the adjacent months, so the grid has no blank holes.

**Public API** — `export interface MiniMonthProps { anchorDate: string; selectedDate?: string; eventDates?: ReadonlySet<string>; onSelectDate(date); onAnchorChange(firstOfMonth); onTaskDrop?: (drag: TaskDragPayload, date: string) => void; labelledBy?: string }`; `export function MiniMonth(props)`. Module data: `WEEKDAY_INITIALS`, `WEEKDAY_NAMES`, `MONTH_NAMES`, `DATE_PATTERN`; helpers `pad`, `iso`, `parts`, `weekdayIndex`, `daysInMonth`, `shiftMonth`, `shiftMonthKeepingDay`, `localToday`.

**State & side effects** — `focusDate` (roving tab stop) and `containerRef`. `moveFocus` sets state then focuses `[data-mini-date=…]` inside a `requestAnimationFrame`. Arrows move ±1/±7 days, Home/End go to week bounds, PageUp/PageDown shift a month keeping the day; crossing a month boundary calls `onAnchorChange(iso(y, m, 1))`. Clicking a day calls `onSelectDate`. **Task drop:** when `onTaskDrop` is supplied every in-month day button also accepts a dragged task row — `onDragOver` calls `preventDefault` only for `dataTransfer.types` containing `text/x-nailong-task`, sets `dropEffect = "move"` and `data-task-drop-active` (the `bg-info-soft` + accent inset-ring affordance); `onDragLeave` clears it when the pointer leaves the button; `onDrop` reads the payload (id + the row's previous `scheduledOn`) through `lib/ui/taskDrag`, clears the attribute, calls `preventDefault` and `onTaskDrop(drag, date)`. The day's click handler is unchanged, so navigation works whether or not the grid is a drop target. Leading and trailing adjacent-month days are rendered as muted, `aria-hidden` `<span>`s — 32px (`h-8 w-8`), `text-ink-mute/45`, not `gridcell`s and not clickable/droppable — so the roving focus model only ever lands on in-month buttons. In-month cells are `h-8 w-8` buttons: the selected day is accent-filled with `shadow-sm`, today is bold in link colour with an inset ring (`ring-1 ring-inset ring-link/35`); unselected cells get `hover:bg-well`/`active:bg-line`, the selected cell uses `active:bg-accent-hover`, and every cell has `active:scale-95` and a `focus-visible` outline. Cells expose `aria-label` ("Wednesday 4 March, has events"), `aria-selected`, `aria-current="date"` for today and `role="gridcell"`. Dots are always neutral (`bg-ink-soft`, white when selected).

**Depends on / Used by** — `components/ui/button`, `components/ui/icons`, `lib/time/zone` (`addDaysToDate`), `lib/ui/taskDrag` (`isTaskDrag`, `readTaskDrag`, `TaskDragPayload`), `lib/utils` (`cn`). Rendered directly by `DatePickerPopover` and `SidebarMiniMonth` (so it is also the body of `DatePickerPopover`'s consumer `TaskPlanPopover`); only the sidebar passes `onTaskDrop`.

**Debugging** —
- The mini month starts on Sunday even though the household week starts elsewhere -> expected: the grid hardcodes Sunday-first (`WEEKDAY_INITIALS`/`weekdayIndex`); only FullCalendar honours `weekStartsOn` -> this file.
- Arrow keys do not move focus -> `focusDate` points at a date not in the current month, so no cell has `tabIndex={0}` -> `moveFocus`/`ensureMonthVisible`.
- Event dots never appear in the sidebar -> the caller's `eventDates` set is empty -> `SidebarMiniMonth`'s range and visibility filter.
- Clicking a grey leading/trailing day does nothing -> intended: those cells are decorative `aria-hidden` spans, not buttons -> the `cell.inMonth` branch.
- Mini month rings a different "today" than the grid -> `localToday` uses the device clock/zone, not the household timezone (the picker's Today button is the caller's separate `today` prop) -> this file and `DatePickerPopover`.
- A task row dropped on a mini-month day does nothing -> no `onTaskDrop` reached `MiniMonth`, or the drag was not the task MIME type (only that type is accepted) -> the caller and `lib/ui/taskDrag`.
- The drop highlight sticks to a day -> `onDragLeave`/`onDrop` stopped deleting `data-task-drop-active` -> this file's `taskDropProps`.

**Tests** — `tests/e2e/mini-month.spec.ts`; the task-row drop on the sidebar mini month is `tests/e2e/tasks.spec.ts` scenario 3.

### components/calendar/DatePickerPopover.tsx

**Purpose** — Popover body for the toolbar title, the event dialog's date field and the two task date fields (the row's Plan popover and the editor's due date): a `MiniMonth` plus a right-aligned "Today" button.

**Public API** — `export function DatePickerPopover(props: Props)`. Props: `anchorDate`, `selectedDate?`, `eventDates?: ReadonlySet<string>`, `today?: string` (household-local today; falls back to the device clock), `onPick(date: string)`. No exported types.

**State & side effects** — Local `anchor` seeded from `anchorDate`; only `onAnchorChange` updates it. `today` is the caller's `today` prop when supplied, else `new Date()` formatted `YYYY-MM-DD` in the device's local zone. The Today button is a ghost button in link colour (`variant="ghost"`, `className="text-link"`). `onPick` is called for both a day click and the Today button; closing the popover is the caller's job. No queries or storage.

**Depends on / Used by** — `components/ui/button`, `./MiniMonth`. Rendered by `Toolbar` inside its popover (which keys it by `anchorDate` so it re-seeds), by `DateField` inside the event dialog's popover (keyed by the field value), and by `TaskPlanPopover` (keyed by the task's `scheduledOn`) and `TaskEditorDialog` (keyed by `dueOn`), whose popover shells live in those files.

**Debugging** —
- Picker opens on the wrong month -> the `key={anchorDate}` (toolbar) or `key={value}` (date field) remount was removed -> `Toolbar` / `DateField`.
- "Today" jumps to yesterday/tomorrow for a travelling user -> the caller did not pass `today`, so the device-clock fallback is used; `Toolbar` omits it while `DateField` forwards `EventDialog`'s household date -> this file's `today` prop.

**Tests** — `tests/e2e/mini-month.spec.ts` ("the toolbar title opens a date picker").

## Shortcuts

### components/calendar/ShortcutHelpDialog.tsx

**Purpose** — The `?` reference sheet: three static groups (Global, Calendar, Editing) of descriptions with `kbd` key caps.

**Public API** — `export function ShortcutHelpDialog(props: { open: boolean; onClose: () => void })`. Internal constant `GROUPS` is the whole content; nothing reads live bindings.

**State & side effects** — None beyond Radix dialog open/close; `onOpenChange(false)` calls `onClose`. Rendering the sheet does not enable, disable or verify any shortcut.

**Depends on / Used by** — `components/ui/dialog`, `components/ui/button`. Rendered by `CalendarShell` (`helpOpen`, set from the `?` key and the toolbar button).

**Debugging** —
- The sheet lists a key that does nothing (`g` go to date) -> `GROUPS` is documentation only; `CalendarShell` never passes `onOpenDatePicker` -> this file plus `useKeyboardShortcuts`.
- A new shortcut is missing from the sheet -> `GROUPS` is hand-maintained -> add the row here when binding it in `useKeyboardShortcuts`.

**Tests** — `tests/e2e/shortcuts.spec.ts`.

## Data mapping and styling

### components/calendar/eventPayload.ts

**Purpose** — Pure form-to-payload conversion for `EventDialog`, including the rule-preservation contract: a rule the user did not touch must reach the server byte-identical.

**Public API** — `export type RepeatPreset = "none" | "daily" | "weekly" | "monthly" | "yearly"`; `deriveRepeat(rule: string | null | undefined): RepeatPreset` (fallback label for a rule the structured editor cannot represent); `export interface EventFormValues` (includes `recurrence: RepeatOptions | null`, `keepInitialRule: boolean`, `initialRule: string | null`); `buildEventPayload(values: EventFormValues): EventInputPayload`.

**State & side effects** — None; fully deterministic. `deriveRepeat` matches `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` by substring and returns `"none"` for anything unrecognised. `buildEventPayload` emits `initialRule` byte-identical when `keepInitialRule` is true, otherwise it serialises `recurrence` with `formatRepeatRule` (or `null` when there is no repeat); empty description/location become `null`; all-day clamps `endDate` up to `startDate` and nulls the instants; timed converts both walls with `localWallTimeToUtc` and nulls the dates.

**Depends on / Used by** — `lib/query/events` (`EventInputPayload`), `lib/recurrence/rule` (`formatRepeatRule`, `RepeatOptions`), `lib/time/zone` (`localWallTimeToUtc`). Imported by `EventDialog`.

**Debugging** —
- A `BYDAY`/`COUNT` series silently loses its details after save -> `keepInitialRule` was false, so the payload rebuilt the rule from the controls; that is the intended contract once Repeat is edited -> check `repeatTouched` in `EventDialog`, not this file.
- A rule the user never touched still changes -> `keepInitialRule` was false because the start date or all-day toggle changed (both legitimately rebuild the rule) -> `EventDialog`'s comparison against `initialStartDate`/`initialAllDay`.
- An all-day repeat is saved with a `…Z` `UNTIL` (or a timed one with a DATE) -> `buildEventPayload` passed the wrong `allDay` into `formatRepeatRule` -> `EventDialog`'s `allDay` state.
- Unticking "All day" leaves stale `startDate` -> the branch nulling the opposite pair was edited -> `buildEventPayload`.
- End before start is accepted -> only all-day has a clamp; timed ranges are sent as typed -> `buildEventPayload`.

**Tests** — `tests/unit/event-payload.test.ts`.

### components/calendar/toFcEvent.ts

**Purpose** — Maps one recurrence occurrence plus its `EventView` into a FullCalendar 7 event and encodes/decodes the composite occurrence id.

**Public API** — `export interface PlannerFcEvent extends EventInput` with `extendedProps: { eventId; collectionId; occurrenceStart; description; location; accent; calendarName }`; `occurrenceFcId(eventId, startKey): string` (`"<eventId>::<startKey>"`); `parseOccurrenceFcId(id): { eventId; startKey } | null`; `occurrenceToFcEvent(occurrence, event, calendarName = ""): PlannerFcEvent`.

**State & side effects** — None. All-day events use `startDate` as the FC start and `endDate + 1 day` as the exclusive end; timed events use ISO instants. `color` is `event.color.containerHex` with `contrastColor = onContainer`; the saturated `mainHex` travels only in `extendedProps.accent`. The FC `id` is the composite occurrence id, so one series renders as many ids.

**Depends on / Used by** — `@fullcalendar/react` (`EventInput`), `lib/recurrence/expand` (`Occurrence`), `lib/services/events` (`EventView`), `lib/time/zone` (`addDaysToDate`). Used by `CalendarView` (`occurrenceToFcEvent`) and `CalendarShell` (`parseOccurrenceFcId` in click/drag handlers).

**Debugging** —
- An event id parser returns `null` -> the FC event was not created here (or an id lost its `::`) -> `parseOccurrenceFcId` splits on the first `::`.
- A one-day all-day event renders zero-width -> the +1 day exclusive end was dropped -> `occurrenceToFcEvent`.
- Text is unreadable on an event -> `containerHex`/`onContainer` came from the wrong shade -> `lib/color/palette` and `EventView.color`.

**Tests** — `tests/unit/toFcEvent.test.ts`.

### components/calendar/taskChip.ts

**Purpose** — Maps one scheduled `TaskView` into the FullCalendar event that renders as a task chip, and owns the chip contract: a `task:`-prefixed id, an exclusive all-day range, `editable: false`, the collection accent, and `extendedProps.kind = "task"` so the grid never routes it to event details/edit. Unscheduled tasks produce no chip. **Accepted superset (controller ruling):** a chip is an all-day event on the one shared `events` array, so it also renders in the Week, Day and List views; it stays read-only there too (no drag/resize, click = task editor) and only month day cells attach task-drop listeners.

**Public API** — `export const TASK_FC_ID_PREFIX = "task:"`; `export interface TaskChip extends EventInput` with `extendedProps: { kind: "task"; taskId; collectionId; collectionName; completed; accent; ariaLabel }`; `taskChip(task: TaskView): TaskChip | null`. A `task` with `scheduledOn === null` returns `null`.

**State & side effects** — None; pure. `start` is the `scheduledOn` date string (never a timestamp) and `end` is `addDaysToDate(scheduledOn, 1)` because FullCalendar's all-day end is exclusive. `title` is the bare task title; `extendedProps.ariaLabel` is `Task: <title>`; `classNames: ["fc-task-chip"]`. `accent` is `shadeTokens(collection.hueFamily, collection.shadeIndex).mainHex` (the saturating bar colour `eventDidMount` paints); a legacy collection with a null/unknown hue family falls back to `shadeTokens("slate", PARENT_SHADE_INDEX)`. `completed` is `status !== "open"` — always false in practice because `CalendarShell.visibleTasks` keeps only `status === "open"` rows (so the optimistic cache holding a just-finished row cannot paint a chip) — and the mapping never emits time-of-day data or an `event.taskId` (v0.3 time blocks are out of scope).

**Depends on / Used by** — `@fullcalendar/react` (`EventInput`), `lib/color/palette` (`SHADE_COUNT`, `PARENT_SHADE_INDEX`, `isHueFamily`, `shadeTokens`, `ShadeTokens`), `lib/services/tasks` (`TaskView`), `lib/time/zone` (`addDaysToDate`). Used by `CalendarView`, which maps the shell's `visibleTasks` through it; unit-tested standalone.

**Debugging** —
- A task chip opens event details or the event form -> the chip lost `extendedProps.kind = "task"` (or the shell's click branch) -> this file and `CalendarShell.handleEventClick`.
- A task chip drags or resizes -> `editable`/`durationEditable` stopped being `false` -> this file.
- A one-day chip spans two days -> the exclusive end was not `scheduledOn + 1 day` -> this file.
- A chip is missing an accent or is grey -> the collection has no palette hue (Inbox/legacy) so the neutral fallback ran -> the collection row's `hueFamily`/`shadeIndex`.
- A task appears on the grid although it was never scheduled -> the `scheduledOn === null` guard was dropped -> this file.

**Tests** — `tests/unit/taskChip.test.ts` (exclusive next-day end, id prefix, non-editable, unscheduled → none, accent from the collection and the neutral fallback, extendedProps task contract).

### components/calendar/fullcalendar-overrides.css

**Purpose** — The Canvas surface for FullCalendar 7: palette variables, hairlines, the today badge, event block typography, task-chip and task-drop styling, agenda table styling, focus rings and a short-viewport fallback.

**Public API** — No exports. It is imported for side effects by `CalendarView`. It targets the semantic classes the view's class generators attach (`html .fc`, `.fc-col-header-cell`, `.fc-daygrid-day`, `.fc-daygrid-day-number`, `.fc-day-today`, `.fc-day-other`, `.fc-event`, `.fc-event-inner`, `.fc-event-time`, `.fc-event-title`, `.fc-task-chip`, `.fc-more-link`, `.fc-timegrid-slot-label`, `.fc-list-*`, `.fc-view-list`) plus the `data-task-drop-active` attribute the drop listeners set.

**State & side effects** — Restyles FC's `--fc-classic-*` variables from app tokens on `html .fc` (specificity `0,1,1` beats FC's `:root` palette regardless of import order), marks today with a 28 px accent circle instead of a background, paints the 3 px left bar with `border-left-color` (set per event by `eventDidMount`), renders `.fc-event.fc-task-chip` as a 12 px muted-well chip whose left bar is the owning list's accent (so it reads as a task, not an event, while keeping the grid's normal stacking and "+N more"), highlights a day cell that carries `data-task-drop-active="true"` with `--color-info-soft` plus an inset 2 px accent ring, hides in-cell events under `max-height: 480px`, gives events a 3 px focus outline, and raises `.fc-more-link`/event min-heights for coarse pointers.

**Depends on / Used by** — App design tokens (`--color-line`, `--color-ink`, `--color-well`, `--color-accent`, `--color-info-soft`, `--color-line-strong`, `--radius-pill`, …) defined by the global stylesheet. Imported once, by `CalendarView`.

**Debugging** —
- Canvas colours lose to FullCalendar's defaults -> the `html .fc` selector was simplified, so FC's `:root` wins -> this file's first rule.
- Day-cell borders turn ink-coloured -> FC's `border-inline-*: 0 !important` shorthands reset the colour -> the `.fc-daygrid-day { border-color: … !important }` rule.
- Events vanish entirely in a phone landscape -> expected under `max-height: 480px` -> Week/Day/List carry detail there.
- Left colour bar missing while the fill is correct -> `borderColor` was reintroduced as an FC option (v7 ignores it) -> `eventDidMount` in `CalendarView`.
- A task chip looks exactly like a timed event -> the `.fc-event.fc-task-chip` rule was dropped or lost the extra class specificity -> this file.
- A dragged task gives no day-cell feedback -> the `data-task-drop-active` rule was dropped, or `CalendarView` stopped setting the attribute -> this file plus `CalendarView`'s `dayCellDidMount`.

**Tests** — `tests/e2e/calendar-style.spec.ts`, `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/design-tokens.spec.ts`; task chips/drop affordance in `tests/e2e/tasks.spec.ts` (Lead-run).

## Focused verification
```bash
npx vitest run tests/unit/event-payload.test.ts tests/unit/quick-create-defaults.test.ts tests/unit/toFcEvent.test.ts tests/unit/taskChip.test.ts tests/unit/task-drag.test.ts
npx playwright test tests/e2e/events.spec.ts tests/e2e/tasks.spec.ts
npm run lint && npm run typecheck
```
