# Services layer

`lib/services/*` is where the product's rules live: every function takes a `Database` (Drizzle over better-sqlite3) plus either a `ViewerContext` or explicit ids, reads and writes the household's rows, and throws `AppError` for anything the caller must handle. Read `## Business rules enforced here` before changing behaviour, then jump to the file section for signatures, tables and failure modes.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, update its section and run `npm run docs:check`.

| File | Role |
|---|---|
| lib/services/calendars.ts | Calendar tree reads, two-level nesting, shade assignment, effective permissions, colour resolution |
| lib/services/events.ts | Event CRUD, range queries, RRULE validation, EXDATE mutation, colour attachment |
| lib/services/household.ts | Single-household bootstrap, membership rows, household settings, member display name |
| lib/services/permissions.ts | The one write predicate for calendars and their events |
| lib/services/preferences.ts | Lazy per-user preference row with defaults and enum normalisation |
| lib/services/search.ts | Household-wide LIKE search with ranking and escaping |

## Business rules enforced here

**Household scoping.** Every query that serves a request filters `household_id = ctx.householdId`: `getCalendar`, `listCalendarTree`, `getEvent`, `listEvents`, and `searchEvents`. A row from another household therefore surfaces as `NOT_FOUND` 404, never `FORBIDDEN` 403 — the caller must not be able to probe for ids. Exceptions that take no `ctx` and are provisioning-scoped: `ensureHousehold`, `addMember`, `listMembers`, and the preference functions (keyed by `userId`, not household). `calendars.nextSortOrder` scopes roots by household but children only by `parent_id`, which is safe because the parent was already scoped.

**View-only permission inheritance.** `getCalendarAccess` loads a calendar and folds the root's flags into it: `ownerId = root.ownerId ?? calendar.ownerId` and `isViewOnlyForPartner = Math.max(root.isViewOnlyForPartner, calendar.isViewOnlyForPartner)`. Nesting is capped at two levels — `createCalendar` rejects a parent that itself has a `parentId` — so one fold covers the whole tree. Every calendar write and every event write calls `assertCalendarWritable` -> `canWriteCalendar`:
- not view-only: both household members may write, regardless of owner;
- view-only: only the member whose id equals `ownerId` may write;
- view-only with `ownerId === null`: fails closed, nobody writes (creation refuses this state, so it only appears from hand-edited data).

Only the current owner may toggle `isViewOnlyForPartner` or reassign `ownerId`. A member may claim an ownerless calendar (`ownerId` -> themselves); giving it back to the household (`ownerId: null`) also clears the view-only flag. A child's `ownerId` is copied from the parent at creation; reassigning a root's `ownerId` writes the new owner to every child in the same transaction, and reassigning a child directly is `VALIDATION` 400, so stored rows match the folded `effective.ownerId` (root first). Migration `0004` backfilled trees written before that rule. `canWriteCalendar` deliberately ignores `householdId`: callers must pass a row they already fetched with household scoping. Household settings (`updateHousehold`) and preferences (`updatePreferences`) have no ownership check — either member may patch them.

**Shade assignment.** A root calendar renders at `PARENT_SHADE_INDEX` (3) and stores that value; its `hueFamily` is required and stored on the root only. Children store `hueFamily: null` and `shadeIndex` claimed as the first unused entry of `CHILD_SHADE_ORDER` (`[4, 2, 5, 1, 6, 0, 7]`), giving at most `MAX_CHILDREN` (7) children; the eighth create raises `CONFLICT` 409. Shade choice is computed per request from the current siblings, not enforced by a unique index, and deleting a child frees its shade for the next one. `resolveShade` always resolves colour through the root, so changing the root's `hueFamily` recolours every child with no child row being written; an unknown or missing family falls back to `slate`. Children inherit `ownerId` from the parent (an owner move on the root cascades) and always start with `isViewOnlyForPartner: 0`; `updateCalendar` refuses `hueFamily`, `isViewOnlyForPartner` and `ownerId` on a child, so protection and ownership can only be set on the root.

