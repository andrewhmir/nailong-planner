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
| `components/calendar/SearchBox.tsx` | Header search combobox plus `/` focus handling |
| `components/calendar/SearchResultsOverlay.tsx` | Grouped result list with month headers and highlighting |
| `components/calendar/MiniMonth.tsx` | Keyboard-navigable month grid with neutral event dots |
| `components/calendar/DatePickerPopover.tsx` | Mini month plus "Today" shortcut for the toolbar title |
| `components/calendar/ShortcutHelpDialog.tsx` | Static `?` shortcut reference sheet |
| `components/calendar/eventPayload.ts` | Pure form→API payload builder and repeat-rule helpers |
| `components/calendar/toFcEvent.ts` | Occurrence→FullCalendar event mapping and occurrence ids |
| `components/calendar/fullcalendar-overrides.css` | Canvas palette and sizing overrides for FullCalendar |

## Shell and layout

### components/calendar/CalendarShell.tsx

**Purpose** — The client-side brain of the calendar route. It loads calendars and a date-range slice of events, expands recurrences into renderable occurrences, and owns every overlay: toolbar, grid, quick create, event dialog, details popover, series-delete prompt and shortcut sheet.

**Public API** — `export function CalendarShell(props: Props)`. Props: `timezone: string`, `currentUserId: string`, `weekStartsOn: number`, `preferences: UserPreferences`. Internal (not exported) types: `EventSelection`, `EventDialogState`, `SelectInfo`, `DatesInfo`, `DropInfo`. Helpers in module scope: `familyOf`, `seriesStartWall`, `seriesEndWall`, `eventToPayload`, `occurrenceKey`, `undoToast`. Constants: `VIEW_TYPES` (FullCalendar view type → `PlannerView`), `DAY_MS`.

**State & side effects** — Local state: `view`, `label`, `anchorDate`, `scrollTime` (frozen once from "now"), `range`, `dialog`/`dialogDirty`/`confirmDiscard`, `quickDraft`, `helpOpen`, `announcement`, `selection`, `pendingDelete`, `nowAnchor`. Refs: `calendarRef`, `handledLinkRef`, `viewChosenByUser`, `openerRef`, `gridRef`, `overlaySeqRef`, `linkSeqRef`. Overlay rule: at most one surface is up — `openDialog`, `openQuickCreate`, a recurring `requestDeleteFor` prompt and `handleEventClick` each bump `overlaySeqRef` and clear the other states. The desktop quick-create bubble also dismisses itself on an outside pointerdown, but these explicit clears are the same-render guarantee for keyboard paths and the search deep link. Queries: `useCalendars()`, `useEvents(range)` (`["events", from, to]`; `effectiveRange` falls back to now−45 d … now+75 d until `datesSet` fires), `usePreferences(initialPreferences)`, `useVisibilityApi()`. Mutations: `useCreateEvent`, `useUpdateEvent`, `useDeleteEvent`. Persistence: `writeLastView(currentUserId, view)` / `readLastView` in `localStorage`; `pushUndo` for move, delete, series delete and skip-occurrence. URL: reads `?date=` and `?event=` from `useSearchParams()` and then `router.replace("/", { scroll: false })`. DOM: a `window.setInterval` that polls every 100 ms for `[data-event-id]` (max 100 attempts) to open a deep-linked event, and a global keydown binding through `useKeyboardShortcuts` plus `useUndoHotkey`. The poll is sequence-guarded: `SearchBox` announces the chosen result on `lib/ui/searchBus`, and that announcement stores `overlaySeqRef` in `linkSeqRef` at click time, so the deep link is **dropped** (URL cleared) if the user opens a create surface after picking the result, while an already-open bubble is closed when the details finally open. `defaultEventCalendarId` (memo) is the isolated calendar while "display only" is active and that calendar is writable, else `preferences.lastEventCalendarId`; it feeds both `QuickCreatePopover` and `EventDialog`.

