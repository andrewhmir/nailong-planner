# Tasks workspace — ClickUp-style UI (v0.2.1) — design

**Status:** approved 2026-10-26 (approach Option A via mockup panel; features: List + Board + grouped list + toolbar + inline pickers + slide-over panel + sidebar counts/quick add; new fields: Priority and In-progress status; release stays inside v0.2.x).

Mockup of record: `.superpowers/mockups/option-a-clickup-on-current-shell.html`.

## 1. Problem & intent

The v0.2.0 `/tasks` workspace is correct but utilitarian: a bucket switcher, a flat
list of rows, and a modal form editor. It does not feel like a task manager. The
owner wants it to feel like ClickUp — dense rows, views (List/Board), grouping and
filtering, inline field editing, a slide-over task panel — **without** replacing the
app shell: the dark icon rail, the collection sidebar with its mini-month, the
calendar page and its visual language stay exactly as they are.

Success means: on `/tasks` you can switch List/Board, group by status or priority,
filter and sort, edit a task's status/priority/dates in place, and open a task in a
right-hand panel — and the calendar, shell, keyboard triage, undo and privacy rules
behave exactly as before.

## 2. Decisions of record

| Decision | Choice |
|---|---|
| Scope | Tasks area only; shell structure, rail, sidebar chrome, calendar untouched |
| Approach | Option A — ClickUp skin on the current shell |
| New fields | `task.priority`; `in_progress` status. **No** assignee, tags, comments |
| Views | List (grouped, collapsible) and Board (status columns) |
| Toolbar | Group (status/priority/list), Filter (status/priority/list), Sort (manual/priority/due/created/title), Hide closed |
| Inline editing | Status pill, priority flag, date chips, list move directly in rows/cards |
| Task detail | Right slide-over panel replaces the modal editor |
| Sidebar | List rows gain active-task count + hover quick-add; calendars unchanged |
| Release | v0.2.1 (`APP_VERSION` and `package.json` → `0.2.1`); roadmap unchanged; no new roadmap entry |
| Data | One additive migration; no table rebuild (status is app-validated text) |

## 3. Data model

### 3.1 `task.status`

Values: `open` (To do), `in_progress`, `done`, `dropped`. No DB constraint changes —
the column is text and validated by Zod.

Semantics:

- **Active** = `open | in_progress`. Buckets, overdue, reorder and sidebar counts all
  use active tasks.
- `done` sets `completedAt` and clears `droppedAt`; `dropped` sets `droppedAt` and
  clears `completedAt`; moving to an active status clears both. A PATCH that echoes
  the stored status is still a no-op (no audit-stamp churn).
- Checkbox: active → `done`; unchecking `done` → `open` (not to the previous status;
  this mirrors v0.2.0 undo semantics and keeps the triage keys predictable).

### 3.2 `task.priority`

Values: `none` (default) | `low` | `normal` | `high` | `urgent`. Sorting rank
ascending none→urgent; display: urgent red flag, high amber, normal blue, low
muted, none no flag.

### 3.3 Migration `0007`

```sql
ALTER TABLE `task` ADD `priority` text DEFAULT 'none' NOT NULL;
```

Journal entry (`idx` 7) and `meta/0007_snapshot.json` must be produced, not
hand-written if avoidable: run `npm run db:generate` (this machine needs one
escalated full-access command because drizzle-kit spawns; if it cannot run, the
snapshot is hand-edited and proven equivalent to `toSQLiteColumn` output). Existing
rows read `priority = 'none'`, statuses unchanged, so no data migration.

## 4. Domain rules (`lib/domain/tasks.ts`)

- `TaskStatus` stays imported from the schema; add `TASK_ACTIVE_STATUSES` and
  `isActiveStatus(status)`.
- `bucketOf` and `isOverdue` treat active statuses as today's `open`.
- Add `bucketOfIncludingClosed(row, ctx)`: for active rows identical to `bucketOf`;
  for done/dropped rows applies the same date-anchor rule ignoring status (undated
  → Inbox if it lives in the Inbox list, otherwise Someday). Used only when the
  closed toggle is on, so a closed task still lands in the scope the user is looking
  at. Bucket *counts* never include closed tasks.
- Add `priorityRank(priority): number` (none 0 … urgent 4) for sort/group.
- New pure module `lib/domain/taskViews.ts`:
  - `TaskLayout = "list" | "board"`, `GroupBy = "status" | "priority" | "list"`,
    `TaskSort = "manual" | "priority" | "due" | "created" | "title"`.
  - `sortTasks(tasks, sort, priorities?)`: manual = `sortOrder, createdAt, id`;
    priority = rank desc then due/created; due = earliest of scheduledOn/dueOn
    (undated last) then priority; created = createdAt desc; title = localeCompare.
  - `groupTasks(tasks, by)`: returns ordered groups `{ key, label, tasks }` —
    status order To do, In progress, Done, Dropped; priority order urgent→none;
    list = by collection name.
  - `filterTasks(tasks, filters)`: status set, priority set, `collectionId`.
  - `TASK_STATUS_ORDER`, `TASK_STATUS_LABELS`, `TASK_PRIORITY_ORDER`,
    `TASK_PRIORITY_LABELS`, `TASK_PRIORITY_RANK` exported once and reused by API,
    UI and tests (single source of truth).

