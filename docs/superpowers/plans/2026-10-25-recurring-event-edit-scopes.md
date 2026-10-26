# Recurring-Event Edit Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy Google Calendar's three recurring-event edit scopes (“This event” / “This and following events” / “All events”) for drag, resize, the Edit form and Delete, with per-instance exceptions, series splitting, undo, tests and docs.

**Architecture:** A per-instance exception is an ordinary `event` row linked to its series by a new nullable `event.recurrence_parent_id` (FK → `event.id`, `ON DELETE CASCADE`) plus `recurrence_id` (the replaced occurrence key). The series keeps an EXDATE for the original slot, so `lib/recurrence/expand.ts`, `toFcEvent`, search and mini-month need **no** override logic. “This and following” truncates the old series (`COUNT`/`UNTIL` rules are rewritten textually) and creates a second series row; “All events” shifts the series and its rule/EXDATEs. Pure rule/key maths go in a new `lib/recurrence/scopes.ts`; SQL and transactions stay in `lib/services/events.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Drizzle ORM + better-sqlite3 (WAL), TanStack Query v5, `rrule` 2.8, Zod 4, FullCalendar 7, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-25-recurring-event-edit-scopes-design.md`

## Global Constraints

- Node 22+, TypeScript strict, no `any` except at a library boundary; SQL and transactions only in `lib/services/*`; pure date/recurrence maths in `lib/recurrence/*`.
- Every file added/moved/changed under `app/`, `components/`, `lib/`, `scripts/` needs its `docs/COMPONENTS/*` section updated in the same task; `npm run docs:check` must exit 0.
- Migrations: schema in `lib/db/schema.ts` then `npm run db:generate`; commit the generated `drizzle/0005_*.sql` **and** `drizzle/meta/0005_snapshot.json` + `_journal.json` entry. Tests build an in-memory DB from migrations.
- Conventional commits, one concern per commit. Branch: `feat/recurring-event-edit-scopes`. No push, PR or deploy.
- Never edit existing historical `docs/superpowers/specs|plans/*` files; only add the new spec/plan.
- Server behaviour must match the spec: absent `scope` keeps today’s all-series PATCH; `scope: "this"` ignores `rrule`; all-day/timed conversion of a whole series is rejected with `VALIDATION`; all-events drag is rejected for rules `parseRepeatRule` reports as `advanced`/unparseable.
- No new npm dependencies.

## Review Focus

- **Advanced/unparseable repeat rule dragged with “All events”** — a user expects the chooser to stay usable; the option must be disabled in the UI and the server must answer `VALIDATION` 400, never mangle the stored rule. Owner: Task 2 (service tests), Task 3 (disabled button).
- **DST series (`event.tzid` set) split or shifted** — a London 09:00 series must stay 09:00 after a split/move across the March/October transition. Owner: Task 1 (`shiftRepeatRule`/`truncateRuleBefore` unit tests) and Task 2 (service test).
- **Split at the first occurrence / `COUNT`-ended series** — the old row is removed, later exceptions are not orphaned or cascade-deleted, and undo restores one series with the right `COUNT`. Owner: Task 2 (integration) and Task 3/4 (undo).
- **Deleting a series that has moved instances** — cascade removes exceptions, the delete response carries the deleted rows, and undo recreates them parent-first. Owner: Task 2 (service/API) and Task 3 (client undo).
- **After a scoped move, the grid must show the occurrence exactly once** — the original slot gone (EXDATE) and the exception at the new time after invalidation/reload, not a duplicate. Owner: Task 5 (Playwright).

---

### Task 1: Schema, migration and pure recurrence-scope helpers

**Files:**
- Modify: `lib/db/schema.ts` (event table)
- Create: `drizzle/0005_recurring_event_scopes.sql`, `drizzle/meta/0005_snapshot.json`, modify `drizzle/meta/_journal.json` (generated)
- Create: `lib/recurrence/scopes.ts`
- Create: `tests/unit/recurrence-scopes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/recurrence/scopes.ts
  export interface ShiftDelta { deltaDays: number; deltaMs: number }
  export interface SeriesMove {
    allDay: boolean;
    startAt: number | null; endAt: number | null;
    startDate: string | null; endDate: string | null;
  }
  export function localDateOfEvent(row: EventRow, zone: string): string;
  export function dateDiffDays(fromDate: string, toDate: string): number;
  export function shiftOccurrenceKey(key: string, delta: ShiftDelta): string;
  export function shiftExdates(raw: string | null, allDay: boolean, delta: ShiftDelta): string | null;
  export function shiftRepeatRule(rule: string, oldStartDate: string, newStartDate: string, context: RepeatContext): string | null;
  export function shiftSeriesTiming(row: EventRow, occurrenceStart: string, move: SeriesMove, zone: string): { patch: Partial<EventRow>; delta: ShiftDelta };
  export function truncateRuleBefore(rule: string, splitStart: string, beforeCount: number, zone: string, timed: boolean): string;
  export function continueRule(rule: string, beforeCount: number): string;
  export function countOccurrencesBefore(row: EventRow, occurrenceStart: string, zone: string): number;
  export function assertOccurrenceOf(row: EventRow, occurrenceStart: string, zone: string): void;
  export function shiftEventTiming(row: EventRow, delta: ShiftDelta): Partial<EventRow>;
  ```
  `ShiftDelta` semantics: `deltaDays` for all-day keys/date fields; `deltaMs` for timed instants; convert an all-day move with `deltaDays` and a timed move with `deltaMs`. `zone` is `row.tzid ?? householdTimezone`.