**EXDATE on single-occurrence delete.** `deleteEvent(db, ctx, id, { scope: "this", occurrenceStart })` never deletes a recurring row: it parses the `exdates` JSON array, appends `occurrenceStart` if absent, and writes the array back with a fresh `updatedAt`. The operation is idempotent, and `occurrenceStart` is stored verbatim — the service does not normalise it against `startAt` or the timezone, so the client must send the same string format it uses to expand occurrences. `{ scope: "all" }`, or `scope: "this"` on an event with no `rrule`, hard-deletes the row.

**Search matching.** `searchEvents` trims the query, returns `[]` below two characters, escapes `\`, `%` and `_`, and runs `LIKE '%term%' ESCAPE '\'` over `title`, `location` and `description` for the caller's household only. SQLite `LIKE` is ASCII-case-insensitive; ranking is done in JavaScript: exact lowercase title (0), title prefix (1), title substring (2), location (3), description (4), otherwise 5, then title `localeCompare`, then id. At most 200 matching rows are fetched and only those are ranked; the result is capped at `min(limit, 50)` with a floor of 1. One row per stored event — recurring series are not expanded, and search is not range-scoped, so it can return events outside the visible calendar range.

**Dates and units.** Timed events store UTC epoch milliseconds in `startAt`/`endAt`; all-day events store household-local `YYYY-MM-DD` in `startDate`/`endDate` with `endDate` inclusive. `listEvents` converts the range's epoch bounds to household-local dates with `utcToLocalDate` and compares all-day rows as `startDate <= toDate AND endDate >= fromDate`, so an all-day event beginning on the exclusive upper bound's date is still returned. Transactions are the exception: only the importer (`commitImport`/`rollbackImportBatch`) and `updateCalendar`'s root-owner-plus-children cascade wrap several statements in one `db.transaction`; every other function is a sequence of synchronous Drizzle statements, so its multi-statement writes are not atomic.

### lib/services/calendars.ts

**Purpose** — Owns the calendar tree: creating roots and sub-calendars, patching them under permission checks, deleting them, resolving the flags that effectively apply, and resolving the shade tokens the UI paints.

**Public API** — Interfaces `CalendarNode extends CalendarRow { children: CalendarRow[] }` and `CalendarAccess { calendar: CalendarRow; root: CalendarRow | null; effective: Pick<CalendarRow, "ownerId" | "isViewOnlyForPartner"> }`.
- `getCalendar(db, ctx, id): CalendarRow` — `NOT_FOUND` 404 "Calendar not found." when missing or in another household.
- `getCalendarAccess(db, ctx, id): CalendarAccess` — `NOT_FOUND` via `getCalendar`.
- `assertCalendarWritable(ctx, access): void` — `FORBIDDEN` 403 "This calendar is view-only.".
- `listCalendarTree(db, ctx): CalendarNode[]` — roots sorted by `sortOrder`, `createdAt`; children sorted by `shadeIndex`.
- `createCalendar(db, ctx, input: CreateCalendarInput): CalendarRow` — `VALIDATION` 400 for a grandchild parent, a root without `hueFamily`, or view-only without an owner; `FORBIDDEN` 403 when `ownerId` is not the caller; `CONFLICT` 409 at seven children.
- `updateCalendar(db, ctx, id, input: UpdateCalendarInput): CalendarRow` — `FORBIDDEN` 403 when not writable, when reassigning someone else's calendar, or when setting view-only without owning it; `VALIDATION` 400 for `hueFamily`, `isViewOnlyForPartner` or `ownerId` on a child (all three live on the root). An accepted `ownerId` change on a root is copied to its children in the same transaction, so a re-owned parent never leaves them in the wrong group.
- `deleteCalendar(db, ctx, id): void` — `FORBIDDEN` when not writable; `NOT_FOUND` when out of scope.
- `resolveShade(db, target: CalendarRow): ShadeTokens` — no throws; may raise `RangeError` only if a stored `shadeIndex` is outside 0-7.

