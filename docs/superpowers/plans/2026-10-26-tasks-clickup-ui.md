# Tasks workspace ClickUp-style UI (v0.2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/tasks` workspace so it feels like ClickUp — List and Board views, grouping/filter/sort toolbar, dense rows with inline status/priority/date pickers, a right-hand task panel and sidebar list counts/quick-add — without changing the app shell, the calendar or the privacy rules.

**Architecture:** Additive schema change (`task.priority`, `in_progress` status) plus a pure domain layer (`lib/domain/taskViews.ts` for grouping/sorting/filtering, URL state in `lib/ui/taskViewParams.ts`), one extended list/counts read path in `lib/services/tasks.ts`, and a rebuild of `components/tasks/*` into small focused components driven by `TasksShell`. Every mutation keeps the v0.2.0 targeted-undo + optimistic-cache contracts; every read keeps the existing collection-permission helpers.

**Tech Stack:** Next.js 16.4.2 App Router, React 19.3.1, TypeScript strict, Drizzle ORM 0.45.4 + better-sqlite3 13, TanStack Query 5, zod 4, Tailwind v4, Radix UI, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-26-tasks-clickup-ui-design.md`

## Global Constraints

- Work in the git worktree `feat/v0.2.1-clickup-ui` created from `main`; never commit to `main` during execution.
- No new npm dependencies. Radix primitives, TanStack Query and Tailwind v4 already in `package.json` cover everything.
- **Active task statuses are `open` and `in_progress` everywhere.** Any `status === "open"` check that means "not finished" must use `isActiveStatus()` / `TASK_ACTIVE_STATUSES` from `lib/domain/tasks.ts`. Grep for `"open"` in `lib/` and `components/` before finishing Task 5.
- Privacy is server-authoritative: task reads/writes always resolve collections through `lib/services/collections.ts` (`resolveVisibleCollections`, `getCollectionAccess`, `ensureInbox`). The counts endpoint must be invisible to non-owners of private lists (404-style absence, not a zero count).
- Docs ship with code: every file added/moved/renamed/deleted under `app/`, `components/`, `lib/`, `scripts/` gets its `### <repo-relative-path>` section added/moved/removed in the owning `docs/COMPONENTS/*.md`, behaviour changes update that section, `npm run docs:check` passes.
- Local test gate: `npx vitest run --maxWorkers=8` (plain `npm test` flakes at 47+ workers). Focused run: `npx vitest run tests/<file> --maxWorkers=8`.
- Playwright cannot run in this sandbox (`spawn EPERM`): `tests/e2e/*` changes are the CI gate. Do not claim e2e green locally.
- `package.json` `version` and `APP_VERSION` in `lib/roadmap.ts` must both be `0.2.1`; `tests/unit/roadmap.test.ts` enforces equality.
- Tests use the in-memory DB helpers (`tests/helpers/db.ts`, `tests/helpers/fixtures.ts`); never touch `data/planner.db`.
- Conventional commits, docs in the same commit as the code.
- Calendar routes/components, the dark nav rail, the sidebar mini-month and the breadcrumb bar are out of scope except where a task explicitly names a file.
- Coarse-pointer targets stay ≥44 px (`[@media(pointer:coarse)]:min-h-11`) and focus rings stay visible.

## Review Focus

The failures most likely to bite a person using this build, each with the task that pins it in tests:

1. An `in_progress` task silently disappears from Inbox/Today/Week/counts/overdue because one SQL or domain check still tests `status === "open"` — Tasks 3, 5, 6.
2. Inline edits that the server rejects (view-only list moved under the task, private partner list, validation) leave the optimistic row changed with no rollback/toast — Tasks 7, 12, 17.
3. Filter + hidden-closed combinations strand the user on an empty screen with no escape — Task 11's empty state and Task 17's e2e.
4. Dragging a board card to Done while the Done column is hidden (closed off) must remove the card, toast, and be undoable — no crash, no ghost — Tasks 14, 17.
5. `?task=` deep link must open the panel exactly once under React StrictMode and clear the param on close — Tasks 12, 13, 17.
6. Typing in the panel, toolbar or capture row must never fire `j`/`k`/`Space` triage — Task 12 reuses `lib/ui/shortcutGuards.ts`; Task 17 pins it in e2e.
7. The reorder contract must include in-progress tasks; a stale client payload is rejected and refetched rather than silently dropping a task — Task 5.
8. Sidebar quick-add must not exist (and never 403) on view-only or non-owned lists — Task 15.

---

## File Structure

**New files**

- `lib/domain/taskViews.ts` — layout/group/sort/filter types, label and order tables, `sortTasks`, `groupTasks`, `filterTasks`.
- `lib/ui/taskViewParams.ts` — URL `TaskViewState` parse/serialize/merge.
- `components/tasks/TaskViewTabs.tsx` — scope tabs + List/Board toggle.
- `components/tasks/TaskToolbar.tsx` — Add task, Group, Filter, Sort, Hide closed.
- `components/tasks/TaskCaptureRow.tsx` — ClickUp-style add-task row.
- `components/tasks/TaskList.tsx` — grouped, collapsible list.
- `components/tasks/TaskGroupHeader.tsx` — group heading + count + collapse.
- `components/tasks/TaskStatusPill.tsx` — inline status picker.
- `components/tasks/TaskPriorityFlag.tsx` — inline priority picker.
- `components/tasks/TaskDateChips.tsx` — scheduled/due chips with date popovers.
- `components/tasks/TaskBoard.tsx` — status columns + drop targets.
- `components/tasks/TaskBoardCard.tsx` — board card.
- `components/tasks/TaskPanel.tsx` — right slide-over task detail.
- `components/tasks/types.ts` — shared `TaskActions`, `WritableList` prop types.
- `app/api/tasks/counts/route.ts` — counts endpoint.

**Rewritten**

- `components/tasks/TasksShell.tsx`, `components/tasks/TaskRow.tsx`, `components/tasks/TaskShortcutHelpDialog.tsx`,
  `lib/services/tasks.ts`, `lib/domain/tasks.ts`, `lib/validation/tasks.ts`, `lib/query/tasks.ts`,
  `lib/api/handlers/tasks.ts`, `lib/db/schema.ts`, `components/sidebar/CollectionRow.tsx`,
  `components/sidebar/CollectionTree.tsx` (caller wiring), `app/(app)/tasks/page.tsx`,
  `app/globals.css`, `components/ui/icons.tsx`, `package.json`, `lib/roadmap.ts`,
  `tests/e2e/tasks.spec.ts`, `tests/integration/tasks.test.ts`, `tests/integration/tasks-api.test.ts`,
  `tests/unit/tasks-buckets.test.ts`, `tests/unit/task-cache.test.ts`.

**Deleted (with their docs sections)**

- `components/tasks/TaskPlanPopover.tsx` (Task 11 — superseded by `TaskDateChips`)
- `components/tasks/TaskViewSwitcher.tsx` (Task 12)
- `components/tasks/TaskCaptureBar.tsx` (Task 12)
- `components/tasks/TaskEditorDialog.tsx` (Task 13)

---

### Task 1: Schema + migration 0007 (`task.priority`)