- [ ] **Step 1: Add the two nullable columns and the index to `lib/db/schema.ts`**

Inside `event` after `exdates`:
```ts
    /**
     * Set only on a per-instance exception: the repeating row this event replaces
     * one occurrence of. Cascades so deleting a series deletes its exceptions.
     */
    recurrenceParentId: text("recurrence_parent_id").references((): AnySQLiteColumn => event.id, {
      onDelete: "cascade",
    }),
    /** Original occurrence key the exception replaced: YYYY-MM-DD or ISO instant. */
    recurrenceId: text("recurrence_id"),
```
and in the table extras, next to `event_calendar_idx`:
```ts
    index("event_recurrence_parent_idx").on(table.recurrenceParentId),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: `drizzle/0005_*.sql` contains `ALTER TABLE \`event\` ADD \`recurrence_parent_id\` … REFERENCES event(id) ON DELETE CASCADE` and `ADD \`recurrence_id\`` plus `CREATE INDEX \`event_recurrence_parent_idx\``; `drizzle/meta/_journal.json` gains the `0005` entry; `0005_snapshot.json` exists.

- [ ] **Step 3: Apply the migration to the local dev DB and the test helper**

Run: `npm run db:migrate`
Expected: exit 0, `PRAGMA table_info(event)` via `npx tsx -e "…"` shows both columns (or simply re-run — the journal records it).

- [ ] **Step 4: Write the failing helper tests**

`tests/unit/recurrence-scopes.test.ts` — use the row factory style already in `tests/unit/recurrence.test.ts` (fill the new columns with `null`).
Test names and assertions to write:
- `"shiftOccurrenceKey shifts dates and instants"`: `shiftOccurrenceKey("2026-10-24", {deltaDays: 1, deltaMs: 0}) === "2026-10-25"`; `shiftOccurrenceKey("2026-10-24T01:00:00.000Z", {deltaDays: 1, deltaMs: 25*3600_000}) === "2026-10-25T02:00:00.000Z"`.
- `"shiftExdates shifts only the matching key shape"`: all-day JSON `["2026-10-24"]` +1 day → `["2026-10-25"]`; malformed JSON → `null`; timed ISO +1h shifts, floating `2026-10-24T09:00` stays unchanged.
- `"shiftRepeatRule shifts weekly BYDAY tokens"`: `FREQ=WEEKLY;BYDAY=SA` with starts `2026-10-24`/`2026-10-25` → contains `BYDAY=SU`.
- `"shiftRepeatRule shifts a monthly day and its UNTIL"`: `FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20261215T235900Z`, start `2026-11-15` → `2026-11-16` → `BYMONTHDAY=16` and `UNTIL=20261216…`.
- `"shiftRepeatRule preserves multi-weekday patterns by shifting each day"`: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` +1 day → `BYDAY=TU,WE,TH,FR,SA`.
- `"shiftRepeatRule refuses advanced or unparseable rules"`: `FREQ=WEEKLY;BYDAY=TU;BYHOUR=9` → `null`; `FREQ=HOURLY` → `null`.
- `"shiftSeriesTiming moves an all-day series and its EXDATEs"`: row 2026-10-24..25 FREQ=WEEKLY BYDAY=SA exdates `["2026-11-07"]`, occurrence `2026-10-24` dropped on `2026-10-25` → patch `startDate === "2026-10-25"`, `endDate === "2026-10-26"`, `exdates` includes `"2026-11-08"`, rrule `BYDAY=SU`.
- `"shiftSeriesTiming moves a timed series by the instant delta"`: startAt `at("2026-10-24T09:00")`, dropped `at("2026-10-25T10:00")` → startAt +25 h, endAt +25 h, EXDATE ISO instant shifted.
- `"truncateRuleBefore writes COUNT for a COUNT series"`: `FREQ=DAILY;COUNT=10`, split occurrence #4 → `COUNT=3`.
- `"truncateRuleBefore writes an all-day UNTIL"`: `FREQ=WEEKLY;BYDAY=SA`, split `2026-10-31`, timed=false → `UNTIL=20261030`.
- `"truncateRuleBefore writes a UTC UNTIL for a timed series"`: split instant of a 09:00 London occurrence → `UNTIL=…Z` one second before the split wall time (assert via expanding the truncated rule: no occurrence `>=` split).
- `"continueRule reduces COUNT"`: `FREQ=DAILY;COUNT=10`, beforeCount 3 → `COUNT=7`; a rule without COUNT is returned verbatim.
- `"countOccurrencesBefore counts and validates"`: weekly series, split 3rd occurrence → 2; a date that is not an occurrence throws `AppError` code `VALIDATION`.
- `"shiftEventTiming shifts an exception row"`: timed exception startAt/endAt by `deltaMs`; all-day dates by `deltaDays`.

Run: `npx vitest run tests/unit/recurrence-scopes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `lib/recurrence/scopes.ts`**