## 5. API

- `GET /api/tasks?view=&collectionId=&includeClosed=true|false` — closed tasks are
  omitted by default (v0.2.0 contract preserved for the calendar chips). When
  `includeClosed` is true, done/dropped rows matching the bucket via
  `bucketOfIncludingClosed` are included. `counts` always count active tasks only.
- `POST /api/tasks` accepts optional `priority` (default `none`).
- `PATCH /api/tasks/{id}` accepts `priority` and `in_progress`.
- New `GET /api/tasks/counts` → `{ buckets: TaskCounts, overdue: number,
  byCollection: Record<string, number> }` for sidebar badges; counts active tasks
  in visible collections only (privacy unchanged — private lists not owned by the
  viewer are absent).
- `PATCH /api/tasks/order` treats active tasks as the reorderable set; the error
  message becomes "Send exactly the active tasks of this list." (tests updated).
- Unknown params are 400 `VALIDATION` through the existing handler patterns; the
  boolean query is parsed strictly (`"true"`/`"false"`, not `Boolean("false")`).

## 6. Client state, URL

`/tasks` keeps `?view=` (bucket) and `?task=` (panel deep link) and adds:
`layout`, `group`, `sort`, `closed=1`, `status=a,b`, `priority=a,b`, `list=<id>`.
Defaults: `layout=list`, `group=status`, `sort=manual`, `closed` off, no filters.
All non-`view` params are client state mirrored with `router.replace` (no history
spam, reload-safe); switching scope keeps layout/group/sort/filters. Unknown values
fall back to defaults. New module `lib/ui/taskViewParams.ts` owns parse/serialize
and is unit-tested.

Data flow: one `useTasks(view, collectionId?, includeClosed)` per scope; group/
filter/sort run client-side on the payload. The board always renders the To do and
In progress columns; turning on **Hide closed** off ("show closed") adds the Done
and Dropped columns, because the server omits those rows unless
`includeClosed=true`. Dragging a card to a column
PATCHes `status` with the same targeted-undo toast as the row action; no
within-column reorder (the reorder API is per-list).

## 7. Components (all under `components/tasks/` unless noted)

| File | Responsibility |
|---|---|
| `TasksShell.tsx` (rewrite) | Orchestrator: scope/layout/group/sort/filter/closed state + URL, selection, mutations & undo (existing helpers reused), renders header, toolbar, list/board, capture row, panel |
| `TaskViewTabs.tsx` (replaces `TaskViewSwitcher.tsx`) | Scope tabs Inbox/Today/Week/Someday with counts + overdue pill + List/Board segmented toggle |
| `TaskToolbar.tsx` (new) | + Add task, Group, Filter, Sort, Hide closed; owns dropdown menus |
| `TaskList.tsx` (new) | Renders grouped sections with collapsible headers and empty states |
| `TaskGroupHeader.tsx` (new) | Group title + count + collapse control |
| `TaskRow.tsx` (rewrite) | Dense row: checkbox, title, list dot, inline status/priority/date pickers, menu; keeps `data-task-id`, selection/focus contract, drag-to-plan payload |
| `TaskStatusPill.tsx` (new) | Status chip + dropdown (To do/In progress/Done/Dropped) |
| `TaskPriorityFlag.tsx` (new) | Priority flag + dropdown |
| `TaskDateChips.tsx` (new) | Scheduled/due chips wrapping the existing `TaskPlanPopover`/date picker |
| `TaskBoard.tsx` (new) | Columns + drag-between-columns status change + per-column quick add |
| `TaskBoardCard.tsx` (new) | Board card (title, flag, due, list dot) for the same task actions |
| `TaskPanel.tsx` (new; replaces `TaskEditorDialog.tsx`) | Right slide-over: inline title, field chips, notes, checklist, actions, deep-link support |
| `TaskCaptureRow.tsx` (new; replaces `TaskCaptureBar.tsx`) | ClickUp-style add-task row (Enter → Inbox, Shift+Enter → Inbox + today); board view adds per column with that status |
| `TaskShortcutHelpDialog.tsx` (update) | Copy for board/panel keys |
| `lib/domain/taskViews.ts` (new) | Grouping/sorting/filtering |
| `lib/ui/taskViewParams.ts` (new) | URL parse/serialize |
| `lib/query/tasks.ts` (update) | `includeClosed` in `useTasks`, `useTaskCounts`, optimistic priority patch |
| `components/sidebar/CollectionRow.tsx` (update) | Count badge + hover quick-add popover for `kind: list` rows the viewer may write to (folded permission; calendars and view-only/private lists show no quick add) |