**Files:**
- Modify: `lib/db/schema.ts:161-196` (task table), `drizzle/meta/_journal.json`, `drizzle/meta/0007_snapshot.json`
- Create: `drizzle/0007_<generated-name>.sql`
- Test: `tests/integration/db.test.ts` (append `describe("migration 0007")`)

**Interfaces:**
- Consumes: nothing.
- Produces: `task.priority` column (`text`, notNull, default `'none'`, enum `"none" | "low" | "normal" | "high" | "urgent"`), `export type TaskPriority = "none" | "low" | "normal" | "high" | "urgent"` and extended `TaskStatus = "open" | "in_progress" | "done" | "dropped"` in `lib/db/schema.ts` (follow the existing `TaskStatus` export style).

- [ ] **Step 1: Extend the Drizzle schema**

In `lib/db/schema.ts`, extend the task status enum with `"in_progress"`, add
`priority: text("priority", { enum: ["none", "low", "normal", "high", "urgent"] }).notNull().default("none")`
after `status`, and export `TaskPriority` next to the existing `TaskStatus` type export. Keep every index unchanged.

- [ ] **Step 2: Generate the migration**

Run `npm run db:generate` **once with `sandbox_permissions: danger-full-access`** (drizzle-kit spawns; confined modes fail with `spawn EPERM`). Expected: new `drizzle/0007_*.sql` containing exactly
`ALTER TABLE \`task\` ADD \`priority\` text DEFAULT 'none' NOT NULL;`, a journal entry with `idx: 7`, and `drizzle/meta/0007_snapshot.json` whose `prevId` is the 0006 snapshot id.

Fallback if the sandbox still blocks: hand-write the SQL file, copy `0006_snapshot.json` to `0007_snapshot.json` (new `id` uuid, `prevId` = old id), add the `priority` column to `tables.task.columns` and to `tables.task.compositePrimaryKeys`, then append the journal entry with the next `when` (previous `when` + 1) and prove `id`/`prevId` chain with `node -e` JSON read.

- [ ] **Step 3: Write the failing migration test**

Append to `tests/integration/db.test.ts`:

```ts
describe("migration 0007", () => {
  it("adds task.priority as NOT NULL DEFAULT 'none' and backfills existing tasks", async () => {
    const { db, sqlite, close } = await makeTestDb({ upTo: "0006_collections_and_tasks" });
    try {
      db.insert(household).values({ id: "h" }).run();
      sqlite.exec(`
        INSERT INTO collection (id, household_id, name, kind, visibility, shade_index, sort_order, created_at, updated_at)
        VALUES ('l', 'h', 'House', 'list', 'shared', 3, 0, 1, 1);
        INSERT INTO task (id, household_id, collection_id, title, created_by, created_at, updated_at)
        VALUES ('t1', 'h', 'l', 'Legacy', 'u1', 1, 1);
      `);
      migrate(db);
      expect(query(sqlite, "SELECT priority FROM task WHERE id = 't1'")).toEqual([{ priority: "none" }]);
      const column = query<{ name: string; notnull: number; dflt_value: string }>(
        sqlite,
        "SELECT name, notnull, dflt_value FROM pragma_table_info('task') WHERE name = 'priority'",
      );
      expect(column).toEqual([{ name: "priority", notnull: 1, dflt_value: "'none'" }]);
      expect(query(sqlite, "SELECT version FROM __drizzle_migrations ORDER BY id DESC LIMIT 1")).toHaveLength(1);
    } finally {
      close();
    }
  });
});
```

- [ ] **Step 4: Run it and confirm it fails on the un-migrated schema**

`npx vitest run tests/integration/db.test.ts --maxWorkers=8` → FAIL (no such column `priority` / schema mismatch) before Step 2's files exist; after generating the migration it must PASS.

- [ ] **Step 5: Docs**

Patch `docs/COMPONENTS/lib-data.md` (`### lib/db/schema.ts`: priority column, status values, TaskPriority type) and `docs/COMPONENTS/scripts-and-ops.md` (migration 0007 entry + that `db:generate` needs a spawn-capable shell here).

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/ tests/integration/db.test.ts docs/COMPONENTS/lib-data.md docs/COMPONENTS/scripts-and-ops.md
git commit -m "feat(db): add task priority column and in_progress status (0007)"
```

---

### Task 2: Design tokens + icons

**Files:**
- Modify: `app/globals.css` (`@theme` block), `components/ui/icons.tsx:1-260`
- Test: none (presentation); verified by `npx tsc --noEmit` and Task 17's e2e.

**Interfaces:**
- Produces: theme tokens `--color-violet: #7b68ee`, `--color-violet-soft: #efedfd`, `--color-violet-press: #6a55e8`, `--color-status-todo: #87909e`, `--color-status-todo-soft: #eceef0`, `--color-status-progress: #4a90e2`, `--color-status-progress-soft: #e8f1fc`; new icons `FlagIcon`, `BoardIcon` (`IconProps` is the existing shared prop type).

- [ ] **Step 1: Add the tokens**

In `app/globals.css` inside `@theme`, after the existing accent block, add the seven custom properties above (comments explain they are consumed only by `components/tasks/*`). No existing token changes value.

- [ ] **Step 2: Add the icons**

In `components/ui/icons.tsx` add `FlagIcon` (filled flag, used for priority) and `BoardIcon` (three columns) following the file's existing 24px/stroke pattern and export list.

- [ ] **Step 3: Verify**

`npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 4: Docs**

Patch `docs/COMPONENTS/app-routes.md` (`### app/globals.css`: the v0.2.1 task tokens) and `docs/COMPONENTS/components-settings-ui.md` (`### components/ui/icons.tsx`: FlagIcon, BoardIcon).

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/ui/icons.tsx docs/COMPONENTS/app-routes.md docs/COMPONENTS/components-settings-ui.md
git commit -m "feat(ui): add task-workspace colour tokens and icons"
```

---

### Task 3: Domain — active statuses, priority rank, closed-bucket rule

**Files:**
- Modify: `lib/domain/tasks.ts:1-87`
- Test: `tests/unit/tasks-buckets.test.ts` (append)

**Interfaces:**
- Consumes: `TaskStatus`, `TaskPriority` from `lib/db/schema`.
- Produces:
  - `TASK_ACTIVE_STATUSES: readonly TaskStatus[]` (`["open", "in_progress"]`)
  - `isActiveStatus(status: TaskStatus): boolean`
  - `priorityRank(priority: TaskPriority): number` (`none` 0 … `urgent` 4)
  - `bucketOfIncludingClosed(task: Pick<TaskRow, "status" | "scheduledOn" | "dueOn" | "collectionId">, ctx: BucketContext): TaskBucket | null`
  - `bucketOf` and `isOverdue` now use active statuses.

- [ ] **Step 1: Write the failing domain tests**

Append to `tests/unit/tasks-buckets.test.ts`:

```ts
it("buckets in_progress tasks like open ones", () => {
  expect(bucketOf(task({ status: "in_progress" }), ctx)).toBe("inbox");
  expect(isOverdue({ status: "in_progress", dueOn: "2026-10-20" }, TODAY)).toBe(true);
});
it("gives closed tasks a bucket only through bucketOfIncludingClosed", () => {
  const done = task({ status: "done", scheduledOn: "2026-10-21" });
  expect(bucketOf(done, ctx)).toBeNull();
  expect(bucketOfIncludingClosed(done, ctx)).toBe("today");
  const undatedDone = task({ status: "done", collectionId: ctx.inboxId });
  expect(bucketOfIncludingClosed(undatedDone, ctx)).toBe("inbox");
  expect(bucketOfIncludingClosed(task({ status: "dropped", dueOn: "2026-11-30" }), ctx)).toBeNull();
});
it("ranks priorities none < low < normal < high < urgent", () => {
  expect(["none", "low", "normal", "high", "urgent"].map((p) => priorityRank(p as never))).toEqual([0, 1, 2, 3, 4]);
});
```

Reuse the file's existing `task()`/`ctx` helpers (they build `BucketContext` with `today`/`endOfWeek`/`inboxId`); add the `in_progress` case to the helper's parameter type if it is typed `TaskStatus`.

- [ ] **Step 2: Run it and confirm it fails**

`npx vitest run tests/unit/tasks-buckets.test.ts --maxWorkers=8` → FAIL (`isActiveStatus`/`bucketOfIncludingClosed`/`priorityRank` not exported).

- [ ] **Step 3: Implement**

In `lib/domain/tasks.ts`: replace the two `status !== "open"` / `status === "open"` checks with `isActiveStatus(...)`; add `bucketOfIncludingClosed` by extracting the date-anchor body into a private `bucketFromDates(row, ctx)` used by both functions (active gate only in `bucketOf`); add `priorityRank` with a `Record<TaskPriority, number>` map.

- [ ] **Step 4: Run tests**

`npx vitest run tests/unit/tasks-buckets.test.ts --maxWorkers=8` → PASS.

- [ ] **Step 5: Docs**

Patch `docs/COMPONENTS/lib-domain.md` (`### lib/domain/tasks.ts`: active-status rule, `bucketOfIncludingClosed` semantics, `priorityRank`).