Pure module; import `addDaysToDate`, `localWallTimeToUtc`, `utcToLocalDate`, `utcToLocalWallTime` from `@/lib/time/zone`, `expandOccurrences` from `@/lib/recurrence/expand`, `parseRepeatRule`, `formatRepeatRule`, `anchorRepeat`, `type RepeatContext` from `@/lib/recurrence/rule`, `AppError`, and `type EventRow`.
Implementation notes:
- Key shapes: all-day `/^\d{4}-\d{2}-\d{2}$/`, instants `new Date(key).toISOString()`.
- Defensive JSON EXDATE parsing like `lib/services/events.ts:parseStoredExdates` (no throw, non-strings dropped).
- `shiftRepeatRule`: `parseRepeatRule(rule, oldStartDate, context)`; `null`/`advanced` → `null`; `deltaDays === 0` → return the rule verbatim; weekly → shift every weekday `(day + deltaDays % 7 + 7) % 7`; monthly → `anchorRepeat(options, newStartDate)`; daily/yearly → options unchanged; `end.mode === "on"` → `addDaysToDate(end.date, deltaDays)`; serialise with `formatRepeatRule(options, newStartDate, context)`.
- `shiftSeriesTiming`: reject `move.allDay !== (row.allDay === 1)` with `AppError("VALIDATION", "A repeating event can't switch between all-day and timed in one move.", 400)`; delta from `localDateOfEvent`; `rrule` via `shiftRepeatRule` and throw the same `VALIDATION` (message names “custom repeat rule”) when it returns `null`; `exdates` via `shiftExdates`; return `{ patch: { startAt, endAt, startDate, endDate, rrule, exdates, updatedAt: Date.now() }, delta }` (all-day fields only for all-day rows, instants only for timed).
- `truncateRuleBefore`: parse the rule into ordered `{key,value}` tokens (split on `;`, uppercase key, preserve order and unknown keys); `beforeCount > 0` guaranteed by caller. `COUNT` present → replace its value. Else `UNTIL`: all-day → previous date `YYYYMMDD`; timed → wall time of `splitStart` in `zone`, minus one second, `localWallTimeToUtc`, format `YYYYMMDDTHHMMSSZ`. Replace an existing `UNTIL` or append.
- `continueRule`: replace `COUNT` with `original - beforeCount` when present, else return the rule verbatim.
- `countOccurrencesBefore` / `assertOccurrenceOf`: call `expandOccurrences(row, {from: seriesStart, to: splitInstant + DAY_MS}, zone)` where `seriesStart` is `utcMidnight(startDate)`/`startAt`; count keys `< occurrenceStart`, throw `AppError("VALIDATION", "That occurrence is not part of this series.", 400)` when no key matches.
- `shiftEventTiming`: all-day → `{ startDate, endDate }` shifted by `deltaDays`; timed → `{ startAt, endAt }` shifted by `deltaMs`; else throw. `updatedAt: Date.now()`.
- `shiftOccurrenceKey` uses the same all-day/instant branches (`deltaDays` vs `deltaMs`).

- [ ] **Step 6: Run the helper suite and the existing recurrence suites**

