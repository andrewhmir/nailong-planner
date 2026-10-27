# Due-date-only task model (v0.2.1 follow-up) — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-27-task-due-datetime-design.md`
**Worktree:** `.worktrees/v0.2.1-clickup-ui` — branch `feat/v0.2.1-clickup-ui`
**Rule:** docs ship in the same commit as the code. Version stays `0.2.1`.

## Tasks

### Task 1 — Schema + migration 0008
- [x] Remove `scheduledOn`, add nullable `dueTime` (`due_time`) to `lib/db/schema.ts`; drop `task_scheduled_idx`, keep `task_due_idx`; fix the table comment.
- [x] Generate/author `drizzle/0008_task_due_datetime.sql` with the backfill before the column drop; journal `idx: 8`; snapshot prevId = 0007 id. The drizzle-kit generator hit an interactive column-conflict prompt in a non-TTY shell even with full access, so the SQL, journal entry and snapshot were hand-authored from the 0007 snapshot and verified by the migration test.
- [x] Migration test in `tests/integration/db.test.ts`: legacy row with `scheduled_on` gets `due_on`; `due_time` starts null; `scheduled_on` and `task_scheduled_idx` are gone.
- [x] Verify: focused db test RED (`no such column: due_time`) then GREEN.

### Task 2 — Domain
- [x] `bucketOf`/`bucketOfIncludingClosed` anchor on `dueOn` only (undated → someday, past → today, beyond week → null).
- [x] `isOverdue(task, today, nowTime)` with the timed boundary (equality is on time; date-only due today waits for tomorrow); `localTimeOfDay(timeZone)` helper.
- [x] `taskViews.ts`: `SortableTask` loses `scheduledOn`, gains `dueTime`; due sort orders date then time (untimed after timed); `effectiveDate` deleted.
- [x] Short display helper (`formatShortWallDate`) in `lib/time/format.ts`.
- [x] Tests: `tasks-buckets`, `task-views` (watched RED then GREEN).

### Task 3 — Validation + service + API
- [x] Validation: drop `scheduledOn`, add `dueTime` (`HH:MM` regex, nullish).
- [x] Service: `TaskView` gains `dueTime` (from row) + server-computed `overdue`; `countActive`/list use `isOverdue` with household `nowTime`; create/patch normalise time↔date (time without date → 400; clearing date clears time); reads select the new columns.
- [x] Client data layer: `lib/query/tasks.ts` types, `lib/query/taskCache.ts` patch fields, `lib/ui/taskUndo.ts` restore patch.
- [x] Tests: `tasks`, `tasks-api`, `task-undo`, `task-cache`.

### Task 4 — The single due button
- [x] New `components/tasks/TaskDueChip.tsx` (delete `TaskDateChips.tsx` + its docs section): one chip `Tue 27 Oct, 18:00`, popover = mini-month + the shared calendar `TimeField` (extended with `value: string | null`, `placeholder`, `disabled`, `onClear`), Done, Clear.
- [x] Wire `TaskRow`, `TaskBoardCard`, `TaskPanel`, `components/tasks/types.ts` (`onDates` → `onDue` patch shape: `{ dueOn?, dueTime? }`), and thread `timeFormat` + `timezone` from the page.
- [x] `TasksShell`: due-patch helper + toasts/undo, triage 1/2/3 → due today / due end of week / clear, capture Shift+Enter = due today, drag-drop = due date; `TaskShortcutHelpDialog` copy.

### Task 5 — Calendar + drag
- [x] `components/calendar/taskChip.ts` renders a task on its `dueOn`.
- [x] `lib/ui/taskDrag.ts` payload `{ id, dueOn }`; `useTaskPlanDrop` sets the due date, toast copy, undo restore; `MiniMonth`/`CalendarShell` callers.
- [x] Tests: `task-drag`, `use-task-shortcuts`, `taskChip`.

### Task 6 — Seed, e2e, docs, verification
- [x] `scripts/seed-test-db.mts`: spread due dates/times across Today/Week/Someday/overdue incl. a deterministic timed overdue row (yesterday 09:00).
- [x] E2E: `tests/e2e/tasks.spec.ts`, `events.spec.ts` fixtures/assertions migrated and typechecked/linted; Playwright not executed locally (the review dev server holds `.next`/`:3000`) — CI gate.
- [x] Docs sweep (scheduledOn → due, single chip, migration 0008, counts/overdue rule, triage/capture/chip copies): `lib-data`, `lib-domain`, `lib-services`, `lib-ui`, `components-tasks`, `components-calendar`, `app-routes`, `api-layer`, `tests`, `scripts-and-ops`, `DEBUGGING`, README.
- [x] Gates: `npm run docs:check` PASS, `npx tsc --noEmit` 0, `npx eslint` 0, full vitest **538/539** PASS (the one failure is the documented pre-existing `tests/unit/undo.test.ts` `vi.mock` resolution issue under the real `node_modules` copy, Ruling 26); dev DB migrated by `lib/db/index.ts` startup `migrate()` and the live API smoke-tested; `npm run build` deferred (dev server cannot be stopped from this sandbox).

## Commit shape
Single commit by the Lead (single committer): `feat(tasks): one due date with an optional due time (0008)` — schema/migration/domain/service/API/UI/calendar/seed/tests/docs together, since the two teammates left their scopes uncommitted and `docs:check` requires the doc sections to move with the deleted file.
