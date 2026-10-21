# Google Calendar ICS Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the household bring its existing Google Calendar history into Nailong Planner from exported `.ics` files: upload → preview → map calendars → transactional commit → undoable batch.

**Architecture:** Server-side only. `ical.js` parses the files into a normalised event list (`lib/import/ics.ts`); `lib/services/import.ts` turns that list into a preview (counts + warnings, no writes), a transactional commit (creates `From Google` calendars, inserts/updates events idempotently by external key, records an `import_batch` + `import_change` ledger), and a rollback that reverses that batch. Three API routes wrap the service; one Settings page (`/settings/import`) drives the wizard. The importer stores each series' source timezone in `event.tzid` and the recurrence engine is fixed first to expand in local wall time, so an imported series does not shift by an hour after a DST transition.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4 (Canvas tokens), Drizzle + SQLite (`better-sqlite3`), TanStack Query 5, sonner, Vitest, Playwright, `ical.js` 2.2.1 (exact pin).

**Spec:** [`docs/superpowers/specs/2026-10-21-calendar-ux-parity-design.md`](../specs/2026-10-21-calendar-ux-parity-design.md) — read §3.3 items 11–12 and §6 decisions **D7** (no two-way sync), **D13** (dependency policy), **D14** (no Google Cloud project / no OAuth), **D16** (fix series timezones before import), then §8.1 (v0.2.0) items 0, 2 and 6, §8.3 ordering, and §10 risks **R4** (ICS corruption) and **R13** (import before timezone fix).

## Scope

In this pass: the **one-time ICS import wizard only**. Explicitly **out** (still v0.2.0 follow-ups, do not build them):

- read-only ICS subscriptions (secret iCal URL),
- the ICS export feed (`/api/feed/<token>.ics`),
- reminders, trash bins, any Google API/OAuth code.

Multi-file upload replaces the spec's "Takeout `.zip`": users unzip a Takeout export once and select every `.ics` in the picker. This avoids a zip dependency (D13) and loses nothing.

## Global Constraints

- **No OAuth, no Google API, no Google Cloud project** (D7, D14). The only credential is an exported file the user hands us.
- **Exactly one new runtime dependency: `ical.js@2.2.1`, pinned exact** (D13). Nothing else — no zip library, no date library (`temporal-polyfill` is already installed but the parser and expansion use `Intl`-based `lib/time/zone.ts` helpers; do not mix in Temporal).
- **Import is idempotent** by `external_key = sha256("ics|" + UID + "|" + (RECURRENCE-ID ?? ""))`. Re-importing the same file must create zero rows; changed content updates the existing row.
- **Preview never writes.** Commit is a single SQLite transaction. Rollback is a single transaction and refuses an already-rolled-back batch.
- **Never guess a time.** An event with an unknown `TZID` is skipped and reported in `warnings`; unsupported parts (VALARM, ATTENDEE, ATTACH) are dropped and counted. A wrong time is worse than a missing event (R4).
- **Uploads are held in memory only** (never written to disk), capped at 5 MB per request, 50 000 events per batch.
- **The docs ship with the code** (`AGENTS.md` §3): every new file gets its `###` section; behaviour changes update the owning doc; `npm run docs:check` is part of every task's definition of done.
- **Frozen contracts:** `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/design-tokens.spec.ts` and `tests/e2e/calendar-style.spec.ts` must keep passing unchanged; existing accessible names stay unless a step says otherwise. `npm run lint`, `npm run typecheck`, `npm test` pass before every commit.
- **Commits:** conventional commits, one per task, e.g. `feat(import): …`. Branch `feat/google-calendar-import` off the current HEAD. Do not commit `.env.local`, `data/`, or any real household export.
- **Node 22+**, `.venv` is for another repo — use `npm`/`npx` here.

## Review Focus

Failure modes the spec implies and the tasks below must pin with tests, most likely to bite first:

1. **A DST-zone weekly series imported from Google must keep its wall-clock time.** A London 09:00 series must read 09:00 in July, not 10:00. → Tasks 2, 3, 4, 9.
2. **All-day multi-day events must not gain a day.** Google writes `DTEND` exclusive; an 5–6 Nov break must import as 5–6, not 5–7. → Task 3.
3. **A moved single occurrence must appear once, at the moved time.** Google exports an override as a second `VEVENT` with `RECURRENCE-ID`; the original slot must be excluded and the new time inserted exactly once. → Tasks 3, 4.
4. **Re-import must not duplicate.** Importing the same file twice, and importing after the file changed, must update in place. → Task 4.
5. **Undo must restore the pre-import state and must not destroy later edits.** Events the user edited after the import are skipped and reported, not clobbered. → Task 5.
6. **Unknown timezones and unsupported constructs must skip + report, never silently shift.** → Tasks 3, 4, 9.
7. **An import into a view-only calendar must be refused server-side**, like every other write. → Tasks 4, 6.

---

## File map (new files marked **new**)

| Area | Files |
|---|---|
| Schema | `lib/db/schema.ts`, `drizzle/0003_import.sql` **new** (+ `drizzle/meta/*`), `lib/services/events.ts`, `lib/query/events.ts`, `tests/unit/recurrence.test.ts`, `tests/integration/import-schema.test.ts` **new** |
| Recurrence fix | `lib/recurrence/expand.ts`, `lib/time/zone.ts` (only if a helper is added there), `tests/unit/recurrence.test.ts`, `docs/COMPONENTS/lib-domain.md`, `docs/DEBUGGING.md` |
| Parser | `package.json`, `package-lock.json`, `lib/import/ics.ts` **new**, `tests/unit/ics-parse.test.ts` **new**, `tests/fixtures/ics/*.ics` **new**, `docs/COMPONENTS/lib-domain.md` |
| Import service | `lib/services/import.ts` **new**, `tests/integration/import-service.test.ts` **new**, `docs/COMPONENTS/lib-services.md` |
| API | `lib/api/handlers/import.ts` **new**, `app/api/import/preview/route.ts` **new**, `app/api/import/commit/route.ts` **new**, `app/api/import/batches/route.ts` **new**, `app/api/import/batches/[id]/rollback/route.ts` **new**, `tests/integration/import-api.test.ts` **new**, `docs/COMPONENTS/api-layer.md`, `docs/COMPONENTS/app-routes.md` |
| UI | `app/(app)/settings/import/page.tsx` **new**, `components/import/ImportWizard.tsx` **new**, `components/import/ImportBatchesCard.tsx` **new**, `components/settings/SettingsForm.tsx`, `docs/COMPONENTS/components-settings-ui.md`, `docs/COMPONENTS/app-routes.md` |
| E2E + docs | `tests/e2e/import.spec.ts` **new**, `tests/fixtures/ics/google-sample.ics` **new**, `tests/fixtures/zip` (none — never add a zip), `docs/COMPONENTS/tests.md`, `README.md`, `CHANGELOG.md`, `docs/OPERATIONS.md`, `docs/DEBUGGING.md` |