**State & side effects** — Reads `calendar`; writes `calendar` insert/update/delete. `deleteCalendar` issues a single `DELETE`: children and their events disappear through the schema's `onDelete: "cascade"` FKs (`foreign_keys = ON` in `lib/db/client.ts`). New ids are `crypto.randomUUID()`; timestamps are `Date.now()`; an empty `updateCalendar` patch returns the existing row without touching the DB. An owner move on a root is a two-statement `db.transaction` (root, then `WHERE parent_id = id` for the children); no cache invalidation (the client owns query invalidation).

**Depends on / Used by** — `drizzle-orm` (`and`, `asc`, `eq`, `isNull`), `calendar`/`CalendarRow`, `AppError`, `lib/color/palette` (`CHILD_SHADE_ORDER`, `MAX_CHILDREN`, `PARENT_SHADE_INDEX`, `isHueFamily`, `shadeTokens`), `CreateCalendarInput`/`UpdateCalendarInput`, `canWriteCalendar`/`ViewerContext`. Used by `lib/api/handlers/calendars.ts`; `lib/services/events.ts` imports `getCalendarAccess`, `assertCalendarWritable` and `resolveShade`; `CalendarNode` is a client type across `components/sidebar/*`, `components/calendar/*`, `lib/ui/*` and `lib/query/calendars.ts`.

**Debugging**
- Two sub-calendars end up with the same shade -> the "first unused index" rule is recomputed per request and not backed by a constraint, so concurrent creates race -> `createCalendar` (`usedShades` / `CHILD_SHADE_ORDER.find`).
- A child renders in the parent's colour even though it looks like it has its own family -> by design; `hueFamily` is always `null` on children and `resolveShade` reads the root -> `resolveShade`.
- A PATCH changing `hueFamily` on a child returns 400 -> only roots own a colour; the UI must edit the root -> `updateCalendar`.
- A PATCH changing `ownerId` on a child returns 400 -> sub-calendars inherit their root's owner; re-own the parent (which cascades) -> `updateCalendar`.
- A re-owned root's children still sit in the old group -> the cascade was skipped (direct SQL, or a pre-`0004` row) -> `updateCalendar` / `drizzle/0004_normalise_subcalendar_owners.sql`.
- A sub-calendar is missing from `GET /api/calendars` -> `listCalendarTree` only maps rows whose `parentId` is a root; a second-level row is dropped silently -> `listCalendarTree`.

**Tests** — `tests/integration/calendars.test.ts` (shade order, reuse after delete, seven-child limit, nesting, ownership and the owner cascade to children, child-owner rejection, view-only, hue re-derivation, tree scoping) and `tests/integration/regressions.test.ts` (inherited protection, ownership claim, cascade).

### lib/services/events.ts

**Purpose** — Reads and writes events, expanding nothing (the client expands RRULEs) while attaching the calendar's resolved colour to every row returned.

**Public API** — Interface `EventView extends EventRow { color: ShadeTokens }`; `EventRange { from: number; to: number }` (inclusive `from`, exclusive `to`, UTC ms).
- `toView(db, row: EventRow): EventView` — joins the owning calendar's shade; falls back to `shadeTokens("slate", 3)` if the calendar row is gone.
- `getEvent(db, ctx, id): EventRow` — `NOT_FOUND` 404 "Event not found.".
- `listEvents(db, ctx, range: EventRange): EventView[]` — every recurring row plus timed rows overlapping the range plus all-day rows touching it.
- `createEvent(db, ctx, input: CreateEventInput): EventView` — `FORBIDDEN` 403 on a view-only calendar; `VALIDATION` 400 from `assertEventShape` or an invalid `rrule`.
- `updateEvent(db, ctx, id, input: UpdateEventInput): EventView` — `NOT_FOUND` 404, `FORBIDDEN` 403 for the current calendar or for a view-only move target, `VALIDATION` 400 on the merged shape or `rrule`.
- `deleteEvent(db, ctx, id, options: { scope: "all" } | { scope: "this"; occurrenceStart: string }): void` — `NOT_FOUND`, `FORBIDDEN`, `VALIDATION` 400 when `occurrenceStart` is empty.