**Depends on / Used by** — `@fullcalendar/react` types, `next/navigation`, `sonner`, `components/ui/button`, `components/ui/dialog`, `components/shell/VisibilityProvider` (`useVisibilityApi`), `lib/color/palette` (`shadeTokens`, `PARENT_SHADE_INDEX`, `isHueFamily`), `lib/query/calendars`, `lib/query/events` (`EventInputPayload`, `EventRange`), `lib/query/preferences`, `lib/query/eventCache` (`parseExdates`), `lib/recurrence/expand` (`expandOccurrences`), `lib/services/permissions` (`canWriteCalendar`), `lib/time/zone`, `lib/time/format`, `lib/ui/lastView`, `lib/ui/searchBus` (`focusSearch`), `lib/ui/undo`, `lib/ui/useKeyboardShortcuts`, `lib/ui/useUndoHotkey`, `lib/ui/useMediaQuery`, `lib/ui/view` (`resolveInitialView`), `lib/ui/visibleCalendars`, and its five sibling calendar components. Rendered only by `app/(app)/page.tsx`.

**Debugging** —
- Event opens then the URL never clears -> the poll found the element from a stale render -> check `handleDatesSet` set `range` and that `visibleEvents` contains the id (`CalendarShell` deep-link effect).
- Two surfaces at once (event details over a quick-create bubble, or a bubble over details) -> one opener did not dismiss the other, or the search deep link landed after the user started creating -> `openQuickCreate`/`openDialog`/`requestDeleteFor`/`handleEventClick` clear the other states; the poll drops the link when `overlaySeqRef` moved since the result click (`linkSeqRef`).
- A searched event's details never opens -> you started a new event or opened the shortcut sheet while the 100 ms poll was still running; the newer action wins by design (the link is dropped and the URL cleared).
- A partner's event is editable -> `readOnlyCalendarIds` folding missed the child -> inspect the `canWriteCalendar` loop (it builds `{ userId, householdId: "" }`, so only `userId` matters).
- Escape deletes the on-screen draft instead of just closing details -> `onEscape` order in `useKeyboardShortcuts` -> check `quickDraft`/`selection` branches, then `QuickCreatePopover` stopPropagation.
- Drag on a recurring event snaps back -> intentional: `handleEventMove` reverts any `base.rrule` event -> the toast text names the reason.

**Tests** — `tests/e2e/events.spec.ts`, `tests/e2e/quick-create.spec.ts`, `tests/e2e/shortcuts.spec.ts`, `tests/e2e/undo.spec.ts`, `tests/e2e/details.spec.ts`, `tests/e2e/search.spec.ts`, `tests/e2e/mini-month.spec.ts`, `tests/e2e/view-preference.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`.

### components/calendar/Toolbar.tsx

**Purpose** — The calendar header row: a Google-style title button that opens a date picker, previous/today/next buttons, the four-way view switch, the `?` shortcut button and `+ Event`.

**Public API** — `export type PlannerView = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth"`; `export function Toolbar(props: Props)`. Props: `label`, `view`, `anchorDate`, `onJumpToDate(date)`, `onViewChange(view)`, `onPrev()`, `onToday()`, `onNext()`, `onNewEvent()`, `onShowShortcuts()`. `VIEWS` maps the four `PlannerView` values to Month/Week/Day/List.

**State & side effects** — One state: `pickerOpen` for the Radix popover. No queries, no storage, no URL writes; every action is a callback into `CalendarShell`. `DatePickerPopover` is keyed by `anchorDate` so the picker's month re-seeds whenever the visible range changes.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/button`, `components/ui/icons`, `lib/utils` (`cn`), `./DatePickerPopover`. Rendered by `CalendarShell`. `PlannerView` is imported by `lib/ui/lastView.ts`, `lib/ui/view.ts` and `lib/ui/useKeyboardShortcuts.ts`, so this file is a type dependency of the client-state layer.

**Debugging** —
- Clicking the title opens the picker at last month -> `DatePickerPopover` was not remounted -> confirm the `key={anchorDate}` prop in `Toolbar`.
- `+ Event` missing on a phone -> expected (`hidden md:inline-flex`); the shell's floating `+` button is the phone path -> check `CalendarShell`'s `md:hidden` button.
- View switch does not stick after reload -> `changeView` in `CalendarShell` writes `localStorage`; `Toolbar` itself never persists.

**Tests** — `tests/e2e/events.spec.ts`, `tests/e2e/mini-month.spec.ts`, `tests/e2e/calendar-style.spec.ts`, `tests/e2e/shortcuts.spec.ts`.

## Views and grid

### components/calendar/CalendarView.tsx

