# Services layer

`lib/services/*` is where the product's rules live: every function takes a `Database` (Drizzle over better-sqlite3) plus either a `ViewerContext` or explicit ids, reads and writes the household's rows, and throws `AppError` for anything the caller must handle. Read `## Business rules enforced here` before changing behaviour, then jump to the file section for signatures, tables and failure modes.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, update its section and run `npm run docs:check`.

| File | Role |
|---|---|
| lib/services/collections.ts | Collection tree reads, two-level nesting, shade assignment, effective permissions, colour resolution |
| lib/services/events.ts | Event CRUD, range queries, RRULE validation, EXDATE mutation, colour attachment |
| lib/services/household.ts | Single-household bootstrap, membership rows, household settings, member display name |
| lib/services/permissions.ts | The one read/write permission pair for collections and their events |
| lib/services/preferences.ts | Lazy per-user preference row with defaults and enum normalisation |
| lib/services/search.ts | Household-wide LIKE search with ranking, escaping and visibility filtering |
| lib/services/tasks.ts | Task CRUD, derived Inbox/Today/Week/Someday views and counts, checklist replacement, manual ordering |

## Business rules enforced here

**Household scoping.** Every query that serves a request filters `household_id = ctx.householdId`: `resolveVisibleCollections`, `ensureInbox`, `getCollection`, `listCollectionTree`, `getEvent`, `listEvents`, and `searchEvents`. A row from another household therefore surfaces as `NOT_FOUND` 404, never `FORBIDDEN` 403 — the caller must not be able to probe for ids. Exceptions that take no `ctx` and are provisioning-scoped: `ensureHousehold`, `addMember`, `listMembers`, and the preference functions (keyed by `userId`, not household). `collections.nextSortOrder` scopes roots by household but children only by `parent_id`, which is safe because the parent was already scoped.

**Effective visibility, one resolver.** `resolveVisibleCollections` loads every household row once, folds each row's root flags (`ownerId = root.ownerId ?? row.ownerId`; `visibility` = the more restrictive of root and row, `VISIBILITY_RANK`: `shared` < `view_only` < `private`) and keeps only rows `canReadCollection` accepts: `shared` and `view_only` are readable by both members, a `private` row only by its effective owner. Nesting is capped at two levels — `createCollection` rejects a parent that itself has a `parentId` — so one fold covers the whole tree, and a hidden private root takes its whole subtree with it. `listCollectionTree`, `listEvents`, `searchEvents` and `listTasks` all build their readable set from this resolver; `getCollection`, `getCollectionAccess`, `getEvent` and `getTask` run the same predicate and answer `NOT_FOUND` 404 for an invisible id, so a private collection's existence never leaks.

**Write guard.** `assertWritable` is the one write rule: collection writes call it directly, while the event, task and import services import `assertCollectionWritable`, which delegates with `access.effective`.
- foreign household -> `NOT_FOUND` 404;
- `private` not owned -> `NOT_FOUND` 404 (not 403: existence hidden);
- `view_only` not owned, including an ownerless row -> `FORBIDDEN` 403 "This collection is view-only.";
- `shared` -> writable by both members.

`canWriteCollection` remains the pure owner predicate used by the client; it is consulted after visibility, so it fails closed for any non-shared row with `ownerId === null` (creation refuses that state, so it only appears from hand-edited data).

Only the current owner may change `visibility` or reassign `ownerId`. A member may claim an ownerless collection (`ownerId` -> themselves); giving it back to the household (`ownerId: null`) also resets `visibility` to `shared`. A child's `ownerId` is copied from the parent at creation; reassigning a root's `ownerId` writes the new owner to every child in the same transaction, and reassigning a child directly is `VALIDATION` 400, so stored rows match the folded `effective.ownerId` (root first). Migration `0004` backfilled trees written before that rule. `canWriteCollection` deliberately ignores `householdId`: callers must pass a row they already fetched with household scoping. Household settings (`updateHousehold`) and preferences (`updatePreferences`) have no ownership check — either member may patch them.

**Shade assignment.** A root collection renders at `PARENT_SHADE_INDEX` (3) and stores that value; its `hueFamily` is required and stored on the root only. Children store `hueFamily: null` and `shadeIndex` claimed as the first unused entry of `CHILD_SHADE_ORDER` (`[4, 2, 5, 1, 6, 0, 7]`), giving at most `MAX_CHILDREN` (7) children; the eighth create raises `CONFLICT` 409. Shade choice is computed per request from the current siblings, not enforced by a unique index, and deleting a child frees its shade for the next one. `resolveShade` always resolves colour through the root, so changing the root's `hueFamily` recolours every child with no child row being written; an unknown or missing family falls back to `slate`. An Inbox created by `ensureInbox` takes the palette's next unused root hue family. Children inherit `ownerId` and `kind` from the parent (an owner move on the root cascades) and always start with `visibility: "shared"`; `updateCollection` refuses `hueFamily`, `visibility` and `ownerId` on a child, so protection and ownership can only be set on the root.