Run: `npx vitest run tests/unit/recurrence-scopes.test.ts tests/unit/recurrence.test.ts tests/unit/recurrence-rule.test.ts`
Expected: PASS (existing tests may need the new `EventRow` fields; add `recurrenceParentId: null, recurrenceId: null` to their row literals).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Fix any other `EventRow` object literals the compiler flags (expected: `lib/services/events.ts`, `lib/query/events.ts`, `tests/unit/recurrence.test.ts`, `tests/helpers/fixtures.ts` — set both new fields to `null`).

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts drizzle lib/recurrence/scopes.ts tests/unit/recurrence-scopes.test.ts lib/services/events.ts lib/query/events.ts tests/unit/recurrence.test.ts tests/helpers/fixtures.ts
git commit -m "feat(recurrence): add recurring-event exception schema and scope helpers"
```

---

### Task 2: Service and API scopes

**Files:**
- Modify: `lib/services/events.ts`, `lib/validation/events.ts`, `lib/api/handlers/events.ts`
- Modify: `tests/integration/events.test.ts`, `tests/integration/events-api.test.ts`

**Interfaces:**
- Consumes Task 1’s `lib/recurrence/scopes.ts` functions.
- Produces:
  ```ts
  // lib/validation/events.ts
  createEventSchema additionally accepts recurrenceParentId?: string | null, recurrenceId?: string | null.
  updateEventSchema additionally accepts scope?: "this" | "following" | "all", occurrenceStart?: string.
  // lib/services/events.ts
  /** A scope-free event field patch (the handler strips the scope envelope). */
  export type EventPatch = Omit<UpdateEventInput, "scope" | "occurrenceStart">;
  export interface SeriesSplitResult {
    event: EventView;                       // the later segment (after the edit/move)
    truncated: EventView | null;            // old segment after truncation; null = removed
    relinked: EventView[];                  // exceptions now owned by the later segment
    relinkedPrevious: EventView[];          // same rows before re-linking/shifting (undo data)
  }
  export function createException(db, ctx, seriesId: string, occurrenceStart: string, input: EventPatch): EventView;
  export function moveSeries(db, ctx, id: string, occurrenceStart: string, move: SeriesMove): EventView;
  export function splitSeries(db, ctx, id: string, occurrenceStart: string, input: EventPatch): SeriesSplitResult;
  export function deleteFollowing(db, ctx, id: string, occurrenceStart: string): { deleted: EventView[]; truncated: EventView | null };
  export function deleteEvent(...): EventView[];   // scope "all" now returns the series + linked exceptions it deleted
  ```
  Handlers keep their exported names; `updateEventHandler` returns `200 { event }` for this/all and `200 SeriesSplitResult` for following. `deleteEventHandler` returns `204` for `this`, `200 { deleted, truncated }` for `all`/`following` (`truncated: null` for all).

- [ ] **Step 1: Write the failing service tests in `tests/integration/events.test.ts`**

Add a `describe("recurring edit scopes", …)` using the existing seeded helpers. Tests:
- `"moves one occurrence into a linked exception and excludes the slot"`: weekly all-day series; `createException(db, ctxA, series.id, "2026-01-31", { startDate: "2026-02-01", endDate: "2026-02-01", allDay: true })`; exception row has `rrule === null`, `recurrenceParentId === series.id`, `recurrenceId === "2026-01-31"`, `calendarId`/`title` copied; series `exdates` contains `"2026-01-31"`; `expandOccurrences(series)` no longer yields that key; `expandOccurrences(exception)` yields the new date.
- `"rejects moving an unknown occurrence"`: expects `APPError VALIDATION` from `createException` for `"2026-01-30"`.
- `"moves the whole series by the drag delta"`: timed weekly series `FREQ=WEEKLY;BYDAY=MO` 09:00 → 10:00 next day; `moveSeries`; series `startAt` +25 h, `endAt` +25 h, rrule contains `BYDAY=TU`, EXDATE shifted.
- `"refuses an all-events move for a custom rule"`: `FREQ=WEEKLY;BYDAY=TU;BYHOUR=9` → `VALIDATION`.
- `"splits the series and applies the edit to the later segment"`: weekly series 8 occurrences, split at 3rd, payload `{ title: "Second half" }`; old row `COUNT=2` (or UNTIL before split), new row title “Second half”, `rrule` with `COUNT=6` (COUNT series) or same UNTIL, `startDate` = split occurrence; `listEvents` renders original before + edited after.
- `"split at the first occurrence removes the old row"`: `truncated === null`, old id no longer in DB, new row spans all occurrences.
- `"re-links later exceptions to the new segment"`: create an exception at occurrence #4 first; split at #3 → exception `recurrenceParentId === newRow.id`; `relinkedPrevious[0].recurrenceParentId === oldSeries.id`.
- `"following move shifts re-linked exceptions by the delta"`: exception at #4 shifted +1 day/1 h when following-move occurs.
- `"deletes a series with its linked exceptions and returns them"`: `deleteEvent(scope all)` returns series+exceptions, exception rows gone (FK cascade).
- `"deleteFollowing removes the split remainder"`: `deleted` includes the new segment and later exceptions; old row survives truncated.
- `"propagates series text edits to exceptions end keeps their times"`: `updateEvent(series,{title:"Renamed"})` → exception title “Renamed”, `startAt` unchanged.
- `"detaches exceptions when the repeat is removed"`: `updateEvent(series,{rrule:null})` → exception `recurrenceParentId === null`.
- `"keeps a DST series' wall clock across a split"`: Europe/London `tzid` weekly 09:00 series around 2027-03-28; split/following-move keeps 09:00 local wall time (assert via `utcToLocalWallTime` on expanded occurrences).
- `"creates an exception under a series via the create path"`: `createEvent` with `recurrenceParentId`/`recurrenceId` (undo restore) sets the link and rejects a missing parent.

Run: `npx vitest run tests/integration/events.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 2: Implement the service layer**

Implementation outline (in `lib/services/events.ts`):
- Keep `parseStoredExdates`; add `serializeExdates`.
- `createException`: `writableEvent`; require `row.rrule`; `assertOccurrenceOf`; resolve the target calendar (input.calendarId ?? row.calendarId; write-check when different, same as `updateEvent`); merge `input` over the row (all-day invariant via `assertEventShape`); build the exception row (`rrule: null`, `exdates: null`, `recurrenceParentId: row.id`, `recurrenceId: occurrenceStart`, `tzid: row.tzid`, external fields null, `createdBy: ctx.userId`, fresh timestamps); `db.transaction` → insert exception + append the key to the series EXDATE; return `toView`.
- `moveSeries`: `writableEvent`; require `row.rrule`; `shiftSeriesTiming`; update the row with the patch; return `toView`.
- `splitSeries`: `writableEvent`; require `row.rrule`; `beforeCount = countOccurrencesBefore`; zone = `row.tzid ?? householdTimezone`; `truncationRule = truncateRuleBefore(...)`; split EXDATEs by key comparison; build the later row:
  - move mode when `input.rrule === undefined` (drag/resize): timing from input; `newRule = continueRule(shiftRepeatRule(oldRule, oldStartDate, newStartDate, context)!, beforeCount)`; shifted EXDATEs; later exceptions shifted via `shiftEventTiming`/`shiftOccurrenceKey`.
  - edit mode when `input.rrule !== undefined`: merged form fields (fall back to row for absent fields); `newRule = input.rrule === row.rrule ? continueRule(row.rrule, beforeCount) : input.rrule`; EXDATEs copied unchanged; later exceptions re-linked unchanged.
  - new row: `recurrenceParentId: null`, `recurrenceId: null`, external fields null, `tzid` copied, fresh timestamps.
  - inside one `db.transaction`: relink later exceptions first, delete old row when `beforeCount === 0`, insert later row, update old row with the truncation rule and kept EXDATEs. Capture `relinkedPrevious` (views before the transaction) for undo.
  - return `{ event: toView(newRow), truncated: beforeCount === 0 ? null : toView(updatedOldRow), relinked, relinkedPrevious }`.