**State & side effects** — Reads `event`, `calendar` (colour and permissions), `household` (timezone, defaulting to `Asia/Taipei` when the row is absent); writes `event` insert/update/delete. `createEvent` sets `createdBy = ctx.userId` and nulls the unused date columns (`allDay` rows clear `startAt`/`endAt`, timed rows clear `startDate`/`endDate`). `exdates` is stored as a JSON string only when non-empty. `deleteEvent` with `scope: "this"` rewrites `exdates` and `updatedAt`; every other delete removes the row. No transactions.

**Depends on / Used by** — `rrule` (`RRule.fromString` validation), `lib/color/palette`, `calendar`/`event`/`household`, `AppError`, `utcToLocalDate`, `assertEventShape` + input types, and `./calendars` (`getCalendarAccess`, `resolveShade`, `assertCalendarWritable`). Used by `lib/api/handlers/events.ts`; `lib/services/search.ts` imports `toView`; `EventView` is the client type in `lib/query/*`, `components/calendar/*`, `lib/time/format.ts` and `lib/query/eventCache.ts`.

**Debugging**
- A "skipped" occurrence still renders -> the service only appended to `exdates`; the client's expansion must filter on it -> `deleteEvent`.
- `[api] unhandled error` with a `SyntaxError` -> the `exdates` column holds invalid JSON (hand-edited row) -> `deleteEvent`'s `JSON.parse`.
- Patching only the title of an all-day event 400s "Timed events need a start and end time." -> the merged shape came out timed because `allDay` was not carried over -> `updateEvent`'s `candidate`.
- Events render in the wrong order in a raw API consumer -> `listEvents` sorts by string: timed rows use a 15-digit zero-padded `startAt`, all-day rows use `startDate`, so all timed rows sort before all-day rows -> the sort in `listEvents`.
- A series moves calendar but keeps the old colour -> `toView` reads the calendar at read time, so check the written `calendarId` -> `updateEvent`.

**Tests** — `tests/integration/events.test.ts` (shape validation, storage units, recurring vs range, colour, EXDATE idempotence, series delete, view-only, household scoping), `tests/integration/events-api.test.ts`, `tests/integration/regressions.test.ts` (all-day patch, calendar move).

### lib/services/household.ts

**Purpose** — Bootstraps and edits the single household record, manages `member` rows, and updates the signed-in member's display name on the Better Auth `user` table.

**Public API** — Interface `HouseholdSettingsInput { name?: string; timezone?: string; weekStartsOn?: 0 | 1 }`.
- `ensureHousehold(db, name = "Our Nest"): HouseholdRow` — returns the first household row, creating one with timezone `Asia/Taipei` and `weekStartsOn: 0`; never throws for a normal DB.
- `getHousehold(db, householdId: string): HouseholdRow` — `NOT_FOUND` 404 "Household not found.".
- `addMember(db, userId, householdId, role = "owner"): void` — no-op when the user already has a membership; never updates the existing role.
- `listMembers(db, householdId: string): MemberRow[]` — raw membership rows, no join to `user`.
- `updateHousehold(db, ctx, input: HouseholdSettingsInput): HouseholdRow` — `NOT_FOUND` if the household is gone; `VALIDATION` 400 "That timezone is not recognized." with `fields.timezone`.
- `updateMemberName(db, ctx, name: string): { id: string; name: string }` — `NOT_FOUND` 404 "Account not found." when no `user` row exists.

**State & side effects** — Writes `household` (insert on first run, then `name`/`timezone`/`weekStartsOn`), `member` (insert), and `user` (`name`, `updatedAt` as a `Date` — the Better Auth columns use Drizzle `timestamp_ms`, so it still persists epoch milliseconds). `ensureHousehold` selects the first row without any id filter, so it assumes a single-household database. No authentication or role check in any function: `member.role` is stored and returned but never consulted for authorization.

**Depends on / Used by** — `household`/`member`/`user` schema types, `AppError`, `ViewerContext`. Used by `lib/api/handlers/settings.ts`, `lib/api/handlers/events.ts` (`getHousehold` for the default range), `app/api/session/route.ts` and `app/(app)/layout.tsx` (`listMembers`), `scripts/provision.mts` and `scripts/seed-test-db.mts` (`ensureHousehold`, `addMember`).