**Inbox.** `ensureInbox` lazily creates the caller's root `kind="list"`, `name="Inbox"`, `ownerId = ctx.userId`, `visibility="private"` collection (parent `null`, next unused root hue) and returns the same row on every later call. `GET /api/collections` calls it before building the tree, so every member's tree contains their own Inbox and never the partner's. Identity is household + owner + kind list + private visibility + name, so a caller-owned `shared` or `view_only` list named "Inbox" is never adopted; a renamed Inbox is re-created on the next call. better-sqlite3 is synchronous and the app is single-process, so the read-then-insert has no creation race.

**EXDATE on single-occurrence delete.** `deleteEvent(db, ctx, id, { scope: "this", occurrenceStart })` never deletes a recurring row: it parses the `exdates` JSON array, appends `occurrenceStart` if absent, and writes the array back with a fresh `updatedAt`. The operation is idempotent, and `occurrenceStart` is stored verbatim — the service does not normalise it against `startAt` or the timezone, so the client must send the same string format it uses to expand occurrences. `{ scope: "all" }`, or `scope: "this"` on an event with no `rrule`, hard-deletes the row.

**Search matching.** `searchEvents` trims the query, returns `[]` below two characters, escapes `\`, `%` and `_`, and runs `LIKE '%term%' ESCAPE '\'` over `title`, `location` and `description` for the caller's household only. The candidate query also intersects `event.collection_id` with `resolveVisibleCollections`, so an event in a private collection the caller does not own never matches. SQLite `LIKE` is ASCII-case-insensitive; ranking is done in JavaScript: exact lowercase title (0), title prefix (1), title substring (2), location (3), description (4), otherwise 5, then title `localeCompare`, then id. At most 200 matching rows are fetched and only those are ranked; the result is capped at `min(limit, 50)` with a floor of 1. One row per stored event — recurring series are not expanded, and search is not range-scoped, so it can return events outside the visible calendar range.

**Task views, counts and ordering.** `listTasks` loads only `status = 'open'` tasks whose `collection_id` is in `resolveVisibleCollections`, then derives every bucket in JavaScript with `bucketOf` (`lib/domain/tasks.ts`): the anchor is the earliest of `scheduledOn`/`dueOn`, undated work is `inbox` only inside the caller's Inbox and `someday` elsewhere, and work dated beyond `endOfWeek(today, weekStartsOn)` has no bucket at all. The list is sorted `sortOrder`, `createdAt`, then id. `counts` are computed before the `collectionId`/`view` filters: they always cover every visible open task, and `overdue` is the cross-cutting `isOverdue` count (`dueOn < today`, never due today). `createTask` appends at `sortOrder = max + 1` inside its list. A task lives only in a `kind="list"` collection, so a calendar is a 400 "Tasks live in lists." for create, move and reorder. `reorderTasks` accepts only the exact set of a list's open task ids (partial sets, duplicates, done/dropped ids and cross-list ids are all 400 "Send exactly the open tasks of this list.") and rewrites `0..n-1`. `updateTask`'s `collectionId` move appends at `max + 1` in the target list, and its `status` stamps move only on a real transition, so a PATCH echoing the stored status is a no-op. `updateTask`'s `checklist` is a full replacement (delete every row, insert in array order with fresh ids and `sortOrder = index`), so a checklist PATCH can never be a partial merge. A task is visible only while its collection is: reads and writes resolve through `resolveVisibleCollections`/`getCollectionAccess`, and a private-not-owned task answers `NOT_FOUND` 404 "Task not found." on every verb. Delete is a hard delete — there is no trash table, and the checklist cascades.

**Dates and units.** Timed events store UTC epoch milliseconds in `startAt`/`endAt`; all-day events store household-local `YYYY-MM-DD` in `startDate`/`endDate` with `endDate` inclusive. `listEvents` converts the range's epoch bounds to household-local dates with `utcToLocalDate` and compares all-day rows as `startDate <= toDate AND endDate >= fromDate`, so an all-day event beginning on the exclusive upper bound's date is still returned. Transactions are the exception: only the importer (`commitImport`/`rollbackImportBatch`), `updateCollection`'s root-owner-plus-children cascade, `updateTask`'s checklist replacement and `reorderTasks`' N updates wrap several statements in one `db.transaction`; every other function is a sequence of synchronous Drizzle statements, so its multi-statement writes are not atomic.

### lib/services/collections.ts

**Purpose** — Owns the collection tree: resolving the rows a viewer may read, creating roots and sub-collections, patching them under permission checks, deleting them, lazily creating the per-user Inbox, resolving the flags that effectively apply, and resolving the shade tokens the UI paints.