- `deleteFollowing`: split with the later row identical to the old continuation (an internal helper shared with `splitSeries`, e.g. `splitAt(db, row, occurrenceStart, nextSpec)`), then delete the later row (cascade removes its exceptions) and return the deleted views + truncated old view.
- `deleteEvent`: for `scope: "all"` collect `children = select where recurrenceParentId = id`, then delete the row, return `[toView(row), ...children.map(toView)]`; `scope: "this"` unchanged (204 path).
- `updateEvent`: after the update, when `input.rrule === null && row.rrule !== null` → `db.update(event).set({ recurrenceParentId: null, recurrenceId: null, updatedAt: Date.now() }).where(eq(event.recurrenceParentId, id))`; otherwise copy provided `title`/`description`/`location`/`calendarId` to linked children.
- `createEvent`: when `input.recurrenceParentId` is provided, `getEvent` the parent (household-scoped), require `parent.rrule`, store both link fields; reject `recurrenceId` without a parent.

- [ ] **Step 3: Run service tests**

Run: `npx vitest run tests/integration/events.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing handler tests in `tests/integration/events-api.test.ts`**

Add tests (build requests through the existing `jsonRequest` helper):
- `"PATCH scope=this creates a linked exception"`: 200, body event has `recurrenceParentId === series.id`, `recurrenceId`, `rrule === null`; series exdates updated.
- `"PATCH scope=following returns the split result"`: 200 body has `event`, `truncated`, `relinked`, `relinkedPrevious`.
- `"PATCH scope=all with occurrenceStart shifts the series"`: 200, series start moves, no exception created.
- `"PATCH scope=this without occurrenceStart is a 400"` and `"PATCH scope=following with an unknown occurrence is a 400"`.
- `"DELETE scope=all returns the deleted rows with 200"` (series + exception) and `"DELETE scope=following returns deleted rows and the truncated row"`.
- `"view-only partner gets 403 on every new scope"` (this/following/all move and following delete).
- `"POST accepts recurrenceParentId and rejects an unknown parent"`.

Run: `npx vitest run tests/integration/events-api.test.ts`
Expected: FAIL.

- [ ] **Step 5: Extend validation schemas and handlers**

- `lib/validation/events.ts`: add the create-only fields and the update scope envelope as described in Interfaces. Keep `.partial()` on the update schema and do not add `.strict()`.
- `lib/api/handlers/events.ts`:
  - `updateEventHandler`: parse, destructure `{ scope, occurrenceStart, ...fields }`; require `occurrenceStart` for `this`/`following` (400 `AppError` with field error); `this` → `createException`; `following` → `splitSeries`; `all` + `occurrenceStart` → `moveSeries` with the timing fields; otherwise `updateEvent` + return `{ event }`.
  - `deleteEventHandler`: scope parsing as today plus `following`; `all` → `{ deleted }` 200; `following` → `{ deleted, truncated }` 200; `this` → 204. Note the early-return shape change in the existing test `supports scope=this delete …` stays 204.
  - `createEventHandler` unchanged (schema carries the link).

- [ ] **Step 6: Run API + service + regression suites**

Run: `npx vitest run tests/integration/events.test.ts tests/integration/events-api.test.ts tests/integration/regressions.test.ts`
Expected: PASS. Update the old `204` expectation for a whole-series delete if any suite asserts it (docs and client change in Task 3).

- [ ] **Step 7: Commit**

```bash
git add lib/services/events.ts lib/validation/events.ts lib/api/handlers/events.ts tests/integration/events.test.ts tests/integration/events-api.test.ts
git commit -m "feat(events): add this/following/all recurring edit scopes to services and API"
```

---

### Task 3: Client chooser, drag/resize/delete scopes and undo

**Files:**
- Modify: `lib/query/events.ts`
- Create: `components/calendar/ScopeDialog.tsx`
- Modify: `components/calendar/CalendarShell.tsx`

**Interfaces:**
- Consumes Task 2’s handler responses.
- Produces:
  ```ts
  // lib/query/events.ts
  export type RecurringScope = "this" | "following" | "all";
  export interface EventInputPayload { /* existing fields */ scope?: RecurringScope; occurrenceStart?: string; }
  export interface UpdateEventResult { event: EventView; truncated?: EventView | null; relinked?: EventView[]; relinkedPrevious?: EventView[] }
  export interface DeleteEventResult { deleted?: EventView[]; truncated?: EventView | null }
  // useUpdateEvent().mutateAsync(...) → UpdateEventResult
  // useDeleteEvent().mutateAsync(...) → DeleteEventResult
  // components/calendar/ScopeDialog.tsx
  export interface ScopeDialogProps {
    title: string; description: string; note?: string;
    disabled?: RecurringScope[];
    onChoose: (scope: RecurringScope) => void;
    onCancel: () => void;
  }
  export function ScopeDialog(props: ScopeDialogProps): React.ReactElement;
  ```
- Both mutations must skip the optimistic range patch whenever `scope` is present; `useDeleteEvent` keeps today’s optimistic EXDATE patch for `scope: "this"` and removes the series + child rows optimistically for `scope: "all"`.

- [ ] **Step 1: Update the query hooks**

- `EventInputPayload` gains `scope` and `occurrenceStart`.
- `useUpdateEvent`: `mutationFn` returns `UpdateEventResult`; `onMutate` only patches the cache when `scope === undefined`; `onSettled` invalidation unchanged.
- `useDeleteEvent`: return type `DeleteEventResult`; parse JSON for `scope !== "this"` (`204` has no body); optimistic for `all` removes the event and any row whose `recurrenceParentId === id`.
- Existing callers (`EventDialog` update, `CalendarShell` non-recurring move) compile unchanged (`result.event`).

Run: `npm run typecheck`
Expected: exit 0 (or only errors in CalendarShell fixable in the next step).

- [ ] **Step 2: Create `components/calendar/ScopeDialog.tsx`**

Presentational block rendered inside an existing `DialogContent`: title/description paragraphs, then a vertical button stack “This event”, “This and following events”, “All events”, “Cancel”. Disabled scopes use `Button` `disabled` plus `aria-describedby` pointing at the `note` paragraph. Buttons call `onChoose("this" | "following" | "all")`; Cancel calls `onCancel`.

- [ ] **Step 3: Rewire `CalendarShell` drag/resize and delete**

- Replace `pendingDelete` with:
  ```ts
  interface PendingScope {
    kind: "move" | "delete";
    event: EventView;
    occurrenceStart: string;
    move?: { allDay: boolean; startAt: number | null; endAt: number | null; startDate: string | null; endDate: string | null };
  }
  const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
  ```
- `openScope(kind, event, occurrenceStart, move?)`: bump `overlaySeqRef`, clear `selection`/`quickDraft`, set the state. Replaces `requestDeleteFor`’s recurring branch (non-recurring delete keeps the direct mutation).
- `handleEventMove`: build the payload exactly as today; when `base.rrule` → `info.revert(); openScope("move", base, parsed.startKey, payload); return;` instead of the toast. Extra guard: `parseRepeatRule(base.rrule, …)` returning `null`/`advanced` disables `following`/`all` in the dialog (pass `disabled` + note).
- Confirm `move`:
  - `this` → `updateEvent.mutateAsync({ id, scope: "this", occurrenceStart, ...move })`; undo: `deleteEvent.mutateAsync({ id: exception.id, scope: "all" })` then `updateEvent.mutateAsync({ id, scope: undefined, exdates: parseExdates(previous.exdates) })`; toast “Occurrence moved” with undo.
  - `following` → `splitSeries` result; undo: recreate `relinkedPrevious` rows under the old series (or the recreated old series), delete the new segment, restore the old row’s rrule/exdates; toast “Following events moved”.
  - `all` → `updateEvent.mutateAsync({ id, scope: "all", occurrenceStart, ...move })`; undo: plain `updateEvent` with the captured previous timing/rrule/exdates; toast “Series moved”.
- Confirm `delete`:
  - `this` → existing `confirmSeriesDelete("this")` (204); undo restores EXDATE (existing).
  - `following` → `deleteEvent.mutateAsync({ id, scope: "following", occurrenceStart })`; undo recreates `deleted` rows parent-first then restores the old row; toast “Following events deleted”.
  - `all` → `deleteEvent.mutateAsync({ id, scope: "all" })`; undo recreates `deleted` rows parent-first (uses `eventToPayload` + new link fields); toast “Series deleted”.
- Add a small local helper `recreateDeleted(rows)` used by the delete undos: sorts rows parent-first, creates parents with the link omitted and children with `recurrenceParentId` remapped from the old ids to the new ones. Extend `eventToPayload` to carry `recurrenceParentId`/`recurrenceId` (it currently omits them) so undo can recreate exceptions under their series.
- Render the chooser in place of the old `pendingDelete` dialog:
  ```tsx
  {pendingScope ? (
    <Dialog open onOpenChange={(open) => (open ? undefined : setPendingScope(null))}>
      <DialogContent title={pendingScope.kind === "move" ? "Move repeating event" : "Delete repeating event"}>
        <ScopeDialog
          title={pendingScope.kind === "move" ? "Change repeating event" : "Delete repeating event"}
          description={pendingScope.kind === "move"
            ? "This event repeats. Change only this event, this and following events, or all events in the series?"
            : "This event repeats. Delete only this event, this and following events, or all events in the series?"}
          disabled={unparseableRrule ? ["following", "all"] : []}
          note={unparseableRrule ? "This series uses a custom repeat rule; only this event can be changed here." : undefined}
          onChoose={confirmScope}
          onCancel={() => setPendingScope(null)}
        />
      </DialogContent>
    </Dialog>
  ) : null}
  ```

- [ ] **Step 4: Verify the client builds and the existing calendar suites still pass**

Run: `npm run typecheck && npx playwright test tests/e2e/events.spec.ts tests/e2e/undo.spec.ts --reporter=list`
Expected: PASS (stop any `npm run dev` first; Playwright seeds and serves `:3100`). The existing “skipping one occurrence” test now clicks the middle option? No — it clicks “This event”, which still exists; keep the button name exactly “This event”.

- [ ] **Step 5: Commit**

```bash
git add lib/query/events.ts components/calendar/ScopeDialog.tsx components/calendar/CalendarShell.tsx
git commit -m "feat(calendar): ask this/following/all scope on repeating drags and deletes"
```

---

### Task 4: Edit-form scope prompt and clicked-occurrence seeding

**Files:**
- Modify: `components/calendar/EventDialog.tsx`
- Modify: `components/calendar/CalendarShell.tsx`

**Interfaces:**
- Consumes Task 3’s `ScopeDialog` and query results.
- Produces: `EventDialog` prop `onSaveRequest?: (payload: EventInputPayload, meta: { repeatTouched: boolean }) => void`. When provided and `mode === "edit"`, `submit()` calls it instead of `updateEvent.mutate`. Without it, today’s behaviour remains.

- [ ] **Step 1: Seed the dialog from the clicked occurrence**

In `CalendarShell`, replace `seriesStartWall`/`seriesEndWall` usage in `openEdit` with an occurrence-aware helper:
```ts
function occurrenceStartWall(event: EventView, occurrenceStart: string, timezone: string): string
```
- all-day series: `${occurrenceStart.slice(0, 10)}T09:00`, end wall = start date + `daysBetween(event.startDate, event.endDate)` days at `T10:00`;
- timed: `utcToLocalWallTime(Date.parse(occurrenceStart), timezone)` split into start; end = start + `(event.endAt - event.startAt)` ms.
`openEdit(event, occurrenceStart)` passes it as `initial.start`/`initial.end`. Update the three call sites: details popover Edit (`selection.occurrenceStart`), keyboard Edit (focused/bubbled occurrence), and keep `openDuplicate` on the series start.

- [ ] **Step 2: Route edit saves through the shell**

- `EventDialog`: accept `onSaveRequest`; in `submit()` for `mode === "edit" && initial.event` call `onSaveRequest?.(buildPayload(), { repeatTouched })` when provided (return early), else today’s `updateEvent.mutate`.
- `CalendarShell`: add
  ```ts
  const [pendingEdit, setPendingEdit] = useState<{
    event: EventView; occurrenceStart: string;
    payload: EventInputPayload; repeatTouched: boolean;
  } | null>(null);
  ```
  `onSaveRequest` for a non-repeating event → plain `updateEvent` + close (today’s behaviour). For a repeating event → `setPendingEdit(...)`; keep the form mounted under `hidden` as the discard prompt already does; render `<ScopeDialog>` in its place with `disabled={pendingEdit.repeatTouched ? ["this"] : []}` and note “Changing the repeat applies to the series.” plus the advanced-rule note/disabled scopes.
- Choose scope → call `updateEvent.mutateAsync({ id, scope, occurrenceStart, ...payload })`:
  - `this` → creates the exception; on success close the dialog and push undo (delete exception + restore EXDATE).
  - `following` → `splitSeries`; on success close and push undo (recreate `relinkedPrevious` under the old/recreated series, delete the new segment, restore the old row).
  - `all` → series edit; on success close and push undo (PATCH the captured previous payload back).
  - On error: toast, clear `pendingEdit`, and show the form again (edits intact).
- Remove the “This event repeats. Saving changes every occurrence in the series.” notice from `EventDialog` (the chooser replaces it) and delete the now-unused `initialRule`-only notice path if it becomes unreachable.

- [ ] **Step 3: Verify types and run the calendar E2E suites**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx playwright test tests/e2e/events.spec.ts tests/e2e/details.spec.ts tests/e2e/undo.spec.ts --reporter=list`
Expected: PASS. Existing edit flows on non-repeating events are unchanged; repeating-event edits now end with the chooser — the `details.spec.ts` edit test must pick `All events` if it edits a recurring fixture (check the spec and add the click).