**Debugging**
- A user gets 403 "not part of this household" -> no `member` row, because provisioning skipped them -> `addMember` / `scripts/provision.mts`.
- A timezone change does not move existing events -> events store UTC instants; only display and the default month range read `household.timezone` -> `updateHousehold`.
- Profile save returns 404 "Account not found." -> a seeded `member` without the Better Auth `user` row -> `updateMemberName`.
- Both members appear as `owner` -> `addMember`'s default role is `"owner"` and nothing enforces a single owner -> `addMember`.

**Tests** — `tests/integration/settings-api.test.ts` covers `updateHousehold` and `updateMemberName` through the handlers. `ensureHousehold`/`addMember` have no direct unit test; they run through `scripts/seed-test-db.mts` for the E2E suite.

### lib/services/permissions.ts

**Purpose** — The single write predicate shared by the calendar and event services, the API layer and the client components.

**Public API** — Interface `ViewerContext { userId: string; householdId: string }`; `canWriteCalendar(viewer: ViewerContext, calendar: Pick<CalendarRow, "ownerId" | "isViewOnlyForPartner">): boolean`. No throws, no I/O.

Truth table: not view-only -> `true` for any viewer; view-only and `ownerId === viewer.userId` -> `true`; view-only and another owner -> `false`; view-only and `ownerId === null` -> `false` (fails closed).

**State & side effects** — None. The function does not read the database, does not verify that the calendar belongs to `viewer.householdId`, and does not check roles; callers must pass a row fetched with household scoping (`getCalendar` does that).

**Depends on / Used by** — Only the `CalendarRow` type. Used by `lib/services/calendars.ts` (`assertCalendarWritable`), `lib/services/events.ts`, `lib/api/route.ts` (type), `components/calendar/CalendarShell.tsx`, `components/settings/CalendarPreferencesCard.tsx`, `tests/unit/permissions.test.ts` and `tests/helpers/fixtures.ts`.

**Debugging**
- The partner can still edit a calendar that is supposed to be locked -> the flag sits on the root while the child row carries `isViewOnlyForPartner: 0`, so the caller passed the child's raw flags instead of `getCalendarAccess(...).effective` -> `canWriteCalendar`.
- The UI looks read-only but the API accepts the write (or the reverse) -> the API folds the root flags through `getCalendarAccess`; `CalendarShell.readOnlyCalendarIds` repeats the same fold client-side with a placeholder `householdId: ""` -> compare both folds.
- A view-only calendar with no owner is editable after a manual DB edit -> it is not; the predicate returns `false` for everyone -> `canWriteCalendar`.

**Tests** — `tests/unit/permissions.test.ts` (shared, partner-owned, owner view-only, partner view-only, ownerless view-only).

### lib/services/preferences.ts

**Purpose** — Stores the per-user calendar preferences with a lazy row: a missing row means "all defaults", so reads never write.

**Public API** — `DEFAULT_VIEWS` (`"auto" | "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth"`), `DefaultView`; `TIME_FORMATS` (`"12h" | "24h"`), `TimeFormat`; `UserPreferences { defaultView, timeFormat, showWeekNumbers, shortcutsEnabled, lastEventCalendarId: string | null }`; `DEFAULT_PREFERENCES` (`auto`, `24h`, `false`, `true`, `null`); `getPreferences(db, userId: string): UserPreferences`; `updatePreferences(db, userId: string, patch: Partial<UserPreferences>): UserPreferences`. Neither function throws.

**State & side effects** — Reads `user_preference` by `user_id`; `updatePreferences` always upserts (`onConflictDoUpdate` on `user_id`) even for an empty patch, writing merged values plus `updatedAt = Date.now()`. `normalise` silently substitutes the default for any stored `default_view` or `time_format` that is no longer in the enum. `lastEventCalendarId` is not validated against the `calendar` table, so it can name a deleted calendar. Only `lastEventCalendarId` distinguishes "leave unchanged" (`undefined`) from "clear" (`null`); the booleans use `??`, so an explicit `false` is persisted.