- [ ] **Step 6: Commit**

```bash
git add lib/domain/tasks.ts tests/unit/tasks-buckets.test.ts docs/COMPONENTS/lib-domain.md
git commit -m "feat(tasks): treat in_progress as active and add priority rank"
```

---

### Task 4: Domain — `lib/domain/taskViews.ts` (sort/group/filter)

**Files:**
- Create: `lib/domain/taskViews.ts`
- Test: `tests/unit/task-views.test.ts`

**Interfaces:**
- Consumes: `TaskStatus`, `TaskPriority` from `lib/db/schema`; `priorityRank` from `lib/domain/tasks`.
- Produces:
  - `type TaskLayout = "list" | "board"`, `type GroupBy = "status" | "priority" | "list"`, `type TaskSort = "manual" | "priority" | "due" | "created" | "title"`
  - `TASK_STATUS_ORDER`, `TASK_STATUS_LABELS` (`open`→"To do", `in_progress`→"In progress", `done`→"Done", `dropped`→"Dropped"), `TASK_PRIORITY_ORDER` (urgent→none for display), `TASK_PRIORITY_LABELS` (`none`→"None" … `urgent`→"Urgent"), `TASK_PRIORITY_RANK`
  - `interface SortableTask { status: TaskStatus; priority: TaskPriority; scheduledOn: string | null; dueOn: string | null; sortOrder: number; createdAt: number; title: string; id: string }`
  - `interface GroupableTask extends SortableTask { collection: { id: string; name: string } }`
  - `sortTasks<T extends SortableTask>(tasks: readonly T[], sort: TaskSort): T[]`
  - `groupTasks<T extends GroupableTask>(tasks: readonly T[], by: GroupBy): TaskGroup<T>[]` with `interface TaskGroup<T> { key: string; label: string; tasks: T[] }` (groups with zero tasks omitted; only the four statuses in `TASK_STATUS_ORDER`)
  - `filterTasks<T extends SortableTask & { collectionId: string }>(tasks: readonly T[], filters: TaskFilters): T[]` with `interface TaskFilters { status: TaskStatus[]; priority: TaskPriority[]; collectionId: string | null }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/task-views.test.ts` with local `make()` rows and these assertions:

```ts
it("labels statuses and priorities the way the UI shows them", () => {
  expect(TASK_STATUS_LABELS.in_progress).toBe("In progress");
  expect(TASK_STATUS_ORDER).toEqual(["open", "in_progress", "done", "dropped"]);
  expect(TASK_PRIORITY_ORDER).toEqual(["urgent", "high", "normal", "low", "none"]);
});
it("sorts by priority then due date, undated last", () => { /* urgent first, none last; tie → earlier effective date first */ });
it("sorts manual order by sortOrder then createdAt then id", () => { /* stable */ });
it("groups by status in fixed order and omits empty groups", () => {
  const groups = groupTasks(rows, "status");
  expect(groups.map((g) => g.key)).toEqual(["open", "in_progress", "done"]);
});
it("groups by priority urgent→none and by list name alphabetically", () => { /* keys/labels */ });
it("filters by status set, priority set and collection id together", () => { /* intersection */ });
it("returns empty arrays for empty input", () => {
  expect(sortTasks([], "manual")).toEqual([]);
  expect(groupTasks([], "list")).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

`npx vitest run tests/unit/task-views.test.ts --maxWorkers=8` → FAIL (module not found).

- [ ] **Step 3: Implement the module**

Effective-date helper: earliest non-null of `scheduledOn`/`dueOn`, `null` sorts last. `sortTasks` returns a copy (`[...tasks]`). Priority sort = `priorityRank(b) - priorityRank(a)` then effective date, then `createdAt`, then `id`. Group labels come from the exported tables; list groups sort by `collection.name` with `localeCompare`, key = collection id.

- [ ] **Step 4: Run tests**

`npx vitest run tests/unit/task-views.test.ts --maxWorkers=8` → PASS.

- [ ] **Step 5: Docs**

Add a `### lib/domain/taskViews.ts` section to `docs/COMPONENTS/lib-domain.md` (purpose, exported types/tables, sort semantics, used by TaskList/TaskBoard/TasksShell).

- [ ] **Step 6: Commit**

```bash
git add lib/domain/taskViews.ts tests/unit/task-views.test.ts docs/COMPONENTS/lib-domain.md
git commit -m "feat(tasks): add grouping, sorting and filtering domain module"
```

---

### Task 5: Validation + service (priority, in_progress, includeClosed, counts, reorder)

**Files:**
- Modify: `lib/validation/tasks.ts`, `lib/services/tasks.ts`
- Test: `tests/integration/tasks.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 types; Task 3 `isActiveStatus`, `bucketOfIncludingClosed`; existing `resolveVisibleCollections`/`ensureInbox`.
- Produces:
  - `taskPrioritySchema`, `createTaskSchema` accepts `priority?`, `updateTaskSchema.status` accepts `in_progress` and `priority?`, `listTasksQuerySchema.includeClosed?: boolean` (strict `"true"`/`"false"` only), `ListTasksQuery` updated.
  - `ListTasksInput.includeClosed?: boolean`.
  - `export interface TaskCountSummary { counts: TaskCounts; byCollection: Record<string, number> }`
  - `getTaskCountSummary(db, ctx, input: { timezone: string; weekStartsOn: 0 | 1 }): TaskCountSummary`
  - `createTask` defaults `priority: "none"`; `updateTask` patches `priority`; transitions: `done`→completedAt set/droppedAt null, `dropped` vice versa, `open`/`in_progress` clear both.
  - `reorderTasks` reorderable set = active tasks; error message `"Send exactly the active tasks of this list."`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/tasks.test.ts` (fixtures `makeSeededDb`, `makeLists` already exist):