Selection/focus contract from v0.2.0 is preserved in both layouts: rows and cards
carry `data-task-id`, `aria-current`, focus moves selection, `j`/`k` traverse the
painted order, and the selection-coherence effect still moves selection to a
survivor after a mutation removes a row. The panel replaces the modal for
`Enter`/row click/`?task=` and follows the existing deep-link settle rules.

## 8. Styling

New tokens in `app/globals.css` `@theme`, consumed only by tasks components:
`--color-violet` (#7b68ee), `--color-violet-soft` (#efedfd), `--color-violet-press`
(#6a55e8), `--color-status-todo`/`-soft` (#87909e/#eceef0),
`--color-status-progress`/`-soft` (#4a90e2/#e8f1fc). Done uses existing
`success`, dropped uses `ink-mute`, priority uses danger/warning/accent/ink-mute.
Density: 13–14 px text, 34–38 px rows, 6 px radii, `#fafbfc` hover, violet selection
(`--color-violet-soft`), 2 px violet inset on the selected row. `/tasks` page
container widens from `max-w-3xl` to full content width so list, board and panel
have room; the rail, sidebar, breadcrumbs and calendar keep today's ink/blue
palette. Coarse-pointer targets stay ≥44 px.

## 9. Keyboard, undo, accessibility

- Kept: `K` global capture, `j`/`k`, `1`/`2`/`3` triage, `4` next list, `Space`
  complete, `Enter` open panel, `?` help, `z`/`Ctrl+Z` undo. Page-scoped shortcuts
  stay suppressed while focus is in an input/textarea/select or while any dialog or
  the panel is open (existing `shortcutGuards`).
- New: in board view `j`/`k` traverse cards in column order; `Space` completes the
  focused card; column drop targets are keyboard-reachable through the status
  picker (drag is an accelerator, never the only path).
- Every mutation (checkbox, status, priority, dates, list move, delete, board drag,
  panel edits) pushes a **targeted** undo handle and a toast, exactly like v0.2.0.
- Panel: `role="dialog"` (non-modal), labelled by the task title, focus moves to the
  title on open, Esc closes, focus returns to the selected row (or the scope tabs
  when it vanished). Group headers are buttons with `aria-expanded`/`aria-controls`;
  status/priority pickers are menus with `aria-haspopup`/labels.

## 10. Tests

- Unit: `tests/unit/task-views.test.ts` (sort/group/filter/tab order, empty groups),
  `tests/unit/task-view-params.test.ts` (parse/serialize/defaults/invalid values),
  `tests/unit/tasks-buckets.test.ts` (active statuses, closed bucket rule),
  `tests/unit/task-cache.test.ts` (priority optimistic patch),
  `tests/unit/roadmap.test.ts`/version (0.2.1), service tests in
  `tests/integration/tasks.test.ts` (priority create/patch, `in_progress`
  transitions, counts, `includeClosed`, reorder active set).
- Integration: `tests/integration/tasks-api.test.ts` — includeClosed param
  validation, counts endpoint shape, private-list filtering regression, status
  transitions' audit results, reorder error message.
- E2E (`tests/e2e/tasks.spec.ts` rewritten): list ⇄ board ⇄ panel, inline status and
  priority change, grouping, hide-closed, sidebar count/quick-add, deep link,
  keyboard triage and undo. Local Playwright is blocked by the sandbox in this
  environment; the spec is the CI gate and is documented as such.
- Local gate: `npm run docs:check && npm run lint && npm run typecheck &&
  npx vitest run --maxWorkers=8` (documented v0.2.0 flake workaround).
- Every changed/added/deleted file gets its `docs/COMPONENTS/` section (app-routes,
  api-layer, lib-data, lib-services, lib-domain, lib-ui, components-tasks,
  components-shell-and-sidebar for CollectionRow, tests.md), README feature copy,
  and any new trap in `docs/DEBUGGING.md`.

## 11. Out of scope

Calendar/event UI, assignees, tags, comments/activity feed, custom per-list
statuses, saved filters/views, dark mode, subtasks (checklist remains flat),
within-column board reorder, notes/focus pages, roadmap changes.

## 12. Risks

- **Status ripple:** every `status === "open"` check must become `isActiveStatus`;
  a missed one silently hides in-progress tasks (tests pin the domain helpers and
  the service queries).
- **Migration snapshot drift:** hand-edited drizzle snapshots are easy to corrupt;
  prefer generated output, then prove equivalence with a fresh introspection check.
- **Density vs. accessibility:** shrinking rows must not shrink hit targets below
  44 px on coarse pointers or drop the visible focus ring.
- **Panel + bucket refetch:** a mutation can move a task out of the open bucket;
  the panel stays on its snapshot and the selection-coherence logic hand-picks the
  survivor (documented behaviour, not a race).