---

### Task 0: Clean the working tree and branch

The checkout has an unfinished but coherent prior change (overlay sequencing for search deep links) plus Next-generated type tweaks. Land it separately so the import work starts from a clean tree.

**Files:**
- Modify (already dirty): `components/calendar/CalendarShell.tsx`, `tests/e2e/quick-create.spec.ts`, `tests/e2e/search.spec.ts`, `docs/COMPONENTS/components-calendar.md`, `docs/COMPONENTS/tests.md`, `docs/DEBUGGING.md`
- Generated: `next-env.d.ts`, `tsconfig.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean tree, branch `feat/google-calendar-import`.

- [ ] **Step 1: Run the two affected e2e specs**

Run: `npx playwright test tests/e2e/quick-create.spec.ts tests/e2e/search.spec.ts`
Expected: all pass. (Playwright seeds `.playwright/test.db` and serves `:3100` itself.)

- [ ] **Step 2: Commit the overlay fix**

```bash
git add components/calendar/CalendarShell.tsx tests/e2e/quick-create.spec.ts tests/e2e/search.spec.ts docs/COMPONENTS/components-calendar.md docs/COMPONENTS/tests.md docs/DEBUGGING.md
git commit -m "fix(calendar): one overlay at a time for deep links and quick create"
```

- [ ] **Step 3: Commit the generated type references separately**

Read the `next-env.d.ts` / `tsconfig.json` diff first; if it is only Next's generated reference/include change:

```bash
git add next-env.d.ts tsconfig.json
git commit -m "chore: sync Next-generated type references"
```

If a diff is not generated boilerplate, stop and report it instead of committing.

- [ ] **Step 4: Branch**

```bash
git switch -c feat/google-calendar-import
git status --short
```

Expected: no modified files.

---

### Task 1: Import schema and external event identity

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0003_import.sql` (produced by `npm run db:generate`; rename the generated file to `0003_import.sql` only if the generator's name is unhelpful — the journal entry must keep matching)
- Modify: `lib/services/events.ts` (row literal gains the new null fields), `lib/query/events.ts` (optimistic row literal)
- Modify: `tests/unit/recurrence.test.ts` (row literal), any other `EventRow` literal the compiler flags
- Create: `tests/integration/import-schema.test.ts`
- Modify: `docs/COMPONENTS/lib-data.md`

**Interfaces:**
- Consumes: `lib/db/client.ts` `Database`, `tests/helpers/db.ts` `makeTestDb`.
- Produces:
  ```ts
  // lib/db/schema.ts — new columns on `event`
  tzid: text("tzid"),                                  // IANA zone for timed series; null = household zone
  externalSource: text("external_source"),             // "ics" for imported rows; null = native
  externalUid: text("external_uid"),
  externalRecurrenceId: text("external_recurrence_id"),
  externalKey: text("external_key"),                   // sha256("ics|<uid>|<recurrence-id-or-empty>")
  externalContentHash: text("external_content_hash"),
  // unique index over (household_id, external_key) — SQLite permits many NULLs
  export const importBatch = sqliteTable("import_batch", { id, householdId, createdBy, sourceName, status, mapping, report, createdAt, rolledBackAt });
  export const importChange = sqliteTable("import_change", { id, batchId, eventId, action, beforeJson, createdAt });
  export type ImportBatchRow = typeof importBatch.$inferSelect;
  export type ImportChangeRow = typeof importChange.$inferSelect;
  ```
  `import_batch.status` is `"committed" | "rolled_back"` (TEXT, default `"committed"`); `import_change.action` is `"create" | "update"`.
  `import_change.batchId` references `import_batch.id` with `onDelete: "cascade"`; `import_batch.householdId` references `household.id` with cascade.

- [ ] **Step 1: Write the failing schema test**

`tests/integration/import-schema.test.ts`:
```ts
// inserts two events with externalKey "k1" (same household) -> the second throws (UNIQUE)
// inserts two events with externalKey null -> both succeed
// inserts an import_batch + import_change, deletes the batch -> the change row is gone
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/integration/import-schema.test.ts`
Expected: FAIL — `externalKey`/`importBatch` are not exported.

- [ ] **Step 3: Edit the schema and generate the migration**

Add the columns, index and two tables exactly as in **Produces**. Then:

Run: `npm run db:generate`
Expected: a new `drizzle/0003_*.sql` and updated `drizzle/meta/_journal.json` + snapshot. Read the SQL: it must contain `ALTER TABLE event ADD ...` for the six columns, `CREATE UNIQUE INDEX ...event_household_external_key...`, and `CREATE TABLE import_batch` / `import_change`. Keep the generator's `0003_` prefix and journal entry; if two files were produced, fix by regenerating once from a clean schema state rather than hand-editing the journal.

- [ ] **Step 4: Fix every `EventRow` / optimistic-row literal the compiler now rejects**

`lib/services/events.ts` `createEvent` adds `tzid: null, externalSource: null, externalUid: null, externalRecurrenceId: null, externalKey: null, externalContentHash: null`.
`lib/query/events.ts` `optimisticEvent` adds the same six (all `null`).
`tests/unit/recurrence.test.ts` `timedRule` adds them too.

- [ ] **Step 5: Run the schema test and the whole unit suite**

Run: `npx vitest run tests/integration/import-schema.test.ts tests/unit`
Expected: PASS.

- [ ] **Step 6: Update the doc and verify gates**

In `docs/COMPONENTS/lib-data.md`, extend the `### lib/db/schema.ts` section: new `event` columns, the unique index, both tables and their types. Run `npm run docs:check && npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle lib/services/events.ts lib/query/events.ts tests docs/COMPONENTS/lib-data.md
git commit -m "feat(import): external event identity and import batch schema"
```

---

### Task 2: Expand recurring timed series in the event's wall clock (D16, prerequisite)

Today `expandTimed` anchors `DTSTART` in UTC. For any zone with DST that shifts every post-transition occurrence by an hour (spec §3.3 item 11, R13). Import stores the source zone in `event.tzid`; this task makes expansion honour it.

**Files:**
- Modify: `lib/recurrence/expand.ts`
- Modify: `tests/unit/recurrence.test.ts`
- Modify: `docs/COMPONENTS/lib-domain.md`, `docs/DEBUGGING.md`

**Interfaces:**
- Consumes: `event.tzid` from Task 1; `utcToLocalWallTime`, `localWallTimeToUtc` from `lib/time/zone.ts`.
- Produces: unchanged public signature
  ```ts
  export function expandOccurrences(event: EventRow, range: OccurrenceRange, timezone: string): Occurrence[];
  ```
  Behaviour: for timed series the anchor zone is `event.tzid ?? timezone`. Each occurrence is produced by expanding **floating wall-clock** timestamps and then converting each one to a UTC instant in that zone; `startAt`/`startKey` remain UTC-based. All-day series are unchanged.

- [ ] **Step 1: Write the failing DST tests**

Add to `tests/unit/recurrence.test.ts` (keep every existing test):
```ts
const LONDON = "Europe/London";
it("keeps a weekly 09:00 series at 09:00 wall time across the spring DST change", () => {
  // series starts Tue 2027-03-02 09:00 London, FREQ=WEEKLY;BYDAY=TU
  // range 2027-03-01 .. 2027-04-14
  const occurrences = expandOccurrences(series, rangeLondon, LONDON);
  // 2027-03-02/09/16/23 at 09:00Z, then 2027-03-30 and 2027-04-06/13 at 08:00Z
  expect(occurrences.map((o) => new Date(o.startAt!).toISOString())).toEqual([...]);
  // and every one reads 09:00 in London:
  expect(occurrences.map((o) => utcToLocalWallTime(o.startAt!, LONDON).slice(11))).toEqual(Array(7).fill("09:00"));
});
it("keeps a weekly 09:00 series at 09:00 wall time across the autumn DST change", () => {
  // starts Tue 2027-10-05 09:00 London; 2027-10-26 is GMT again (BST ends 2027-10-31)
});
it("anchors EXDATE instants against the event zone, not the household zone", () => {
  // London series with exdates [ISO instant of 2027-03-30T08:00Z] -> that occurrence is skipped
});
it("falls back to the household zone when tzid is null", () => {
  // existing Taipei series with tzid: null behaves exactly as before
});
```

- [ ] **Step 2: Run and see the first two fail**

Run: `npx vitest run tests/unit/recurrence.test.ts`
Expected: FAIL — London occurrences come back at 10:00 local in summer (the current bug).

- [ ] **Step 3: Implement floating expansion in `expandTimed`**

Add private helpers in `lib/recurrence/expand.ts`:
```ts
function wallMsOf(instant: number, zone: string): number;      // Date.UTC(parts of instant in zone)
function stampOf(wallMs: number): string;                      // "YYYYMMDDTHHMMSS" (floating, no Z)
function instantOf(wallMs: number, zone: string): number;      // localWallTimeToUtc("YYYY-MM-DDTHH:MM", zone)
                                                               // on DST-gap AppError: +1h and retry (max 2), per RFC 5545 §3.3.5
```
Algorithm: `zone = event.tzid ?? timezone`; parse the rule with `DTSTART:` taken from `stampOf(wallMsOf(event.startAt, zone))`; call `between` with floating bounds (`wallMsOf(range.from, zone) - duration - DAY_MS` … `wallMsOf(range.to, zone) + DAY_MS`); map each returned `Date` through `Date.UTC(y, m, d, h, min, s)` → `instantOf`; keep the existing `instant >= event.startAt` and exdate filtering. Pass `event.tzid ?? timezone` as the EXDATE conversion zone in `parseExdates` for timed events. Do not change `expandAllDay` or the public signature.

- [ ] **Step 4: Run the recurrence suite**

Run: `npx vitest run tests/unit/recurrence.test.ts tests/unit/toFcEvent.test.ts`
Expected: PASS, including all pre-existing tests unchanged.

- [ ] **Step 5: Document the trap**

`docs/COMPONENTS/lib-domain.md`: update `### lib/recurrence/expand.ts` (zone resolution, floating expansion, gap shift) and `### lib/time/zone.ts` if a helper moved there. `docs/DEBUGGING.md`: add the symptom row `imported/edited recurring event shifts by an hour after a DST change → expansion anchored in UTC or tzid lost → check event.tzid and expandTimed`. Run `npm run docs:check`.

- [ ] **Step 6: Commit**

```bash
git add lib/recurrence/expand.ts tests/unit/recurrence.test.ts docs/COMPONENTS/lib-domain.md docs/DEBUGGING.md
git commit -m "fix(recurrence): expand timed series in the event's wall-clock timezone"
```

---

### Task 3: ICS parser

**Files:**
- Modify: `package.json`, `package-lock.json` (`ical.js@2.2.1`, exact)
- Create: `lib/import/ics.ts`
- Create: `tests/unit/ics-parse.test.ts`
- Create: `tests/fixtures/ics/google-timed.ics`, `google-allday.ics`, `google-recurring.ics`, `google-overrides.ics`, `google-edge.ics`
- Modify: `docs/COMPONENTS/lib-domain.md`

**Interfaces:**
- Consumes: `ical.js`; `localWallTimeToUtc`, `addDaysToDate` from `lib/time/zone.ts`; `node:crypto`.
- Produces:
  ```ts
  // lib/import/ics.ts
  export interface IcsEvent {
    calendarName: string;
    uid: string;
    recurrenceId: string | null;     // date (all-day) or ISO instant of the overridden occurrence
    title: string;
    description: string | null;
    location: string | null;
    allDay: boolean;
    startAt: number | null;          // UTC ms, timed only
    endAt: number | null;
    startDate: string | null;        // inclusive YYYY-MM-DD, all-day only
    endDate: string | null;          // inclusive
    tzid: string | null;             // source IANA zone for timed events; null = household zone/UTC
    rrule: string | null;            // RFC 5545 rule string, e.g. "FREQ=WEEKLY;BYDAY=TU"
    exdates: string[];               // ISO instants (timed) or YYYY-MM-DD (all-day)
    externalKey: string;             // sha256("ics|<uid>|<recurrenceId ?? "">")
    contentHash: string;             // sha256 over the normalised fields above
  }
  export interface IcsWarning { uid: string; title: string; reason: string }
  export interface IcsCalendarSummary {
    name: string; events: number; recurring: number; overrides: number;
    earliest: string | null; latest: string | null; // YYYY-MM-DD
  }
  export interface IcsDropped { alarms: number; attendees: number; attachments: number }
  export interface ParsedIcs {
    calendars: IcsCalendarSummary[];
    events: IcsEvent[];
    warnings: IcsWarning[];
    dropped: IcsDropped;
  }
  export function parseIcs(text: string, householdTimezone: string, fallbackCalendarName?: string): ParsedIcs;
  ```

  Parsing rules (all pinned by the parser tests):
  - Calendar name from `X-WR-CALNAME`, else the fallback name per file (the service passes the file's basename).
  - Timed `DTSTART;TZID=Europe/London` → wall time resolved in that zone, `tzid` stored. `DTSTART:…Z` → instant, `tzid: null`. Floating `DTSTART` (no zone) → resolved in `householdTimezone`, `tzid: null`. Unknown `TZID` (not a known IANA zone) → skip the event, add a warning, never guess.
  - All-day `DTSTART;VALUE=DATE`/`DTEND;VALUE=DATE` are exclusive at the end: `endDate = DTEND - 1 day` (missing `DTEND` = same day). Multi-day ranges keep their real inclusive end.
  - `RRULE` serialised with `ICAL.Recur.toString()`; multiple `EXDATE` properties/values become one list; `RECURRENCE-ID` marks an override.
  - Overrides: group by `UID`; the base (no `RECURRENCE-ID`) keeps the rule and gains the override's `RECURRENCE-ID` value in `exdates`; each override becomes its own `IcsEvent` with `rrule: null` and the `RECURRENCE-ID` in `recurrenceId`.
  - `SUMMARY`/`DESCRIPTION`/`LOCATION` unescaped by `ical.js`; `description`/`location` `null` when empty.
  - `DURATION` used when `DTEND` is absent (timed or all-day).
  - VALARM / ATTENDEE / ATTACH counted into `dropped`, never imported.
  - `X-WR-CALNAME` may appear on a `VCALENDAR` that holds several calendars? It does not in Google exports; one calendar per file.

- [ ] **Step 1: Install the dependency exactly**

Run: `npm install --save-exact ical.js@2.2.1`
If npm fails with `EPERM` on the global npm cache (this sandbox cannot write `%LOCALAPPDATA%\npm-cache`), retry once with a workspace cache and remove it afterwards:
`npm install --save-exact --cache .npm-cache ical.js@2.2.1` then `Remove-Item -Recurse -Force .npm-cache`.
Expected: `package.json` shows `"ical.js": "2.2.1"` and `npm run typecheck` can import it. If `ical.js` ships no types, add `lib/import/ical-js.d.ts` with a minimal `declare module "ical.js"` covering `parse`, `Component`, `Time`, `Recur` — do not add another dependency.

- [ ] **Step 2: Write the parser fixtures and failing tests**

Fixtures are small hand-written copies of Google export structure (CRLF + folded lines + `TZID` parameters). `tests/unit/ics-parse.test.ts` must assert, per fixture:
- timed: title/description (with `\n`, `\,`, `\;` escapes)/location, `startAt`/`endAt` instants, `tzid: "Asia/Taipei"`, calendar name, `dropped.alarms === 1`.
- all-day: two-day event → `startDate: "2026-11-05"`, `endDate: "2026-11-06"`.
- recurring: `rrule === "FREQ=WEEKLY;BYDAY=TU"`, `exdates` length 1, series `externalKey` equals the sha256 of `ics|uid|`.
- overrides: 2 parsed events for one UID; the series excludes the overridden instant; the override has `rrule: null`, `recurrenceId` set, distinct `externalKey`.
- edge: unknown `TZID` → event skipped + warning; `ATTENDEE` counted; floating time resolved with the household zone; a 90-minute `DURATION` event gets `endAt - startAt = 90 min`.

- [ ] **Step 3: Run and see them fail**

Run: `npx vitest run tests/unit/ics-parse.test.ts`
Expected: FAIL — `@/lib/import/ics` does not exist.

- [ ] **Step 4: Implement `parseIcs`**

Use `ICAL.parse(text)` + `new ICAL.Component(jcal)`, `getAllSubcomponents("vevent")`, `getFirstPropertyValue`, `ICAL.Time.toUnixTime()`, `ICAL.Duration.toSeconds()`. Zone validation: `new Intl.DateTimeFormat("en-US", { timeZone: tzid })` inside `try/catch` — an invalid zone throws `RangeError`; treat `"Z"`, `"UTC"`, `"Etc/UTC"` as UTC (`tzid: null`). Wall time → instant with `localWallTimeToUtc`; on a DST-gap `AppError`, shift the wall time +1 h and retry once. Hashes with `createHash("sha256")` from `node:crypto`. Never throw on one bad VEVENT: warn and continue; only throw `AppError("VALIDATION", …)` when the text is not an iCalendar document at all (no `VCALENDAR`).

- [ ] **Step 5: Run the parser tests and the rest of the unit suite**

Run: `npx vitest run tests/unit`
Expected: PASS.

- [ ] **Step 6: Docs + gates**

`docs/COMPONENTS/lib-domain.md`: add the `### lib/import/ics.ts` section (purpose, public API, side effects none, depends on ical.js + zone helpers, debugging: `wrong import time -> TZID/floating handling -> parseIcs`, tests). Run `npm run docs:check && npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/import tests/unit/ics-parse.test.ts tests/fixtures/ics docs/COMPONENTS/lib-domain.md
git commit -m "feat(import): parse Google Calendar ICS exports"
```

---

### Task 4: Preview and transactional commit

**Files:**
- Create: `lib/services/import.ts`
- Create: `tests/integration/import-service.test.ts`
- Modify: `docs/COMPONENTS/lib-services.md`

**Interfaces:**
- Consumes: `parseIcs`; `getCalendarAccess`/`assertCalendarWritable` from `lib/services/calendars.ts`; `HUE_FAMILIES`, `CHILD_SHADE_ORDER`, `MAX_CHILDREN` from `lib/color/palette.ts`; `Database`, `ViewerContext`, `AppError`.
- Produces:
  ```ts
  export const IMPORT_ROOT_NAME = "From Google";
  export interface ImportFile { name: string; text: string }
  export type ImportCalendarMode = { mode: "new" } | { mode: "existing"; calendarId: string };
  export type ImportMapping = Record<string, ImportCalendarMode>; // keyed by source calendar name

  export interface ImportPreviewCalendar {
    name: string; events: number; recurring: number; overrides: number;
    earliest: string | null; latest: string | null;
    createCount: number; updateCount: number; unchangedCount: number;
  }
  export interface ImportPreview {
    calendars: ImportPreviewCalendar[];
    createCount: number; updateCount: number; unchangedCount: number;
    warnings: IcsWarning[]; dropped: IcsDropped;
  }
  export interface ImportReport {
    batchId: string; created: number; updated: number; unchanged: number;
    calendarsCreated: string[]; warnings: IcsWarning[]; dropped: IcsDropped;
  }
  export interface ImportBatchView {
    id: string; sourceName: string; createdAt: number;
    status: "committed" | "rolled_back"; rolledBackAt: number | null;
    created: number; updated: number;
  }
  export function previewImport(db: Database, ctx: ViewerContext, files: ImportFile[]): ImportPreview;
  export function commitImport(db: Database, ctx: ViewerContext, input: { files: ImportFile[]; mapping: ImportMapping }): ImportReport;
  ```

  Rules:
  - `validateFiles`: 1–20 files, each text non-empty, total ≤ 5 MB, parsed events ≤ 50 000; otherwise `AppError("VALIDATION", …)`.
  - Target calendars: `{mode:"new"}` resolves under a top-level `From Google` root, created on first use with the first hue family not already used by a root (`HUE_FAMILIES` order), child shade from the next free `CHILD_SHADE_ORDER` slot (`MAX_CHILDREN` enforced — if the root is full, create `From Google 2`, then 3…). Imported calendars are shared (`ownerId: null`, `isViewOnlyForPartner: 0`).
  - `{mode:"existing"}` must pass `getCalendarAccess` + `assertCalendarWritable` for `ctx`; a missing key in the mapping is a validation error naming the source calendar.
  - Event upsert: match on `(householdId, externalKey)`. New → insert a full `event` row including `tzid`/`external*` columns and `sourceName` in the batch's `mapping`. Existing with `externalContentHash === contentHash` → `unchanged`, no write. Existing with a different hash → update the imported fields only (`title`, `description`, `location`, `allDay`, start/end, `rrule`, `exdates`, `tzid`, `externalContentHash`, `updatedAt`), never `calendarId`? — a re-import into the same mapping **does** move the event if the mapping changed; keep `calendarId` in the update set.
  - One `db.transaction`: all writes or none.
  - Ledger: one `import_batch` row (status `committed`, `mapping`/`report` JSON, `sourceName` = joined file names) and one `import_change` row per inserted/updated event (`create` / `update` with `beforeJson` = JSON of the previous row for updates, `null` for creates).
  - `previewImport` performs the same parse + mapping resolution *without* writes and computes create/update/unchanged counts against the current DB.

- [ ] **Step 1: Write the failing service tests**

`tests/integration/import-service.test.ts` with `makeSeededDb()` and an in-memory ICS string built by a helper (`ics(events: string): string`) — not the fixtures from Task 3, so the tests stay independent:
```ts
it("previews counts without writing anything", ...)        // preview.createCount === 3, event table count 0
it("commits calendars and events in one batch", ...)       // From Google root + child + 3 events; batch status committed; 3 create changes
it("re-importing an unchanged file creates nothing", ...)  // second commit: created 0, unchanged 3, event rows still 3
it("re-importing a changed title updates in place", ...)   // same event id, new title, updated 1, one update change with beforeJson
it("refuses a view-only target calendar", ...)             // 403 AppError, nothing written (owner-b view-only calendar)
it("reports unknown timezones as warnings and imports the rest", ...)
it("rejects oversized uploads", ...)                       // text > 5 MB -> VALIDATION
```
Also assert the stored row: `tzid === "Europe/London"`, `externalKey`/`externalContentHash` set, `startAt` correct.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/integration/import-service.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the service**

Write `lib/services/import.ts` exactly against the **Produces** block. Use `crypto.randomUUID()` for ids. Read events for matching with one `select()` filtered by `inArray(event.externalKey, keys)` inside the household. Sort batch report kept as `{ created, updated, unchanged, calendarsCreated }`. `sourceName` joins file names with `, ` and is capped at 200 chars.

- [ ] **Step 4: Run the service tests**

Run: `npx vitest run tests/integration/import-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Docs + gates**

`docs/COMPONENTS/lib-services.md`: add `### lib/services/import.ts` (Purpose, Public API incl. the types above, State & side effects: `import_batch`/`import_change` writes, transactions, calendar creation, Debugging: `preview says 0 events -> parser dropped them / unknown TZID`, idempotency key, Tests). Run `npm run docs:check && npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add lib/services/import.ts tests/integration/import-service.test.ts docs/COMPONENTS/lib-services.md
git commit -m "feat(import): preview and transactional commit of ICS files"
```

---

### Task 5: Rollback and batch history

**Files:**
- Modify: `lib/services/import.ts`
- Modify: `tests/integration/import-service.test.ts`
- Modify: `docs/COMPONENTS/lib-services.md`

**Interfaces:**
- Consumes: Task 4's ledger and `commitImport`.
- Produces:
  ```ts
  export interface RollbackReport {
    batchId: string; deleted: number; restored: number; skipped: number; calendarsDeleted: string[];
  }
  export function rollbackImportBatch(db: Database, ctx: ViewerContext, batchId: string): RollbackReport;
  export function listImportBatches(db: Database, ctx: ViewerContext): ImportBatchView[];
  ```
  Rules:
  - Unknown / other-household batch → `AppError("NOT_FOUND", "Import batch not found.", 404)`.
  - Already `rolled_back` → `AppError("VALIDATION", "This import has already been undone.", 409)`.
  - `update` changes: restore the `beforeJson` columns, but **skip** when `event.updatedAt > batch.createdAt` (the user edited it after the import) — count as `skipped`.
  - `create` changes: delete the row, but skip (and count) when it was edited after the import or is already gone.
  - After the changes, delete calendars this batch created that are now empty: children first, then the `From Google` root if nothing remains. `calendarsDeleted` lists their names.
  - One transaction; set `status = "rolled_back"`, `rolledBackAt = Date.now()`.

- [ ] **Step 1: Write the failing rollback tests**

Extend `tests/integration/import-service.test.ts`:
```ts
it("rolls a batch back to the pre-import state", ...)      // events gone, batch rolled_back, calendarsDeleted includes the created child
it("refuses to roll back twice", ...)                      // second call 409
it("skips events edited after the import and says so", ...) // edit one imported event, roll back -> skipped 1, that event keeps the edit
it("lists batches newest first with counts", ...)
it("cannot roll back another household's batch", ...)      // 404
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/integration/import-service.test.ts`
Expected: FAIL — `rollbackImportBatch` is not exported.

- [ ] **Step 3: Implement rollback + history**

Add the two functions to `lib/services/import.ts` as specified. Restore only columns present in `beforeJson`; never restore `id`/`householdId`. Use `db.transaction`.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run tests/integration/import-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Docs + gates + commit**

Update the same `lib-services.md` section (rollback semantics, skip rule). Run `npm run docs:check && npm run typecheck && npm run lint`, then:

```bash
git add lib/services/import.ts tests/integration/import-service.test.ts docs/COMPONENTS/lib-services.md
git commit -m "feat(import): undoable import batches"
```

---

### Task 6: API routes

**Files:**
- Create: `lib/api/handlers/import.ts`
- Create: `app/api/import/preview/route.ts`, `app/api/import/commit/route.ts`, `app/api/import/batches/route.ts`, `app/api/import/batches/[id]/rollback/route.ts`
- Create: `tests/integration/import-api.test.ts`
- Modify: `docs/COMPONENTS/api-layer.md`, `docs/COMPONENTS/app-routes.md`

**Interfaces:**
- Consumes: `guarded`, `readJson` from `lib/api/handlers/support.ts`; service functions from Tasks 4–5; `withViewer` from `lib/api/route.ts`.
- Produces:
  ```ts
  // lib/api/handlers/import.ts
  export const previewImportHandler: (db, ctx, request) => Promise<Response>;   // 200 { preview }
  export const commitImportHandler: (db, ctx, request) => Promise<Response>;    // 201 { report }
  export const listImportBatchesHandler: (db, ctx, request) => Response;        // 200 { batches }
  export const rollbackImportBatchHandler: (db, ctx, id, request) => Promise<Response>; // 200 { rollback }
  ```
  Request contract (multipart/form-data):
  - `files`: one or more uploaded `.ics` files (`formData().getAll("files")`), field name exactly `files`.
  - `mapping`: JSON string, only for commit, validated with the service (bad JSON → `VALIDATION` 400).
  Routes follow `app/api/events/route.ts`: `export const dynamic = "force-dynamic";` plus `withViewer(...)`.

- [ ] **Step 1: Write the failing API tests**

`tests/integration/import-api.test.ts` calls the handlers directly with `new Request(url, { method: "POST", body: formData })`:
```ts
it("previews multipart uploads", ...)                    // 200, preview.createCount === n, DB still empty
it("commits and returns the batch report", ...)          // 201, report.batchId set
it("returns 400 for a missing mapping", ...)
it("returns 400 for malformed mapping JSON", ...)
it("lists batches and rolls one back", ...)              // GET 200, POST rollback 200, second rollback 409
it("returns 404 for an unknown batch", ...)
it("rejects an unauthenticated request", ...)            // handler without ctx impossible; assert `withViewer` route? see below
```
For auth, route-level tests are not possible without a session; instead assert `viewerFromRequest` is not bypassed by checking the handler signature requires `ctx` (compile-time) and that `withViewer` wraps every route (read the four route files in the test via `readFileSync`). Keep that one assertion cheap.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/integration/import-api.test.ts`
Expected: FAIL — handler module missing.

- [ ] **Step 3: Implement handlers and routes**

Handlers: parse `await request.formData()` in a `try/catch` (`NEW: "Send the export as multipart/form-data."`), read files with `file.text()`, name from `file.name`, enforce the service's size cap, call the service, return JSON. Follow `fieldErrors` for validation envelopes.

- [ ] **Step 4: Run the API tests**

Run: `npx vitest run tests/integration/import-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Docs + gates + commit**

`docs/COMPONENTS/api-layer.md`: add `### lib/api/handlers/import.ts`. `docs/COMPONENTS/app-routes.md`: add all four route sections (`### app/api/import/preview/route.ts`, …) with methods, bodies, status codes. Run `npm run docs:check && npm run typecheck && npm run lint`, then:

```bash
git add lib/api/handlers/import.ts app/api/import tests/integration/import-api.test.ts docs/COMPONENTS/api-layer.md docs/COMPONENTS/app-routes.md
git commit -m "feat(import): preview, commit and rollback API routes"
```

---

### Task 7: Import page and wizard — upload + preview

**Files:**
- Create: `app/(app)/settings/import/page.tsx`
- Create: `components/import/ImportWizard.tsx`
- Modify: `components/settings/SettingsForm.tsx` (a card linking to `/settings/import`)
- Modify: `docs/COMPONENTS/app-routes.md`, `docs/COMPONENTS/components-settings-ui.md`

**Interfaces:**
- Consumes: `getAuth`/`getDb`/`member` guard pattern from `app/(app)/settings/page.tsx`; `Button` from `components/ui/button.tsx`; Canvas card recipes copied from `SettingsForm.tsx` (`FIELD`, `LABEL`, `CARD`, `CARD_HEADING` — copied, as that file does, not imported).
- Produces: `export function ImportWizard(): JSX.Element` (client component, no props). Step union `"upload" | "preview" | "mapping" | "report"`.
  - Step 1 — upload: `h1` "Import from Google Calendar", explanatory copy (Google Calendar → Settings → Import & export → Export, or Takeout; unzip first; back up first), `<input type="file" accept=".ics,text/calendar" multiple aria-label="Google Calendar files">`, button "Continue".
  - On Continue: build `FormData` with every file under `files`, POST `/api/import/preview`, keep the `File[]` in state for commit, move to preview.
  - Step 2 — preview: table of source calendars with columns *Calendar, Events, Range, Repeating, Create, Update, Unchanged*; a warnings list (`role="status"`); a dropped-parts line; buttons "Back" and "Continue".

- [ ] **Step 1: Add the settings card**

In `SettingsForm.tsx`, after `<CalendarPreferencesCard …/>`, add a card (same `CARD`/`CARD_HEADING` classes) titled "Google Calendar import" with one sentence and a `<Link href="/settings/import">` labelled "Open the importer" styled as a bordered button (`inline-flex h-[38px] items-center rounded-md border border-line-strong bg-well px-3 text-ink hover:bg-line`).

- [ ] **Step 2: Build the page and wizard skeleton**

`app/(app)/settings/import/page.tsx` mirrors the settings page guard (session → membership → redirect `/login`), renders the back link ("Back to settings"), `<h1>Import from Google Calendar</h1>`, `<ImportWizard />` inside `mx-auto max-w-3xl`.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev` (if not already running), open `http://localhost:3000/settings`, click the card, upload `tests/fixtures/ics/google-timed.ics` (Task 3 fixture), confirm the preview table and counts render. Stop and report any console error.

- [ ] **Step 4: Gates + docs + commit**

`docs/COMPONENTS/app-routes.md` gets `### app/(app)/settings/import/page.tsx` and `docs/COMPONENTS/components-settings-ui.md` gets `### components/import/ImportWizard.tsx` + `### components/settings/SettingsForm.tsx` update (new card). Run `npm run docs:check && npm run typecheck && npm run lint`, then:

```bash
git add "app/(app)/settings/import" components/import components/settings/SettingsForm.tsx docs/COMPONENTS
git commit -m "feat(import): settings entry point and upload/preview wizard"
```

---

### Task 8: Wizard — mapping, commit report, undo, history

**Files:**
- Modify: `components/import/ImportWizard.tsx`
- Create: `components/import/ImportBatchesCard.tsx`
- Modify: `app/(app)/settings/import/page.tsx` (render the history card under the wizard)
- Modify: `docs/COMPONENTS/components-settings-ui.md`

**Interfaces:**
- Consumes: `useCalendars()` from `lib/query/calendars.ts`; `useQueryClient()`; `toast` from sonner; `Button`.
- Produces:
  - Step 3 — mapping: one row per source calendar; a `<select aria-label={`Import target for ${name}`}>` with options `Create a new calendar under "From Google"` (value `new`) and each writable calendar (`existing:<id>`); default `new`; button "Import N events" (disabled while submitting), "Back".
  - Commit: POST `/api/import/commit` with the same files + `mapping` JSON; on success move to report and invalidate `["events"]`, `["calendars"]`.
  - Step 4 — report: created/updated/unchanged counts, created calendars, warnings; buttons "Go to calendar" (link `/`) and "Undo this import" (POST `/api/import/batches/<id>/rollback`, then toast "Import undone", refresh history).
  - `ImportBatchesCard`: fetches `/api/import/batches`, renders a table (When, Source, Created, Updated, Status) with an "Undo" button on committed rows; heading "Past imports"; empty state "No imports yet."

- [ ] **Step 1: Implement mapping with writable calendars**

Fold root + child access like `CalendarPreferencesCard.tsx` does (`canWriteCalendar` over root and children) so view-only targets are never offered. Selection state: `Record<string, {mode:"new"} | {mode:"existing"; calendarId:string}>` keyed by source calendar name.

- [ ] **Step 2: Implement commit, report, undo and history**

As specified above. Errors: `toast.error(payload.error.message)`; never leave the wizard stuck in a submitting state.

- [ ] **Step 3: Verify by hand**

With `npm run dev`: import the fixture, map one calendar to an existing writable calendar, commit, confirm report counts, "Go to calendar" shows the events, "Undo this import" removes them and the history row flips to `rolled_back`.

- [ ] **Step 4: Gates + docs + commit**

Update `docs/COMPONENTS/components-settings-ui.md` (`ImportWizard` mapping/commit/undo, `### components/import/ImportBatchesCard.tsx`, settings page section). Run `npm run docs:check && npm run typecheck && npm run lint`, then:

```bash
git add components/import app/\(app\)/settings/import docs/COMPONENTS/components-settings-ui.md
git commit -m "feat(import): map calendars, commit with report, undo imports"
```

---

### Task 9: End-to-end coverage, real-export check, docs sweep

**Files:**
- Create: `tests/e2e/import.spec.ts`
- Create: `tests/fixtures/ics/google-sample.ics`
- Modify: `docs/COMPONENTS/tests.md`, `README.md`, `CHANGELOG.md`, `docs/OPERATIONS.md`, `docs/DEBUGGING.md`

**Interfaces:**
- Consumes: `signIn`, `ANDREW` from `tests/e2e/helpers.ts`; `loadFixtures()` for the password.
- Produces: one spec covering the whole loop with these accessible names: `Open the importer`, `Google Calendar files`, `Continue`, `Import 3 events`, `Undo this import`, `Past imports`.

- [ ] **Step 1: Write the fixture and the failing e2e spec**

`google-sample.ics`: `X-WR-CALNAME:Family`, one timed event "Dentist appointment" on a near-future date (compute from a fixed date that the seeded test DB shows — use the month Playwright lands on), one two-day all-day event, one `FREQ=WEEKLY` series. Spec:
```ts
test("imports a Google export, shows it, and undoes it", async ({ page }) => {
  // sign in, go to /settings and click "Open the importer"
  // setInputFiles([fixture]) -> Continue -> expect table row "Family" and "3 events"
  // Continue -> expect "Import 3 events" -> click -> expect "Import complete"
  // "Go to calendar" -> expect "Dentist appointment" visible
  // back to /settings/import -> "Undo this import" -> expect the event gone after reload
});
```

- [ ] **Step 2: Run it and see it fail (or catch real bugs)**

Run: `npx playwright test tests/e2e/import.spec.ts`
Expected: FAIL before the UI exists; if Tasks 7–8 are complete it should pass on the first or second run. Fix real defects in the owning task, not in the spec.

- [ ] **Step 3: Real-export dry run**

Ask the user to unzip their Google Takeout export and copy the `.ics` files to `.playwright/import/` (gitignored). Then, with the dev server running: open `/settings/import`, upload them, and **stop at the preview**. Report per-calendar counts, date range, recurring count, warnings and dropped parts back to the user, and wait for their go-ahead before committing. Before any commit against real data: `npm run backup` and confirm the backup file exists. Never commit the export itself.

- [ ] **Step 4: Docs sweep**

- `docs/COMPONENTS/tests.md`: rows for `tests/unit/ics-parse.test.ts`, `tests/integration/import-schema.test.ts`, `tests/integration/import-service.test.ts`, `tests/integration/import-api.test.ts`, `tests/e2e/import.spec.ts`.
- `README.md`: add the feature under what it does (import Google Calendar `.ics` exports, preview, undo) and remove ICS import from the "not yet" list (keep export/subscriptions there).
- `CHANGELOG.md`: under Unreleased → Added: "Google Calendar import — upload exported `.ics` files, preview counts and warnings, map calendars under a *From Google* root, commit transactionally, and undo the whole batch."
- `docs/OPERATIONS.md`: a short "Importing from Google Calendar" recipe (Takeout export → unzip → `/settings/import` → preview → commit; run `npm run backup` first; imports are idempotent, re-running the same export is safe).
- `docs/DEBUGGING.md`: traps for `imported event at the wrong time`, `import duplicated events`, `undo does not remove events`.

- [ ] **Step 5: Gates + commit**

Run: `npm run docs:check && npm run lint && npm run typecheck && npm test && npx playwright test tests/e2e/import.spec.ts tests/e2e/settings.spec.ts tests/e2e/viewport-fit.spec.ts`
Expected: all green.

```bash
git add tests/e2e/import.spec.ts tests/fixtures docs README.md CHANGELOG.md
git commit -m "test(import): end-to-end Google Calendar import coverage"
```

---

### Task 10: Full verification and independent review

**Files:**
- Modify only what the review or a failing gate requires.

- [ ] **Step 1: Full gate run**

Run: `npm run lint && npm run typecheck && npm run docs:check && npm test`
Expected: PASS with zero warnings that were not there before.

- [ ] **Step 2: Apply the migration to the local dev database**

Run: `npm run db:migrate`
Expected: `0003` applies without error. Then `npm run dev` and load `/` and `/settings/import` once; no runtime error in the console.

- [ ] **Step 3: Independent review**

Load the `requesting-code-review` skill and dispatch one fresh read-only reviewer over `git diff main...HEAD` (or the merge base with `feat/v0.1.0` if `main` is behind). Give it the plan path and the review focus; it must run the tests itself and report file:line evidence. Address findings, or record why each is not actionable.

- [ ] **Step 4: Commit any review fixes and report**

Conventional commit per fix, then report to the user: what shipped, what was deliberately deferred (subscriptions, export feed, OAuth), the real-export preview results and the exact command to finish the migration when they choose to commit their data.

---

## Self-review

- **Spec coverage:** §8.1 item 2 (import wizard: upload, preview, map, dry-run counts, transactional commit, report, undo batch) → Tasks 3–9. Item 0 and D16/R13 (timezone fix first) → Task 2. Item 6, import subset only (external identity columns, `import_batch`/`import_change`) → Task 1. R4 mitigations (preview/dry run, report, refuse unknown TZID, round-trip-style parser tests) → Tasks 3, 4, 9. D13 dependency pin → Task 3. D7/D14 no OAuth → Global Constraints. Deferred items named in **Scope**.
- **Deliberate deviations from the spec, documented:** `.zip` upload replaced by multi-file `.ics` (no new dependency); subscriptions and export feed deferred; overrides materialised as standalone rows with an excluded series occurrence (spec wording: "overrides materialised").
- **Type consistency:** `IcsEvent`/`ParsedIcs` (Task 3) → `ImportPreview`/`ImportReport`/`ImportMapping` (Task 4) → handler response shapes (Task 6) → wizard state (Tasks 7–8). `ImportBatchView` is shared by the history UI and the handler.
- **Review Focus coverage:** items 1–7 map to tests in Tasks 2, 3, 4, 5 and the e2e in Task 9.