```ts
it("creates tasks with priority and defaults to none", async () => {
  const seeded = await makeSeededDb();
  const { shared } = makeLists(seeded);
  const high = createTask(seeded.db, seeded.ctxA, { title: "Taxes", collectionId: shared.id, priority: "high" });
  const plain = createTask(seeded.db, seeded.ctxA, { title: "Dishes", collectionId: shared.id });
  expect(high.priority).toBe("high");
  expect(plain.priority).toBe("none");
});
it("moves a task to in_progress without completion stamps, then stamps done and back", async () => {
  /* updateTask status in_progress → completedAt/droppedAt null;
     status done → completedAt number, droppedAt null;
     status in_progress again → both null */
});
it("counts in_progress tasks in the buckets, overdue and per-collection counts", async () => {
  /* listTasks counts include in_progress scheduled today; getTaskCountSummary().byCollection[shared.id] counts it */
});
it("includeClosed surfaces done tasks in their scope but never changes counts", async () => {
  /* done task scheduled today: default list omits; includeClosed:true includes in view "today"; counts identical */
});
it("reorder accepts the active set including in_progress and rejects a stale payload", async () => {
  /* two open + one in_progress → orderedIds of all three passes; omit one → AppError VALIDATION 400 with new message */
});
it("counts endpoint data excludes a private list the partner cannot read", async () => {
  /* ctxB getTaskCountSummary has no byCollection entry for privateList; counts.buckets excludes its tasks */
});
```

- [ ] **Step 2: Run and confirm failure**

`npx vitest run tests/integration/tasks.test.ts --maxWorkers=8` → FAIL (unknown fields / missing exports).

- [ ] **Step 3: Implement validation**

Add `taskPrioritySchema = z.enum(["none", "low", "normal", "high", "urgent"])`; `priority: taskPrioritySchema.optional()` on create; extend update with `status: z.enum(["open", "in_progress", "done", "dropped"]).optional()` and `priority`; `includeClosed` as `z.enum(["true", "false"]).transform((v) => v === "true").optional()` so `?includeClosed=false` is false, not `Boolean("false")`; export inferred types.

- [ ] **Step 4: Implement the service**

`listTasks`: fetch `inArray(task.status, includeClosed ? [...TASK_ACTIVE_STATUSES, "done", "dropped"] : TASK_ACTIVE_STATUSES)`; counts always over active rows only; bucket filter uses `bucketOf` for active and `bucketOfIncludingClosed` when closed is included; sort unchanged. `getTaskCountSummary` reuses the same active query + visible-id filter and builds `byCollection` plus `counts`. `createTask`/`updateTask`/`reorderTasks` per Interfaces block.

- [ ] **Step 5: Run tests**

`npx vitest run tests/integration/tasks.test.ts --maxWorkers=8` → PASS. Then `grep -n '"open"' lib/services lib/domain components/tasks` and confirm every remaining occurrence is a legitimate literal (not a finished-check).

- [ ] **Step 6: Docs**

Patch `docs/COMPONENTS/lib-data.md` (`lib/validation/tasks.ts`) and `docs/COMPONENTS/lib-services.md` (`lib/services/tasks.ts`: priority, active status set, includeClosed rule, counts summary, reorder contract).

- [ ] **Step 7: Commit**

```bash
git add lib/validation/tasks.ts lib/services/tasks.ts tests/integration/tasks.test.ts docs/COMPONENTS/lib-data.md docs/COMPONENTS/lib-services.md
git commit -m "feat(tasks): priority, in_progress and closed-aware reads in validation and service"
```

---

### Task 6: API — `includeClosed` param and counts endpoint

**Files:**
- Modify: `lib/api/handlers/tasks.ts`, `tests/integration/tasks-api.test.ts`
- Create: `app/api/tasks/counts/route.ts`

**Interfaces:**
- Consumes: `listTasksQuerySchema.includeClosed`, `getTaskCountSummary`.
- Produces: `GET /api/tasks?includeClosed=true`; `GET /api/tasks/counts` → `{ counts: TaskCounts, byCollection: Record<string, number> }`; `taskCountsHandler` exported from `lib/api/handlers/tasks.ts`.

- [ ] **Step 1: Write the failing API tests**

Append to `tests/integration/tasks-api.test.ts` (reuse its request helpers and viewer setup):

```ts
it("returns closed tasks only when includeClosed=true", async () => {
  /* done task in the Inbox: GET /api/tasks?view=inbox → absent; ?view=inbox&includeClosed=true → present */
});
it("rejects a non-boolean includeClosed with a VALIDATION 400", async () => {
  /* GET /api/tasks?includeClosed=maybe → 400 { error: { code: "VALIDATION", fields: { includeClosed: ... } } } */
});
it("serves per-collection counts and hides private partner lists", async () => {
  /* GET /api/tasks/counts → 200 { counts: { inbox, today, week, someday, overdue }, byCollection };
     partner session → 401 without cookie; ctxB → no entry for ctxA's private list */
});
```

- [ ] **Step 2: Run and confirm failure**

`npx vitest run tests/integration/tasks-api.test.ts --maxWorkers=8` → FAIL.

- [ ] **Step 3: Implement**

`parseListQuery` reads `includeClosed`; add `taskCountsHandler = guarded((db, ctx) => NextResponse.json(getTaskCountSummary(db, ctx, { timezone, weekStartsOn })))` with the household lookup; add `app/api/tasks/counts/route.ts` with `export const dynamic = "force-dynamic"; export const GET = withViewer(({ db, ctx }) => taskCountsHandler(db, ctx));`.

- [ ] **Step 4: Run tests**

`npx vitest run tests/integration/tasks-api.test.ts --maxWorkers=8` → PASS.

- [ ] **Step 5: Docs**

Patch `docs/COMPONENTS/api-layer.md` (`lib/api/handlers/tasks.ts`), `docs/COMPONENTS/app-routes.md` (`### app/api/tasks/counts/route.ts`, and the `includeClosed` param on the tasks route).

- [ ] **Step 6: Commit**

```bash
git add lib/api/handlers/tasks.ts app/api/tasks/counts/route.ts tests/integration/tasks-api.test.ts docs/COMPONENTS/api-layer.md docs/COMPONENTS/app-routes.md
git commit -m "feat(api): add includeClosed task reads and counts endpoint"
```

---

### Task 7: Query hooks + optimistic priority patch

**Files:**
- Modify: `lib/query/tasks.ts`
- Test: `tests/unit/task-cache.test.ts` (append)

**Interfaces:**
- Consumes: `getTaskCountSummary` response shape (task 6).
- Produces: `useTasks(view?: TaskBucket | "all", collectionId?: string, includeClosed?: boolean)` with query key `["tasks", view ?? "all", collectionId ?? null, includeClosed ? "closed" : "open"]`; `useTaskCounts(options?: { enabled?: boolean })` with key `["tasks", "counts"]` (disabled until the sidebar is on `/tasks`); `patchTask()` handles `priority`.

- [ ] **Step 1: Write the failing cache test**