**Public API** — Interfaces `CollectionNode extends CollectionRow { children: CollectionRow[] }` and `CollectionAccess { collection: CollectionRow; root: CollectionRow | null; effective: EffectiveCollection }`, where `EffectiveCollection = Pick<CollectionRow, "ownerId" | "visibility" | "householdId">`; constant `INBOX_NAME = "Inbox"`.
- `resolveVisibleCollections(db, ctx): CollectionRow[]` — every household row `canReadCollection` accepts, root-folded; ordered by `sortOrder`, `createdAt`. The one private filter behind every read path.
- `getCollection(db, ctx, id): CollectionRow` — `NOT_FOUND` 404 "Calendar not found." when missing, in another household, or private and not owned.
- `assertCollectionVisible(db, ctx, id): CollectionRow` — the named read guard; same result as `getCollection`.
- `getCollectionAccess(db, ctx, id): CollectionAccess` — `NOT_FOUND` via the same guard; folds the root's owner and visibility into `effective`.
- `listCollectionTree(db, ctx): CollectionNode[]` — built from `resolveVisibleCollections`: roots ordered by `sortOrder`, `createdAt`, children by `shadeIndex`; a hidden root drops its subtree with it.
- `createCollection(db, ctx, input: CreateCollectionInput): CollectionRow` — `VALIDATION` 400 for a grandchild parent, a root without `hueFamily`, a private collection without an owner ("A private collection needs an owner.", `fields.ownerId`), a non-shared `visibility` without an owner (view-only message), or a child whose explicit `kind` disagrees with its parent; `FORBIDDEN` 403 when `ownerId` is not the caller; `CONFLICT` 409 at seven children. A root defaults `kind` to `"calendar"` and `visibility` to `"shared"`; a sub-collection inherits its parent's `kind` and `ownerId` and starts `visibility: "shared"`.
- `updateCollection(db, ctx, id, input: UpdateCollectionInput): CollectionRow` — `NOT_FOUND` 404 when invisible; `FORBIDDEN` 403 when not writable, when reassigning someone else's collection, or when setting a non-shared `visibility` without owning it; `VALIDATION` 400 for `hueFamily`, `visibility` or `ownerId` on a child (all three live on the root) and for switching to `private` while the effective owner stays `null` ("A private collection needs an owner.", `fields.ownerId`, checked before the owner-only 403). An accepted `ownerId` change on a root is copied to its children in the same transaction, so a re-owned parent never leaves them in the wrong group.
- `deleteCollection(db, ctx, id): void` — `NOT_FOUND` when out of scope or private and not owned; `FORBIDDEN` when visible but not writable.
- `ensureInbox(db, ctx): CollectionRow` — idempotent lazy Inbox (see Business rules); inserts it on the first call.
- `assertCollectionWritable(ctx, access): void` — delegates to `assertWritable(access.effective, ctx)`; kept for the event and import services.
- `resolveShade(db, target: CollectionRow): ShadeTokens` — no throws; may raise `RangeError` only if a stored `shadeIndex` is outside 0-7.

**State & side effects** — Reads `collection`; writes `collection` insert/update/delete. `listCollectionTree` is read-only through `resolveVisibleCollections`; `ensureInbox` inserts one private list row when the caller has no `Inbox` yet, using the palette's next unused root hue family. `deleteCollection` issues a single `DELETE`: children and their events disappear through the schema's `onDelete: "cascade"` FKs (`foreign_keys = ON` in `lib/db/client.ts`). New ids are `crypto.randomUUID()`; timestamps are `Date.now()`; an empty `updateCollection` patch returns the existing row without touching the DB. An owner move on a root is a two-statement `db.transaction` (root, then `WHERE parent_id = id` for the children); no cache invalidation (the client owns query invalidation).

**Depends on / Used by** — `drizzle-orm` (`and`, `asc`, `eq`, `isNull`), `collection`/`CollectionRow`, `AppError`, `lib/color/palette` (`CHILD_SHADE_ORDER`, `HUE_FAMILIES`, `MAX_CHILDREN`, `PARENT_SHADE_INDEX`, `isHueFamily`, `shadeTokens`, `HueFamily`), `CreateCollectionInput`/`UpdateCollectionInput`, and `./permissions` (`assertWritable`, `canReadCollection`, `EffectiveCollection`, `ViewerContext`). Used by `lib/api/handlers/collections.ts` (`ensureInbox`, tree, CRUD); `lib/services/events.ts` imports `assertCollectionVisible`, `assertCollectionWritable`, `getCollectionAccess`, `resolveShade` and `resolveVisibleCollections`; `lib/services/search.ts` imports `resolveVisibleCollections`; `lib/services/import.ts` imports `createCollection`, `getCollectionAccess` and `assertCollectionWritable`; `CollectionNode` is a client type across `components/sidebar/*`, `components/calendar/*`, `lib/ui/*` and `lib/query/collections.ts`.

**Debugging**
- The partner can see a private collection or its events -> a read path filtered the raw row (`visibility` is always `"shared"` on children) or skipped `resolveVisibleCollections` -> the resolver / `getCollectionAccess`.
- A write returns 404 where 403 was expected -> the collection is `private` and not owned; that is deliberate existence hiding -> `assertWritable`.
- `GET /api/collections` gains an `Inbox` row for each member -> intended lazy creation; renaming the list and reloading creates another, because the name is part of the identity (household + owner + kind list + private visibility) -> `ensureInbox`.
- Two sub-calendars end up with the same shade -> the "first unused index" rule is recomputed per request and not backed by a constraint, so concurrent creates race -> `createCollection` (`usedShades` / `CHILD_SHADE_ORDER.find`).
- A child renders in the parent's colour even though it looks like it has its own family -> by design; `hueFamily` is always `null` on children and `resolveShade` reads the root -> `resolveShade`.
- A PATCH changing `hueFamily` on a child returns 400 -> only roots own a colour; the UI must edit the root -> `updateCollection`.
- A PATCH changing `ownerId` on a child returns 400 -> sub-collections inherit their root's owner; re-own the parent (which cascades) -> `updateCollection`.
- A re-owned root's children still sit in the old group -> the cascade was skipped (direct SQL, or a pre-`0004` row) -> `updateCollection` / `drizzle/0004_normalise_subcalendar_owners.sql`.
- A sub-calendar is missing from `GET /api/collections` -> the read tree only attaches children under a visible root; a second-level row is dropped silently -> `listCollectionTree`.

