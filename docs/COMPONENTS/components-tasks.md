# Tasks workspace components

The `/tasks` triage workspace: capture, the four buckets and the row actions.
Bucketing itself is server-side (`lib/domain/tasks.ts`, `lib/services/tasks.ts`);
these components choose a view, render what the server returns and turn row
actions into PATCH/DELETE calls.

`app/(app)/tasks/page.tsx` is documented in
[`app-routes.md`](app-routes.md#appapptaskspagetsx) — the repo rule is one
`###` section per file, and every `app/` route lives in `app-routes.md`, so the
page cannot appear here as well.

**Read this when** a row action does nothing, a task shows in the "wrong"
bucket, a touch target is too small, or an E2E spec cannot find a control: the
accessible-name patterns are listed per component below.

### components/tasks/TasksShell.tsx

**Purpose** — The client workspace under the server page: capture bar, view switcher, and the active bucket's rows with their loading, error and empty states. It is the only owner of the selected view and of the task/collection mutations.

**Public API** — `export function TasksShell(props: { timezone: string; weekStartsOn: 0 | 1; shortcutsEnabled: boolean; currentUserId: string })`. No other exports.

**State & side effects** — Local `view` (`useState<TaskBucket>`, default `"inbox"`). Queries: `useTasks(view)` over the key `["tasks", view ?? "all", collectionId ?? null]` (`/api/tasks?view=…`, returns `{ tasks, counts }`) and `useCollections()` (`["collections"]`, needed for the Move-to-list submenu). `counts` stays `undefined` until the first payload (loading and error render no badges) and `today` is `useMemo(() => localToday(timezone), [timezone])`; bucket membership itself is never recomputed here. Mutations: `useUpdateTask` for complete/uncomplete (`status`), Plan (`scheduledOn`, `null` clears), Move (`collectionId`) and Drop (`status: "dropped"`); `useDeleteTask` for Delete. Failures toast `Could not update the task.` / `Could not schedule the task.` / `Could not move the task.` / `Could not drop the task.` / `Could not delete the task.`; there is no optimistic create or delete (only the PATCH hook is optimistic, and the settle refetch removes completed/dropped rows). Move targets are the viewer's writable lists, computed here with `canWriteCollection` over `foldCollectionPermission` (the shared root/child fold, also used by the sidebar) and labelled `Parent / Child` for sub-lists; the current list is filtered per row and the server stays authoritative (a stale tree gets a 403). States: `isError` renders `role="alert"` with "Could not load the tasks." and a "Try again" retry button; `isPending` renders `role="status"` "Loading tasks…"; zero rows renders exactly "Nothing here. Enjoy the quiet.". The root `<section aria-label="Tasks" data-testid="tasks-shell">` also carries `data-week-starts-on` and `data-shortcuts-enabled`, the two page values the keyboard triage layer in Task 9 consumes.

**Depends on / Used by** — `lib/domain/tasks` (`localToday`, `TaskBucket`), `lib/query/tasks` (`useTasks`, `useUpdateTask`, `useDeleteTask`), `lib/query/collections` (`useCollections`), `lib/services/permissions` (`canWriteCollection`, `foldCollectionPermission`), `lib/validation/tasks` (`UpdateTaskInput`), `components/ui/button`, `sonner`, and the three sibling components. Rendered only by `app/(app)/tasks/page.tsx`.

**Debugging** —
- A completed task vanishes with no way to undo here -> intended in this task: `listTasks` excludes done/dropped rows, so the settle refetch removes the row; undo arrives with the editor (Task 10).
- A badge lags one step behind a row edit -> `useUpdateTask` is row-only optimistic and `counts` are recomputed on the settle refetch -> `lib/query/tasks.ts`.
- A task exists but every view is empty -> it is dated beyond this week (no triage bucket) or its list is private to the partner (server 404) -> `lib/domain/tasks.ts` `bucketOf` and `lib/services/tasks.ts` `listTasks`.
- "Move to list…" is disabled or missing a list -> there is no other writable `kind="list"` collection, or `["collections"]` is still loading -> `moveTargets` above plus `GET /api/collections`.
- A row action does nothing and no toast appears -> the click landed before hydration on the E2E dev server, or the list is view-only for the partner (the PATCH 403s and toasts) -> rerun the action and read the toast.
- The breadcrumb on `/tasks` says "Calendar" -> expected until Task 13 makes the rail entry live: `ROUTE_CRUMBS` is built from `LIVE_ENTRIES`, so an unlisted `(app)` route falls back -> `components/shell/AppShell.tsx`.
- The page scrolls the whole document -> a wrapper added `h-screen`/`overflow-hidden`; only `main` may scroll -> viewport contract in `app-routes.md` (`app/(app)/layout.tsx`).

**Tests** — `tests/e2e/tasks.spec.ts` (scenario 1: capture, Plan scheduling, bucket persistence across reload). No unit test: this shell is exercised through Playwright and its PATCH/query behaviour lives in `tests/unit/task-cache.test.ts` and `tests/integration/tasks-api.test.ts`.

### components/tasks/TaskCaptureBar.tsx

**Purpose** — One always-visible input for fast task capture: `Enter` files the task in the Inbox, `Shift+Enter` schedules it for the household's today.

**Public API** — `export function TaskCaptureBar(props: { timezone: string; onCaptured?: (task: TaskView) => void })`. The `timezone` prop is required for `localToday(timezone)` and is the one addition to the plan's `{ onCaptured? }` signature.

**State & side effects** — Local `title` only. `useCreateTask()` (`POST /api/tasks`, then invalidates `["tasks"]`). The input has `id="task-capture"`, `type="text"`, placeholder exactly `Add a task…`, an `sr-only` `<label htmlFor="task-capture">Add a task</label>` and a hint line (`id="task-capture-hint"`, wired with `aria-describedby`) "Enter adds to Inbox · Shift+Enter schedules it for today". `onKeyDown` intercepts `Enter` only (`preventDefault`), passing `event.shiftKey` to the mutation: `{ title }` or `{ title, scheduledOn: localToday(timezone) }`. The title is trimmed; an empty/whitespace title is ignored. The input is `disabled` while the mutation is pending; the text is cleared and `onCaptured` fired only on success, so a failure keeps the text and toasts `Could not add the task.`. No local storage. `TasksShell` does not pass `onCaptured` yet: it is the hook the later focus/announce wiring uses.

**Depends on / Used by** — `lib/domain/tasks` (`localToday`), `lib/query/tasks` (`useCreateTask`), `lib/services/tasks` (`TaskView`), `sonner`. Rendered by `TasksShell`. The E2E spec drives it through `#task-capture` and `page.keyboard.press("Enter")`.

**Debugging** —
- Typing and pressing Enter does nothing -> the title was blank after trimming, or a request is still in flight (the input is disabled) -> this file's `capture`.
- Shift+Enter files the task in Inbox instead of Today -> `event.shiftKey` was not forwarded, or the household zone is wrong so "today" is another date -> check `capture` and `household.timezone`.
- The typed text disappears after a server error -> `setTitle("")` moved into `onError` or outside `onSuccess` -> `capture`'s callbacks.

**Tests** — `tests/e2e/tasks.spec.ts` (all three captures; persistence after reload).

### components/tasks/TaskViewSwitcher.tsx

**Purpose** — The segmented Inbox · Today · Week · Someday control with each bucket's open count, plus the cross-cutting overdue badge.

**Public API** — `export const TASK_BUCKET_LABELS: Record<TaskBucket, string>` (also imported by `TasksShell` for the row list's label); `export function TaskViewSwitcher(props: { view: TaskBucket; counts?: TaskCounts; onChange: (view: TaskBucket) => void })`.

**State & side effects** — Stateless and controlled; the selected view lives in `TasksShell` (default Inbox). Buttons render in `TASK_BUCKETS` order, each with `aria-pressed={view === bucket}` and, once counts have loaded, `aria-label` `"<Label>, <count> open"` (for example `Today, 3 open`); before the first payload (loading or error) `counts` is `undefined`, every button still renders, its accessible name is just the label, and no badge is drawn — the switcher never shows a false row of zeros. The visible count is an `aria-hidden` badge with `data-testid="tasks-count-<bucket>"`; once counts exist a zero still renders as `0`. `counts.overdue > 0` renders one separate badge (`data-testid="tasks-overdue-count"`, danger colours, text `N overdue`) and nothing when zero: overdue is deliberately **not** a fifth bucket, because an overdue task can sit in Today or Week. No query, no storage.

**Depends on / Used by** — `lib/domain/tasks` (`TASK_BUCKETS`, `TaskBucket`), `lib/services/tasks` (`TaskCounts`), `lib/utils` (`cn`). Rendered by `TasksShell`.

**Debugging** —
- A count looks wrong but the rows look right -> `counts` is global across every visible open task, even when the rows are filtered -> `GET /api/tasks` returns global counts (documented in `app-routes.md`).
- The overdue badge disappears while a due date is in the past -> the task is done/dropped (no longer open) or `dueOn === today` (not overdue) -> `isOverdue` in `lib/domain/tasks.ts`.
- `getByRole("button", { name: "Today" })` matches two controls -> the popover's Today shortcut and this bucket both exist; this one's name is `Today, N open` -> scope the locator.

**Tests** — `tests/e2e/tasks.spec.ts` asserts the bucket rows and the count badges after reload.

### components/tasks/TaskRow.tsx

**Purpose** — One row: accessible completion checkbox, title (struck through when done), due badge, the owning list's shade dot, the Plan popover and the row menu with `Move to list…`, `Drop` and `Delete`.

**Public API** — `export function TaskRow(props: { task: TaskView; today: string; moveTargets: ReadonlyArray<{ id: string; name: string }>; onToggleDone: (done: boolean) => void; onPlan: (date: string | null) => void; onMove: (collectionId: string) => void; onDrop: () => void; onDelete: () => void })`. All state lives in the shell; the row only renders and calls back.

**State & side effects** — No local state besides the Plan popover's open flag (inside `TaskPlanPopover`). The `<li>` is `tabIndex={0}`, carries `data-task-id={task.id}` and is `draggable`: `onDragStart` sets `text/x-nailong-task` to the task id (the calendar-chip drop target in Task 11 reads it) with `effectAllowed = "move"`. The checkbox's accessible name is exactly the task title (`Checkbox label={task.title}`); checking PATCHes `status: "done"`, unchecking `status: "open"`. The title gets `line-through` when `status === "done"` (visible only while the optimistic row survives; done rows are not listed after the settle refetch). A due date renders a badge: `Overdue` in `bg-danger-soft`/`text-danger-ink` when `isOverdue(task, today)`, otherwise `formatWallDate(dueOn)` in the neutral well style; no due date renders no badge. The collection dot is `shadeTokens(collection.hueFamily, collection.shadeIndex).main` when the hue is a known family, else `var(--color-ink-mute)`; it is `aria-hidden` with the list name following as `sr-only`. Accessible names the E2E spec depends on: `Options for <title>` on the menu trigger (same pattern as the sidebar row), `Plan <title>` on the Plan trigger. The menu trigger is hover/focus-revealed (`opacity-0` until `group-hover`/`focus-visible`/menu-open) and permanently visible on a coarse pointer (`[@media(pointer:coarse)]:opacity-100`), so touch users can reach Move/Drop/Delete without hovering. On a coarse pointer the checkbox and both icon controls grow to 44px. `Move to list…` is a submenu; when no other writable list exists it renders as a disabled item instead. `Delete` is danger-styled and runs `DELETE /api/tasks/{id}`.

**Depends on / Used by** — `components/ui/checkbox`, `components/ui/dropdown-menu` (sub + item primitives), `components/ui/icons` (`MoreVerticalIcon`), `lib/color/palette` (`isHueFamily`, `shadeTokens`), `lib/domain/tasks` (`isOverdue`), `lib/time/format` (`formatWallDate`), `lib/services/tasks` (`TaskView`), `lib/utils` (`cn`), `./TaskPlanPopover`. Rendered by `TasksShell` inside `<ul aria-label="<View> tasks">`.

**Debugging** —
- The checkbox does nothing -> the PATCH failed (view-only list, partner-owned) -> read the toast from `TasksShell`; a done task also disappears after the settle refetch, which is expected.
- A row's dot is grey -> the collection has no `hueFamily` (an Inbox list is created without one) or the stored hue is not a palette family -> fallback branch here.
- `Overdue` shows on a task due today -> `isOverdue` compares `dueOn < today`, so equal dates are not overdue -> `lib/domain/tasks.ts`.
- The overflow menu is unreachable by keyboard -> the `group-focus-within:opacity-100` / `focus-visible:opacity-100` classes were removed -> the trigger's `className`.
- Dragging a row drops nothing in Task 11 -> the `text/x-nailong-task` payload or `data-task-id` was renamed -> this file's `<li>`.

**Tests** — `tests/e2e/tasks.spec.ts` (checkbox labels, Plan, Options menus). Pure bucket/overdue maths lives in `tests/unit/tasks-buckets.test.ts`.

### components/tasks/TaskPlanPopover.tsx

**Purpose** — The row's anchored Plan surface: the shared neutral `MiniMonth` in a Radix popover, with a Clear date action, that writes `scheduledOn`.

**Public API** — `export function TaskPlanPopover(props: { task: TaskView; today: string; onPick: (date: string | null) => void })`. The visual trigger is a ghost "Plan" button whose accessible name is `Plan <title>`; the caller (`TasksShell`) owns the PATCH.

**State & side effects** — Local `open` only. Renders a `PopoverPrimitive.Root`/`Trigger`/`Content` (portalled, `align="end"`, `sideOffset={4}`, `collisionPadding={12}`, `aria-label="Schedule <title>"`, `data-testid="task-plan-popover"`, the shared `popover-in` animation) containing `DatePickerPopover` with `anchorDate={task.scheduledOn ?? today}`, `selectedDate={task.scheduledOn ?? undefined}` and the household `today`; the picker is keyed by `task.scheduledOn` so it re-seeds on the saved value. Picking a day calls `onPick(date)` and closes; Clear date (disabled when there is no scheduled date) calls `onPick(null)`. The footer shows `formatWallDate(scheduledOn)` or "No date". Radix owns Escape, outside-click and focus return to the Plan trigger. Popover is **non-modal**, so it does not trap focus; Escape/outside-click close it and focus returns on close. No query and no storage of its own.

**Depends on / Used by** — `@radix-ui/react-popover`, `components/ui/button`, `components/ui/icons` (`CalendarIcon`), `components/calendar/DatePickerPopover` (which renders `MiniMonth`), `lib/time/format` (`formatWallDate`), `lib/services/tasks` (`TaskView`). Rendered by `TaskRow`.

**Debugging** —
- The picker opens on the wrong month -> the anchor is `scheduledOn` when present, not today; the key was removed so a saved date did not re-seed -> this file's `DatePickerPopover` props.
- "Today" in the picker schedules the wrong day for a travelling user -> the picker's Today falls back to the device clock when `today` is omitted -> pass the household date (this file does).
- Picking a day closes the popover but the row keeps the old date -> the PATCH failed and the optimistic patch rolled back -> the toast from `TasksShell` plus the network response.
- Escape closes the page instead of the popover -> the content was rendered outside Radix's portal/root -> this file's `PopoverPrimitive.Portal`.

**Tests** — `tests/e2e/tasks.spec.ts` (schedule two tasks to Today/This week through this popover). The popover reuses `MiniMonth`, already covered by `tests/e2e/mini-month.spec.ts` and `tests/e2e/event-fields.spec.ts`.