```ts
it("optimistically patches priority across every cached tasks payload and rolls back", async () => {
  /* seed query client with two ["tasks", …] payloads containing task t1;
     run onMutate({ id: "t1", priority: "urgent" }) → both rows priority urgent;
     onError with snapshot context → both restored to prior value */
});
```

- [ ] **Step 2: Run and confirm failure**

`npx vitest run tests/unit/task-cache.test.ts --maxWorkers=8` → FAIL.

- [ ] **Step 3: Implement**

Add the third `useTasks` arg + query key + `includeClosed=true` request param; add `useTaskCounts` fetch of `/api/tasks/counts`; extend `patchTask` with `if (input.priority !== undefined) patch.priority = input.priority;`. Mutations already invalidate `["tasks"]`, which covers the counts key.

- [ ] **Step 4: Run tests**

`npx vitest run tests/unit/task-cache.test.ts --maxWorkers=8` → PASS.

- [ ] **Step 5: Docs**

Patch `docs/COMPONENTS/lib-data.md` (`### lib/query/tasks.ts`: new key, `useTaskCounts`, priority optimistic patch).

- [ ] **Step 6: Commit**

```bash
git add lib/query/tasks.ts tests/unit/task-cache.test.ts docs/COMPONENTS/lib-data.md
git commit -m "feat(tasks): query hooks for closed tasks, counts and priority"
```

---

### Task 8: URL view state — `lib/ui/taskViewParams.ts`

**Files:**
- Create: `lib/ui/taskViewParams.ts`
- Test: `tests/unit/task-view-params.test.ts`

**Interfaces:**
- Consumes: `TaskLayout`, `GroupBy`, `TaskSort` from `lib/domain/taskViews`; `TaskStatus`/`TaskPriority` from `lib/db/schema`.
- Produces:
  - `interface TaskViewState { layout: TaskLayout; group: GroupBy; sort: TaskSort; closed: boolean; status: TaskStatus[]; priority: TaskPriority[]; collectionId: string | null }`
  - `DEFAULT_TASK_VIEW_STATE: TaskViewState`
  - `parseTaskViewState(params: URLSearchParams): TaskViewState`
  - `mergeTaskViewParams(base: URLSearchParams, state: TaskViewState): URLSearchParams` — preserves `view` and `task`, removes default-valued keys, comma-joins `status`/`priority`, sets `collectionId` as `list`, `closed` as `"1"`.

- [ ] **Step 1: Write the failing test**

`tests/unit/task-view-params.test.ts`:

```ts
it("defaults to list/status/manual, closed hidden, no filters", () => {
  expect(parseTaskViewState(new URLSearchParams("view=inbox"))).toEqual(DEFAULT_TASK_VIEW_STATE);
});
it("parses valid params and drops unknown values", () => {
  const parsed = parseTaskViewState(new URLSearchParams("layout=board&group=priority&sort=due&closed=1&status=open,in_progress,bogus&priority=urgent&list=l1"));
  expect(parsed).toMatchObject({ layout: "board", group: "priority", sort: "due", closed: true, status: ["open", "in_progress"], priority: ["urgent"], collectionId: "l1" });
});
it("omits defaults and preserves view/task when merging", () => {
  const merged = mergeTaskViewParams(new URLSearchParams("view=today&task=t1"), DEFAULT_TASK_VIEW_STATE);
  expect(merged.get("view")).toBe("today");
  expect(merged.get("task")).toBe("t1");
  expect(merged.get("layout")).toBeNull();
  expect(merged.get("closed")).toBeNull();
});
it("round-trips a non-default state", () => { /* parse(merge(params, state)) equals state */ });
```

- [ ] **Step 2: Run and confirm failure**, then **implement**, then **run to pass**.

Commands as in Task 4.

- [ ] **Step 3: Docs**

Add `### lib/ui/taskViewParams.ts` to `docs/COMPONENTS/lib-ui.md` (state shape, param names, replace-not-push rule).

- [ ] **Step 4: Commit**

```bash
git add lib/ui/taskViewParams.ts tests/unit/task-view-params.test.ts docs/COMPONENTS/lib-ui.md
git commit -m "feat(tasks): URL-backed task view state"
```

---

### Task 9: Presentational field pickers

**Files:**
- Create: `components/tasks/types.ts`, `components/tasks/TaskStatusPill.tsx`, `components/tasks/TaskPriorityFlag.tsx`, `components/tasks/TaskDateChips.tsx`
- Test: none (UI; covered by Task 17 e2e and `npx tsc --noEmit`).

**Interfaces:**
- Produces (all client components, named exports):
  - `components/tasks/types.ts`: `interface TaskActions { onOpen(): void; onStatus(status: TaskStatus): void; onPriority(priority: TaskPriority): void; onDates(patch: { scheduledOn?: string | null; dueOn?: string | null }): void; onMove(collectionId: string): void; onDrop(): void; onDelete(): void; onToggleDone(done: boolean): void }`; `interface WritableList { id: string; name: string }`.
  - `TaskStatusPill({ status, onChange, compact? }: { status: TaskStatus; onChange: (status: TaskStatus) => void; compact?: boolean })` — button styled with the status tokens; Radix dropdown listing `TASK_STATUS_ORDER` with `TASK_STATUS_LABELS`; `aria-label` "Status: <label>"; `data-testid="task-status-<status>"`.
  - `TaskPriorityFlag({ priority, onChange }: { priority: TaskPriority; onChange: (priority: TaskPriority) => void })` — dropdown listing `TASK_PRIORITY_ORDER` with labels; flag coloured by priority; `aria-label` "Priority: <label>"; `data-testid="task-priority-<priority>"`.
  - `TaskDateChips({ scheduledOn, dueOn, today, title, onChange }: { scheduledOn: string | null; dueOn: string | null; today: string; title: string; onChange: (patch: { scheduledOn?: string | null; dueOn?: string | null }) => void })` — two Radix popovers wrapping `DatePickerPopover` (reuse `components/calendar/DatePickerPopover`), chips show `formatWallDate`, overdue due chip uses `text-danger-ink`, `data-testid="task-date-scheduled"` / `"task-date-due"`.

- [ ] **Step 1: Implement the three components** using the shared dropdown-menu primitives (`components/ui/dropdown-menu`) and existing `Button` styles only where they fit; dense row chips are plain buttons with `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet`, `text-xs`, `[@media(pointer:coarse)]:min-h-11`.

- [ ] **Step 2: Verify**

`npx tsc --noEmit` → PASS; `npm run lint` → PASS.

- [ ] **Step 3: Docs**

Add sections for the four files to `docs/COMPONENTS/components-tasks.md` (Purpose/API/State/Depends/Debugging/Tests — Tests: "No direct unit coverage; tests/e2e/tasks.spec.ts").

- [ ] **Step 4: Commit**

```bash
git add components/tasks/types.ts components/tasks/TaskStatusPill.tsx components/tasks/TaskPriorityFlag.tsx components/tasks/TaskDateChips.tsx docs/COMPONENTS/components-tasks.md
git commit -m "feat(tasks): inline status, priority and date pickers"
```

---

### Task 10: Capture row, scope tabs, toolbar

**Files:**
- Create: `components/tasks/TaskCaptureRow.tsx`, `components/tasks/TaskViewTabs.tsx`, `components/tasks/TaskToolbar.tsx`
- Test: none (UI; Task 17 e2e).

