# Tasks workspace components

The `/tasks` workspace: the capture row, the scope tabs and List/Board toggle,
the view toolbar (group/filter/sort/hide-closed), the grouped dense list with
inline status/priority/date pickers, and the row actions. Bucketing itself is
server-side (`lib/domain/tasks.ts`, `lib/services/tasks.ts`); grouping, sorting
and filtering are client-side pure projections (`lib/domain/taskViews.ts`) and
the toolbar state is URL-backed (`lib/ui/taskViewParams.ts`). These components
render what the server returns and turn actions into PATCH/DELETE calls. The
page-scoped keyboard triage layer
(`lib/ui/useTaskShortcuts.ts`, mounted by `TasksShell`) and the global `Shift+K`
capture live alongside them; `GlobalCapture` itself is documented in
[`components-shell-and-sidebar.md`](components-shell-and-sidebar.md), because
`AppShell` mounts it on every route.

`app/(app)/tasks/page.tsx` is documented in
[`app-routes.md`](app-routes.md#appapptaskspagetsx) — the repo rule is one
`###` section per file, and every `app/` route lives in `app-routes.md`, so the
page cannot appear here as well.

**Read this when** a row action does nothing, a task shows in the "wrong"
bucket, a touch target is too small, or an E2E spec cannot find a control: the
accessible-name patterns are listed per component below.

### components/tasks/TasksShell.tsx

**Purpose** — The client workspace under the server page: the capture row, scope tabs, view toolbar, grouped dense list (with its loading, error and empty states), the task editor and the page-scoped keyboard triage/undo layers. It is the only owner of `TaskViewState` (layout/group/sort/closed/filters, URL-backed), the scope, the row selection, the open editor, the per-task `TaskActions` closures and the task/collection mutations.

**Public API** — `export function TasksShell(props: { timezone: string; weekStartsOn: 0 | 1; shortcutsEnabled: boolean; currentUserId: string })`. No other exports. It mounts `TaskEditorDialog` itself (opened by `Enter`, the row title/`Open`, and the `?task=<id>` deep link) until the later slide-over panel task replaces it.

**State & side effects** — `state: TaskViewState` is initialised once from `useSearchParams()` with `parseTaskViewState` and written through `updateState(next)`: `setState(next)` plus `router.replace("/tasks?" + mergeTaskViewParams(searchParams, next))` (never `push`, so Back leaves `/tasks` instead of undoing each toolbar click). The reverse direction is a render-time sync keyed by the query string (`searchKey`/`syncedSearchKey`, the React "adjust state when a prop changes" pattern): a Back/Forward or a pasted link re-parses `layout`/`group`/`sort`/`closed`/`status`/`priority`/`list`, and the equal parse schedules no extra render. Local `view: TaskBucket` (default `"inbox"`), `selectedTaskId: string | null`, `editorTask: TaskView | null` (`null` means closed) and `helpOpen`. Queries: `useTasks(view, state.collectionId ?? undefined, state.closed)` over the four-part key `["tasks", view, collectionId ?? null, closed ? "closed" : "open"]` (`/api/tasks?view=&collectionId=&includeClosed=true`) and `useCollections()` (`["collections"]`, for the Move-to-list submenu and the filter's list). `counts` comes from the same payload and stays `undefined` until it lands (loading/error render no badges); `today` is `useMemo(() => localToday(timezone), [timezone])`. Rows are a pure projection: `sortTasks(filterTasks(tasks, { status, priority, collectionId }), sort)` then `groupTasks(..., group)`; `visibleRows` is the flattened group order, and the selection/`j`/`k`/coherence effect all use it. Mutations: `useUpdateTask` for complete/uncomplete and the status picker (`status`, including `in_progress`), the priority picker (`priority`), the date chips and the `1`/`2`/`3` keys (`scheduledOn`/`dueOn`; `3` may also move an undated Inbox row), the editor save (`title`, `notes`, `checklist`), Move/the `4` key/`3`'s Inbox filing (`collectionId` + `sortOrder` on undo) and Drop; `useDeleteTask` for Delete and `useCreateTask` for the delete-undo re-create. Failure toasts: status paths `Could not update the task.`, priority `Could not update the priority.`, dates `Could not schedule the task.`, Move `Could not move the task.`, Delete `Could not delete the task.`; `4` with no other writable list toasts `No other writable list to move to.`, while `3` toasts `Filed to Someday` on a successful Inbox filing, `Already unscheduled` when the Inbox has no other writable list, and `Already in Someday` for an undated row outside the Inbox. `useUndoHotkey()` is mounted here, so `z`/`Ctrl+Z` work on `/tasks` exactly as on the calendar. `TaskToolbar`'s Add task focuses the capture input by the `#task-capture` id; choosing Board sets `layout=board` in the URL, but the board itself is a later task, so the shell keeps rendering the list with a `role="status"` note and the toolbar's Group control disabled.

**Undo contract (targeted)** — Every successful complete/reopen/start/drop/delete/schedule/priority/move calls `pushUndo` with a compensating action and shows `undoToast(message, handle)` (`lib/ui/undoToast.ts`), so the toast's Undo reverts *that* action and not whatever landed last. The stack labels are `Complete task` / `Start task` / `Reopen task` / `Drop task` / `Delete task` / `Schedule task` / `Change priority` / `Move task`; `z`/`Ctrl+Z` consume the shared stack LIFO. A PATCH whose server echo equals the previous row (status, priority, both dates, or the same collection) pushes **no** action — the toast would be a lie.

| Action | Undo (compensating request) |
|---|---|
| Complete / start / reopen / drop | one PATCH back to the previous `status` |
| Status pill, priority flag | one PATCH back to the previous `status` / `priority` |
| Date chips, `1`/`2`, `3`'s clear-dates | one PATCH restoring the previous `scheduledOn` + `dueOn` |
| Move (menu, `4`, `3`'s Inbox filing) | PATCH `collectionId` back to the source list, then PATCH `sortOrder` (a move always appends, so the position needs the second request) |
| Delete | `POST /api/tasks` with the captured `title`/`notes`/dates/`collectionId`, then PATCH `checklist` + `sortOrder`; the re-created task gets a **new id** (there is no trash table) |
| Editor save | **no** undo: the editor is a deliberate whole-form save; delete is the undoable action there |

**`?task=` deep link** — A calendar task chip pushes `/tasks?task=<id>`. `TasksShell` reads `useSearchParams()`; the param is one-shot, and the handled marker is set by `deepLinkHandledRef` **only once the lookup settles** (`lib/ui/taskDeepLink.ts`). That ordering is required, not stylistic: `next.config.ts` sets `reactStrictMode: true`, so development runs the effect's setup → cleanup → setup, the first `GET /api/tasks/{id}` closure is cancelled before its response, and an early marker would make the second setup return while that cancelled closure owns the only answer — no editor would ever open. The in-flight promise is cached in a ref keyed by the param, so the second setup awaits the same request and the marker is set at the settle site. The effect prefers the row from the current (unfiltered) view through `tasksRef`, so arriving rows do not re-run it; otherwise it uses the `GET` — a scheduled chip task is never in the Inbox view, so the `GET` is the normal path, not a fallback. A 404/403 toasts and drops only `?task=` from the live URL, keeping the toolbar params. `closeEditor()` (Cancel, Escape, Save, Delete) also removes the param through `clearTaskParam()` (merge the current state, delete `task`, `router.replace`), so a reload or Back does not reopen a dismissed dialog; `/tasks` itself carries no `view` parameter and the scope stays local state defaulting to `"inbox"`.

**Selection and the shortcut contract** — `useTaskShortcuts(shortcutsEnabled, …)` is mounted here, so every key is page-scoped and inert when the preference is off. `j`/`k` clamp through `visibleRows` (the grouped render order; from no selection `j` lands on the first row and `k` on the last), set `selectedTaskId` and call the row's `focus()`; clicking or tabbing into a row selects it through `TaskRow.onFocus`. `1` sets `scheduledOn = localToday(timezone)`, `2` sets `scheduledOn = endOfWeek(today, weekStartsOn)` (on the household week's last day this equals today, so the task shows in Today per D6), `3` clears both dates — but an Inbox task is already undated, so there it files the row into the next writable `kind="list"` collection (the same path as `4`); `4` cycles to the next writable list, `x` PATCHes `status: "done"`, `Enter` opens the editor for the selection, `?` opens `TaskShortcutHelpDialog` (also the "Keyboard shortcuts" button beside the scope tabs) and `Escape` clears the selection. Switching the scope clears the selection but keeps layout/group/sort/filters (they live in the URL). All keys share `isTextEntryTarget`/`hasOpenOverlay`, so typing in the capture input or any open dialog/menu/popover never moves the selection; `Enter` on a focused button (checkbox, title, pickers, menu, tabs) is left to that control instead of the editor.

**Selection coherence** — Complete, start, drop, delete, schedule, priority and Move can all remove the selected row from the visible rows once the settle refetch (or a filter/group change) paints. A `useEffect` over `visibleRows` compares the selection using `previousTasksRef` (the last rendered rows): when the selected id no longer exists, the stale id is cleared and the selection moves to the row that took its place (`min(oldIndex, length − 1)`, falling back to the first row) and that row is focused, because focus follows selection. When nothing is visible, focus goes to the current scope tab (`TaskViewTabs.activeRef`) — not the capture input, which would swallow `j` as typed text. While the editor is open the selection still moves (the modal owns focus) and `closeEditor` focuses the live selection on the next paint, falling back to the scope tab. The effect never runs while the query is pending or on a scope switch (the selection is null then), so a following `j`/`x`/`1` acts on a real row instead of silently no-opping on a vanished id. A row inside a **collapsed** group is still in `visibleRows` (collapse state is local to `TaskList`), so `j`/`k` can select it and `focus()` is a no-op until the group is expanded — the selection becomes visible then.

**Editor wiring** — `openTask(task)` selects the row and sets `editorTask`; `closeEditor` clears it (and the `?task=` param when present) and restores focus to `li[data-selected="true"]` (or the scope tab when the save re-bucketed the last row out of the view). The editor's Delete closes the dialog and then runs the same `deleteTaskWithUndo` as the row menu, so both paths push the same undo.

**Task chips are tasks, not events** — On the calendar (`/`), `CalendarShell` draws scheduled **active** tasks (`isActiveStatus`: open or in_progress) through `components/calendar/taskChip.ts` as read-only all-day FullCalendar events with ids `task:<id>` and `extendedProps.kind = "task"`. Chips join the same `events` array as the event occurrences: they inherit the grid's stacking, `dayMaxEventRows`/`eventMaxStack` and the built-in "+N more", so a day full of chips folds exactly like a day full of events. A click is branched in `CalendarShell.handleEventClick` to `router.push("/tasks?task=<id>")` — never the event details popover, event edit form, drag or resize. `data-task-id` and `aria-label="Task: <title>"` are set by `CalendarView.eventDidMount`. Rendering is read-only: a task chip's only interaction is the deep link; planning happens through the row's date chips or by dragging the row. Only active (`open`/`in_progress`) rows draw, so the optimistic task cache holding a just-completed/dropped row for a beat cannot paint a chip for finished work — and an in-progress task is not flagged `completed`. **Accepted superset (controller ruling):** because a chip is an all-day event on the one shared `events` array, it also appears in the Week, Day and List views; those grids are read-only for chips too (no drag/resize, click = task editor), and only the month day cells attach task-drop listeners.

States: `isError` renders `role="alert"` with "Could not load the tasks." and a "Try again" retry button; `isPending` renders `role="status"` "Loading tasks…"; zero visible groups render `TaskList`'s empty state — "No tasks match these filters." with a Clear-filters button when a status/priority/list filter is active, otherwise exactly "Nothing here. Enjoy the quiet.". The root `<section aria-label="Tasks" data-testid="tasks-shell">` also carries `data-week-starts-on` and `data-shortcuts-enabled` as debugging/E2E hooks (the props are consumed directly now); the rendered list container carries `data-testid="task-list"` (`role="group" aria-label="<Scope> tasks"`), and rows render as `li[data-task-id]` with `data-selected="true"`/`aria-current="true"` on the selected row.

**Depends on / Used by** — `next/navigation` (`useRouter`, `useSearchParams`), `lib/db/schema` (`TaskPriority`, `TaskStatus`), `lib/domain/tasks` (`endOfWeek`, `localToday`, `TaskBucket`), `lib/domain/taskViews` (`filterTasks`, `groupTasks`, `sortTasks`), `lib/query/tasks` (`useTasks`, `useCreateTask`, `useUpdateTask`, `useDeleteTask`), `lib/query/collections` (`useCollections`), `lib/services/permissions` (`canWriteCollection`, `foldCollectionPermission`), `lib/ui/taskDeepLink`, `lib/ui/taskViewParams` (`parseTaskViewState`, `mergeTaskViewParams`, `TaskViewState`), `lib/ui/undo` (`pushUndo`), `lib/ui/undoToast`, `lib/ui/useTaskShortcuts`, `lib/ui/useUndoHotkey`, `lib/validation/tasks` (`UpdateTaskInput`), `components/ui/button`, `sonner`, and the siblings `TaskCaptureRow`/`TaskViewTabs`/`TaskToolbar`/`TaskList`/`TaskEditorDialog`/`TaskShortcutHelpDialog`/`types`. Rendered only by `app/(app)/tasks/page.tsx`.

**Debugging** —
- A completed/dropped/deleted task vanishes with no toast to undo it -> the settle refetch removed the row but the compensating action was not pushed (a no-op echo is skipped on purpose) -> `patchStatus`/`deleteTaskWithUndo` above.
- The toast's Undo brings back the wrong task or nothing -> the toast was shown without its own `pushUndo` handle, or the action was already undone/dropped by the 20-action cap -> `lib/ui/undo.ts`, `lib/ui/undoToast.ts`.
- Undo of a delete creates a second copy instead of restoring the old one -> intended: `deleteTask` hard-deletes, so undo re-creates the row with a **new id**; reload the list and expect the new id -> `deleteTaskWithUndo` above.
- Undo of a move puts the task back in the list but at the end -> the second `sortOrder` PATCH was lost (a move PATCH always appends) -> `patchMove`'s undo closure.
- The editor opens blank or for the previous task -> `editorTask` is stale or `TaskEditorDialog`'s `key={task.id}` was removed -> this file and `components/tasks/TaskEditorDialog.tsx`.
- Focus lands on `<body>` after the editor closes -> `closeEditor`'s timeout found neither a selected row nor a scope tab (the list re-rendered late) -> this file's `closeEditor`.
- A badge lags one step behind a row edit -> `useUpdateTask` is row-only optimistic and `counts` are recomputed on the settle refetch -> `lib/query/tasks.ts`.
- A task exists but every view is empty -> it is dated beyond this week (no triage bucket) or its list is private to the partner (server 404) -> `lib/domain/tasks.ts` `bucketOf` and `lib/services/tasks.ts` `listTasks`.
- The list is empty but the task exists and a filter badge is violet -> a status/priority/list filter is active (the URL says so) -> clear it from the toolbar or the empty state's Clear-filters button; check `state.status`/`priority`/`collectionId`.
- `?task=<id>` lands on `/tasks` with no editor -> the deep-link lookup failed (read the toast), or the param was marked handled **before** it settled: development StrictMode's setup → cleanup → setup then skips on the second pass while the first, cancelled closure holds the only response -> this file's effect plus `lib/ui/taskDeepLink.ts`.
- The editor reopens after being closed from a chip -> `closeEditor` did not remove the param, or the handled ref was cleared while the param still names the task -> this file's `clearTaskParam`.
- A chip click opens the event details instead of the task -> the calendar branch on `extendedProps.kind` was lost (see `components-calendar.md`), not this file.
- A row cannot be dragged onto the mini month, or its Undo restores the wrong date -> the row's payload and the mini-month/drop listeners disagree on the `text/x-nailong-task` shape (`{ id, scheduledOn }`) -> `lib/ui/taskDrag.ts`, `components/tasks/TaskRow.tsx`, `components/calendar/MiniMonth.tsx`, `lib/ui/useTaskPlanDrop.ts`.
- "Move to list…" is disabled or missing a list -> there is no other writable `kind="list"` collection, or `["collections"]` is still loading -> `moveTargets` above plus `GET /api/collections`.
- `j`/`k`/`1`/`x`/`z` do nothing -> focus is in an input, a dialog/menu is open, or `shortcutsEnabled` is off (`z` is not gated: `useUndoHotkey` is unconditional like the calendar's) -> check `lib/ui/useTaskShortcuts.ts`, `lib/ui/useUndoHotkey.ts` and `[data-testid="tasks-shell"]`'s `data-shortcuts-enabled`.
- `j` moves the wrong row after switching scopes -> the scope change should have cleared `selectedTaskId`; if it did not, `changeScope` lost the reset -> this file.
- The next triage key silently does nothing after a row was completed/deleted -> the task left the visible rows on the settle refetch and a stale `selectedTaskId` survived; the selection-coherence effect should have moved the selection to the nearest surviving row and focused it -> this file's `previousTasksRef` effect, `data-selected` on the rows.
- Focus lands on the scope tab after the last visible row disappears -> intended: there is no row to focus, and the tab is a real keyboard stop so `j` still means "next row" -> this file's `activeRef`.
- Pressing `1` twice leaves the task in Today with no visible change -> the PATCH is the same date, so the server echoes it and no undo toast appears -> this is the no-op guard, not a bug.
- Choosing Board shows a list -> intended: the board is a later task; the note and the disabled Group control say so, and `layout=board` is already reload-safe.
- The toolbar change is lost on reload -> `updateState` did not run `router.replace` (or `mergeTaskViewParams` dropped the key because it equalled the default) -> this file's `updateState` plus `lib/ui/taskViewParams.ts`.
- A row action does nothing and no toast appears -> the click landed before hydration on the E2E dev server, or the list is view-only for the partner (the PATCH 403s and toasts) -> rerun the action and read the toast.
- The breadcrumb on `/tasks` says "Calendar" -> the route lost its live roadmap entry: `ROUTE_CRUMBS` is built from `LIVE_ENTRIES`, so an unlisted `(app)` route falls back -> `lib/roadmap.ts`, `components/shell/AppShell.tsx`.
- The page scrolls the whole document -> a wrapper added `h-screen`/`overflow-hidden`; only `main` may scroll -> viewport contract in `app-routes.md` (`app/(app)/layout.tsx`).

**Tests** — `tests/e2e/tasks.spec.ts` is the UI gate (the v0.2.1 rewrite of its list/board/panel scenarios is Task 17; until then its old Plan-popover and ungroupped-order assertions are stale by design). No component unit test: the shell is exercised through Playwright, the pure key map by `tests/unit/use-task-shortcuts.test.ts`, the undo handle API by `tests/unit/undo.test.ts`, the URL codec by `tests/unit/task-view-params.test.ts`, the grouping/sorting/filtering by `tests/unit/task-views.test.ts`, and its PATCH/query behaviour by `tests/unit/task-cache.test.ts` and `tests/integration/tasks-api.test.ts`.

### components/tasks/TaskShortcutHelpDialog.tsx

**Purpose** — The `/tasks` `?` sheet: one "Global" group (`Shift+K`, `?`; `/` is the calendar's search and is not bound on `/tasks`, so it is deliberately absent) and one "Triage" group (`j`/`k`, `1`–`4`, `x`, `Enter`, `Escape`), listing `3` as "Someday: clear dates, or file an Inbox task to a list". It is deliberately separate from `components/calendar/ShortcutHelpDialog.tsx` because `j`/`k` mean row selection here and period navigation there.

**Public API** — `export function TaskShortcutHelpDialog(props: { open: boolean; onClose: () => void })`. Rows live in a module-level `GROUPS` constant; there are no queries or mutations.

**State & side effects** — Stateless/controlled. Renders the shared `Dialog`/`DialogContent` (`title="Keyboard shortcuts"`, description "Single-key shortcuts can be turned off in Settings → Calendar."), so Radix owns Escape, outside-click, focus trap and focus return to the opening control. `onOpenChange(false)` calls `onClose`; the footer "Close" button does too. Opened by `?` or the "Keyboard shortcuts" button beside the scope tabs in `TasksShell`. The copy still says "Open the selected task" for `Enter`: until the panel task lands, that opens `TaskEditorDialog`.

**Depends on / Used by** — `components/ui/dialog`, `components/ui/button`. Rendered by `components/tasks/TasksShell.tsx`.

**Debugging**
- `?` opens the calendar sheet instead of this one -> focus is on `/`, not `/tasks`; both hooks are page-scoped -> the calendar's `ShortcutHelpDialog` is the other mount.
- `?` does nothing while the sheet is open -> expected: `hasOpenOverlay()` blocks all page keys and Radix owns Escape/close.
- A key advertised here does not work -> compare `GROUPS` with `resolveTaskShortcut` in `lib/ui/useTaskShortcuts.ts`; the dialog must not advertise a gesture the resolver does not own.

**Tests** — No direct unit test (static markup); scenario 2 of `tests/e2e/tasks.spec.ts` exercises the keys it lists.

### components/tasks/TaskRow.tsx

**Purpose** — One dense ClickUp-style row: completion checkbox, a clickable title (struck through when done), the owning list's shade dot and name, the inline `TaskStatusPill`/`TaskPriorityFlag`/`TaskDateChips`, and the overflow menu with `Open`, `Move to list…`, `Drop` and `Delete`. It remains the triage layer's selection unit and the drag source.

**Public API** — `export function TaskRow(props: { task: TaskView; today: string; selected: boolean; onFocus(): void; actions: TaskActions; moveTargets: WritableList[] })`. `actions` is built per task by `TasksShell.actionsFor` (via `TaskList.actionsFor`), so every control changes its own row; `moveTargets` arrives with the current list already filtered out.

**State & side effects** — No local state of its own (the dropdown and the two date popovers own their open state; `TaskDateChips` owns the pickers). The `<li>` is `tabIndex={0}`, `aria-label={task.title}`, carries `data-task-id={task.id}`, `data-selected="true"` and `aria-current="true"` while selected (`bg-violet-soft` plus a 2px violet inset shadow), and reports focus upward through `onFocus` so a click/Tab on any control selects the row. It is `draggable`: `onDragStart` calls `setTaskDragPayload(event.dataTransfer, task)` from `lib/ui/taskDrag.ts`, which stamps `text/x-nailong-task` with the id and current `scheduledOn` and sets `effectAllowed = "move"`. The title is a real `<button>` whose click calls `actions.onOpen` (so `Enter` on it activates natively instead of being swallowed by the shortcut layer); its text gets `line-through` when `status === "done"`. The checkbox's accessible name is exactly the task title (`Checkbox label={task.title}`) and calls `actions.onToggleDone`, which the shell turns into `done`/`open`. The collection dot is `shadeTokens(collection.hueFamily, collection.shadeIndex).main` when the hue is a known family, else `var(--color-ink-mute)`; it is `aria-hidden` with the list name next to it (visually hidden below `sm` via `max-sm:sr-only`, so the name stays available to assistive tech). Accessible names the E2E later uses: `Options for <title>` on the menu trigger (hover/focus-revealed, permanently visible on coarse pointers), `Status: <label>`, `Priority: <label>`, `Scheduled date for <title>`, `Due date for <title>`. On a coarse pointer the checkbox and every icon control grow to 44px. The menu's first item is `Open` (the same target as a title click and `Enter`), then the `Move to list…` submenu (a disabled item when no other writable list exists), a separator, `Drop` and the danger-styled `Delete`.

**Depends on / Used by** — `components/ui/checkbox`, `components/ui/dropdown-menu` (sub + item primitives), `components/ui/icons` (`MoreVerticalIcon`), `lib/color/palette` (`isHueFamily`, `shadeTokens`), `lib/services/tasks` (`TaskView`), `lib/ui/taskDrag` (`setTaskDragPayload`), `lib/utils` (`cn`), `./TaskStatusPill`, `./TaskPriorityFlag`, `./TaskDateChips`, `./types` (`TaskActions`, `WritableList`). Rendered by `components/tasks/TaskList.tsx` inside a group's `<ul>`.

**Debugging** —
- The checkbox does nothing -> the PATCH failed (view-only list, partner-owned) -> read the toast from `TasksShell`; a done task also disappears after the settle refetch when closed rows are hidden, which is expected.
- A row's dot is grey -> the collection has no `hueFamily` (an Inbox list is created without one) or the stored hue is not a palette family -> fallback branch here.
- The due chip is red on a task due today -> `DateChips` compares `dueOn < today`, like `isOverdue` (equal dates are not overdue) -> `./TaskDateChips.tsx`.
- The overflow menu is unreachable by keyboard -> the `group-focus-within:opacity-100` / `focus-visible:opacity-100` classes were removed -> the trigger's `className`.
- A row cannot be selected by clicking or Tab -> `onFocus` was dropped from the `<li>` or `TaskList` stopped passing it -> this file's `li` plus `TaskList`.
- `aria-current`/`data-selected` never changes -> `selected` was hard-coded or the row re-renders without the prop -> `TaskList`'s `selectedId`.
- Clicking the title opens nothing -> `actions.onOpen` was not wired or the shell's `openTask` lost `setEditorTask` -> this file plus `TasksShell`.
- Dragging a row drops nothing -> the `onDragStart` payload was inlined again and renamed, so the drop targets' `text/x-nailong-task` no longer matches -> this file plus `lib/ui/taskDrag.ts`.

**Tests** — `tests/e2e/tasks.spec.ts` (selection/focus, inline status/priority/date changes, menu Open/Delete, row→mini-month drag; the v0.2.1 rewrite lands in Task 17). The drag payload helpers are pinned by `tests/unit/task-drag.test.ts`.

### components/tasks/TaskGroupHeader.tsx

**Purpose** — One collapsible group heading: a chevron button with the group label and its task count. `TaskList` owns the open state and passes it in; the header only renders and calls `onToggle`.

**Public API** — `export function TaskGroupHeader(props: { label: string; count: number; open: boolean; controlsId: string; onToggle(): void; testId?: string })`. `controlsId` names the `<ul>` the button controls; `testId` is the optional `task-group-<key>` E2E hook (the accessible name is the label).

**State & side effects** — None; controlled by `TaskList`. The `<button>` carries `aria-expanded={open}` and `aria-controls={controlsId}`, rotates its `ChevronDownIcon` when collapsed, shows the count pill (`aria-hidden`) plus an `sr-only` "N tasks", and has a violet focus ring and a 44px coarse-pointer target. No query, no storage.

**Depends on / Used by** — `components/ui/icons` (`ChevronDownIcon`), `lib/utils` (`cn`). Rendered by `components/tasks/TaskList.tsx`.

**Debugging** — The group will not collapse -> the `<ul>`'s `hidden` prop is not bound to the same `open` value `TaskGroupHeader` received -> `TaskList`'s `openByKey`. The count does not match the visible rows -> the header was fed a different array from the `<ul>` (for example after a filter) -> `group.tasks.length` in `TaskList`. A screen reader announces the wrong state -> `aria-expanded`/`aria-controls` were dropped; both are required even though the chevron already turns.

**Tests** — No direct unit coverage; the group collapse interaction belongs to `tests/e2e/tasks.spec.ts` (Task 17).

### components/tasks/TaskList.tsx

**Purpose** — The grouped list: one `TaskGroupHeader` plus a `<ul>` per `TaskGroup`, with local collapse state (all groups start open), and the empty state when there are no groups at all.

**Public API** — `export function TaskList(props: { groups: TaskGroup<TaskView>[]; today: string; selectedId: string | null; onFocus(id: string): void; actionsFor(task: TaskView): TaskActions; moveTargets: WritableList[]; emptyMessage: string; onClearFilters: (() => void) | null })`. `groups` is `groupTasks` output (empty groups already omitted). **Deviation from the plan's brief:** the brief types this prop as a single `actions: TaskActions`, but every `TaskActions` callback acts on *its own* task and the type carries no task argument, so one shared object cannot bind a click to the row that fired it; `TaskList` therefore takes `actionsFor(task)` and hands each row its own `TaskActions`. `TaskRow`'s public prop stays exactly `actions: TaskActions`.

**State & side effects** — Local `openByKey: Record<string, boolean>` (absent means open) and nothing else; `toggle(key)` flips one group and a group that only appears after a filter/sort change defaults to open. Each group renders `<section aria-label="<label> tasks">` containing `TaskGroupHeader` and `<ul id=... hidden={!open}>`; collapsed rows stay in the DOM (and in `TasksShell`'s `visibleRows`) but are not focusable. `onFocus(id)` bubbles a row focus/click up. When `groups.length === 0` it renders `emptyMessage`; a "Clear filters" button appears only when `onClearFilters` is non-null (the shell passes it only while a filter is active). The root carries `data-testid="task-list"` (the v0.2.0 contract, now on the grouped container). No query, no storage.

**Depends on / Used by** — `components/ui/button` (Clear filters), `lib/domain/taskViews` (`TaskGroup`), `lib/services/tasks` (`TaskView`), `./TaskGroupHeader`, `./TaskRow`, `./types`. Rendered by `components/tasks/TasksShell.tsx`.

**Debugging** — `j`/`k` selects a row that is not visible -> the selection traverses `TasksShell`'s group data, not the collapsed DOM; expand the group (a known limitation of keeping collapse state here) -> this file's `openByKey` plus the shell's `visibleRows`. The empty state appears with tasks in the bucket -> a filter is active or every group was emptied by it -> read the shell's `filtersActive`/`emptyMessage`. "Clear filters" is missing although the list is empty -> `onClearFilters` is `null` because no filter is active -> the shell. Two groups split the same status -> `groupTasks` was fed unsorted rows or the wrong `group` key -> `lib/domain/taskViews.ts` and the shell's `state.group`.

**Tests** — No direct unit coverage; group rendering/collapse and the empty-state Clear-filters are `tests/e2e/tasks.spec.ts` (Task 17). The grouping maths is `tests/unit/task-views.test.ts`.

### components/tasks/TaskEditorDialog.tsx

**Purpose** — The task editor: one dialog for title, notes, due date and checklist, with Save and Delete. Opened by `TasksShell` on `Enter`, the row title / row menu's `Open` action and the `?task=` deep link; it only renders while a task is supplied.

**Public API** — `export function TaskEditorDialog(props: { task: TaskView | null; today: string; onClose: () => void; onDelete: (task: TaskView) => void })`. `today` is the household-local date for the due-date picker (a deviation from the plan's `{ task, onClose }` interface, needed for a correct Today button); `onDelete` exists because the shell owns the delete mutation and its undo toast. The body (`TaskEditorBody`, not exported) is keyed by `task.id`, so every open starts from the server snapshot.

**State & side effects** — Draft state: `title`, `notes` (plain text), `dueOn: string | null`, a checklist array of `{ key, title, done }` (server item ids as keys), the add-item field, the due-popover open flag and `useUpdateTask().isPending`. Save (form submit, or Enter in the title field) PATCHes one payload: `title` (trimmed; empty disables Save and shows the `role="alert"` "Give the task a title." under the field), `notes` (blank clears to `null`), `dueOn` and the **whole** `checklist` array as `{ title, done }` — Task 5's replace contract, so a save regenerates every item id. A save may move the task out of the open bucket (a due date); `onClose` runs after the PATCH and the shell's selection coherence handles the vanished row. A server 400/403 surfaces as an error toast (the shared `useUpdateTask` throws the envelope message) and the dialog stays open. Checklist controls: each item renders a `Checkbox` whose accessible name is the item title and a `Remove <title>` button; the add field (`New checklist item`, `#task-editor-new-item`) adds on Enter without submitting the form, and the `Add item` button is disabled while blank. The due field is a labelled (`Due date`) outline button showing `formatWallDate(dueOn)` or "No due date" that opens the shared `DatePickerPopover` in a non-modal popover, with a `Clear due date` action; Escape inside it closes only the calendar because the popover's Radix `DismissableLayer` is the highest layer while it is open — Radix's document-capture Escape handler dismisses that layer and the dialog's layer never sees the key (the file deliberately has no `stopPropagation`; a bubble handler would be a no-op against a capture listener). `Delete task` closes the dialog and calls `onDelete(task)`. Escape, `Cancel` and a successful save call `onClose`; `TasksShell` then restores focus to the selected row. Coarse-pointer targets are 44px; the scroll area pads 4px horizontally so focus rings are not clipped.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/calendar/DatePickerPopover` (which renders `MiniMonth`), `components/ui/{button,checkbox,dialog,icons}`, `lib/query/tasks` (`useUpdateTask`), `lib/services/tasks` (`TaskView`), `lib/time/format` (`formatWallDate`), `lib/utils` (`cn`), `lib/validation/tasks` (`UpdateTaskInput`), `sonner`. Rendered by `components/tasks/TasksShell.tsx` (only mount).

**Debugging**
- The dialog opens with the previous task's text -> the body lost `key={task.id}` -> this file's `TaskEditorDialog`.
- Save does nothing -> the title is blank after trimming (Save disabled and the field shows its alert) or a PATCH is already in flight -> this file's `save`.
- Escape closes the whole editor while the due-date calendar is open -> the popover is not the topmost Radix layer (it must be portalled inside its own `PopoverPrimitive.Root` and actually open), so the dialog's `DismissableLayer` took the key; there is no `stopPropagation` to look for -> this file's `PopoverPrimitive.Root`/`Content`.
- Checklist edits look saved but revert after reload -> the PATCH sent a partial array or the service treated it as a diff; it must be the complete `checklist` -> `lib/services/tasks.ts` `replaceChecklist`.
- The new title/notes are gone after Escape -> intended: Escape and Cancel discard the draft (no dirty-guard confirm in this dialog) -> this file's `onClose`.
- Delete leaves the list unchanged -> the DELETE failed (view-only/partner list) -> read the toast from `TasksShell`'s `deleteTaskWithUndo`.

**Tests** — `tests/e2e/tasks.spec.ts` (the editor-persistence test; Task 17 updates its row-opener selector): open a row with `Enter` (and once through the row menu's `Open`), edit title + notes, add two checklist items, tick one, save, reload and assert the row/API payload, set a due date through the date popover (the task re-buckets Inbox → Today and its due chip appears), clear it again (back to Inbox, chip gone, `dueOn: null`), then open again and assert Escape closes without saving. No component unit test (the repo has no React renderer); the PATCH/cache behaviour is covered by `tests/unit/task-cache.test.ts` and `tests/integration/tasks-api.test.ts`.

### components/tasks/types.ts

**Purpose** — The shared task-surface contract: `TaskActions` (the eight callbacks a row, board card or slide-over panel may call) and `WritableList` (the id/name pair the move menu and the list filter use). Type-only, so it has no React or runtime footprint.

**Public API** — `export interface TaskActions { onOpen(): void; onStatus(status: TaskStatus): void; onPriority(priority: TaskPriority): void; onDates(patch: { scheduledOn?: string | null; dueOn?: string | null }): void; onMove(collectionId: string): void; onDrop(): void; onDelete(): void; onToggleDone(done: boolean): void }`; `export interface WritableList { id: string; name: string }`. Each surface receives an `actions` object already bound to *its* task; the object itself never carries a task id.

**State & side effects** — None: no hooks, no storage, no queries. The callback implementations (PATCH/toast/undo) live in `TasksShell`; a surface only invokes them.

**Depends on / Used by** — `lib/db/schema` (`TaskStatus`, `TaskPriority`, type-only). Imported by `components/tasks/TaskRow.tsx`, `TaskList.tsx`, `TaskToolbar.tsx`, `TaskStatusPill.tsx`'s consumers and (later) the board/panel; `TasksShell` builds the `TaskActions` per task.

**Debugging** — A row control changes the wrong task -> the shell built one `TaskActions` for all rows instead of one per task -> `TasksShell`'s `actionsFor(task)`. A new inline picker has no callback -> add it here first; the compiler then names every shell implementation that must supply it.

**Tests** — No direct unit coverage (types only); `npx tsc --noEmit` enforces the call sites. `tests/e2e/tasks.spec.ts` exercises the actions through the row.

### components/tasks/TaskStatusPill.tsx

**Purpose** — The inline status picker: a dense pill coloured with the status tokens (`status-todo`, `status-progress`, existing `success` for done and `well` for dropped) that opens a Radix radio menu of `TASK_STATUS_ORDER`.

**Public API** — `export function TaskStatusPill(props: { status: TaskStatus; onChange: (status: TaskStatus) => void; compact?: boolean })`. `compact` drops the visible label and keeps the dot, for a narrow slot; the button's `aria-label` is always `Status: <label>`.

**State & side effects** — No local state: `DropdownMenu` owns open/focus. The trigger is a plain `<button>` (not `Button`) carrying `data-testid="task-status-<status>"`, a violet focus ring and a 44px coarse-pointer target. Choosing a different status calls `onChange` once and closes the menu; choosing the current status does nothing. No query, no storage: the shell owns the PATCH, the "Task completed"/"Task started"/… toast and its undo.

**Depends on / Used by** — `components/ui/dropdown-menu` (radio group/item), `lib/domain/taskViews` (`TASK_STATUS_ORDER`, `TASK_STATUS_LABELS`), `lib/db/schema` (`TaskStatus`), `lib/utils` (`cn`). Rendered by `components/tasks/TaskRow.tsx` (non-compact) and later by the board card/panel.

**Debugging** — The pill says "To do" but the task is in progress -> `status` came from a stale `TaskView` snapshot; the optimistic `useUpdateTask` patch should repaint it, otherwise the PATCH failed and the toast explains why -> `lib/query/tasks.ts`. The menu opens but the check sits on the wrong row -> the radio group lost `value={status}` -> this file. A dark/invisible pill -> the status token classes were replaced by literal hex values; `app/globals.css` owns them.

**Tests** — No direct unit coverage; `tests/e2e/tasks.spec.ts` (inline status change) is the UI gate.

### components/tasks/TaskPriorityFlag.tsx

**Purpose** — The inline priority picker: a `FlagIcon` coloured by priority (`urgent` danger, `high` warning, `normal` accent, `low`/`none` muted, `none` at lower emphasis) with the priority word, opening a Radix radio menu of `TASK_PRIORITY_ORDER`.

**Public API** — `export function TaskPriorityFlag(props: { priority: TaskPriority; onChange: (priority: TaskPriority) => void })`. The trigger's `aria-label` is `Priority: <label>` and its test id is `task-priority-<priority>`; the label text is hidden below `sm` so the row stays narrow.

**State & side effects** — No local state; `DropdownMenu` owns open/focus. Choosing a different priority calls `onChange` once and closes the menu; the current priority is a no-op. The shell owns the PATCH and the "Priority updated" toast plus its targeted undo. No query, no storage.

**Depends on / Used by** — `components/ui/dropdown-menu` (radio group/item), `components/ui/icons` (`FlagIcon`), `lib/domain/taskViews` (`TASK_PRIORITY_ORDER`, `TASK_PRIORITY_LABELS`), `lib/db/schema` (`TaskPriority`), `lib/utils` (`cn`). Rendered by `components/tasks/TaskRow.tsx` and later by the board card/panel.

**Debugging** — `none` looks like a broken/empty control -> intended: the muted flag is the affordance that opens the menu; it brightens on hover. A flag shows the wrong colour -> the priority value is stale (optimistic patch rolled back after a 403) -> read the shell's toast. The menu is missing a level -> `TASK_PRIORITY_ORDER` was filtered in the UI instead of consuming the shared table.

**Tests** — No direct unit coverage; `tests/e2e/tasks.spec.ts` (inline priority change) is the UI gate. The priority ordering tables themselves are pinned by `tests/unit/task-views.test.ts`.

### components/tasks/TaskDateChips.tsx

**Purpose** — The row's two inline date fields: a scheduled chip (calendar icon) and a due chip (clock icon), each a Radix popover wrapping the shared `DatePickerPopover` plus a Clear action. Supersedes the deleted `TaskPlanPopover` (one date, scheduled-only).

**Public API** — `export function TaskDateChips(props: { scheduledOn: string | null; dueOn: string | null; today: string; title: string; onChange: (patch: { scheduledOn?: string | null; dueOn?: string | null }) => void })`. The chips carry `data-testid="task-date-scheduled"` / `"task-date-due"` and their clear buttons `-clear`; the accessible names are "Scheduled date for <title>"/"Due date for <title>" (plus the formatted date when set).

**State & side effects** — Local `open` per chip only. A set chip shows `formatWallDate(date)` (e.g. "Wed, 28 Oct 2026"); an unset chip is icon-only, which keeps the picker reachable on every row without two "Set date" labels. The due chip is `text-danger-ink` when `dueOn < today` — date-only, because the props carry no status, so a closed row with a past due date also renders the overdue colour (the row is only in the list when "Show closed" is on). Picking a day closes the popover and calls `onChange({ scheduledOn })` or `onChange({ dueOn })`; Clear calls the same with `null`. The picker is keyed by the saved date so it re-seeds, uses the household `today` (never the device clock) and is non-modal (Escape/outside-click close, focus returns to the chip). No query, no storage: the shell owns the PATCH and its "Task scheduled"/"Due date updated" toast plus targeted undo.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/calendar/DatePickerPopover` (which renders `MiniMonth`), `components/ui/button`, `components/ui/icons` (`CalendarIcon`, `ClockIcon`, `IconProps`), `lib/time/format` (`formatWallDate`), `lib/utils` (`cn`). Rendered by `components/tasks/TaskRow.tsx` and later by the panel.

**Debugging** — The picker opens on the wrong month -> the anchor is the saved date when present; the chip lost its `key={date}` and no longer re-seeds -> this file's `DateChip`. The due chip is red on a done task -> intended date-only comparison: the component has no status prop; the bucket/overdue rule itself is `isOverdue` in `lib/domain/tasks.ts`. Picking a day moves the row to another bucket -> expected: `scheduledOn`/`dueOn` decide bucket membership server-side. Escape closes the whole panel instead of the calendar -> the popover content is not portalled/rooted (it must be the topmost Radix layer) -> this file's `PopoverPrimitive.Portal`.

**Tests** — No direct unit coverage; `tests/e2e/tasks.spec.ts` (inline date set/clear) is the UI gate. `MiniMonth` itself is covered by `tests/e2e/mini-month.spec.ts` and `tests/e2e/event-fields.spec.ts`.

### components/tasks/TaskCaptureRow.tsx

**Purpose** — The ClickUp-style add-task row above the list: one input, `Enter` captures into the Inbox (or the supplied list), `Shift+Enter` also schedules it for the household's today. Replaces the deleted `TaskCaptureBar`; the id and test id stay `task-capture`.

**Public API** — `export function TaskCaptureRow(props: { timezone: string; collectionId?: string; status?: TaskStatus; placeholder?: string; onCaptured?: (task: TaskView) => void })`. `timezone` drives `localToday`; `collectionId` files the task in that list; `status` is for the later board's per-column quick add.

**State & side effects** — Local `title` only. `useCreateTask()` posts `{ title }` / `{ title, collectionId }` / `+ scheduledOn: localToday(timezone)`; the trimmed title must be non-empty and the input is disabled while the mutation is pending. The text is cleared and `onCaptured` fired only on success, so a failed create keeps what was typed and toasts exactly `Could not add the task.` Because `POST /api/tasks` does not accept `status` (the create schema predates the field), a non-`open` `status` costs one follow-up PATCH through `useUpdateTask`; if that PATCH fails the task still exists and the toast says `Task added, but its status could not be set.` The element carries `id="task-capture"` and `data-testid="task-capture"` (the old e2e selector and the new contract), an `sr-only` label plus hint (`Enter adds the task to Inbox. Shift+Enter also schedules it for today.`).

**Depends on / Used by** — `lib/domain/tasks` (`localToday`), `lib/query/tasks` (`useCreateTask`, `useUpdateTask`), `lib/services/tasks` (`TaskView`), `lib/validation/tasks` (`CreateTaskInput`), `components/ui/icons` (`PlusIcon`), `sonner`. Rendered by `components/tasks/TasksShell.tsx`; the later board renders one per column.

**Debugging** — Typing + Enter does nothing -> the title is blank after trimming or a create is in flight (input disabled) -> this file's `capture`. Shift+Enter files it in Inbox -> `event.shiftKey` was not forwarded or the household zone is wrong -> `capture` and `household.timezone`. The typed text disappears after a server error -> `setTitle("")` left `onSuccess` -> this file's callbacks. A board quick-add leaves the task in To do -> the follow-up status PATCH failed; read the toast -> this file's `onSuccess`.

**Tests** — No direct unit coverage; `tests/e2e/tasks.spec.ts` (capture + persistence) is the UI gate.

### components/tasks/TaskViewTabs.tsx

**Purpose** — The scope tabs (Inbox · Today · Week · Someday with open counts and the cross-cutting overdue pill) plus the List/Board segmented control. Replaces the deleted `TaskViewSwitcher.tsx`.

**Public API** — `export const TASK_BUCKET_LABELS: Record<TaskBucket, string>` — **moved here** from `TaskViewSwitcher.tsx` (deleted in the same release); `TasksShell` reads it for the list's accessible name. `export function TaskViewTabs(props: { view: TaskBucket; counts?: TaskCounts; layout: TaskLayout; onScope(view: TaskBucket): void; onLayout(layout: TaskLayout): void; activeRef?: Ref<HTMLButtonElement> })`. `activeRef` is attached to the current scope's button so an emptied view can hand focus back there.

**State & side effects** — Stateless/controlled; the scope and layout live in `TasksShell` (scope local, layout in the URL). Scope buttons render in `TASK_BUCKETS` order with `aria-pressed` and `aria-label="<Label>, <count> open"` once counts exist; before the first payload the badge is absent (never a false row of zeros). The count badge is `aria-hidden` with `data-testid="tasks-count-<bucket>"`; `counts.overdue > 0` renders one separate danger pill (`data-testid="tasks-overdue-count"`, `N overdue`) because overdue is not a fifth bucket. The List/Board control is a `role="group"` of two `aria-pressed` buttons; choosing Board persists `layout=board` but the board itself lands later — `TasksShell` keeps rendering the list with a "Board view ships next" note and disables the toolbar's Group menu. No query, no storage.

**Depends on / Used by** — `lib/domain/tasks` (`TASK_BUCKETS`, `TaskBucket`), `lib/domain/taskViews` (`TaskLayout`), `lib/services/tasks` (`TaskCounts`), `components/ui/icons` (`ListIcon`, `BoardIcon`), `lib/utils` (`cn`). Rendered by `components/tasks/TasksShell.tsx`.

**Debugging** — A count looks wrong while the rows look right -> `counts` is global across every visible active task, even when the rows are filtered -> `GET /api/tasks` returns global counts. The overdue pill hides -> the task is done/dropped (inactive) or `dueOn === today` -> `isOverdue` in `lib/domain/tasks.ts`. `getByRole("button", { name: "Today" })` matches two controls -> the picker's Today shortcut and this scope both exist; this one's name is `Today, N open` -> scope the locator. Choosing Board shows a list -> intended until the board change; the note and the disabled Group control are the honest state, not a bug.

**Tests** — No direct unit coverage; `tests/e2e/tasks.spec.ts` asserts the scope rows and count badges.

### components/tasks/TaskToolbar.tsx

**Purpose** — The dense view toolbar: Add task, Group (status/priority/list), Filter (status/priority/list checkboxes with a Clear action), Sort (manual/priority/due/created/title) and the Hide closed toggle.

**Public API** — `export function TaskToolbar(props: { state: TaskViewState; onChange(next: TaskViewState): void; onAddTask(): void; lists: WritableList[] })`. Every menu change calls `onChange({ ...state, key })`; the shell writes the result into the URL. `onAddTask` focuses the capture row's input (the shell owns `#task-capture`); `lists` populates the filter's List group with the writable lists.

**State & side effects** — No local state; the Radix dropdowns own open/focus and close on selection (checkbox items stay open so several can be ticked). Group is **disabled** when `state.layout === "board"` (the board is always grouped by status) with a `title` explaining it; Sort, Filter and Hide closed stay enabled. The Filter trigger shows a violet active count (`data-testid="task-filter-count"`); Clear filters resets `status`, `priority` and `collectionId` only. Hide closed is a toggle whose `aria-pressed` is `!state.closed`: pressed means done/dropped rows are hidden (the default), and clicking it sets `closed=1` in the URL. Add task is the violet primary control (`data-testid="task-add"`). No query, no storage.

**Depends on / Used by** — `components/ui/dropdown-menu` (radio/checkbox/label/separator), `components/ui/icons` (`ChevronDownIcon`, `PlusIcon`), `lib/domain/taskViews` (`TASK_STATUS_ORDER`/`LABELS`, `TASK_PRIORITY_ORDER`/`LABELS`, `GroupBy`, `TaskSort`), `lib/ui/taskViewParams` (`TaskViewState`), `./types` (`WritableList`), `lib/utils` (`cn`). Rendered by `components/tasks/TasksShell.tsx`.

**Debugging** — Group is greyed out -> the URL says `layout=board`; switch to List to regroup -> `state.layout`. A filter tick does not narrow the list -> the shell stopped passing `state.status`/`priority`/`collectionId` to `filterTasks`, or the selected status is outside the fetched rows -> `TasksShell`'s `filterTasks` call. Hide closed looks pressed on first load -> intended: closed rows are hidden by default, so "Hide closed" is on; pressing it sets `closed=1`. The List filter is missing a list -> only writable `kind="list"` collections are passed (the shell's `moveTargets`); private or view-only lists are deliberately absent.

**Tests** — No direct unit coverage; `tests/e2e/tasks.spec.ts` (grouping, filtering, hide-closed) is the UI gate. `tests/unit/task-views.test.ts` pins the group/sort/filter maths it drives.

## Known debt (deferred)

- **The date-popover wiring is duplicated a third time in `TaskEditorDialog`.** Its due-date field hand-rolls the `PopoverPrimitive.Root`/`Trigger`/`Portal`/`Content` shell, the Clear action and the keyed `DatePickerPopover` that `components/calendar/DateField.tsx` already provides (the other copy is `Toolbar`'s title picker). Consolidating them into one shared field is deliberately deferred: it is presentation-only duplication, and the nested-layer Escape behaviour it encodes (the popover must be the topmost Radix `DismissableLayer`) is pinned by the editor-persistence test in `tests/e2e/tasks.spec.ts`. Do not refactor it as part of a docs sweep.