**Depends on / Used by** — `drizzle-orm` `eq`, `userPreference`. Used by `lib/api/handlers/preferences.ts`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/settings/page.tsx`, `lib/query/preferences.ts`, and as a type/enum source by `lib/validation/preferences.ts` (validation imports the service constants — the reverse dependency is intentional), `lib/ui/view.ts`, `lib/time/format.ts` and several shell/settings components.

**Debugging**
- Preferences reset to defaults after a deploy -> either no stored row for that user or a stored enum value that fell out of `DEFAULT_VIEWS`/`TIME_FORMATS` -> `normalise`.
- `PATCH /api/settings/preferences` 400s with `fields.form` -> the Zod schema is `.strict()` -> `lib/validation/preferences.ts`, not this file.
- One member's change appears for the other -> check the stored `user_id`; both service functions are keyed only by `userId` -> `getPreferences`.

**Tests** — `tests/integration/preferences-api.test.ts` (defaults without a row, partial merge, enum rejection, per-user isolation) plus `tests/e2e/preferences.spec.ts` and `tests/e2e/view-preference.spec.ts` through the UI.

### lib/services/search.ts

**Purpose** — Household-wide event search over title, location and description, ranked in memory because SQLite has no relevance score here.

**Public API** — `searchEvents(db, ctx, rawQuery: string, limit: number = RESULT_LIMIT): EventView[]` (`RESULT_LIMIT` 50). Throws nothing of its own; a query shorter than 2 characters after trimming returns `[]`. The effective cap is `Math.max(1, Math.min(Math.trunc(limit) || 50, 50))`, so `0`, `NaN` and negatives collapse to a small positive cap rather than an error.

**State & side effects** — Read-only: one `event` query (household-scoped, `LIMIT 200`), then `toView` per result, which issues one `calendar` query each. Wildcards in the user's text are escaped (`escapeLike`) and matched with `ESCAPE '\'` so `100%` matches literally. Ranking: exact title 0, title prefix 1, title substring 2, location 3, description 4, other 5; ties by `title.localeCompare` then `id`. No RRULE expansion — a series is one hit.

**Depends on / Used by** — `drizzle-orm` (`and`, `eq`, `or`, `sql`, `AnySQLiteColumn`), `event`/`EventRow`, `toView`/`EventView` from `./events`, `ViewerContext`. Used by `lib/api/handlers/events.ts` (`searchEventsHandler`); the client reaches it through `lib/query/search.ts` -> `GET /api/events/search`.

**Debugging**
- A known event is not found -> only the first 200 matching rows (unordered, no range filter) are ranked -> `CANDIDATE_LIMIT` in `searchEvents`.
- A search for `%` returns everything -> regression in `escapeLike` or the `ESCAPE '\'` clause -> `searchEvents`.
- One-character queries return nothing -> `MIN_QUERY_LENGTH` is 2 by design -> `searchEvents`.
- Results look unordered compared with the UI list -> ranking is exact/prefix/substring on the title before location and description, not chronological -> `rank`.

**Tests** — `tests/integration/search-api.test.ts` (fields, casing, minimum length, household isolation, one row per series, wildcard escaping, ranking and limit); `tests/e2e/search.spec.ts` covers the endpoint through the UI.

### lib/services/import.ts

**Purpose** — Google Calendar import without OAuth: previews parsed `.ics` files without writing, commits them in one SQLite transaction (creating `From Google` calendars, upserting events idempotently by external key, recording an undo ledger), and rolls a committed batch back.

**Public API**
- `const IMPORT_ROOT_NAME = "From Google"`; `interface ImportFile { name; text }`.
- `type ImportCalendarMode = { mode: "new" } | { mode: "existing"; calendarId }`; `type ImportMapping = Record<string, ImportCalendarMode>` keyed by source calendar name.
- `previewImport(db, ctx, files): ImportPreview` — per-calendar create/update/unchanged counts, `nonHouseholdTimezones` (the R13 dry-run note), warnings, dropped parts; no writes.
- `commitImport(db, ctx, { files, mapping }): ImportReport` — `{ batchId, created, updated, unchanged, calendarsCreated, warnings, dropped }`.
- `rollbackImportBatch(db, ctx, batchId): RollbackReport` — `{ batchId, deleted, restored, skipped, calendarsDeleted }`.
- `listImportBatches(db, ctx): ImportBatchView[]` — newest first, counts read from the stored report.
- Limits: 20 files, 5 MB of text, 50 000 events per commit. An `externalKey` that appears twice in one upload is imported once and reported as a warning.