**Interfaces:**
- Produces:
  - `TaskCaptureRow({ timezone, collectionId?, status?, placeholder?, onCaptured? }: { timezone: string; collectionId?: string; status?: TaskStatus; placeholder?: string; onCaptured?: (task: TaskView) => void })` — Enter creates (`Inbox` by default, `scheduledOn: today` with Shift+Enter), `status` passed through for board columns; error toast "Could not add the task."; keeps typed text on failure; `data-testid="task-capture"` (same id as today so e2e can be updated in place).
  - `TaskViewTabs({ view, counts, layout, onScope, onLayout, activeRef }: { view: TaskBucket; counts?: TaskCounts; layout: TaskLayout; onScope(view: TaskBucket): void; onLayout(layout: TaskLayout): void; activeRef?: Ref<HTMLButtonElement> })` — scope buttons with `TASK_BUCKET_LABELS` (export it from here, moved from `TaskViewSwitcher`), overdue pill, List/Board segmented control with `aria-pressed`; `data-testid="tasks-count-<bucket>"` preserved.
  - `TaskToolbar({ state, onChange, onAddTask, lists }: { state: TaskViewState; onChange(next: TaskViewState): void; onAddTask(): void; lists: WritableList[] })` — Add task (violet primary, `data-testid="task-add"`), Group menu (Status/Priority/List), Filter menu with status/priority/list checkbox groups and a Clear action, Sort menu, Hide closed toggle button (`aria-pressed`).

- [ ] **Step 1: Implement the three components** with only props/state they own; every menu change calls `onChange({ ...state, key: value })`. In board layout the **Group** control is disabled (the board is always grouped by status); Sort, Filter and Hide closed stay available.

Groupable rows: `groupTasks` requires each row to carry `collection: { id, name }`, which `TaskView` already provides — the UI passes `TaskView[]` and the generic types accept it structurally.

- [ ] **Step 2: Verify** `npx tsc --noEmit` → PASS; `npm run lint` → PASS.

- [ ] **Step 3: Docs** — add the three sections to `docs/COMPONENTS/components-tasks.md`, and record that `TASK_BUCKET_LABELS` moved here from `TaskViewSwitcher.tsx` (deleted in Task 12).

- [ ] **Step 4: Commit**

```bash
git add components/tasks/TaskCaptureRow.tsx components/tasks/TaskViewTabs.tsx components/tasks/TaskToolbar.tsx docs/COMPONENTS/components-tasks.md
git commit -m "feat(tasks): capture row, scope tabs and view toolbar"
```

---

### Task 11: Dense row, group header, grouped list

**Files:**
- Modify: `components/tasks/TaskRow.tsx` (rewrite)
- Create: `components/tasks/TaskGroupHeader.tsx`, `components/tasks/TaskList.tsx`
- Delete: `components/tasks/TaskPlanPopover.tsx` (superseded by `TaskDateChips`; its only consumer was the old TaskRow)
- Test: none (UI; Task 17 e2e).

**Interfaces:**
- Produces:
  - `TaskRow({ task, today, selected, onFocus, actions, moveTargets }: { task: TaskView; today: string; selected: boolean; onFocus(): void; actions: TaskActions; moveTargets: WritableList[] })` — same DOM contract as today (`tabIndex={0}`, `draggable`, `data-task-id`, `data-selected`, `aria-current`, drag payload via `setTaskDragPayload`), plus: list dot + name, `TaskStatusPill`, `TaskPriorityFlag`, `TaskDateChips`, menu (Open, Move to list…, Drop, Delete). Row opens the panel on click of the title and on `Enter` (shell handles Enter through `onOpen`).
  - `TaskGroupHeader({ label, count, open, controlsId, onToggle, testId? }: { label: string; count: number; open: boolean; controlsId: string; onToggle(): void })` — `button` with `aria-expanded`/`aria-controls` + chevron.
  - `TaskList({ groups, today, selectedId, onFocus, actions, moveTargets, emptyMessage, onClearFilters }: { groups: TaskGroup<TaskView>[]; today: string; selectedId: string | null; onFocus(id: string): void; actions: TaskActions; moveTargets: WritableList[]; emptyMessage: string; onClearFilters: (() => void) | null })` — local `Record<string, boolean>` collapse state (all open by default), renders `TaskGroupHeader` + `<ul>` per group; empty groups are already omitted by `groupTasks`; when `groups.length === 0` renders the empty state, with a "Clear filters" button when `onClearFilters` is provided, else "Nothing here. Enjoy the quiet."
  - `GroupableTask` type: `TaskView` satisfies it (uses `collection` and the row fields).

- [ ] **Step 1: Implement TaskRow** keeping the selection/focus contract and the coarse-pointer sizes; the checkbox calls `actions.onToggleDone`; "Open" menu item calls `actions.onOpen`.
- [ ] **Step 2: Implement TaskGroupHeader + TaskList.**
- [ ] **Step 3: Verify** `npx tsc --noEmit` → PASS (TasksShell still uses the old props until Task 12; if the signature break makes the repo fail to typecheck, do Task 12 in the same commit and move its checkbox steps here — the two tasks share the shell rewrite).
- [ ] **Step 4: Docs** — rewrite the `### components/tasks/TaskRow.tsx` section, delete the `### components/tasks/TaskPlanPopover.tsx` section (and mention the replacement), and add sections for the two new files.
- [ ] **Step 5: Commit**

```bash
git add components/tasks/TaskRow.tsx components/tasks/TaskGroupHeader.tsx components/tasks/TaskList.tsx components/tasks/TaskPlanPopover.tsx docs/COMPONENTS/components-tasks.md
git commit -m "feat(tasks): dense grouped task list"
```

---

### Task 12: `TasksShell` rewrite (list view wiring + URL state) and removal of the old switcher/capture bar

**Files:**
- Modify: `components/tasks/TasksShell.tsx` (rewrite), `components/tasks/TaskShortcutHelpDialog.tsx`, `components/tasks/TaskEditorDialog.tsx` (keep until Task 13)
- Delete: `components/tasks/TaskViewSwitcher.tsx`, `components/tasks/TaskCaptureBar.tsx`
- Test: existing `tests/unit/task-deep-link.test.ts`, `tests/unit/use-task-shortcuts.test.ts` must keep passing.

**Interfaces:**
- Consumes: `parseTaskViewState`, `mergeTaskViewParams` (Task 8), `useTasks(view, collectionId, includeClosed)` (Task 7), `TaskViewTabs`/`TaskToolbar`/`TaskList`/`TaskRow` (Tasks 10/11), `TaskCaptureRow` (10).
- Produces: the `/tasks` shell as the single owner of `TaskViewState` (read once from `useSearchParams`, written with `router.replace`), selection id, `editorTask`, mutations and undo (all v0.2.0 helpers kept: `patchStatus`, `patchSchedule`, `patchMove`, `deleteTaskWithUndo`, `pushUndo`/`undoToast`), plus a new `patchPriority(target, priority)` helper that toasts "Priority updated" with a targeted undo.

Behavior to keep verbatim: selection coherence effect, `j`/`k` movement, triage keys, deep-link settle logic (`fetchDeepLinkTask`, `deepLinkHandledRef`, `deepLinkRequestRef`), `moveTargets` writable lists, focus return on dialog close, help dialog, `useUndoHotkey`, `data-testid="tasks-shell"`, `data-testid="task-list"` on the list container.