- [ ] **Step 4: Commit**

```bash
git add components/calendar/EventDialog.tsx components/calendar/CalendarShell.tsx
git commit -m "feat(calendar): offer this/following/all scopes when saving a repeating event"
```

---

### Task 5: E2E coverage, docs and full verification

**Files:**
- Create: `tests/e2e/recurring-scope.spec.ts`
- Modify: docs per the list below.
- Modify: `docs/DEBUGGING.md`, `docs/COMPONENTS/*`, `README.md` only if the feature list mentions recurrence scopes.

**Interfaces:** none new.

- [ ] **Step 1: Write `tests/e2e/recurring-scope.spec.ts`**

Use `signIn(page, ANDREW, fixtures.password)` and create the series through the UI (toolbar → New event → title → Repeat weekly → Save) so the spec does not depend on seed dates. Helpers: `storedEvents(page)` = `GET /api/events?from=…` returning `EventView[]`.
Tests:
1. `"moves this occurrence only"` — create weekly event; drag an occurrence block to another day cell; chooser appears; click “This event”; `expect.poll(storedEvents)` finds the series with the dragged key in `exdates` and an exception row with `recurrenceParentId === series.id`; the block is visible on the new day after reload and only once.
2. `"cancelling a drop snaps the occurrence back"` — drag, click Cancel; series `exdates` empty and no exception row.
3. `"moves the whole series"` — drag; choose “All events”; series `startAt`/`startDate` shifted by one day and `exdates` unchanged; reload shows the original slot empty.
4. `"editing this and following splits the series"` — click an occurrence → Edit; change Title; Save; choose “This and following events”; two stored rows: old title row truncated, new title row starting at the clicked occurrence.
5. `"deleting this and following leaves the earlier occurrences"` — create a weekly series, delete an occurrence with the middle option; stored rows lose the later occurrences; earlier blocks remain.
6. `"an already-moved occurrence is an ordinary event"` — move one occurrence with “This event”, then drag that same block again; no chooser appears; stored row count unchanged.
7. `"a custom repeat rule only offers this event"` — create a series through the API with `rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=9"`, reload, drag an occurrence; the chooser shows “All events” and “This and following events” disabled and “This event” works.
8. `"undo restores a following move"` — drag with “This and following events”, then click the toast Undo; `expect.poll(storedEvents)` shows one series again (same `rrule` and EXDATEs as before the drag).