**Purpose** — The only file that mounts FullCalendar 7. It maps `RenderableOccurrence[]` to FullCalendar inputs, restores the semantic CSS hooks v7 replaced with generators, and forwards grid events to the shell.

**Public API** — `export interface RenderableOccurrence { occurrence: Occurrence; event: EventView }`; `export function CalendarView(props: Props)`. Props: `calendarRef: RefObject<CalendarRef | null>`, `timezone`, `timeFormat: TimeFormat`, `showWeekNumbers`, `scrollTime: string`, `firstDay: number`, `occurrences`, `calendarNames: ReadonlyMap<string,string>`, `readOnlyCalendarIds: ReadonlySet<string>`, and the handlers `onDatesSet`, `onDateClick`, `onSelect`, `onEventClick`, `onEventMove(info: EventDropInfo | EventResizeDoneInfo)`.

**State & side effects** — No React state. Builds `fcEvents` on every render, spreading `occurrenceToFcEvent(...)` and adding `editable: !readOnlyCalendarIds.has(event.calendarId)`. `eventDidMount` writes `data-event-id`, `data-occurrence-start`, an `aria-label` (`title`, "all day"/formatted start, calendar name), and `info.el.style.borderLeftColor` from `extendedProps.accent` (v7 dropped `borderColor`). FullCalendar config that matters: `initialView="dayGridMonth"`, `headerToolbar={false}`, `timeZone={timezone}`, `firstDay`, `weekNumbers`, `height="100%"`, `expandRows`, `fixedWeekCount={false}`, `dayMaxEventRows={3}`, `eventMaxStack={3}`, `scrollTime`, `snapDuration="00:15:00"`, `slotDuration="00:30:00"`, `slotEventOverlap={false}`, `longPressDelay={300}`, `nowIndicator`, `selectable`, `selectMirror`, `editable`, `eventResizableFromStart`; `slotHeaderFormat` drops minutes in 12-hour mode. Imports `@fullcalendar/react/skeleton.css`, the classic theme CSS/palette and `./fullcalendar-overrides.css`.

**Depends on / Used by** — `@fullcalendar/react` plus the `daygrid`, `timegrid`, `list`, `interaction` and `themes/classic` plugins, `lib/time/format` (`fcEventTimeFormat`, `formatInstant`), `./toFcEvent`. Rendered by `CalendarShell`; the theme CSS is what `fullcalendar-overrides.css` targets.

**Debugging** —
- Event blocks lose their left colour bar -> `extendedProps.accent` missing or `eventDidMount` did not run -> check `occurrenceToFcEvent` and `fullcalendar-overrides.css` `.fc-event` rules.
- A month renders six empty week rows or scrolls the page -> `height`/`expandRows`/`fixedWeekCount` changed, or the parent lost `min-h-0 flex-1` -> check this file's wrapper classes and `viewport-fit.spec.ts`.
- Deep links and drag callbacks report an unknown id -> the `data-event-id` attribute or the `id::startKey` format changed -> `eventDidMount` and `parseOccurrenceFcId`.
- Week view opens at midnight -> `scrollTime` prop is not `HH:MM:SS` -> check the shell's `scrollTime` initialiser.

**Tests** — `tests/e2e/events.spec.ts`, `tests/e2e/calendar-style.spec.ts`, `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/view-preference.spec.ts`.

## Quick create

### components/calendar/QuickCreatePopover.tsx

**Purpose** — The click-a-day bubble: type a title, pick a writable calendar, Save, or escalate to the full dialog with "More options". It becomes a bottom sheet below 768 px.

**Public API** — `export interface QuickCreateDraft extends QuickCreateRange { dateWall: string; anchor: { x: number; y: number } }`; `export function QuickCreatePopover(props: Props)`. Props: `draft`, `calendars: CalendarNode[]` (writable only), `defaultCalendarId: string | null`, `timezone`, `timeFormat`, `onClose()`, `onMoreOptions(values: { title; calendarId; startWall; endWall; allDay })`. Module constants: `CARD_WIDTH = 320`, `MARGIN = 16`, `CARD_HEIGHT_ESTIMATE = 260`, `CONTROL` (38 px field recipe).