- [ ] **Step 1: Write the shell** — state: `const [state, setState] = useState(() => parseTaskViewState(searchParams))` plus an effect syncing from `searchParams` when the URL changes (back/forward), and `function updateState(next) { setState(next); router.replace(\`/tasks?${mergeTaskViewParams(searchParams, next)}\`) }`. `tasksQuery = useTasks(view, state.collectionId ?? undefined, state.closed)`; grouped rows via `sortTasks(filterTasks(tasks, state), state.sort)` then `groupTasks(..., state.group)` for list; render `TaskCaptureRow` above the list, `TaskViewTabs`, `TaskToolbar`, then `TaskList`. View switch clears the selection (existing rule).
- [ ] **Step 2: Delete `TaskViewSwitcher.tsx` and `TaskCaptureBar.tsx`**, removing their `docs/COMPONENTS/components-tasks.md` sections in the same commit.
- [ ] **Step 3: Verify** `npx tsc --noEmit` → PASS; `npx vitest run tests/unit/task-deep-link.test.ts tests/unit/use-task-shortcuts.test.ts --maxWorkers=8` → PASS; `npm run docs:check` → PASS.
- [ ] **Step 4: Docs** — rewrite `### components/tasks/TasksShell.tsx` (state ownership, URL params, layout rendering, undo), patch `### components/tasks/TaskShortcutHelpDialog.tsx` if copy changes are deferred to Task 13.
- [ ] **Step 5: Commit**

```bash
git add components/tasks/TasksShell.tsx components/tasks/TaskShortcutHelpDialog.tsx components/tasks/TaskViewSwitcher.tsx components/tasks/TaskCaptureBar.tsx docs/COMPONENTS/components-tasks.md
git commit -m "feat(tasks): rebuild the tasks shell around list views and URL state"
```

---

### Task 13: Slide-over task panel (replaces the modal)

**Files:**
- Create: `components/tasks/TaskPanel.tsx`
- Delete: `components/tasks/TaskEditorDialog.tsx`
- Modify: `components/tasks/TasksShell.tsx` (render the panel), `components/tasks/TaskShortcutHelpDialog.tsx`
- Test: existing `tests/unit/task-deep-link.test.ts` stays green; e2e in Task 17.