**Tests** — `tests/integration/collections.test.ts` (shade order, reuse after delete, seven-child limit, nesting, ownership and the owner cascade to children, child-owner rejection, view-only write, private tree/get/update/delete hiding with the subtree, private-without-owner validation, kind mismatch, Inbox idempotence, per-viewer privacy and no adoption of a caller-owned shared list named "Inbox", hue re-derivation, tree scoping) and `tests/integration/regressions.test.ts` (inherited protection, ownership claim, cascade).

### lib/services/events.ts

**Purpose** — Reads and writes events, expanding nothing (the client expands RRULEs) while attaching the calendar's resolved colour to every row returned.

**Public API** — Interface `EventView extends EventRow { color: ShadeTokens }`; `EventRange { from: number; to: number }` (inclusive `from`, exclusive `to`, UTC ms).
- `toView(db, row: EventRow): EventView` — joins the owning calendar's shade; falls back to `shadeTokens("slate", 3)` if the calendar row is gone.
- `getEvent(db, ctx, id): EventRow` — `NOT_FOUND` 404 "Event not found."; also 404 when the event's collection is private and the caller does not own it (existence hidden).
- `listEvents(db, ctx, range: EventRange): EventView[]` — every recurring row plus timed rows overlapping the range plus all-day rows touching it, restricted to the collections `resolveVisibleCollections` returns.
- `createEvent(db, ctx, input: CreateEventInput): EventView` — `NOT_FOUND` 404 when the target collection is invisible to the caller; `FORBIDDEN` 403 on a view-only collection; `VALIDATION` 400 "Events live in calendars." when the target's `kind` is not `calendar`; `VALIDATION` 400 from `assertEventShape` or an invalid `rrule`. The kind check runs after the visibility and writability guards, so a hidden or view-only list answers 404/403 rather than revealing its kind. `CreateEventInput.collectionId` is required, so there is no default (the client resolves `lastEventCalendarId`/the isolated calendar among writable calendars only).
- `updateEvent(db, ctx, id, input: UpdateEventInput): EventView` — `NOT_FOUND` 404 for an invisible event or move target, `FORBIDDEN` 403 for the current collection or for a view-only move target, `VALIDATION` 400 "Events live in calendars." when a move target is a list, `VALIDATION` 400 on the merged shape or `rrule`. A rejected move leaves the stored row untouched.
- `deleteEvent(db, ctx, id, options: { scope: "all" } | { scope: "this"; occurrenceStart: string }): void` — `NOT_FOUND`, `FORBIDDEN`, `VALIDATION` 400 when `occurrenceStart` is empty.

**State & side effects** — Reads `event`, `collection` (visibility, colour, kind and permissions), `household` (timezone, defaulting to `Asia/Taipei` when the row is absent); writes `event` insert/update/delete. Every read and write resolves the collection through `assertCollectionVisible`/`getCollectionAccess`, so a private collection not owned by the caller behaves like a missing event/collection. Both write paths require the target collection to be `kind: "calendar"` (`assertEventCalendar`, mirroring `assertTaskList` in `lib/services/tasks.ts`), so a list can never hold an event. `createEvent` sets `createdBy = ctx.userId` and nulls the unused date columns (`allDay` rows clear `startAt`/`endAt`, timed rows clear `startDate`/`endDate`). `exdates` is stored as a JSON string only when non-empty. `deleteEvent` with `scope: "this"` rewrites `exdates` and `updatedAt`; every other delete removes the row. No transactions.

**Depends on / Used by** — `rrule` (`RRule.fromString` validation), `lib/color/palette`, `collection`/`event`/`household`, `AppError`, `utcToLocalDate`, `assertEventShape` + input types, and `./collections` (`assertCollectionVisible`, `assertCollectionWritable`, `getCollectionAccess`, `resolveShade`, `resolveVisibleCollections`). Used by `lib/api/handlers/events.ts`; `lib/services/search.ts` imports `toView`; `EventView` is the client type in `lib/query/*`, `components/calendar/*`, `lib/time/format.ts` and `lib/query/eventCache.ts`.

**Debugging**
- The partner can see an event in a private collection -> a read path bypassed `resolveVisibleCollections` (lists/search) or `getCollectionAccess` (by-id) -> `getEvent` / `listEvents`.
- A "skipped" occurrence still renders -> the service only appended to `exdates`; the client's expansion must filter on it -> `deleteEvent`.
- `[api] unhandled error` with a `SyntaxError` -> the `exdates` column holds invalid JSON (hand-edited row) -> `deleteEvent`'s `JSON.parse`.
- Patching only the title of an all-day event 400s "Timed events need a start and end time." -> the merged shape came out timed because `allDay` was not carried over -> `updateEvent`'s `candidate`.
- Events render in the wrong order in a raw API consumer -> `listEvents` sorts by string: timed rows use a 15-digit zero-padded `startAt`, all-day rows use `startDate`, so all timed rows sort before all-day rows -> the sort in `listEvents`.
- A series moves calendar but keeps the old colour -> `toView` reads the calendar at read time, so check the written `collectionId` -> `updateEvent`.
- Creating an event in a list 400s "Events live in calendars." -> intended: a list is a task home; the client should have filtered it out of the picker/default -> `assertEventCalendar`, then `CalendarShell`'s `writableCollections` / `EventDialog`'s calendars memo.