**State & side effects**
- Writes only inside `commitImport` and `rollbackImportBatch`, each one `db.transaction`.
- Commit resolves targets: `{ mode: "new" }` reuses an existing child of an import root by name (still passing the same `getCalendarAccess`/`assertCalendarWritable` check as an explicit mapping), otherwise creates the root (`From Google`, then `From Google 2`… with the next unused hue family) and the child; `{ mode: "existing" }` goes through the same permission pair, so a view-only target is refused with 403 and nothing is written.
- New import calendars are **personal to the importer**: `ensureImportRoot` creates the root with `ownerId = ctx.userId`, and both reuse helpers (`ownedImportRoots`/`findImportChild`) search only that person's own roots, so a partner's `From Google` tree is never reused or written. Imported events therefore land in the importer's person group in the sidebar instead of "Ours"; map to an existing shared calendar for a deliberately shared import.
- Idempotency is `(household_id, external_key)`: an unknown key inserts; a matching `externalContentHash` **and the same target calendar** counts `unchanged` and writes nothing; a different hash **or a different mapped calendar** updates the imported fields (including `calendarId`) and records an `update` change whose `before_json` is the previous row.
- Ledger: one `import_batch` (`status: committed`, JSON `mapping`/`report` include `createdCalendarIds` for the undo) plus one `import_change` per inserted/updated event.
- Rollback deletes `create` rows and restores `update` rows from `before_json` (including the row's previous `updatedAt`, so restoring an earlier batch does not look like a user edit), **skipping any event whose `updatedAt` is newer than the batch** (the user edited it after the import) and reporting it as `skipped`; then deletes the empty calendars it created, children before the root. Before mutating anything it re-checks `assertCalendarWritable` for every calendar the rollback would touch (the current row's calendar and the `before_json` calendar), so the partner cannot undo an import that targeted the owner's view-only calendar — a refusal rolls the whole transaction back and leaves the batch `committed`. A second rollback is a 409.

**Depends on / Used by** — `lib/import/ics.ts` (`parseIcs`), `calendar`/`event`/`household`/`importBatch`/`importChange`, `lib/color/palette` (`HUE_FAMILIES`, `MAX_CHILDREN`, `HueFamily`), `./calendars` (`createCalendar`, `getCalendarAccess`, `assertCalendarWritable`). Will be used by `lib/api/handlers/import.ts` and the `/settings/import` wizard.

**Debugging**
- Preview says 0 events -> the parser dropped them (unknown TZID, missing UID/DTSTART) -> read `preview.warnings`.
- Re-import duplicates rows -> `external_key` differs between parses -> compare `event.external_key` with `parseIcs` output.
- A commit updates an event the user edited in Nailong -> only events with the same `external_key` are touched, and a content-hash mismatch is what updates them; imported series are not protected from later re-imports by design.
- Undo left an event behind -> it was edited after the import (`skipped`) or it was imported by an earlier batch -> check `import_change.batch_id` and the event's `updated_at`.
- Undo left `From Google` behind -> it still holds events from another batch -> `calendarsCreated` cleanup only removes empty calendars.
- Imported events appear under "Ours" and hide with the Ours pill -> the calendar is a legacy import tree with `owner_id` NULL -> re-import (creates the importer's own tree and moves the rows) or move the calendar to its owner in the calendar dialog.

**Tests** — `tests/integration/import-service.test.ts` (preview counts, commit, idempotent re-import, update isolation, view-only refusal, per-member separation — each importer gets their own tree and never reuses the partner's, unknown timezone, size limit, rollback and skip rule, rollback permission check, batch history).

## Focused verification

```bash
npx vitest run tests/integration/calendars.test.ts tests/integration/events.test.ts tests/integration/search-api.test.ts tests/integration/import-service.test.ts tests/unit/permissions.test.ts
npm run lint && npm run typecheck
```