**State & side effects** — State: `title`, `pickedCalendarId` (`null` until the user picks a row in the list). `effectiveCalendarId` is derived on every render: `pickedCalendarId ?? defaultCalendarId` when `calendarSwatch` finds it, else `calendars[0]?.id`, else `""` — so a changed default (the shell reuses this mounted bubble for the next draft) is never frozen at mount. While the desktop bubble is up, a capture-phase `document` `pointerdown` listener calls `onClose()` on any click outside its own DOM; the portalled calendar list is exempt via `data-dismiss-ignore` on `CalendarPicker`'s content, and the phone sheet skips the listener because its Radix `Dialog` dismisses itself. `useMediaQuery("(max-width: 767px)")` selects dialog vs bubble. Mutations: `useCreateEvent` (optimistic row via `["events"]` cache), `useDeleteEvent` for the undo action, `useUpdatePreferences` writing `lastEventCalendarId`. On success it pushes an undo entry, shows a 10 s "Event created" toast with Undo, remembers the calendar and closes. `draftPayload` converts wall time with `localWallTimeToUtc` and, for all-day drafts, subtracts one day from the exclusive end. The bubble is `position: fixed` at the click point clamped into the viewport, and its own keydown handler closes on Escape with `stopPropagation`.

**Depends on / Used by** — `@/lib/query/events`, `@/lib/query/preferences`, `@/lib/services/calendars`, `@/lib/ui/calendarPicker` (`calendarSwatch`), `@/lib/time/format` (`formatWallDate`, `formatWallTime`), `@/lib/time/zone`, `@/lib/ui/undo`, `@/lib/ui/useMediaQuery`, `components/ui/dialog`, and `./CalendarPicker`. Rendered by `CalendarShell` whenever `quickDraft` is set (day click, drag-select, `Shift+C`, or the phone `+`).

**Debugging** —
- Save does nothing -> `effectiveCalendarId` is empty because every calendar is read-only and `calendars` is empty -> check `writableCalendars` in `CalendarShell`.
- Bubble appears off-screen on a phone in landscape -> `CARD_HEIGHT_ESTIMATE` clamp used the wrong assumption -> the phone path should be the dialog; check the media query.
- The bubble stays up after clicking a toolbar/sidebar control -> the outside-click listener was dropped, or a page-wide element carries `data-dismiss-ignore` -> this file's `pointerdown` effect.
- Clicking a row in the calendar list dismisses the bubble -> the portalled content lost its `data-dismiss-ignore` marker -> `CalendarPicker`'s `PopoverPrimitive.Content`.
- The bubble proposes the previous default right after "display only this calendar" changes -> the default was frozen in state instead of derived -> `effectiveCalendarId`, `defaultEventCalendarId` in `CalendarShell`.
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

**Purpose** — Nested calendar chooser used wherever an event needs a calendar. Top-level calendars always list; a row's chevron reveals its sub-calendars; the list scrolls past 320 px.

**Public API** — `export function CalendarPicker(props: Props)`. Props: `calendars: CalendarNode[]` (writable), `value: string`, `onChange(id: string)`, `variant?: "chip" | "field"` (default `"chip"`), `id?: string`. Constants: `FALLBACK_COLOR = "oklch(0.65 0.02 250)"`, `FOCUS`. Trigger carries `data-testid="calendar-picker-trigger"`; the list carries `data-testid="calendar-picker-list"`.