**Interfaces:**
- Produces: `TaskPanel({ task, today, onClose, actions, onChecklist }: { task: TaskView | null; today: string; onClose(): void; actions: TaskActions; onChecklist(items: { title: string; done: boolean }[]): void })`. Adds `onTitle(title: string): void` to `TaskActions` (Task 9 interface) because the panel's inline title is editable there; **no toast/undo for title edits** (they are explicit and reversible by retyping). Renders `null` when no task. `role="dialog"` `aria-modal="false"` `aria-label="Task details"`; header breadcrumb "Inbox / <title>" with close button (`aria-label="Close task"`); inline title input (`data-testid="task-panel-title"`, saves on blur/Enter via `actions` — add `onTitle(title: string): void` to `TaskActions`) empty title reverts; `TaskStatusPill`, `TaskPriorityFlag`, `TaskDateChips`, list chip (menu moving lists), notes textarea (save on blur, max 2000), checklist add/toggle/remove (same replace contract as the old dialog), footer actions Complete / Drop / Delete, shortcut hint line.
- Esc closes (`useEffect` on `keydown`, capture phase, ignore when a Radix popover/menu is open — the existing editor's popover comment applies); focus moves to the title on open; shell's `closeEditor` keeps returning focus.

- [ ] **Step 1: Implement `TaskPanel`**; wire `onTitle` into `TaskActions` and the shell (`patchTitle` with undo? title edits don't need undo — no toast).
- [ ] **Step 2: Swap the shell's `<TaskEditorDialog>` for `<TaskPanel>`**, delete `TaskEditorDialog.tsx` + its doc section, update the help dialog copy ("Enter opens the task panel").
- [ ] **Step 3: Verify** `npx tsc --noEmit` → PASS; `npx vitest run tests/unit/task-deep-link.test.ts --maxWorkers=8` → PASS; `npm run docs:check` → PASS.
- [ ] **Step 4: Docs** — add `### components/tasks/TaskPanel.tsx`, delete the dialog section, update shell section.
- [ ] **Step 5: Commit**

```bash
git add components/tasks/TaskPanel.tsx components/tasks/TaskEditorDialog.tsx components/tasks/TasksShell.tsx components/tasks/TaskShortcutHelpDialog.tsx docs/COMPONENTS/components-tasks.md
git commit -m "feat(tasks): slide-over task panel replaces the editor dialog"
```

---

### Task 14: Board view

**Files:**
- Create: `components/tasks/TaskBoard.tsx`, `components/tasks/TaskBoardCard.tsx`
- Modify: `components/tasks/TasksShell.tsx`, `components/tasks/TaskShortcutHelpDialog.tsx`
- Test: none locally (e2e Task 17).

**Interfaces:**
- Consumes: `TaskActions`, `TaskStatusPill`/`TaskPriorityFlag` (compact), `TaskDateChips`, `TASK_STATUS_ORDER`, `TASK_STATUS_LABELS`, `TaskCaptureRow`, `groupTasks` (or direct grouping by status).
- Produces: `TaskBoard({ tasks, today, selectedId, closed, onFocus, actions, onCreate }: { tasks: TaskView[]; today: string; selectedId: string | null; closed: boolean; onFocus(id: string): void; actions: TaskActions; onCreate(status: TaskStatus): void })` — columns `open`, `in_progress` always, `done` + `dropped` only when `closed`; each column lists `TaskBoardCard` in `sortOrder` order with a `TaskCaptureRow` when `status` is an active one; the card's status/priority/date changes go through `actions` (no duplicate callbacks). Card: title, `TaskPriorityFlag`, due chip, list dot, menu; `data-task-id` (keyboard traversal + selection reuse), draggable with `dataTransfer.setData("application/x-nailong-task-status", task.id)` and `effectAllowed="move"`; column `onDragOver` sets `dropEffect="move"`, `onDrop` reads the id and calls `actions.onStatus(task, columnStatus)` (ignore when the source column is the target). New file `lib/ui/taskBoardDrag.ts` with `setBoardDragPayload(dataTransfer, taskId)` / `readBoardDragPayload(dataTransfer): string | null` and a unit test `tests/unit/task-board-drag.test.ts` (payload round-trip + null for missing type).

- [ ] **Step 1: Write `lib/ui/taskBoardDrag.ts` + its failing unit test**, run it (FAIL), implement, run (PASS).
- [ ] **Step 2: Implement `TaskBoardCard` + `TaskBoard`; render in shell when `state.layout === "board"`; keyboard `j`/`k` keep working because cards carry `data-task-id` in DOM order and the existing `focusRow` query targets `[data-task-id]`.**
- [ ] **Step 3: Verify** `npx tsc --noEmit` → PASS; `npx vitest run tests/unit/task-board-drag.test.ts --maxWorkers=8` → PASS; `npm run docs:check` → PASS (deleted/added files documented).
- [ ] **Step 4: Docs** — `lib/ui.md` (`taskBoardDrag.ts`), `components-tasks.md` (two components, board keyboard/drag contracts, the "no within-column reorder" rule).
- [ ] **Step 5: Commit**

```bash
git add components/tasks/TaskBoard.tsx components/tasks/TaskBoardCard.tsx lib/ui/taskBoardDrag.ts tests/unit/task-board-drag.test.ts components/tasks/TasksShell.tsx components/tasks/TaskShortcutHelpDialog.tsx docs/COMPONENTS/lib-ui.md docs/COMPONENTS/components-tasks.md
git commit -m "feat(tasks): status board with drag-to-change-status"
```

---

### Task 15: Sidebar list counts + quick add

**Files:**
- Modify: `components/sidebar/CollectionRow.tsx`, `components/sidebar/CollectionTree.tsx`
- Test: none locally (e2e Task 17); permission logic reuses `foldCollectionPermission`/`canWriteCollection`.

**Interfaces:**
- Consumes: `useTaskCounts()` (Task 7), `useCreateTask`.
- Produces: new optional props on `CollectionRow`: `taskCount?: number` and `onQuickAdd?: () => void` (rendered only when provided). `CollectionTree` calls `useTaskCounts({ enabled: pathname.startsWith("/tasks") })` (from `usePathname`) and, for `kind === "list"` rows whose folded permission allows writing (`canWriteCollection({ userId: currentUserId, householdId: "" }, foldCollectionPermission(...))`), passes `taskCount={counts.data?.byCollection[collection.id]}` and `onQuickAdd` opening a small Radix `Dialog` with one title input (Enter submits `createTask({ title, collectionId })`, Esc closes, toast on error, `data-testid="sidebar-quick-add"`). Calendars and view-only/private non-owned lists get neither prop.

- [ ] **Step 1: Implement** (keep existing row structure/toggles; count renders as a muted pill before the menu, hidden at 0 or `undefined`; quick-add only on hover/focus like the existing row actions, coarse-pointer always visible).
- [ ] **Step 2: Verify** `npx tsc --noEmit` → PASS; `npm run lint` → PASS; `npm run docs:check` → PASS.
- [ ] **Step 3: Docs** — patch `### components/sidebar/CollectionRow.tsx` and `### components/sidebar/CollectionTree.tsx` in `docs/COMPONENTS/components-shell-and-sidebar.md` (counts query, quick-add permission rule, create mutation).
- [ ] **Step 4: Commit**

```bash
git add components/sidebar/CollectionRow.tsx components/sidebar/CollectionTree.tsx docs/COMPONENTS/components-shell-and-sidebar.md
git commit -m "feat(tasks): sidebar list counts and quick add"
```

---

### Task 16: Page width, density audit, version 0.2.1

**Files:**
- Modify: `app/(app)/tasks/page.tsx`, `package.json`, `lib/roadmap.ts`, `README.md`
- Test: `tests/unit/roadmap.test.ts` (existing equality test must pass)

**Interfaces:**
- Produces: `/tasks` page container `mx-auto w-full max-w-6xl` (was `max-w-3xl`); `version` and `APP_VERSION` both `"0.2.1"`.

- [ ] **Step 1: Widen the page** and pass nothing new (shell owns state).
- [ ] **Step 2: Density/style audit** — walk every tasks component and confirm: `text-sm`/`text-[13px]` row type, 6 px radii (`rounded-md` where used), violet focus rings on interactive chips, `bg-surface` list with `border-line`, no leftover `bg-accent` primary buttons inside the tasks area (violet only), coarse-pointer 44 px targets, and that no calendar/shell file changed.
- [ ] **Step 3: Bump the version** in `package.json` and `lib/roadmap.ts`; update the README "What's new"/features copy with the List/Board/panel/priority/in-progress description.
- [ ] **Step 4: Verify** `npx vitest run tests/unit/roadmap.test.ts --maxWorkers=8` → PASS; `npm run docs:check` → PASS; `npm run lint` → PASS; `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Docs** — patch `docs/COMPONENTS/app-routes.md` for `app/(app)/tasks/page.tsx`, and `docs/COMPONENTS/scripts-and-ops.md` for the version pin.
- [ ] **Step 6: Commit**

```bash
git add "app/(app)/tasks/page.tsx" package.json lib/roadmap.ts README.md docs/COMPONENTS/app-routes.md docs/COMPONENTS/scripts-and-ops.md
git commit -m "feat(tasks): widen the workspace, polish density and bump to 0.2.1"
```

---

### Task 17: E2E spec, docs gate and final verification

**Files:**
- Rewrite: `tests/e2e/tasks.spec.ts`
- Modify: `docs/COMPONENTS/tests.md`, `docs/DEBUGGING.md`
- Test: itself + the whole suite.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Rewrite the e2e spec** with these cases (Playwright is the CI gate; local run is blocked by this sandbox — note it in the task report):
  1. default `/tasks` renders grouped list by status with the seeded tasks, and toggling Board shows the status columns;
  2. inline status change on a row moves it between group sections and shows the undo toast; `Ctrl+Z` restores;
  3. inline priority change shows the flag and survives a reload (URL-independent persistence);
  4. group-by Priority and Sort-by Due reorder the rows; Hide closed reveals the done task;
  5. opening a row opens the panel, Esc closes it and focus returns to the row;
  6. `?task=<id>` deep link opens the panel once, and closing clears the param;
  7. keyboard triage (`j`, `2`, `Space`) still works, and typing in the capture row does not fire it;
  8. sidebar list row shows the active count and quick-add creates a task in that list (when logged in as the seeded user).
- [ ] **Step 2: Run the local gates**

```bash
npm run docs:check
npm run lint
npx tsc --noEmit
npx vitest run --maxWorkers=8
```

Expected: all pass, ≥ 470 tests across ≥ 50 files. Record the exact counts in the task report. Playwright: `npm run test:e2e` will fail locally with `spawn EPERM` — record it as the CI gate, not a regression.

- [ ] **Step 3: Docs final pass**

`docs/COMPONENTS/tests.md` rows for `task-views.test.ts`, `task-view-params.test.ts`, `task-board-drag.test.ts` and the rewritten e2e spec; `docs/DEBUGGING.md` traps: (a) "an in_progress task missing from a view → a stale `status === "open"` check, use `isActiveStatus`"; (b) "board drag does nothing → dataTransfer uses `application/x-nailong-task-status`, not text/plain"; (c) "shortcuts fire while typing in the panel → the input/target guard in `lib/ui/shortcutGuards.ts`"; (d) "closed tasks missing → the request needs `includeClosed=true`".
Run `npm run docs:check` last.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/tasks.spec.ts docs/COMPONENTS/tests.md docs/DEBUGGING.md
git commit -m "test(tasks): e2e coverage for list, board, panel and sidebar"
```

---

## Task Ordering Notes

- Tasks 1–8 are server/domain and land before any UI so the UI tasks compile against real types.
- Task 11 and Task 12 share the `TaskRow`/`TasksShell` interface change; if a task boundary must move, merge them (the plan's step 3 in Task 11 records the allowed merge).
- Task 13 depends on Task 12 (panel replaces the dialog inside the rewritten shell); Task 14 depends on 12/13.
- Task 15 is independent of 12–14 once Task 7 ships and can be dispatched in parallel with the UI tasks.
- Task 16 and 17 are integration/polish and run last.