Run: `npx playwright test tests/e2e/recurring-scope.spec.ts --reporter=list`
Expected: PASS. Fix selectors: use `getByRole("button", { name: "This event", exact: true })`, avoid matching “This and following events”; use the existing `dragTo` pattern from `tests/e2e/events.spec.ts`.

- [ ] **Step 2: Update the docs (definition of done)**

- `docs/COMPONENTS/lib-domain.md`: new `### lib/recurrence/scopes.ts` section; update `### lib/recurrence/expand.ts` and `### lib/recurrence/rule.ts` “Depends on / Used by” to mention splitting/shifting consumers.
- `docs/COMPONENTS/lib-services.md`: `### lib/services/events.ts` — new functions, transaction boundaries, cascade/relink/propagation rules, delete return shape.
- `docs/COMPONENTS/lib-data.md`: `### lib/db/schema.ts` — new columns + index; `### lib/query/events.ts` — scope payload, result types, no optimistic scope patches, series-delete response.
- `docs/COMPONENTS/app-routes.md` and `### lib/api/handlers/events.ts` in `api-layer.md`: PATCH/DELETE scope contracts and status codes (DELETE all/following = 200 `{deleted,…}`, this = 204); POST link fields.
- `docs/COMPONENTS/components-calendar.md`: `### components/calendar/CalendarShell.tsx` drag/resize/delete scopes + undo; `### components/calendar/EventDialog.tsx` clicked-occurrence seeding + save chooser; new `### components/calendar/ScopeDialog.tsx`; remove the old “drag on recurring snaps back -> intentional” debugging line.
- `docs/COMPONENTS/scripts-and-ops.md`: migration row for `0005` (columns and index).
- `docs/COMPONENTS/tests.md`: row for `tests/unit/recurrence-scopes.test.ts` and `tests/e2e/recurring-scope.spec.ts`; extend the integration row.
- `docs/DEBUGGING.md`: replace the “v0.1.0 edits a recurring event as a series” bullet; update the recurring trap table rows (drag snap-back row, add: exception not appearing → EXDATE/recurrence key shape; split leaves only one segment → COUNT/UNTIL truncation; cascade/undo row; advanced-rule disabled row). Add the clicked-occurrence edit seeding trap.
- `README.md`: if it lists “whole-series editing” for recurring events, update that sentence.