**Tests** — `tests/integration/events.test.ts` (shape validation, storage units, recurring vs range, colour, EXDATE idempotence, series delete, view-only, private-read/write 404s including a child of a private root, household scoping), `tests/integration/events-api.test.ts` (including create-into-list and move-into-list 400s), `tests/integration/regressions.test.ts` (all-day patch, calendar move).

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

**Purpose** — The one read/write permission pair for collections and the events inside them: `canReadCollection` decides effective visibility, `assertWritable` guards every write, and the pure `canWriteCollection` owner predicate is also used by the client.

**Public API** — `ViewerContext { userId: string; householdId: string }`; `EffectiveCollection = Pick<CollectionRow, "ownerId" | "visibility" | "householdId">` (the root-folded columns produced by `getCollectionAccess` and `resolveVisibleCollections`).
- `canReadCollection(viewer, effective): boolean` — `false` for a foreign household; otherwise `false` only when `visibility === "private"` and `ownerId !== viewer.userId`. `shared` and `view_only` read as `true`.
- `assertWritable(effective, ctx): void` — throws `AppError`: foreign household -> `NOT_FOUND` 404; `private` not owned -> `NOT_FOUND` 404 (existence hidden); `view_only` not owned, including an ownerless row -> `FORBIDDEN` 403 "This collection is view-only."; `shared` -> returns.
- `canWriteCollection(viewer, collection: Pick<CollectionRow, "ownerId" | "visibility">): boolean` — pure predicate: `shared` -> `true`; `view_only`/`private` and `ownerId === viewer.userId` -> `true`; otherwise `false` (an ownerless non-shared row fails closed).

Truth table for viewer A (the owner) over the effective columns:

| visibility | owner = A | owner = B | owner = null |
|---|---|---|---|
| `shared` | read + write | read + write | read + write |
| `view_only` | read + write | read, 403 on write | read, 403 on write |
| `private` | read + write | 404 on read and write | 404 on read and write |

A foreign `householdId` is 404 and invisible even when the row is `shared`.