**State & side effects** — `open` and `expanded: ReadonlySet<string>`; rows come from `buildPickerRows(calendars, expanded)`. On open it merges `expandedForSelection(calendars, value)` into the expanded set so the selected branch is visible. Selecting a row calls `onChange` and closes. The portalled content stops Escape propagation so closing the list cannot also cancel the draft bubble behind it, and it carries `data-dismiss-ignore` so an enclosing dismiss-on-outside-click surface (the quick-create bubble) survives a row click. No queries or storage; the trigger swatch/name come from `calendarSwatch`.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/button`, `components/ui/icons`, `lib/services/calendars` (`CalendarNode`), `lib/ui/calendarPicker`, `lib/utils`. Rendered by `EventDialog` (`variant="field"`) and `QuickCreatePopover` (`chip`).

**Debugging** —
- Selected sub-calendar is scrolled out of view on open -> `expandedForSelection` returned no branch -> check the parent/child ids in the `CalendarNode[]` passed in.
- Escape closes the bubble and loses the title -> the `onKeyDown` stopPropagation was removed -> this file's `PopoverPrimitive.Content`.
- Swatch is grey for a real calendar -> `calendarSwatch` did not find the id (e.g. a read-only calendar filtered out of `calendars`) -> `FALLBACK_COLOR`.

**Tests** — `tests/e2e/calendar-picker.spec.ts`; helper module covered by `tests/unit/calendarPicker.test.ts`.

## Event details and editing

### components/calendar/EventDetails.tsx

**Purpose** — The presentational facts-and-actions body shared by the desktop popover and the phone dialog: title, when, repeat summary, calendar row, map link, clamped notes and the action buttons.

**Public API** — `export interface EventDetailsProps` with `event: EventView`, `calendarName`, `color`, `timezone`, `timeFormat: TimeFormat`, `occurrenceStart`, `readOnly`, `onEdit()`, `onDelete()`, `onDuplicate()`, `onClose()`; `export function EventDetails(props)`. Constant `CLAMPED_DESCRIPTION_LENGTH = 140`.

**State & side effects** — One state: `expanded` for the notes clamp. Derived text via `formatOccurrenceHeading`, `formatOccurrenceWhen` and `describeRrule`. Location renders as a Google Maps search link (`https://www.google.com/maps/search/?api=1&query=…`, `target="_blank"`). `readOnly` hides Edit, Duplicate and Delete and shows a "View only" note. It owns no dialog semantics, focus management, queries or storage.

**Depends on / Used by** — `components/ui/button`, `lib/recurrence/label` (`describeRrule`), `lib/services/events` (`EventView`), `lib/services/preferences` (`TimeFormat`), `lib/time/format`. Rendered by `EventDetailsPopover`; not rendered directly by the shell.

**Debugging** —
- A later occurrence shows the series start date -> the wrong `occurrenceStart` key reached this component -> trace `selection.occurrenceStart` in `CalendarShell` (`eventClick` uses `extendedProps.occurrenceStart`).
- "Show more" never appears on long notes -> the 3-line CSS clamp hides it at a different length than 140 chars -> both conditions gate the button; check `CLAMPED_DESCRIPTION_LENGTH`.
- Edit/Delete missing for the owner -> `readOnly` was computed from a calendar id missing in `calendars` -> `readOnlyCalendarIds` in `CalendarShell`.

**Tests** — `tests/e2e/details.spec.ts`, `tests/e2e/viewonly.spec.ts`.

### components/calendar/EventDetailsPopover.tsx

**Purpose** — Anchors `EventDetails` to the clicked event block on desktop and renders the same body in a dialog below 768 px, where a popover would be clipped.

**Public API** — `export function EventDetailsPopover(props: Props)` where `Props extends EventDetailsProps` plus `anchorRect: DOMRect` and `anchorElement: HTMLElement | null`.