- [ ] **Step 3: Run the docs gate and fix every reported heading**

Run: `npm run docs:check`
Expected: exit 0. If it prints `add ### <path> → <doc>`, copy the heading into the named doc with the template section.

- [ ] **Step 4: Full verification**

Run, in order:
1. `npm run lint`
2. `npm run typecheck`
3. `npm run docs:check`
4. `npm test` (Vitest unit + integration, in-memory SQLite) — expect all suites pass, including the new ones.
5. `npx playwright test tests/e2e/events.spec.ts tests/e2e/recurring-scope.spec.ts tests/e2e/undo.spec.ts tests/e2e/details.spec.ts --reporter=list` — then `npm run test:e2e` if time allows (full suite is the pre-merge gate, not the edit loop).
Expected: all green; if a test fails, fix the code or the test evidence in the same task, never weaken an assertion to make it pass.

- [ ] **Step 5: Commit the tests and docs**

```bash
git add tests/e2e/recurring-scope.spec.ts docs README.md
git commit -m "test(calendar): cover recurring edit scopes end to end and update docs"
```

- [ ] **Step 6: Whole-branch review**

Run: `git log --oneline main..HEAD` and `git diff --stat main...HEAD`; dispatch one fresh reviewer subagent with the spec path, the diff instruction and the verification commands; address findings before the final answer.