**State & side effects** — None: no database reads and no role checks. `canWriteCollection` deliberately ignores `householdId`, so callers must pass household-scoped rows. `assertWritable` only sees the effective columns, so callers must have folded the root first (`getCollectionAccess(...).effective` or the resolver's fold).

**Depends on / Used by** — `CollectionRow` and `AppError`. Used by `lib/services/collections.ts` (`resolveVisibleCollections`, `getCollectionAccess`, every write, and the `assertCollectionWritable` delegation), `lib/services/events.ts` (type only), `lib/api/route.ts` (type), `components/calendar/CalendarShell.tsx`, `components/settings/CalendarPreferencesCard.tsx`, `components/import/ImportWizard.tsx`, `tests/unit/permissions.test.ts` and `tests/helpers/fixtures.ts`.

**Debugging**
- The partner can read a private collection -> the caller passed the raw child row (`visibility` is always `"shared"` on children) instead of `getCollectionAccess(...).effective` or the resolver's fold -> `canReadCollection`.
- A write returns 404 where 403 was expected -> the row is `private` and not owned; 404 is deliberate existence hiding -> `assertWritable`.
- The partner can still edit a collection that is supposed to be locked -> the restriction sits on the root while the child row carries `visibility: "shared"`, so the caller passed the child's raw flags instead of the effective columns -> `canWriteCollection`.
- The UI looks read-only but the API accepts the write (or the reverse) -> the API folds the root flags through `getCollectionAccess`; `CalendarShell.readOnlyCollectionIds` repeats the same fold client-side with a placeholder `householdId: ""` -> compare both folds.
- A non-shared collection with no owner is editable after a manual DB edit -> it is not; the predicate returns `false` for everyone -> `canWriteCollection`.

**Tests** — `tests/unit/permissions.test.ts` (truth table over `{shared, view_only, private} × {owner me, owner partner, owner null}` for both predicates, plus the foreign-household 404), exercised end to end by `tests/integration/collections.test.ts` and `tests/integration/events.test.ts`.

### lib/services/preferences.ts

**Purpose** — Stores the per-user calendar preferences with a lazy row: a missing row means "all defaults", so reads never write.

**Public API** — `DEFAULT_VIEWS` (`"auto" | "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth"`), `DefaultView`; `TIME_FORMATS` (`"12h" | "24h"`), `TimeFormat`; `UserPreferences { defaultView, timeFormat, showWeekNumbers, shortcutsEnabled, lastEventCalendarId: string | null }`; `DEFAULT_PREFERENCES` (`auto`, `24h`, `false`, `true`, `null`); `getPreferences(db, userId: string): UserPreferences`; `updatePreferences(db, userId: string, patch: Partial<UserPreferences>): UserPreferences`. Neither function throws.

**State & side effects** — Reads `user_preference` by `user_id`; `updatePreferences` always upserts (`onConflictDoUpdate` on `user_id`) even for an empty patch, writing merged values plus `updatedAt = Date.now()`. `normalise` silently substitutes the default for any stored `default_view` or `time_format` that is no longer in the enum. `lastEventCalendarId` is not validated against the `collection` table, so it can name a deleted collection. Only `lastEventCalendarId` distinguishes "leave unchanged" (`undefined`) from "clear" (`null`); the booleans use `??`, so an explicit `false` is persisted.

**Depends on / Used by** — `drizzle-orm` `eq`, `userPreference`. Used by `lib/api/handlers/preferences.ts`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/settings/page.tsx`, `lib/query/preferences.ts`, and as a type/enum source by `lib/validation/preferences.ts` (validation imports the service constants — the reverse dependency is intentional), `lib/ui/view.ts`, `lib/time/format.ts` and several shell/settings components.

**Debugging**
- Preferences reset to defaults after a deploy -> either no stored row for that user or a stored enum value that fell out of `DEFAULT_VIEWS`/`TIME_FORMATS` -> `normalise`.
- `PATCH /api/settings/preferences` 400s with `fields.form` -> the Zod schema is `.strict()` -> `lib/validation/preferences.ts`, not this file.
- One member's change appears for the other -> check the stored `user_id`; both service functions are keyed only by `userId` -> `getPreferences`.

**Tests** — `tests/integration/preferences-api.test.ts` (defaults without a row, partial merge, enum rejection, per-user isolation) plus `tests/e2e/preferences.spec.ts` and `tests/e2e/view-preference.spec.ts` through the UI.

### lib/services/search.ts

**Purpose** — Household-wide event search over title, location and description, ranked in memory because SQLite has no relevance score here.

**Public API** — `searchEvents(db, ctx, rawQuery: string, limit: number = RESULT_LIMIT): EventView[]` (`RESULT_LIMIT` 50). Throws nothing of its own; a query shorter than 2 characters after trimming returns `[]`. The effective cap is `Math.max(1, Math.min(Math.trunc(limit) || 50, 50))`, so `0`, `NaN` and negatives collapse to a small positive cap rather than an error.

**State & side effects** — Read-only: one `resolveVisibleCollections` query, one `event` query (household-scoped, intersected with the resolver's ids, `LIMIT 200`), then `toView` per result, which issues one `collection` query each. Wildcards in the user's text are escaped (`escapeLike`) and matched with `ESCAPE '\'` so `100%` matches literally. Ranking: exact title 0, title prefix 1, title substring 2, location 3, description 4, other 5; ties by `title.localeCompare` then `id`. No RRULE expansion — a series is one hit.

**Depends on / Used by** — `drizzle-orm` (`and`, `eq`, `inArray`, `or`, `sql`, `AnySQLiteColumn`), `event`/`EventRow`, `resolveVisibleCollections` from `./collections`, `toView`/`EventView` from `./events`, `ViewerContext`. Used by `lib/api/handlers/events.ts` (`searchEventsHandler`); the client reaches it through `lib/query/search.ts` -> `GET /api/events/search`.

**Debugging**
- A known event is not found -> only the first 200 matching rows (unordered, no range filter) are ranked -> `CANDIDATE_LIMIT` in `searchEvents`.
- A search for `%` returns everything -> regression in `escapeLike` or the `ESCAPE '\'` clause -> `searchEvents`.
- An event in a private collection shows up in the partner's results -> the `inArray(event.collectionId, resolveVisibleCollections(...))` predicate was dropped or bypassed -> `searchEvents`.
- One-character queries return nothing -> `MIN_QUERY_LENGTH` is 2 by design -> `searchEvents`.
- Results look unordered compared with the UI list -> ranking is exact/prefix/substring on the title before location and description, not chronological -> `rank`.

**Tests** — `tests/integration/search-api.test.ts` (fields, casing, minimum length, household isolation, one row per series, wildcard escaping, ranking and limit, private-collection exclusion); `tests/e2e/search.spec.ts` covers the endpoint through the UI.

### lib/services/import.ts

**Purpose** — Google Calendar import without OAuth: previews parsed `.ics` files without writing, commits them in one SQLite transaction (creating `From Google` calendars, upserting events idempotently by external key, recording an undo ledger), and rolls a committed batch back.

**Public API**
- `const IMPORT_ROOT_NAME = "From Google"`; `interface ImportFile { name; text }`.
- `type ImportCalendarMode = { mode: "new" } | { mode: "existing"; collectionId }`; `type ImportMapping = Record<string, ImportCalendarMode>` keyed by source calendar name.
- `previewImport(db, ctx, files): ImportPreview` — per-calendar create/update/unchanged counts, `nonHouseholdTimezones` (the R13 dry-run note), warnings, dropped parts; no writes.
- `commitImport(db, ctx, { files, mapping }): ImportReport` — `{ batchId, created, updated, unchanged, calendarsCreated, warnings, dropped }`.
- `rollbackImportBatch(db, ctx, batchId): RollbackReport` — `{ batchId, deleted, restored, skipped, calendarsDeleted }`.
- `listImportBatches(db, ctx): ImportBatchView[]` — newest first, counts read from the stored report.
- Limits: 20 files, 5 MB of text, 50 000 events per commit. An `externalKey` that appears twice in one upload is imported once and reported as a warning.

**State & side effects**
- Writes only inside `commitImport` and `rollbackImportBatch`, each one `db.transaction`.
- Commit resolves targets: `{ mode: "new" }` reuses an existing child of an import root by name (still passing the same `getCollectionAccess`/`assertCollectionWritable` check as an explicit mapping), otherwise creates the root (`From Google`, then `From Google 2`… with the next unused hue family) and the child; `{ mode: "existing" }` goes through the same permission pair, so a view-only target is refused with 403 and nothing is written.
- New import calendars are **personal to the importer and always calendars**: `ensureImportRoot` creates the root with `kind: "calendar"`, `visibility: "shared"` and `ownerId = ctx.userId`, and both reuse helpers (`ownedImportRoots`/`findImportChild`) search only that person's own roots. `isImportRoot` additionally requires `kind === "calendar"`, so a list that happens to be named `From Google` can never capture an import or be reused as a target. Imported events therefore land in the importer's person group in the sidebar instead of "Ours"; map to an existing shared calendar for a deliberately shared import. Import never creates a list or a private collection.
- Idempotency is `(household_id, external_key)`: an unknown key inserts; a matching `externalContentHash` **and the same target calendar** counts `unchanged` and writes nothing; a different hash **or a different mapped calendar** updates the imported fields (including `collectionId`) and records an `update` change whose `before_json` is the previous row.
- Ledger: one `import_batch` (`status: committed`, JSON `mapping`/`report` include `createdCalendarIds` for the undo) plus one `import_change` per inserted/updated event.
- Rollback deletes `create` rows and restores `update` rows from `before_json` (including the row's previous `updatedAt`, so restoring an earlier batch does not look like a user edit), **skipping any event whose `updatedAt` is newer than the batch** (the user edited it after the import) and reporting it as `skipped`; then deletes the empty calendars it created, children before the root. Before mutating anything it re-checks `assertCollectionWritable` for every calendar the rollback would touch (the current row's calendar and the `before_json` calendar), so the partner cannot undo an import that targeted the owner's view-only calendar — a refusal rolls the whole transaction back and leaves the batch `committed`. A second rollback is a 409.

**Depends on / Used by** — `lib/import/ics.ts` (`parseIcs`), `collection`/`event`/`household`/`importBatch`/`importChange`, `lib/color/palette` (`HUE_FAMILIES`, `MAX_CHILDREN`, `HueFamily`), `./collections` (`createCollection`, `getCollectionAccess`, `assertCollectionWritable`). Will be used by `lib/api/handlers/import.ts` and the `/settings/import` wizard.

**Debugging**
- Preview says 0 events -> the parser dropped them (unknown TZID, missing UID/DTSTART) -> read `preview.warnings`.
- Re-import duplicates rows -> `external_key` differs between parses -> compare `event.external_key` with `parseIcs` output.
- A commit updates an event the user edited in Nailong -> only events with the same `external_key` are touched, and a content-hash mismatch is what updates them; imported series are not protected from later re-imports by design.
- Undo left an event behind -> it was edited after the import (`skipped`) or it was imported by an earlier batch -> check `import_change.batch_id` and the event's `updated_at`.
- Undo left `From Google` behind -> it still holds events from another batch -> `calendarsCreated` cleanup only removes empty calendars.
- Imported events appear under "Ours" and hide with the Ours pill -> the calendar is a legacy import tree with `owner_id` NULL -> re-import (creates the importer's own tree and moves the rows) or move the calendar to its owner in the calendar dialog.

**Tests** — `tests/integration/import-service.test.ts` (preview counts, commit, idempotent re-import, update isolation, view-only refusal, per-member separation — each importer gets their own tree and never reuses the partner's, a spoofing list named `From Google` is ignored and only shared calendars are created, unknown timezone, size limit, rollback and skip rule, rollback permission check, batch history).

### lib/services/tasks.ts

**Purpose** — Task CRUD inside `kind: "list"` collections (a calendar holds events, so it refuses tasks), the derived task views (Inbox/Today/Week/Someday plus `all`), per-view counts, checklist replacement and manual ordering. Visibility is never re-implemented here: every path resolves the owning collection through `lib/services/collections.ts`.

**Public API** — Interfaces `ChecklistItemView { id: string; title: string; done: boolean }`; `TaskView extends TaskRow { checklist: ChecklistItemView[]; collection: Pick<CollectionRow, "id" | "name" | "kind" | "hueFamily" | "shadeIndex"> }`; `TaskCounts { inbox; today; week; someday; overdue }`; `ListTasksInput { view?: TaskBucket | "all"; collectionId?: string; timezone: string; weekStartsOn: 0 | 1 }`.
- `toTaskView(db, row: TaskRow): TaskView` — attaches the checklist ordered by `sortOrder` and the owning list's summary for the colour dot. It does not check visibility, so callers must pass a row whose collection they already resolved; a row with no owning collection is `NOT_FOUND` 404 "Task not found.".
- `listTasks(db, ctx, input: ListTasksInput): { tasks: TaskView[]; counts: TaskCounts }` — open tasks in `resolveVisibleCollections` (optionally narrowed to one `collectionId`), bucketed with `lib/domain/tasks.ts` and sorted `sortOrder`, `createdAt`, id. `view` accepts the four buckets or `"all"`; omitted means all. `counts` ignore both filters. Calls `ensureInbox`, so the first call may create the caller's Inbox.
- `getTask(db, ctx, id): TaskView` — `NOT_FOUND` 404 "Task not found." when missing, in another household, or in a private list the caller does not own.
- `createTask(db, ctx, input: CreateTaskInput): TaskView` — defaults `collectionId` to the caller's Inbox; `NOT_FOUND` 404 for an invisible target, `FORBIDDEN` 403 for a view-only one, `VALIDATION` 400 "Tasks live in lists." for a calendar; writes `status: "open"`, `createdBy = ctx.userId`, and `sortOrder = max + 1` in the target list.
- `updateTask(db, ctx, id, input: UpdateTaskInput): TaskView` — writable current list; `NOT_FOUND`/`FORBIDDEN` as above, plus the same checks (404/403/400 for a calendar target) on a `collectionId` move; a move appends at `max + 1` in the target list. Whitelist: `title`, `notes`, `scheduledOn`, `dueOn`, `status`, `sortOrder`, `collectionId`, `checklist`. `status` moves the audit stamps only on a real transition — `"done"` sets `completedAt` and clears `droppedAt`, `"dropped"` sets `droppedAt` and clears `completedAt`, `"open"` clears both, and a PATCH echoing the stored status changes nothing. A present `checklist` replaces the whole list in a transaction. An empty patch is a read.
- `deleteTask(db, ctx, id): void` — visible + writable, then a hard delete; the checklist cascades.
- `reorderTasks(db, ctx, input: ReorderTasksInput): TaskView[]` — visible + writable list (a calendar is `VALIDATION` 400 "Tasks live in lists."); `orderedIds` must equal exactly the list's open task ids as a set, else `VALIDATION` 400 "Send exactly the open tasks of this list."; writes `sortOrder = index` in one transaction and returns the reordered views.

**State & side effects** — Reads `task`, `task_checklist_item`, `collection`; writes `task` (insert/update/delete) and `task_checklist_item` (delete-all then insert). `listTasks` may insert the caller's Inbox collection; every other read is read-only. `updateTask` wraps the row patch and the checklist replacement in one `db.transaction` when `checklist` is present; `reorderTasks` wraps its N updates. Checklist ids are always server-generated `crypto.randomUUID()`; timestamps are `Date.now()`; a moved task is appended at `max + 1` in the target list. No cache invalidation (the client owns query invalidation).

**Depends on / Used by** — `drizzle-orm` (`and`, `asc`, `eq`, `inArray`), `task`/`taskChecklistItem`/`collection` rows, `AppError`, `lib/domain/tasks.ts` (`bucketOf`, `endOfWeek`, `isOverdue`, `localToday`, `BucketContext`, `TaskBucket`), the task validation input types, and `./collections` (`assertCollectionWritable`, `ensureInbox`, `getCollectionAccess`, `resolveVisibleCollections`). No API route imports it yet — Task 6 adds `lib/api/handlers/tasks.ts`; today its only consumers are the integration tests, and `TaskView` is the payload shape the Tasks UI will consume.

**Debugging**
- A partner can see a private list's task -> a path skipped the collection resolver -> `listTasks`'s `visibleIds` / `getTask`'s `taskAccess`.
- A done or dropped task still appears in a view -> the query filtered on something other than `status = 'open'` -> `listTasks`.
- Badge counts change when a list or view is selected -> `counts` were computed after the filter instead of from all visible open tasks -> `listTasks`.
- A task dated beyond this week is missing from Today/Week/Someday -> intended: `bucketOf` returns `null`, so only `view: "all"` includes it -> `lib/domain/tasks.ts`.
- Reorder returns 400 "Send exactly the open tasks of this list." -> the payload was not the full open set (partial, duplicate, done/dropped, cross-list or missing id); a stale client must re-fetch -> `reorderTasks`.
- A deleted task cannot be restored from a trash -> there is none: `deleteTask` hard-deletes and the checklist cascades, so undo re-creates the task with a new id -> the undo call site, `lib/services/tasks.ts`.
- Checklist item ids change on every save -> intended: a checklist PATCH is a full replacement, not a diff -> `replaceChecklist`.
- A task moved between lists lands last -> intended: a move appends at `max + 1` in the target list, like a create -> `updateTask`.
- Sending the current status again rewrites `completedAt`/`droppedAt` -> it must not: the stamps move only on a real transition, so an echoed status leaves the row untouched -> `updateTask`.
- Creating or moving a task into a calendar, or reordering a calendar, returns 400 "Tasks live in lists." -> intended: a task lives only in a `kind: "list"` collection; calendars hold events -> `assertTaskList`.

**Tests** — `tests/integration/tasks.test.ts` (Inbox default and insert order, explicit dates and list summary, private/view-only/foreign create guards, calendar-kind rejection for create/move/reorder, both week-start conventions across all four buckets, global counts vs view/collection filters, overdue boundaries, move permissions, append-on-move, transition-only status timestamps, checklist replace/clear and id regeneration, reorder success plus partial/duplicate/cross-list/done rejection, partner 404 on get/list/update/delete, view-only read/write split, cascade delete, schema parsing).

## Focused verification

```bash
npx vitest run tests/integration/collections.test.ts tests/integration/events.test.ts tests/integration/tasks.test.ts tests/integration/search-api.test.ts tests/integration/import-service.test.ts tests/unit/permissions.test.ts
npm run lint && npm run typecheck
```