**State & side effects** — `useMediaQuery("(max-width: 767px)")` picks the surface; `contentRef` drives the autofocus choice. Radix owns Escape, outside-click and the focus trap. `onOpenAutoFocus` prevents the default and focuses `[data-action="edit"]` (falling back to the first button); `onCloseAutoFocus` returns focus to `anchorElement`. Closing calls `details.onClose()`. The desktop anchor is a 1 px fixed-position `span` at `anchorRect.left/top`, so the popover survives grid re-renders.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/dialog`, `lib/ui/useMediaQuery`, `./EventDetails`. Rendered by `CalendarShell` when `selectedEvent && selection`.

**Debugging** —
- Popover appears in the wrong corner after scrolling -> the stored `anchorRect` is stale -> `handleEventClick` captured it at click time; re-select the event.
- Focus does not return to the event block -> `anchorElement` was null (block re-rendered) -> check the `info.el` passed from `CalendarShell`.
- On a tablet the popover is clipped by the grid -> the 768 px breakpoint no longer matches the layout -> `useMediaQuery` string in this file and `AppShell`'s `md`.

**Tests** — `tests/e2e/details.spec.ts`.

### components/calendar/EventDialog.tsx

**Purpose** — The full create/edit form: title, calendar (nested picker), all-day, start/end date and time, repeat preset, location, notes, and a save guard. On edit it saves the whole series.

**Public API** — `export interface EventDialogInitial { event?: EventView; start: string; end: string; allDay: boolean; pendingTitle?: string }`; `export function EventDialog(props: Props)`. Props: `mode: "create" | "edit"`, `initial`, `initialRule?: string | null`, `timezone`, `calendars: CalendarNode[]`, `defaultCalendarId?: string | null`, `onClose()` (success/programmatic), `onCancel?()` (runs the shell's unsaved guard), `onDirtyChange?(dirty)`. Module constants `CONTROL`, `TEXTAREA`, `LABEL`; helper `splitWall`.

**State & side effects** — Field state: `title`, `calendarId`, `allDay`, `startDate`, `startTime`, `endDate`, `endTime`, `repeat`, `description`, `location`; frozen `initialRepeat` from `deriveRepeat(initialRule)`. `selectedCalendarId` falls back live to `calendars[0]?.id` while the list loads. Every setter calls `markDirty()`. Mutations: `useCreateEvent` (pushes an undo that deletes the new row and shows a 10 s Undo toast), `useUpdateEvent` (PATCH of the whole series), `useDeleteEvent` (only for that undo), `useUpdatePreferences({ lastEventCalendarId })`. Save is disabled while `pending`, with an empty title, or with no calendar. On a recurring edit it shows a "saves every occurrence" notice. The form caps its height (`max-h-[calc(100dvh-12rem)]`) and makes the footer sticky below `md`.

**Depends on / Used by** — `sonner`, `components/ui/button`, `lib/query/events`, `lib/query/preferences`, `lib/time/zone` (`utcToLocalWallTime`), `lib/ui/undo`, `./eventPayload`, `./CalendarPicker`. Rendered by `CalendarShell` inside its `Dialog`; the shell keeps it mounted under `hidden` while the discard prompt shows.

**Debugging** —
- Saving an untouched weekly rule turns into `FREQ=WEEKLY` -> the rule-preservation branch broke -> `buildEventPayload` (`repeatChanged` must stay false).
- Calendar resets to the first one on open -> `defaultCalendarId` was read-only so it fell back -> `initialCalendarId` in this file plus `writableCalendars`.
- Cancel discards without asking -> `onCancel` was not passed -> the shell's `requestCloseDialog` guard.
- Focus ring disappears on a field -> someone added `outline-none` to `CONTROL`; Tailwind v4 compiles it into `--tw-outline-style: none` and `outline-2` reads it back.

**Tests** — `tests/e2e/events.spec.ts`, `tests/e2e/quick-create.spec.ts` (dirty-discard), `tests/e2e/details.spec.ts` (duplicate).

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

**State & side effects** — No state. Reads `useCalendars()` for id→name, groups rows by `monthLabel(navigableDateFor(event, timezone))` (insertion order), and renders `role="listbox"`/`role="option"` with `aria-selected`, `aria-activedescendant` targets and an `aria-live` result count. `highlight` marks the first case-insensitive match for queries of 2+ chars. With fewer than 2 trimmed characters it shows the hint instead of an empty list. `inline` switches `absolute left-0 top-full` (which carries the floating `w-[26rem] max-w-[calc(100vw-2rem)]` width — the panel is out of flow, so the width must live here and never on an in-flow wrapper) to `mt-2`.

**Depends on / Used by** — `lib/query/calendars`, `lib/query/search` (`navigableDateFor`), `lib/time/format`, `lib/utils` (`cn`). Rendered only by `SearchBox`.

**Debugging** —
- Rows group under the wrong month -> `monthLabel` parses `formatWallDate` by spaces -> changing that format breaks the split here.
- Highlight marks the wrong substring -> only the first match is wrapped -> `highlight`.
- Calendar name column empty -> `useCalendars` cache is cold or the event's calendar was deleted -> `calendarNames` map.

**Tests** — `tests/e2e/search.spec.ts`, `tests/e2e/screenshot.spec.ts` (visual).

## Mini month and date navigation

### components/calendar/MiniMonth.tsx

**Purpose** — A neutral month grid with roving-tabindex keyboard navigation and a dot for days that have visible events; used by the sidebar and by the toolbar's date picker.

**Public API** — `export interface MiniMonthProps { anchorDate: string; selectedDate?: string; eventDates?: ReadonlySet<string>; onSelectDate(date); onAnchorChange(firstOfMonth); labelledBy?: string }`; `export function MiniMonth(props)`. Module data: `WEEKDAY_INITIALS`, `WEEKDAY_NAMES`, `MONTH_NAMES`, `DATE_PATTERN`; helpers `pad`, `iso`, `parts`, `weekdayIndex`, `daysInMonth`, `shiftMonth`, `shiftMonthKeepingDay`, `localToday`.

**State & side effects** — `focusDate` (roving tab stop) and `containerRef`. `moveFocus` sets state then focuses `[data-mini-date=…]` inside a `requestAnimationFrame`. Arrows move ±1/±7 days, Home/End go to week bounds, PageUp/PageDown shift a month keeping the day; crossing a month boundary calls `onAnchorChange(iso(y, m, 1))`. Clicking a day calls `onSelectDate`. Cells expose `aria-label` ("Wednesday 4 March, has events"), `aria-selected`, `aria-current="date"` for today and `role="gridcell"`. Dots are always neutral (`bg-ink-soft`, white when selected).

**Depends on / Used by** — `components/ui/button`, `components/ui/icons`, `lib/time/zone` (`addDaysToDate`), `lib/utils` (`cn`). Rendered by `DatePickerPopover` and `SidebarMiniMonth`.

**Debugging** —
- The mini month starts on Sunday even though the household week starts elsewhere -> expected: the grid hardcodes Sunday-first (`WEEKDAY_INITIALS`/`weekdayIndex`); only FullCalendar honours `weekStartsOn` -> this file.
- Arrow keys do not move focus -> `focusDate` points at a date not in the current month, so no cell has `tabIndex={0}` -> `moveFocus`/`ensureMonthVisible`.
- Event dots never appear in the sidebar -> the caller's `eventDates` set is empty -> `SidebarMiniMonth`'s range and visibility filter.
- Mini month shows a different "today" than the grid -> `localToday` uses the device clock/zone, not the household timezone -> this file.

**Tests** — `tests/e2e/mini-month.spec.ts`.

### components/calendar/DatePickerPopover.tsx

**Purpose** — Popover body for the toolbar title: a `MiniMonth` plus a right-aligned "Today" button.

**Public API** — `export function DatePickerPopover(props: Props)`. Props: `anchorDate`, `selectedDate?`, `eventDates?: ReadonlySet<string>`, `onPick(date: string)`. No exported types.

**State & side effects** — Local `anchor` seeded from `anchorDate`; only `onAnchorChange` updates it. `today` is formatted from `new Date()` in the device's local zone. `onPick` is called for both a day click and the Today button; closing the popover is the caller's job. No queries or storage.

**Depends on / Used by** — `components/ui/button`, `./MiniMonth`. Rendered by `Toolbar` inside its popover; `Toolbar` keys it by `anchorDate` so it re-seeds.

**Debugging** —
- Picker opens on the wrong month -> the `key={anchorDate}` remount was removed -> `Toolbar`.
- "Today" jumps to yesterday/tomorrow for a travelling user -> `today` is device-local, not household-zoned -> this file.

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

**Public API** — `export type RepeatRule = "none" | "daily" | "weekly" | "monthly" | "yearly"`; `REPEAT_OPTIONS: Array<{ value: RepeatRule; label: string }>`; `deriveRepeat(rule: string | null | undefined): RepeatRule`; `export interface EventFormValues`; `buildEventPayload(values: EventFormValues): EventInputPayload`. Internal `RRULE_BY_REPEAT`.

**State & side effects** — None; fully deterministic. `deriveRepeat` matches `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` by substring and returns `"none"` for anything unrecognised. `buildEventPayload` keeps `initialRule` when `repeat === initialRepeat`, otherwise emits `FREQ=…` or `null`; empty description/location become `null`; all-day clamps `endDate` up to `startDate` and nulls the instants; timed converts both walls with `localWallTimeToUtc` and nulls the dates.

**Depends on / Used by** — `lib/query/events` (`EventInputPayload`), `lib/time/zone` (`localWallTimeToUtc`). Imported by `EventDialog`.

**Debugging** —
- A `BYDAY`/`COUNT` series silently loses its details after save -> `repeatChanged` was true (the select's derived value differed) -> `deriveRepeat` for a rule whose `FREQ` is not one of the four.
- Unticking "All day" leaves stale `startDate` -> the branch nulling the opposite pair was edited -> `buildEventPayload`.
- End before start is accepted -> only all-day has a clamp; timed ranges are sent as typed -> `buildEventPayload`.

**Tests** — `tests/unit/event-payload.test.ts`.

### components/calendar/toFcEvent.ts

**Purpose** — Maps one recurrence occurrence plus its `EventView` into a FullCalendar 7 event and encodes/decodes the composite occurrence id.

**Public API** — `export interface PlannerFcEvent extends EventInput` with `extendedProps: { eventId; calendarId; occurrenceStart; description; location; accent; calendarName }`; `occurrenceFcId(eventId, startKey): string` (`"<eventId>::<startKey>"`); `parseOccurrenceFcId(id): { eventId; startKey } | null`; `occurrenceToFcEvent(occurrence, event, calendarName = ""): PlannerFcEvent`.

**State & side effects** — None. All-day events use `startDate` as the FC start and `endDate + 1 day` as the exclusive end; timed events use ISO instants. `color` is `event.color.containerHex` with `contrastColor = onContainer`; the saturated `mainHex` travels only in `extendedProps.accent`. The FC `id` is the composite occurrence id, so one series renders as many ids.

**Depends on / Used by** — `@fullcalendar/react` (`EventInput`), `lib/recurrence/expand` (`Occurrence`), `lib/services/events` (`EventView`), `lib/time/zone` (`addDaysToDate`). Used by `CalendarView` (`occurrenceToFcEvent`) and `CalendarShell` (`parseOccurrenceFcId` in click/drag handlers).

**Debugging** —
- An event id parser returns `null` -> the FC event was not created here (or an id lost its `::`) -> `parseOccurrenceFcId` splits on the first `::`.
- A one-day all-day event renders zero-width -> the +1 day exclusive end was dropped -> `occurrenceToFcEvent`.
- Text is unreadable on an event -> `containerHex`/`onContainer` came from the wrong shade -> `lib/color/palette` and `EventView.color`.

**Tests** — `tests/unit/toFcEvent.test.ts`.

### components/calendar/fullcalendar-overrides.css

**Purpose** — The Canvas surface for FullCalendar 7: palette variables, hairlines, the today badge, event block typography, agenda table styling, focus rings and a short-viewport fallback.

**Public API** — No exports. It is imported for side effects by `CalendarView`. It targets the semantic classes the view's class generators attach (`html .fc`, `.fc-col-header-cell`, `.fc-daygrid-day`, `.fc-daygrid-day-number`, `.fc-day-today`, `.fc-day-other`, `.fc-event`, `.fc-event-inner`, `.fc-event-time`, `.fc-event-title`, `.fc-more-link`, `.fc-timegrid-slot-label`, `.fc-list-*`, `.fc-view-list`).

**State & side effects** — Restyles FC's `--fc-classic-*` variables from app tokens on `html .fc` (specificity `0,1,1` beats FC's `:root` palette regardless of import order), marks today with a 28 px accent circle instead of a background, paints the 3 px left bar with `border-left-color` (set per event by `eventDidMount`), hides in-cell events under `max-height: 480px`, gives events a 3 px focus outline, and raises `.fc-more-link`/event min-heights for coarse pointers.

**Depends on / Used by** — App design tokens (`--color-line`, `--color-ink`, `--color-well`, `--color-accent`, `--color-line-strong`, `--radius-pill`, …) defined by the global stylesheet. Imported once, by `CalendarView`.

**Debugging** —
- Canvas colours lose to FullCalendar's defaults -> the `html .fc` selector was simplified, so FC's `:root` wins -> this file's first rule.
- Day-cell borders turn ink-coloured -> FC's `border-inline-*: 0 !important` shorthands reset the colour -> the `.fc-daygrid-day { border-color: … !important }` rule.
- Events vanish entirely in a phone landscape -> expected under `max-height: 480px` -> Week/Day/List carry detail there.
- Left colour bar missing while the fill is correct -> `borderColor` was reintroduced as an FC option (v7 ignores it) -> `eventDidMount` in `CalendarView`.

**Tests** — `tests/e2e/calendar-style.spec.ts`, `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/design-tokens.spec.ts`.

## Focused verification
```bash
npx vitest run tests/unit/event-payload.test.ts tests/unit/quick-create-defaults.test.ts tests/unit/toFcEvent.test.ts
npx playwright test tests/e2e/events.spec.ts
npm run lint && npm run typecheck
```
