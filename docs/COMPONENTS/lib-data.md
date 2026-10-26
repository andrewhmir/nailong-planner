# Data layer: DB, queries, auth and validation

The storage and transport foundation of the planner: the Drizzle/SQLite schema, the connection and migration singletons, the TanStack Query hooks and optimistic caches that mirror that schema in the browser, the Better Auth instance, and the Zod schemas every write endpoint validates against. Read this doc before changing a column, a query key, a cache update, an auth table, or an API payload shape.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, update its section and run `npm run docs:check`.

| File | Role |
|---|---|
| lib/db/schema.ts | Domain tables (`household`, `member`, `user_preference`, `collection`, `event`, `task`, `task_checklist_item`, `import_batch`, `import_change`) plus row types; re-exports the auth tables |
| lib/db/auth-schema.ts | Generated Better Auth tables (`user`, `session`, `account`, `verification`, `two_factor`) and their relations |
| lib/db/client.ts | Opens better-sqlite3 with WAL + foreign keys and wraps it in Drizzle |
| lib/db/index.ts | Lazy app-wide database singleton that migrates on first use |
| lib/db/migrate.ts | Applies the committed SQL migrations in `drizzle/` |
| lib/query/collections.ts | `useCollections` plus create/update/delete collection mutations |
| lib/query/events.ts | Range query, search-compatible cache keys, optimistic create/update/delete with rollback |
| lib/query/eventCache.ts | Pure array helpers used by the optimistic event cache and the undo path |
| lib/query/preferences.ts | Preferences query seeded from the server layout, plus a sequence-guarded patch mutation |
| lib/query/search.ts | Event search query and the "where should a result open" helper |
| lib/query/tasks.ts | Task view/counts query plus create/update/delete/reorder mutations (only PATCH is optimistic) |
| lib/query/taskCache.ts | Pure `{ tasks, counts }` payload helper for the optimistic task cache |
| lib/auth/server.ts | Better Auth factory and lazy app singleton (two-user cap, rate limiting, 2FA/admin plugins) |
| lib/auth/users.ts | `MAX_USERS` and user-table reads used by the sign-up hook and provisioning |
| lib/validation/collections.ts | Zod schemas for collection create/update |
| lib/validation/events.ts | Zod schemas for event create/update plus the all-day/timed shape invariant |
| lib/validation/preferences.ts | Strict Zod schema for the per-user preference PATCH |
| lib/validation/settings.ts | Zod schemas for household and profile updates |
| lib/validation/tasks.ts | Zod schemas for task create/update, reorder and the list query |

## Entity model

Fourteen tables exist in the migrated database (eight migrations: `0000_even_morg`, `0001_tiny_falcon`, `0002_user_preference`, `0003_salty_stranger`, `0004_normalise_subcalendar_owners`, `0005_sloppy_praxagora`, `0006_collections_and_tasks`, `0007_sharp_leper_queen`). `household` is the tenancy boundary; every domain query filters on `household_id`. Column names below are the SQLite names, with the Drizzle field in parentheses when it differs.

| Table | Key columns | Constraints and relations |
|---|---|---|
| `household` | `id` (PK), `name` default `'Our Nest'`, `timezone` default `'Asia/Taipei'`, `week_starts_on` default `0`, `created_at` | No foreign keys. Single row in practice. |
| `member` | `user_id` (PK), `household_id`, `role` default `'member'`, `created_at` | `household_id` -> `household.id` `ON DELETE cascade`. `user_id` is a logical reference to `user.id` — no FK. |
| `user_preference` | `user_id` (PK), `default_view` default `'auto'`, `time_format` default `'24h'`, `show_week_numbers` default `0`, `shortcuts_enabled` default `1`, `last_event_calendar_id` nullable, `updated_at` | No FK. Row is lazy: absent means all defaults, and reads never insert. |
| `collection` | `id` (PK), `household_id`, `parent_id` nullable, `kind` default `'calendar'`, `name`, `hue_family` nullable, `shade_index` default `0`, `owner_id` nullable, `visibility` default `'shared'`, `sort_order` default `0`, `created_at`, `updated_at` | `household_id` -> `household.id` cascade; `parent_id` -> `collection.id` cascade (self-referencing nesting). Indexes `collection_household_idx`, `collection_parent_idx`. `kind` is `calendar`/`list`; `visibility` is `shared`/`view_only`/`private` — migration `0006` replaced `is_view_only_for_partner` (`1` -> `view_only`) and added both columns. `hue_family` is meaningful on roots only; children inherit the family and carry `shade_index`. `owner_id` null means shared ("Ours"); a child mirrors its root's `owner_id` (`updateCollection` cascades an owner move, migration `0004` backfilled legacy rows). Logical ref to `user.id`. |
| `event` | `id` (PK), `household_id`, `collection_id`, `title`, `description`, `location`, `all_day` default `0`, `start_at`, `end_at`, `start_date`, `end_date`, `rrule`, `exdates`, `recurrence_parent_id`, `recurrence_id`, `tzid`, `external_source`, `external_uid`, `external_recurrence_id`, `external_key`, `external_content_hash`, `created_by`, `created_at`, `updated_at` | `household_id` and `collection_id` (renamed from `calendar_id` by migration `0006`; the Drizzle property is `collectionId`, renamed from `calendarId` in Task 2) both cascade. `recurrence_parent_id` is a self-FK to `event.id` with `ON DELETE CASCADE` (migration `0005_sloppy_praxagora`), so deleting a series deletes its exception rows; `recurrence_id` is the original occurrence key an exception replaced. Indexes `event_household_start_idx` (`household_id`,`start_at`), `event_household_start_date_idx` (`household_id`,`start_date`), `event_collection_idx`, `event_recurrence_parent_idx` (`recurrence_parent_id`), and the unique `event_household_external_key_idx`. `start_at`/`end_at` are UTC epoch ms for timed rows; `start_date`/`end_date` are household-local `YYYY-MM-DD` for all-day rows with an inclusive `end_date`. `exdates` is JSON text. `created_by` is a logical ref to `user.id`. |
| `task` | `id` (PK), `household_id`, `collection_id`, `title`, `notes` nullable, `status` default `'open'`, `priority` default `'none'`, `scheduled_on` nullable, `due_on` nullable, `completed_at` nullable, `dropped_at` nullable, `sort_order` default `0`, `created_by`, `created_at`, `updated_at` | Added by migration `0006`; `priority` added by `0007`. `household_id` -> `household.id` cascade; `collection_id` -> `collection.id` cascade. Indexes `task_household_status_idx` (`household_id`,`status`), `task_collection_idx`, `task_scheduled_idx`, `task_due_idx`. `scheduled_on`/`due_on` are household-local **date-only** `YYYY-MM-DD` strings, never epochs; `status` is `open`/`in_progress`/`done`/`dropped` (active = open or in_progress); `priority` is `none`/`low`/`normal`/`high`/`urgent`; `completed_at`/`dropped_at` are epoch-ms audit stamps. `created_by` is a logical ref to `user.id`. |
| `task_checklist_item` | `id` (PK), `task_id`, `title`, `done` default `0`, `sort_order` default `0` | Added by migration `0006`. `task_id` -> `task.id` cascade; index `task_checklist_task_idx`. Flat, no nesting. |
| `user` | `id` (PK), `name`, `email` unique, `email_verified` default false, `image`, `created_at`, `updated_at`, `role`, `banned`, `ban_reason`, `ban_expires`, `two_factor_enabled` | Better Auth table. Unique index `user_email_unique`. |
| `session` | `id` (PK), `expires_at`, `token` unique, `created_at`, `updated_at`, `ip_address`, `user_agent`, `user_id`, `impersonated_by` | `user_id` -> `user.id` cascade; unique `session_token_unique`; index `session_userId_idx`. |
| `account` | `id` (PK), `account_id`, `provider_id`, `user_id`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at` | `user_id` -> `user.id` cascade; index `account_userId_idx`. Email/password sign-in stores the hash in `password`. |
| `verification` | `id` (PK), `identifier`, `value`, `expires_at`, `created_at`, `updated_at` | Index `verification_identifier_idx`. Uses Better Auth's `identifier`, not `identifier_id`. |
| `two_factor` | `id` (PK), `secret`, `backup_codes`, `user_id`, `verified` default true, `failed_verification_count` default 0, `locked_until` | `user_id` -> `user.id` cascade; indexes `twoFactor_secret_idx`, `twoFactor_userId_idx`. |

Cross-table rules that are enforced in code rather than SQL:

- No FK joins `member.user_id`, `collection.owner_id`, `event.created_by`, `task.created_by`, or `user_preference.user_id` to `user.id`. The comment in `lib/db/schema.ts` states they are logical refs validated in the service layer, because SQLite would need a table rebuild to add them.
- Collection cascade is recursive at the SQL level: deleting a parent deletes its children, and their events go with them (asserted in `tests/integration/db.test.ts`). Tasks attached to a deleted collection cascade too, then their checklist items.
- Domain tables store timestamps as plain integers via `$defaultFn(() => Date.now())`, while Better Auth tables use `mode: "timestamp_ms"` and therefore hydrate as `Date` objects. See the gotchas at the end.
- Task dates are **date-only strings**, unlike event instants: `task.scheduled_on`/`task.due_on` are `YYYY-MM-DD`, never epoch milliseconds.

## Database

### lib/db/schema.ts

**Purpose** — Drizzle ORM table definitions for the nine domain tables, their inferred row types, and a re-export of Better Auth's tables so one schema map serves the app and the auth adapter.

**Public API** — tables `household`, `member`, `userPreference`, `collection`, `event`, `task`, `taskChecklistItem`, `importBatch`, `importChange`; types `HouseholdRow`, `MemberRow`, `UserPreferenceRow`, `CollectionRow`, `CollectionKind`, `CollectionVisibility`, `EventRow`, `TaskRow`, `TaskStatus`, `TaskPriority`, `TaskChecklistItemRow`, `ImportBatchRow`, `ImportChangeRow` (all `typeof table.$inferSelect`); `export * from "./auth-schema"` at the bottom, which re-exports `user`, `session`, `account`, `verification`, `twoFactor` and their `relations()` helpers.

**State & side effects** — No connection, no I/O, no side effects. Column semantics that matter:
- Every domain table's `createdAt`/`updatedAt` is `integer(...).$defaultFn(() => Date.now())`, so inserts get epoch milliseconds from JS and selects return `number`, not `Date`. `collection.updatedAt` and `task.updatedAt` also carry `$onUpdate(() => Date.now())`.
- `collection.parentId` uses `references((): AnySQLiteColumn => collection.id)` to express the self-FK; `onDelete: "cascade"`.
- `collection.kind` (`calendar`/`list`, default `calendar`) and `collection.visibility` (`shared`/`view_only`/`private`, default `shared`) are the v0.2 columns; `visibility` replaced the old `is_view_only_for_partner` integer in migration `0006`.
- `event.allDay`, `task.done`, `userPreference.showWeekNumbers` and `shortcutsEnabled` are `integer` (0/1), not `boolean`.
- `event.collectionId` is the Drizzle property for the SQL column `collection_id` (migration `0006`), and the index `event_collection_idx` targets it; the Drizzle property and the SQL column agree. Task 2 renamed the property from `calendarId` to `collectionId`, so no TypeScript alias remains.
- `event.exdates` is nullable JSON text; `event.startAt`/`endAt` and `startDate`/`endDate` are both nullable because all-day and timed rows populate different pairs.
- `event.recurrenceParentId` is a nullable self-FK (`references((): AnySQLiteColumn => event.id)`, `onDelete: "cascade"`) set only on a per-instance exception; `event.recurrenceId` stores the occurrence key the exception replaced (`YYYY-MM-DD` for all-day, an ISO instant for timed). Migration `0005_sloppy_praxagora` adds both plus `event_recurrence_parent_idx`. Exceptions are ordinary rows: the series keeps an EXDATE for the original slot, so nothing in expansion, rendering or search needs an override branch.
- `event.tzid` is the IANA zone a recurring timed series is expanded in; null means the household zone. Imported Google series store their source `TZID`, so the recurrence engine keeps their wall-clock time across a DST change.
- `event.externalSource`/`externalUid`/`externalRecurrenceId`/`externalKey`/`externalContentHash` are import provenance, all null for events created in Nailong. `event_household_external_key_idx` is a unique index on `(household_id, external_key)`; SQLite allows unlimited NULL keys, so native events never collide.
- `task.scheduledOn`/`dueOn` are nullable household-local `YYYY-MM-DD` strings; `task.status` is `open`/`in_progress`/`done`/`dropped` (v0.2.1 added `in_progress` as an active status; open and in_progress are the "active" pair the domain helpers use), `task.priority` is `none`/`low`/`normal`/`high`/`urgent` (default `none`, migration `0007`), `task.sortOrder` is the manual order within a list and `task.createdBy` is a logical ref to `user.id`. `task_checklist_item` is the flat checklist, cascading from its task.
- `import_batch` records one committed import (`status` `committed` | `rolled_back`, JSON `mapping`/`report`); `import_change` is its undo ledger, one row per inserted/updated event with `before_json` holding the replaced row. Deleting a batch cascades its changes; `import_change.event_id` deliberately has no FK.
- Comments mark `hueFamily` as root-only and `shadeIndex` as child-only (roots render at `PARENT_SHADE_INDEX`), and `ownerId` null as a shared collection.

**Depends on / Used by** — imports `drizzle-orm/sqlite-core`. Imported by `lib/api/route.ts`, every `lib/services/*` module, all pages under `app/(app)/`, the query hooks (type-only), `lib/auth/server.ts` (schema map), `tests/helpers/db.ts`, `tests/helpers/fixtures.ts`, and most integration/unit tests.

**Debugging** —
- All-day event missing from the grid while it exists in the table -> the range filter converts `range.from`/`range.to` to local `YYYY-MM-DD` with the household timezone and compares them to `startDate`/`endDate` -> check `household.timezone` and `listEvents` in `lib/services/events.ts`.
- `createdAt` prints as `[object Object]` or throws on `.getTime()` -> the code treated `EventRow.createdAt` as a `Date`; domain tables return `number` (contrast with `auth-schema.ts`).
- Calendar delete removes more rows than expected -> `parent_id` is a cascading self-FK; check the child tree before deleting (`lib/services/collections.ts`).
- A task lands on the wrong day around midnight or DST -> `scheduled_on`/`due_on` are household-local date strings, so compare them as strings; never convert them to epochs or UTC instants.
- Re-importing the same Google export creates duplicates -> the upsert is keyed on `(household_id, external_key)`; a duplicate means `external_key` was null or rebuilt differently -> check `parseIcs` in `lib/import/ics.ts`.
- A recurring imported event shifts by an hour after a DST change -> `event.tzid` is null or expansion is UTC-anchored -> check `expandOccurrences` in `lib/recurrence/expand.ts`.

**Tests** — `tests/integration/db.test.ts` (migrations apply, cascade deletes, FK enforcement, all-day/timed column separation, migration `0004` owner backfill, migration `0006` rename/visibility backfill/task tables); `tests/integration/import-schema.test.ts` (external-key uniqueness, NULL keys, import ledger cascade); fixtures in `tests/helpers/fixtures.ts`.

### lib/db/auth-schema.ts

**Purpose** — Better Auth's generated Drizzle tables (`user`, `session`, `account`, `verification`, `two_factor`) and their relation metadata, re-exported by `lib/db/schema.ts`.

**Public API** — tables `user`, `session`, `account`, `verification`, `twoFactor` (SQL name `two_factor`); relation builders `userRelations`, `sessionRelations`, `accountRelations`, `twoFactorRelations`. No functions or types are exported beyond the Drizzle table objects.

**State & side effects** — Pure definitions; no connection. Notable column behaviour:
- All timestamps use `integer(..., { mode: "timestamp_ms" })`, so reads hydrate as `Date` and writes must pass a `Date`.
- `created_at`/`updated_at` default in SQL to `cast(unixepoch('subsecond') * 1000 as integer)`; `updated_at` additionally carries `$onUpdate(() => new Date())` on `user`, `session`, `account`, `verification`. `two_factor` has no timestamps at all.
- `user.email` and `session.token` are `.unique()`; `session.userId` and `account.userId` are indexed and cascade from `user`.
- `user.role`, `banned`, `banReason`, `banExpires` and `session.impersonatedBy` exist because of the `admin()` plugin; `two_factor` and `user.twoFactorEnabled` come from the `twoFactor()` plugin.
- `session.updatedAt` has `$onUpdate` but no SQL default — Better Auth must supply it on insert.

**Depends on / Used by** — imports `relations`, `sql` from `drizzle-orm` and `sqlite-core`. Re-exported via `lib/db/schema.ts` (so `drizzleAdapter(..., { schema })` sees both halves); imported directly by `tests/integration/auth.test.ts`.

**Debugging** —
- Auth writes fail with a NOT NULL constraint on `session.updated_at` -> a hand-written insert omitted it; Better Auth normally fills it.
- Comparing `user.createdAt` with `event.createdAt` yields `Invalid Date`/NaN -> one side is a `Date` (auth table), the other a `number` (domain table).
- A join from `event.createdBy` to `user.id` "should" work but the query planner has no FK/index -> `event.created_by` has no index and no FK; filter by household first.

**Tests** — `tests/integration/auth.test.ts` (imports `account` to assert the stored password is hashed).

### lib/db/client.ts

**Purpose** — Opens a better-sqlite3 connection, applies the two required pragmas, and wraps it in Drizzle with the full schema map.

**Public API** — `resolveDatabasePath(databaseUrl: string): string` (strips a leading `file:`); `createDb(databaseUrl: string): { db, sqlite }`; `type Database = ReturnType<typeof createDb>["db"]`.

**State & side effects** — Per call: creates the parent directory with `mkdirSync(..., { recursive: true })` unless the path is exactly `:memory:`; runs `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`. No module-level cache — each `createDb` call opens a new handle, so callers that forget to `close()` leak connections (the test helper returns a `close`) and hold WAL locks.

**Depends on / Used by** — `better-sqlite3`, `node:fs`, `node:path`, `drizzle-orm/better-sqlite3`, `./schema`. Used by `lib/db/index.ts` (the app singleton), `lib/auth/server.ts` and every `lib/services/*` module (type `Database`), `lib/api/route.ts`, and the scripts `provision.mts`, `migrate.mts`, `backup.mts`, `reset-password.mts`, `seed-test-db.mts`.

**Debugging** —
- `SQLITE_CANTOPEN` on startup -> `DATABASE_URL` has a relative path and the process cwd differs (scripts run from the repo root by convention) -> log the resolved path from `resolveDatabasePath`.
- Foreign-key violations are not raised -> the caller built its own `new Database(...)` without `PRAGMA foreign_keys = ON` -> check `createDb` was used (tests/helpers/db.ts sets the pragma itself).
- Stale reads across processes -> WAL mode allows one writer; a second long-lived connection (a script) blocks writes -> close the other handle.

**Tests** — No direct test coverage. `tests/integration/db.test.ts` opens its own better-sqlite3 handle rather than `createDb`.

### lib/db/index.ts

**Purpose** — Lazily opens the application database on first use and applies pending migrations, so a container needs no separate migration step.

**Public API** — `getDb(): Database`; `getSqlite(): better-sqlite3` instance (calls `getDb()` first if nothing is cached).

**State & side effects** — Module-level `cached` holds both `db` and `sqlite` for the process lifetime, so there is exactly one connection per server process. The first call validates the production environment (`assertProductionEnv`: explicit `DATABASE_URL`, a 32+ character `BETTER_AUTH_SECRET`, an absolute `BETTER_AUTH_URL`), creates the data directory, calls `createDb(env.DATABASE_URL)` and then `migrate(...)`; migrations run inside the first request (or the first page render) rather than at build time. `cached` is assigned only after `migrate()` succeeds: a failed migration closes the half-open connection, rethrows, and the next request retries instead of serving a half-built schema. Errors surface as route 500s and as a 503 from `/api/health`.

**Depends on / Used by** — `@/lib/env` (`DATABASE_URL` and `assertProductionEnv`), `./client`, `./migrate`. Called by `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/settings/page.tsx`, `lib/api/route.ts` (`withViewer` passes `db` to every handler), `lib/auth/server.ts` (`getAuth`), and `app/api/health/route.ts` (via `getSqlite`).

**Debugging** —
- First request slow or a burst of migration errors right after deploy -> migrations run lazily on that request -> check the `drizzle/` folder is present in the runtime image.
- `/api/health` returns 503 -> the singleton could not open or migrate the database, or the production environment is invalid -> read the `[health] database check failed` log; the preceding `[db] could not open "<path>" (cwd=…, uid=…)` line names the resolved path, the working directory and the process user — that is what distinguishes a wrong `DATABASE_URL` from a volume-permission problem.
- A migration error keeps repeating on every request -> that is the intended fail-fast: `cached` is never set when `migrate()` throws, so the deploy stays unhealthy instead of serving a half-built schema. Fix the migration and redeploy.
- Two connections in one process (e.g. WAL growth, lock contention) -> a script imported `createDb` directly alongside `getDb` -> they are separate handles by design.

**Tests** — No direct coverage; integration tests use `tests/helpers/db.ts` (`makeTestDb`) to avoid the singleton and get an isolated in-memory database.

### lib/db/migrate.ts

**Purpose** — Thin wrapper over Drizzle's better-sqlite3 migrator that applies every committed SQL migration from `drizzle/`.

**Public API** — `migrate(db: Database, migrationsFolder = resolve(process.cwd(), "drizzle")): void`.

**State & side effects** — Synchronous. Drizzle records applied entries in its own `__drizzle_migrations` table keyed by the `drizzle/meta/_journal.json` tags; migrations already applied are skipped. No caching, no transaction wrapper written here (the migrator handles ordering). Current journal: `0000_even_morg` (domain tables + indexes), `0001_tiny_falcon` (Better Auth tables), `0002_user_preference`, `0003_salty_stranger` (import ledger + external event columns), `0004_normalise_subcalendar_owners` (owner backfill), `0005_sloppy_praxagora` (recurrence_parent_id self-FK, recurrence_id, event_recurrence_parent_idx), `0006_collections_and_tasks` (renames `calendar` -> `collection`, adds `kind`/`visibility`, renames `event.calendar_id` -> `collection_id`, adds `task` + `task_checklist_item`). Tests may pass a temporary truncated folder via `makeTestDb({ upTo })` (`tests/helpers/db.ts`) to build the pre-migration schema; the real `drizzle/` folder is never modified.

**Depends on / Used by** — `drizzle-orm/better-sqlite3/migrator` and `./client` (type only). Called by `lib/db/index.ts`, `tests/helpers/db.ts`, and the scripts `migrate.mts`, `provision.mts`, `backup.mts`, `reset-password.mts`, `seed-test-db.mts`.

**Debugging** —
- `Can't find meta/_journal.json` -> the default folder resolved against the wrong cwd (a script launched outside the repo root) -> pass an explicit `migrationsFolder` or run from the repo root.
- A new column is missing at runtime while the SQL file exists -> the file was never added to `_journal.json` (generate it with Drizzle Kit, do not hand-write) -> check the journal entries.
- Migration error leaves the database half-applied -> the migrator stops at the first failure; restore the `data/` backup before retrying (see `docs/OPERATIONS.md`).

**Tests** — Exercised indirectly by every integration test through `tests/helpers/db.ts`; `tests/integration/db.test.ts` asserts the resulting schema behaviour. No test targets `migrate` alone.

## Client data fetching (TanStack Query)

Shared setup: `app/providers.tsx` creates one `QueryClient` with `staleTime: 10_000`, `refetchOnWindowFocus: false`, `retry: 1`. All hooks in this group are `"use client"` and each file defines its own small `requestJson` helper that unwraps `{ error: { message } }` into an `Error`.

### lib/query/collections.ts

**Purpose** — Fetches the household calendar tree and exposes create/update/delete calendar mutations.

**Public API** — `interface CollectionInput { name; parentId?; kind?; hueFamily?; ownerId?; visibility? }`; hooks `useCollections()` (query key `["collections"]`), `useCreateCollection()`, `useUpdateCollection()`, `useDeleteCollection()`. Mutations resolve to `{ collection: CollectionRow }` (create/update) or `void` (delete).

**State & side effects** — Query key: `["collections"]` (single entry, holds `CollectionNode[]` from `lib/services/collections`). GET `/api/collections`; POST `/api/collections`; PATCH `/api/collections/{id}` (accepts `sortOrder` in addition to the create fields); DELETE `/api/collections/{id}`. Invalidation: create invalidates `["collections"]`; update invalidates `["collections"]`, `["tasks"]` and `["events"]` because a rename, hue or visibility change is painted in task-row dots and calendar chips too; delete invalidates `["collections"]`, `["events"]` and `["tasks"]` because child collections, their events and their tasks are cascaded away. No optimistic updates in this file.

**Depends on / Used by** — `@tanstack/react-query`, `CollectionRow` type, `CollectionNode` type. Used by `components/calendar/CalendarShell.tsx` (`useCollections`), `components/sidebar/CollectionTree.tsx` (all four hooks), `components/sidebar/SidebarMiniMonth.tsx`, `components/settings/CalendarPreferencesCard.tsx` and `components/calendar/SearchResultsOverlay.tsx` (`useCollections`). `components/sidebar/CollectionDialog.tsx` only imports the `CollectionRow` type from `lib/db/schema`.

**Debugging** —
- Sidebar shows a stale calendar name after a rename -> the PATCH succeeded but the tree query is within its 10 s `staleTime` and nothing invalidated it -> check `useUpdateCollection().onSuccess`.
- Deleted calendar's events linger on the grid -> only `["collections"]` was invalidated by a custom call site -> compare with `useDeleteCollection`.
- `hueFamily` missing on a child -> children inherit the family from the root; only roots carry `hueFamily` (`calendar.hue_family` is nullable).

**Tests** — No direct test coverage (the hooks are exercised through `tests/e2e/sidebar.spec.ts`, `tests/e2e/calendar-picker.spec.ts` and the API suite `tests/integration/collections-api.test.ts`).

### lib/query/events.ts

**Purpose** — Range query for the visible grid window and the three event mutations, each with an optimistic cache write over every cached `["events"]` range plus a snapshot rollback.

**Public API** — `interface EventRange { from; to }` (UTC epoch ms; `from` inclusive, `to` exclusive for timed rows — upstream `listEvents` compares all-day rows as local dates instead); `type RecurringScope = "this" | "following" | "all"`; `interface EventInputPayload` (all event fields optional, `exdates: string[]`, plus the scope envelope `scope`/`occurrenceStart` and the undo-only `recurrenceParentId`/`recurrenceId`); `interface UpdateEventResult { event; truncated?; relinked?; relinkedPrevious? }`; `interface DeleteEventResult { deleted?; truncated?; segmentId? }`; hooks `useEvents(range)`, `useCreateEvent()`, `useUpdateEvent()`, `useDeleteEvent()`. Delete takes `{ id, scope?: RecurringScope, occurrenceStart? }` and resolves the server's deleted rows; `segmentId` lets a following-delete undo exclude the merged-back segment.

**State & side effects** — Query key: `["events", range?.from ?? 0, range?.to ?? 0]`; disabled while `range` is null (the key still exists as `["events", 0, 0]`). GET `/api/events?from=&to=`; POST `/api/events`; PATCH `/api/events/{id}`; DELETE `/api/events/{id}` with a JSON body `{ scope, occurrenceStart }`.
- Snapshot/rollback: `snapshotEvents` cancels the `["events"]` queries and stores every `[key, data]` pair; `restoreEvents` writes them back on error. Both are module-private.
- Create: appends an optimistic `temp-<uuid>` row to every cached range (`householdId` and `createdBy` are empty strings, `color` is `shadeTokens("slate", 1)`); on success `replaceEvent` swaps it for the server row, keeping its index.
- Update: `patchList` maps the payload onto `Partial<EventView>` and always stamps `updatedAt: Date.now()`. **Scoped writes do no optimistic patch** (`scope` present): they change several rows or split a series, so the invalidation renders the authoritative result instead of a guessed shape.
- Delete `scope: "all"` filters the row and its linked exceptions out of the cache; `scope: "this"` appends the occurrence to `exdates`, skipping the write when the key is already present; `scope: "following"` has no optimistic patch.
- `onSettled` invalidates `["events"]` for all three mutations, which also refetches `["events", "search", …]` because it shares the prefix.

**Depends on / Used by** — `lib/color/palette` (`shadeTokens`), `lib/query/eventCache`, `EventView` type. Used by `components/calendar/CalendarShell.tsx`, `components/calendar/EventDialog.tsx`, `components/calendar/QuickCreatePopover.tsx`, `components/sidebar/SidebarMiniMonth.tsx`; `EventInputPayload` is the payload type of `components/calendar/eventPayload.ts`.

**Debugging** —
- Event disappears instantly then reappears -> optimistic write ran and the request failed, so `restoreEvents` replayed the snapshot -> look for the thrown `Error` message from `requestJson`.
- A newly created event shows a grey/slate block -> that is the optimistic placeholder colour; if it never updates, the server row never replaced it -> check the `tempId` match in `onSuccess`.
- Two `useEvents` consumers with different ranges show different data -> each range is a separate cache entry; `setQueriesData({ queryKey: ["events"] })` intentionally patches all of them.
- Deleting one occurrence leaves the grid unchanged -> `occurrenceStart` did not match the stored EXDATE format (all-day: `YYYY-MM-DD`, timed: ISO string) -> check `parseExdates` callers.
- A scoped move shows the old row until the refetch -> expected: scoped writes skip the optimistic patch; if it never updates, `onSettled` invalidation was dropped -> `useUpdateEvent`/`useDeleteEvent`.
- Undo leaves a duplicate block after a split -> the undo closure recreated the pre-split exceptions under the old series but did not filter the merged-back segment; a following-delete undo must use the response's `segmentId` and restore the old rule instead of recreating both segments -> `CalendarShell.confirmDeleteScope` undo.

**Tests** — No direct hook test. The cache behaviour is asserted in `tests/unit/event-cache.test.ts` (helpers) and end-to-end in `tests/e2e/events.spec.ts`, `tests/e2e/recurring-scope.spec.ts`, `tests/e2e/undo.spec.ts`, `tests/e2e/shortcuts.spec.ts`.

### lib/query/eventCache.ts

**Purpose** — Pure, framework-free array helpers for the optimistic event cache; every TanStack range query under `["events"]` holds an `EventView[]`, so each helper maps one array and the mutation hooks apply it to every cached range.

**Public API** —
- `type EventCacheMap = Record<string, EventView[]>`
- `applyEventPatch(events: EventView[], id: string, patch: Partial<EventView>): EventView[]`
- `removeEvent(events: EventView[], id: string): EventView[]`
- `replaceEvent(events: EventView[], event: EventView): EventView[]`
- `parseExdates(raw: string | null): string[]`

**State & side effects** — None: all four functions are pure and allocate new arrays (the input is never mutated, asserted in the unit test).

- `applyEventPatch` maps and spreads; a missing `id` is a no-op.
- `removeEvent` filters by id.
- `replaceEvent` finds the first row whose id starts with `temp-` **or** equals `event.id`, drops every temp row and any existing row with that id, then re-inserts the server row at the original index (clamped to the kept length). A range with no match appends.
- `parseExdates` treats `null`, non-JSON and non-array payloads as `[]` and keeps only string entries.

**Optimistic update / rollback and the undo path** — These helpers are the write side of the cache; the read/restore side is private to `lib/query/events.ts` (`snapshotEvents` + `restoreEvents`), so a mutation's rollback is always "restore the whole `["events"]` snapshot", never a per-helper inverse. The user-visible undo lives in `lib/ui/undo.ts` and replays the opposite *mutation*, which re-enters these helpers:

- Delete an event (`components/calendar/CalendarShell.tsx`, `requestDeleteFor`) pushes `{ label: "Delete event", undo: createEvent.mutateAsync(eventToPayload(event)) }`; `eventToPayload` there uses `parseExdates` to rebuild the `exdates` array.
- Delete a series (`confirmSeriesDelete`, `scope: "all"`) does the same; skipping one occurrence (`scope: "this"`) computes the remaining dates with `parseExdates(event.exdates).filter(key => key !== occurrenceStart)` and undoes by calling `updateEvent.mutateAsync({ id, exdates: remaining })`.
- Drag-move undo calls `updateEvent.mutateAsync` with the previous `allDay`/`startAt`/`endAt`/`startDate`/`endDate` payload (`patchList` path).
- Create undo (`components/calendar/EventDialog.tsx`, `components/calendar/QuickCreatePopover.tsx`) calls `deleteEvent.mutateAsync({ id: event.id, scope: "all" })`, i.e. `removeEvent` on the cache.
- `tests/e2e/undo.spec.ts` covers the toast, `Ctrl+Z` and plain `z` paths; `tests/e2e/shortcuts.spec.ts` asserts `z` is undo while `Delete` deletes.

**Depends on / Used by** — `EventView` type only. Imported by `lib/query/events.ts` (all four helpers) and `components/calendar/CalendarShell.tsx` (`parseExdates` only).

**Debugging** —
- Reordering after quick create -> `replaceEvent` inserts at the *first* temp row it finds, so two overlapping creates in one range can swap positions -> verify only one temp row is present.
- Undo restores an event with a different id -> undo is implemented as create, not as a server-side "restore"; the new row gets a new id, so any stale reference (open dialog, selection) points at the old one -> re-select after undo.
- Garbage in `exdates` silently behaves as "no exceptions" -> `parseExdates` swallows `JSON.parse` failures -> log the raw column value when a repeating event will not skip.
- A patch drops a field -> `applyEventPatch` only replaces keys present in `patch`; `undefined` in the patch would blank the field, which is why `patchList` skips undefined.

**Tests** — `tests/unit/event-cache.test.ts` covers `applyEventPatch`, `removeEvent`, `replaceEvent` (including index preservation). `parseExdates` has no direct unit test; it is covered indirectly by `tests/e2e/events.spec.ts` and `tests/e2e/undo.spec.ts`.

### lib/query/preferences.ts

**Purpose** — Reads the signed-in user's calendar preferences (seeded from the server render so first paint is correct) and patches them with an out-of-order-safe optimistic update.

**Public API** — `const preferencesKey = ["preferences"] as const`; `usePreferences(initialData: UserPreferences): UserPreferences`; `useUpdatePreferences()` returning a mutation over `Partial<UserPreferences>` that resolves to `{ preferences }`.

**State & side effects** — Query key: `["preferences"]`, with `initialData` (the row the server layout already read) and `staleTime: Infinity`, so the GET `/api/settings/preferences` normally never refires. PATCH `/api/settings/preferences`.
- The mutation keeps a `useRef` counter (`latestIssued`). `onMutate` increments it, records the sequence, cancels the query, merges the patch into the cache and returns `{ previous, sequence }`.
- `onError` restores `previous`. `onSuccess` writes the server's canonical row **only if** its sequence is still the latest, so a slow earlier response cannot overwrite a newer toggle.
- The hook never invalidates or refetches: the PATCH response is treated as the source of truth.

**Depends on / Used by** — `UserPreferences` type from `lib/services/preferences`. Used by `components/calendar/CalendarShell.tsx` (view/time-format/shortcuts), `components/settings/CalendarPreferencesCard.tsx`, and `useUpdatePreferences` alone by `components/calendar/EventDialog.tsx` and `components/calendar/QuickCreatePopover.tsx` (both persist `lastEventCalendarId`).

**Debugging** —
- Toggling a preference twice quickly ends on the first value -> the second PATCH resolved first and the guard rejected the stale one -> inspect `latestIssued`/`sequence` handling and confirm both requests reached the server.
- A setting reverts after a reload but looks right in the UI -> the optimistic cache was never persisted (server rejected the PATCH) -> check the response body/status in the network panel.
- A preferences change is not reflected elsewhere in the same tab -> everything reads the single `["preferences"]` entry -> check whether that component copied the value into local state instead of calling `usePreferences` (compare `components/calendar/CalendarShell.tsx` and `components/settings/CalendarPreferencesCard.tsx`).

**Tests** — No direct test coverage; the endpoint is covered by `tests/integration/preferences-api.test.ts`, the UI by `tests/e2e/preferences.spec.ts`, `tests/e2e/view-preference.spec.ts` and `tests/e2e/quick-create.spec.ts`.

### lib/query/search.ts

**Purpose** — Title/description event search for the header search box, plus a helper that decides which date the grid should open at when a result is clicked.

**Public API** — `useSearchEvents(query: string)` returning the matching `EventView[]`; `navigableDateFor(event: EventView, timezone: string): string`.

**State & side effects** — Query key: `["events", "search", normalized]` where `normalized = query.trim().toLowerCase()`. Deliberately shares the `["events"]` prefix so every event mutation's invalidation refreshes search results too. `enabled` only when `normalized.length >= 2`; the request itself sends `/api/events/search?q=<query.trim()>` (trimmed but **not** lower-cased). `placeholderData: keepPreviousData` keeps the previous list on screen while the next keystroke resolves. `navigableDateFor` expands a recurring row with `expandOccurrences` over `[now, now + 2 years]` and returns `occurrenceDate(event, next.startKey, timezone)`; non-recurring rows use `startDate` (all-day) or the ISO string of `startAt`.

**Depends on / Used by** — `@tanstack/react-query` (`keepPreviousData`), `lib/recurrence/expand`, `lib/time/format` (`occurrenceDate`), `EventView`. Used by `components/calendar/SearchBox.tsx` and `components/calendar/SearchResultsOverlay.tsx`.

**Debugging** —
- Typing one character shows no results -> intentional (`enabled` requires two characters) -> check the caller does not render an empty state as an error.
- Search results contain an unsaved event with a `temp-` id -> optimistic create/update writes use `setQueriesData({ queryKey: ["events"] })`, which also matches this key -> expect transient temp rows until `onSettled` invalidates.
- Clicking a recurring result opens the series' original month instead of the next occurrence -> `expandOccurrences` returned nothing (EXDATE-only series, or a rule outside the next two years) -> check the stored `rrule`/`exdates`.
- Results flicker to empty between keystrokes -> `keepPreviousData` was dropped or the key lost its `"search"` segment.

**Tests** — No direct test coverage for the hook; `navigableDateFor` is exercised through `tests/e2e/search.spec.ts`, and the endpoint through `tests/integration/search-api.test.ts`.

### lib/query/tasks.ts

**Purpose** — The Tasks data layer: one query for a task view (or one list) with the rail counts, one counts-only query the sidebar can enable per route, plus create/update/delete/reorder mutations. Only the update mutation writes the cache optimistically; every mutation invalidates the `["tasks"]` prefix on settle, which also refreshes the counts query.

**Public API** — `useTasks(view?: TaskBucket | "all", collectionId?: string, includeClosed?: boolean)`; `useTaskCounts(options?: { enabled?: boolean })` returning `TaskCountSummary` (`{ counts: TaskCounts; byCollection: Record<string, number> }`); `useCreateTask()` over `CreateTaskInput` → `{ task: TaskView }`; `useUpdateTask()` over `{ id: string } & UpdateTaskInput` → `{ task: TaskView }`; `useDeleteTask()` over `string` → `void`; `useReorderTasks()` over `ReorderTasksInput` → `{ tasks: TaskView[] }`. The view query resolves to `{ tasks: TaskView[]; counts: TaskCounts }`, and `patchTask(input: UpdateTaskInput): Partial<TaskView>` is exported so the cache test can drive the optimistic patch without a renderer.

**State & side effects** — The view query key is `["tasks", view ?? "all", collectionId ?? null, includeClosed ? "closed" : "open"]`, so an omitted view and `"all"` share one cache entry and the open/closed variants never collide. `GET /api/tasks?view=&collectionId=&includeClosed=true` (each param omitted when undefined/false; `includeClosed=true` is sent only when the flag is on). The counts query key is `["tasks", "counts"]` and it calls `GET /api/tasks/counts` with `enabled: options?.enabled ?? true`; no component calls it yet — the sidebar's `pathname.startsWith("/tasks")` gate lands with the sidebar wiring (Task 15 of the v0.2.1 plan). `POST /api/tasks`; `PATCH /api/tasks/{id}`; `DELETE /api/tasks/{id}` (no body); `PATCH /api/tasks/order`.
- `useUpdateTask` is the only optimistic hook: `snapshotTasks` cancels the `["tasks"]` queries and stores every `[key, data]` pair, `patchTask` maps the payload onto `Partial<TaskView>` (nullish dates/notes clear the field, `updatedAt` is stamped, `priority` is copied, checklist items get `temp-<index>` ids), then `patchTasksEntry` from `lib/query/taskCache.ts` patches each cached payload, returning an entry untouched when it does not hold a `tasks` array. The counts key shares the prefix but holds a `TaskCountSummary`, so that guard is what keeps a PATCH from throwing. `onError` restores the whole snapshot; `onSettled` invalidates `["tasks"]`.
- Create, delete and reorder never touch the cache: their `onSettled` invalidates `["tasks"]` and the refetch paints the server result, so counts and bucket membership cannot lie optimistically.
- `counts` is never patched by hand; one row patch cannot change the global badges, and the settle refetch recalculates them.

**Depends on / Used by** — `@tanstack/react-query`, `lib/query/taskCache`, `TaskView`/`TaskCounts`/`TaskCountSummary`/`TaskBucket` types, and the `lib/validation/tasks.ts` inferred inputs (`CreateTaskInput`, `UpdateTaskInput`, `ReorderTasksInput`). Imported by `components/tasks/TasksShell.tsx` (`useTasks`, `useUpdateTask`, `useDeleteTask`), `components/tasks/TaskCaptureRow.tsx` (`useCreateTask` + `useUpdateTask` for a board column's follow-up status) and `components/shell/GlobalCapture.tsx` (`useCreateTask`, and `useDeleteTask` for the capture undo), `components/tasks/TaskEditorDialog.tsx` and `lib/ui/useTaskPlanDrop.ts` (`useUpdateTask`), and `components/calendar/CalendarShell.tsx` (`useTasks("all")` for the chips). `useReorderTasks` and `useTaskCounts` have no call site yet: the order PATCH is exercised only by the integration tests, and the sidebar's count wiring lands with the later sidebar task (the `/tasks` tabs read the counts embedded in `useTasks`).

**Debugging** —
- A row flickers back to its old title -> the PATCH failed and `restoreTasks` replayed the snapshot -> read the thrown `Error` message from `requestJson`.
- A created or deleted task appears only after a moment -> intended: those hooks refetch instead of writing the cache -> check the invalidated prefix is still `["tasks"]`.
- Closed rows never appear -> the query was called without `includeClosed` or a caller rebuilt the key without its `"open"`/`"closed"` segment -> check the third argument and the key.
- A PATCH throws `Cannot read properties of undefined (reading 'map')` -> the optimistic updater stopped going through `patchTasksEntry` and tried to patch the `["tasks", "counts"]` summary as a task list -> `patchTasksEntry` in `lib/query/taskCache.ts`.
- `GET /api/tasks/counts` fires on the calendar -> `useTaskCounts` was left `enabled: true` instead of receiving the sidebar's `/tasks` pathname gate.
- The list and the rail disagree mid-edit -> `counts` is untouched by the optimistic patch and refreshes only on settle -> expected; a permanently stale badge means the invalidation was removed.
- A moved task still shows the source list's name/dot, and its position and counts look stale for a beat -> the optimistic patch carries the raw `collectionId` (and `sortOrder` only when the undo sends one), never the nested `collection` summary, and the server-computed append position plus the counts arrive with the settle refetch -> expected, not a cache bug -> `patchTask` and `onSettled`.
- Two views show the same edit twice -> `setQueriesData({ queryKey: ["tasks"] })` intentionally patches every cached `(view, collectionId)` payload.

**Tests** — No direct hook test. The pure cache helpers are covered by `tests/unit/task-cache.test.ts`, including the priority optimistic patch across two cached payloads and its snapshot rollback; the endpoints by `tests/integration/tasks-api.test.ts`.

### lib/query/taskCache.ts

**Purpose** — Pure, framework-free helpers for the `{ tasks, counts }` payload held by every `["tasks", …]` query, so the optimistic hook never maps cache shapes inline.

**Public API** — `interface TasksCacheData { tasks: TaskView[]; counts: TaskCounts }`; `updateTaskInData(data, id, patch: Partial<TaskView>): TasksCacheData`; `patchTasksEntry(entry: unknown, id: string, patch: Partial<TaskView>): unknown`.

**State & side effects** — None: `updateTaskInData` allocates a new payload and a new `tasks` array and never mutates the input. `updateTaskInData` replaces only the row whose id matches (a missing id leaves every row unchanged) and returns `counts` by reference, because one row patch cannot change the global badges. `patchTasksEntry` is the cache-entry guard `useUpdateTask` applies through `setQueriesData`: it returns any entry that is not a `{ tasks: ... }` payload unchanged (the counts query `["tasks", "counts"]` holds `{ counts, byCollection }`), and only then delegates to `updateTaskInData`. `useUpdateTask` applies it to every cached payload; create, delete and reorder only invalidate `["tasks"]`, so there is no optimistic removal helper.

**Depends on / Used by** — `TaskView`/`TaskCounts` types. Imported by `lib/query/tasks.ts` (`patchTasksEntry`, `TasksCacheData`) and `tests/unit/task-cache.test.ts`.

**Debugging** —
- Counts change immediately after a title edit -> `updateTaskInData` started copying `counts`; it must return the same object -> check the helper's spread.
- A PATCH throws `Cannot read properties of undefined (reading 'map')` -> the counts entry (`{ counts, byCollection }`) reached `updateTaskInData` because `patchTasksEntry` was bypassed -> keep the `setQueriesData` callback delegating to `patchTasksEntry`.
- A patched task disappears -> the patch carried `status: "done"`/`"dropped"` and the settle refetch excluded it from the open list -> expected; do not "fix" it in the cache helper.
- A checklist edit flashes ids like `temp-0` -> intended optimistic placeholders until the PATCH response/refetch replaces the row -> `patchTask` in `lib/query/tasks.ts`.

**Tests** — `tests/unit/task-cache.test.ts` (patch by id, unknown-id no-op, immutability, counts untouched, `patchTasksEntry` skips counts/undefined/null entries, priority patch across two cached payloads and its rollback).

## Auth

### lib/auth/server.ts

**Purpose** — Builds the Better Auth instance against a given database (factory for tests/scripts) and exposes one lazily created app instance with the two-account cap, rate limiting, admin and 2FA plugins.

**Public API** — `interface CreateAuthOptions { allowSignUp?: boolean; rateLimit?: boolean }`; `createAuth(database: Database, options?: CreateAuthOptions)`; `getAuth()` returning the singleton.

**State & side effects** — Module-level `instance` in `getAuth`, so one auth instance per process, bound to `getDb()`.
- Secret: `env.BETTER_AUTH_SECRET`, else the fixed `test-only-secret-…` when `NODE_ENV === "test"`, else a thrown error naming `openssl rand -base64 32`.
- `emailAndPassword.enabled` with `disableSignUp: options.allowSignUp !== true` (the running app never allows public sign-up), `minPasswordLength: 12`.
- `session.expiresIn` 7 days, `updateAge` 1 day.
- `rateLimit.enabled: options.rateLimit !== false` (app passes `env.AUTH_RATE_LIMIT !== "off"`), `window: 60`, `max: 100`, plus a stricter `"/sign-in/email": { window: 60, max: 5 }`. The limiter is in-memory, which the comment justifies with the single-instance SQLite deployment.
- `advanced`: client IP read from `x-forwarded-for`; cookies `httpOnly`, `sameSite: "lax"`, `secure` only when `BETTER_AUTH_URL` starts with `https://`. `trustedOrigins: [env.BETTER_AUTH_URL]`.
- Plugins: `admin()`, `twoFactor()` — they add the `role`/`banned`/`ban*` user columns and the `two_factor` table.
- `databaseHooks.user.create.before` throws `APIError("FORBIDDEN")` with "This planner is limited to two accounts." when `countUsers(database) >= MAX_USERS`.

**Depends on / Used by** — `better-auth`, `better-auth/api` (`APIError`), `better-auth/adapters/drizzle`, `better-auth/plugins`, `@/lib/db` (`getDb`), `@/lib/db/schema`, `@/lib/env`, `./users`. Used by `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/settings/page.tsx`, `app/login/page.tsx`, `app/api/auth/[...all]/route.ts`, `lib/api/route.ts` (`viewerFromRequest`), and the scripts `provision.mts` / `seed-test-db.mts`.

**Debugging** —
- "BETTER_AUTH_SECRET is required" at boot -> production/dev started without the variable -> set it (≥32 chars) in `.env.local`.
- Sign-in returns 429 during E2E -> the rate limiter counts many sign-ins from one loopback IP -> run with `AUTH_RATE_LIMIT=off` (E2E does).
- Session cookie set but `getSession` returns null in a route -> `BETTER_AUTH_URL`/origin mismatch, so `trustedOrigins` rejects it -> compare with the actual host.
- Provisioning a third user fails with FORBIDDEN -> that is the `MAX_USERS` hook, not a bug -> delete the extra row before re-seeding.

**Tests** — `tests/integration/auth.test.ts` (sign-up disabled, two-user cap, sign-in cookie usable via `auth.api.getSession`, password stored hashed).

### lib/auth/users.ts

**Purpose** — The user-table primitives that back the two-account cap and the provisioning script.

**Public API** — `const MAX_USERS = 2`; `countUsers(db: Database): number`; `findUserByEmail(db: Database, email: string)` returning the row or `undefined`; `listUsers(db: Database)` returning all rows.

**State & side effects** — Read-only, synchronous Drizzle queries against `user`; no caching. `findUserByEmail` normalises its argument with `email.trim().toLowerCase()`, so lookups are case-insensitive by construction — but the stored value is whatever Better Auth wrote, and `user.email` is only unique case-sensitively at the SQL level.

**Depends on / Used by** — `drizzle-orm` (`count`, `eq`), `Database` type, `user` table. `MAX_USERS` and `countUsers` are imported by `lib/auth/server.ts` for the sign-up hook; `scripts/provision.mts` imports `MAX_USERS`, `countUsers` and `findUserByEmail`. `listUsers` currently has no importer.

**Debugging** —
- Sign-up allowed with two existing accounts -> `countUsers` is called on the same database the adapter writes to; a mismatch means `createAuth` was given a different handle -> check the `createAuth(db, …)` argument.
- Provisioning creates a duplicate account -> `findUserByEmail` compares against the trimmed lower-case email while the row was stored differently -> inspect `select email from user`.
- `findUserByEmail` returns `undefined` for an existing user -> the account lives in `account`/`session` but the `user` row was deleted (cascades remove the rest, so this usually means a test fixture inserted only auth rows).

**Tests** — Covered indirectly by `tests/integration/auth.test.ts` (the cap is asserted through HTTP) and by `scripts/provision.mts` usage. No unit test targets `lib/auth/users.ts`.

## Validation schemas

All five modules export plain Zod schemas (no I/O). Handlers parse the JSON body with them and let `AppError`/`ZodError` mapping in `lib/api` produce the 400 envelope; the schemas themselves never touch the database.

### lib/validation/collections.ts

**Purpose** — Zod schemas for creating and updating a calendar.

**Public API** — `collectionKindSchema` (`"calendar" | "list"`), `collectionVisibilitySchema` (`"shared" | "view_only" | "private"`); `createCollectionSchema` (`name` 1–60 after trim, `parentId` non-empty string or null/undefined, `kind` optional member of the kind enum, `hueFamily` member of `HUE_FAMILIES` or null/undefined, `ownerId` non-empty or null/undefined, `visibility` optional member of the visibility enum); `updateCollectionSchema` (all optional: `name`, `hueFamily`, `ownerId` nullable, `visibility`, `sortOrder` int ≥ 0); types `CreateCollectionInput`, `UpdateCollectionInput`.

**State & side effects** — None; pure parsing. Notes: `updateCollectionSchema` deliberately omits `parentId`, so a PATCH cannot re-parent a calendar through this schema. Neither schema is `.strict()`, so unknown keys are stripped rather than rejected. `hueFamily` is validated against `HUE_FAMILIES` from `lib/color/palette`; the "roots only" rule is enforced in the service layer, not here.

**Depends on / Used by** — `zod`, `@/lib/color/palette`. `createCollectionSchema`/`updateCollectionSchema` are parsed in `lib/api/handlers/collections.ts`; the inferred types are imported by `lib/services/collections.ts` (`createCollection`, `updateCollection`).

**Debugging** —
- Creating a sub-calendar is rejected although `parentId` was sent -> the create schema accepts it but the service rejects nesting depth, a kind mismatch, or ownership -> look at `lib/services/collections.ts`, not here.
- A `private` collection without an owner is a 400 "A private collection needs an owner." from the service, not from these schemas -> the update rule has to read the stored owner, so create and update both validate it in `lib/services/collections.ts` (`fields.ownerId`).
- A PATCH renaming to 61 characters returns 400 with a custom message -> `max(60)` after `trim()`; the message is the second `max` argument.
- Colour family silently ignored -> the value was not in `HUE_FAMILIES` and the key got stripped instead of throwing (schemas are not strict) -> check `lib/color/palette.ts`.

**Tests** — No direct unit test. Validation is exercised through `tests/integration/collections-api.test.ts` (asserts `error.code === "VALIDATION"`) and `tests/integration/collections.test.ts`.

### lib/validation/events.ts

**Purpose** — Zod schemas for event create/update plus `assertEventShape`, the invariant that keeps all-day rows on local dates and timed rows on UTC instants.

**Public API** — `createEventSchema` (`collectionId` min 1, `title` 1–200 trimmed, `description` ≤4000, `location` ≤200, `allDay` boolean defaulting to `false`, `startAt`/`endAt` integer or nullish, `startDate`/`endDate` matching `^\d{4}-\d{2}-\d{2}$` or nullish, `rrule` ≤500, `exdates` array of non-empty strings or nullish, plus the undo-only `recurrenceParentId`/`recurrenceId` non-empty strings or nullish); `updateEventSchema` (same fields, `collectionId` optional, whole object `.partial()`, so `allDay` has **no** default, plus the recurring-scope envelope `scope: "this" | "following" | "all"` and `occurrenceStart` string); `assertEventShape(input: EventShapeInput): void`; types `CreateEventInput`, `UpdateEventInput`, `EventShapeInput`.

**State & side effects** — Pure parsing and throwing only; `assertEventShape` raises `AppError("VALIDATION", …, 400, { field })`.
- All-day branch: requires both dates, rejects impossible calendar dates via `isRealDate` (UTC round-trip), and rejects any `startAt`/`endAt`. It computes `toAllDayRange(startDate, endDate)` and discards it (`void range`) — the range is used for validation only.
- Timed branch: requires both instants, rejects any date, and requires `endAt > startAt`.
- The schema-level default lives on create only; the file comment explains that a default on update would turn a partial PATCH of an all-day event into a timed one. `assertEventShape` defaults `allDay` to false, so a PATCH that changes only a date still needs the caller to pass the existing `allDay`.
- `rrule` syntax (RFC 5545, `FREQ=`) is validated in `lib/services/events.ts`, not in these schemas.
- The link fields are create-only so undo can rebuild a deleted exception under its series; the scope envelope is read and stripped by `lib/api/handlers/events.ts` before the service sees a patch.

**Depends on / Used by** — `zod`, `@/lib/errors` (`AppError`), `@/lib/time/zone` (`toAllDayRange`). Parsed in `lib/api/handlers/events.ts`; `assertEventShape` and the input types are used by `lib/services/events.ts`; `CreateEventInput` is imported by `tests/integration/search-api.test.ts` for seeding.

**Debugging** —
- A PATCH that only changes the title fails with "Timed events need a start and end time." -> `assertEventShape` was called with the patch alone instead of the merged row -> check the call site in `lib/services/events.ts`.
- `2026-02-30` passes the regex but is rejected -> `isRealDate` does the calendar check; the message is "That calendar date does not exist.".
- `endAt === startAt` accepted by Zod then rejected with 400 -> zero-length timed events are invalid; the error field is `endAt`.
- An all-day update turns into a timed event -> `updateEventSchema` must not carry an `allDay` default; if it reappears, this is the regression.
- A scoped PATCH loses `scope`/`occurrenceStart` before the handler branches -> `.partial()` still lists them; if a future `.strict()` is added they must stay declared -> `updateEventSchema`.

**Tests** — No direct unit test of the schemas or `assertEventShape`. Behaviour is covered by `tests/integration/events.test.ts` (VALIDATION assertions), `tests/integration/events-api.test.ts`, `tests/integration/regressions.test.ts`, and `tests/e2e/events.spec.ts`.

### lib/validation/preferences.ts

**Purpose** — Strict Zod schema for the partial preference PATCH accepted by `PATCH /api/settings/preferences`.

**Public API** — `updatePreferencesSchema`: optional `defaultView` (enum `DEFAULT_VIEWS`), `timeFormat` (enum `TIME_FORMATS`), `showWeekNumbers` boolean, `shortcutsEnabled` boolean, `lastEventCalendarId` non-empty string or null; type `UpdatePreferencesInput`.

**State & side effects** — Pure parsing, `.strict()`. The enum values are imported from `lib/services/preferences`, so adding a view or time format there is enough for validation to follow. `lastEventCalendarId` accepts `null` (meaning "pick for me") but not `""`. `.strict()` means an unknown key is a 400 rather than a silent strip — unlike the calendar schemas.

**Depends on / Used by** — `zod`, `@/lib/services/preferences` (`DEFAULT_VIEWS`, `TIME_FORMATS`). Parsed in `lib/api/handlers/preferences.ts`; `lib/query/preferences.ts` sends the matching `Partial<UserPreferences>` body.

**Debugging** —
- A preferences PATCH returns 400 on an extra key -> `.strict()` is intentional; the client must send only these five fields -> compare with `useUpdatePreferences` call sites.
- Clearing the remembered calendar fails -> send `null`, not `""` (`min(1)` rejects the empty string).
- A stored view value falls back to `auto` after a rename -> `normalise` in `lib/services/preferences.ts` rejects unknown stored values; the schema only guards writes.

**Tests** — No direct unit test. Covered through `tests/integration/preferences-api.test.ts` and `tests/e2e/preferences.spec.ts`.

### lib/validation/settings.ts

**Purpose** — Zod schemas for the two settings forms: household details and the signed-in user's display name.

**Public API** — `updateHouseholdSchema` (optional `name` 1–60 trimmed, `timezone` 1–64, `weekStartsOn` literal `0` or `1`); `updateProfileSchema` (`name` required, 1–60 trimmed); types `UpdateHouseholdInput`, `UpdateProfileInput`.

**State & side effects** — Pure parsing; no `.strict()`, so extra keys are stripped. `timezone` is only length-checked — an unknown IANA zone is accepted here and the failure (if any) surfaces later in `Intl`/formatting code. `weekStartsOn` is restricted to `0` (Sunday) and `1` (Monday), not any integer.

**Depends on / Used by** — `zod` only. Parsed in `lib/api/handlers/settings.ts` for `PATCH /api/settings/household` and `PATCH /api/settings/profile`; the profile handler writes through Better Auth rather than directly to the table.

**Debugging** —
- Saving the household name with trailing spaces stores them -> `.trim()` runs before length checks and its output is what the handler receives; a stored untrimmed value means the write bypassed this schema.
- A timezone typo is accepted and dates render in the old zone -> the schema only checks length -> validate against `Intl.supportedValuesOf("timeZone")` if this becomes a problem.
- Setting week start to `2` returns 400 -> only `0`/`1` are modelled (`week_starts_on` integer default 0).

**Tests** — No direct unit test; covered through `tests/integration/settings-api.test.ts` and `tests/e2e/settings.spec.ts`.

### lib/validation/tasks.ts

**Purpose** — Zod schemas for creating a task, partially updating it, reordering a list and filtering the task list query, plus the date-only field shared by `scheduledOn` and `dueOn`.

**Public API** — `dateOnlySchema` (`/^\d{4}-\d{2}-\d{2}$/`, custom message "Use YYYY-MM-DD."); `prioritySchema` (`none|low|normal|high|urgent`); `checklistInputSchema` (array of at most 50 `{ title: 1–200 trimmed, done: boolean }`); `createTaskSchema` (`title` 1–200 trimmed required, `notes` ≤ 2000 nullish, `collectionId` optional non-empty, `scheduledOn`/`dueOn` date-only nullish, `priority` optional); `updateTaskSchema` (`createTaskSchema.partial()` plus `status` enum `open|in_progress|done|dropped`, `checklist`, `sortOrder` int ≥ 0); `reorderTasksSchema` (`collectionId` non-empty, `orderedIds` array of at least 1 non-empty strings); `taskViewSchema` (`inbox|today|week|someday|all`, built from `TASK_BUCKETS`); `listTasksQuerySchema` (`view` optional, `collectionId` optional non-empty, `includeClosed` optional strict `"true"|"false"` transformed to a boolean); types `CreateTaskInput`, `UpdateTaskInput`, `ReorderTasksInput`, `ListTasksQuery`.

**State & side effects** — None; pure parsing. None of the task schemas is `.strict()`, so unknown keys are stripped rather than rejected. `dateOnlySchema` checks the shape only — `2026-13-01` passes, exactly like the event schemas' `dateString`; tasks store the string and the service does no calendar-date check. `nullish()` on the two date fields is what lets a PATCH clear a date with `null`. `title` is trimmed before its length check. `updateTaskSchema` deliberately carries no defaults, so every omitted field means "leave unchanged"; that is why `status` is not defaulted to `"open"` and a checklist PATCH replaces rather than merges. `listTasksQuerySchema` is fed only the three params `GET /api/tasks` reads, so absent params must be passed as `undefined` (not `null`). `includeClosed` is the literal query-string `"true"`/`"false"` and the `enum` transform maps it to a boolean — deliberately not `z.coerce.boolean()`, which would turn `"false"` into `true`; an actual JSON boolean is rejected too, because the wire format is the string.

**Depends on / Used by** — `zod` and `TASK_BUCKETS` from `lib/domain/tasks.ts` (a runtime import, so the bucket list stays the single source for the view enum). The schemas and their inferred types are imported by `lib/services/tasks.ts` and `lib/api/handlers/tasks.ts`; they are exercised directly by `tests/integration/tasks.test.ts` and through the handlers by `tests/integration/tasks-api.test.ts`.

**Debugging** —
- A PATCH that only changes the title clears a date -> the client sent the field as `null` (or omitted the key and another layer defaulted it); missing keys are left alone by `updateTask`'s whitelist.
- A task cannot be moved through the reorder payload -> `reorderTasksSchema` only carries order; moving is `updateTaskSchema.collectionId`.
- An extra field is silently dropped -> task schemas are not `.strict()` (only `lib/validation/preferences.ts` rejects unknown keys).
- A checklist item title is stored trimmed but a note's whitespace is kept -> only `title` fields call `.trim()`; `notes` is capped, not trimmed.
- `GET /api/tasks?view=` returns 400 `fields.view` -> the value is outside `TASK_BUCKETS` plus `"all"`; an empty string is not treated as "omitted" -> `listTasksQuerySchema`.
- `?includeClosed=false` still returns done tasks -> the strict `"true"|"false"` enum was replaced with `z.coerce.boolean()` (or a plain `Boolean(...)`), where `Boolean("false")` is `true` -> `listTasksQuerySchema.includeClosed`.

**Tests** — Parsed in `tests/integration/tasks.test.ts` (date shape, create title/notes bounds, partial update with status/checklist/sortOrder, checklist cap, reorder minimum, and the strict `includeClosed` `"true"`/`"false"` mapping with `"maybe"`/`"0"`/boolean rejection); handler-level status codes are covered by `tests/integration/tasks-api.test.ts`.

## Non-obvious gotchas for `docs/DEBUGGING.md`

- **Two timestamp conventions.** Domain tables (`household`, `member`, `collection`, `event`, `task`, `task_checklist_item`, `user_preference`, the two import tables) store `integer` epoch ms filled by `$defaultFn(() => Date.now())` and hydrate as `number`. Better Auth tables use `mode: "timestamp_ms"` and hydrate as `Date`. Any comparison or arithmetic across the two families must convert.
- **`event.end_date` is inclusive.** All-day rows carry local `YYYY-MM-DD` in `start_date`/`end_date`; `CalendarShell` subtracts one day when a drag produces FullCalendar's exclusive end. Timed rows carry UTC ms in `start_at`/`end_at` and leave both date columns null.
- **WAL + one writer.** `createDb` sets `journal_mode = WAL`, `foreign_keys = ON` and `busy_timeout = 15000`; there is one connection per server process (`getDb`) but each script opens its own, so a running dev server and a script both writing will block each other (up to 15 s before `database is locked`). `data/planner.db-wal`/`-shm` are expected files; a stale `-wal` after an abrupt kill is not corruption.
- **Migrations run on the first request, not at build.** `getDb()` creates the directory, opens the database and calls `migrate()` lazily, and the default migrations folder is `resolve(process.cwd(), "drizzle")` — cwd-sensitive for scripts.
- **Query keys are four families plus a prefix trick.** `["collections"]`, `["events", from, to]`, `["events", "search", normalized]`, `["preferences"]`, `["tasks", view ?? "all", collectionId ?? null]`. Event and task mutations use `setQueriesData`/`invalidateQueries` with the `["events"]` / `["tasks"]` prefix, so event writes also reach search results and task writes reach every `(view, collectionId)` entry. Calendar delete invalidates `["collections"]` and `["events"]`; preferences mutations never invalidate (they `setQueryData` the PATCH response, guarded by a `latestIssued` sequence ref).
- **Optimistic writes are global, rollback is wholesale.** Every cached `["events"]` range and every cached `["tasks", …]` payload is patched by the respective update hooks, and rollback restores the full snapshot taken in `onMutate` — undo is a separate mechanism (`lib/ui/undo.ts`) that replays the opposite mutation, so an undone create produces a new event id. The task create/delete/reorder hooks are deliberately not optimistic: they only invalidate.
- **No FK ties domain rows to `user`.** `member.user_id`, `collection.owner_id`, `event.created_by` and `task.created_by` are logical references validated in services; neither `created_by` is indexed. The two-account cap is a `databaseHooks.user.create.before` check in `createAuth`, not a constraint.
- **`updateEventSchema` must never gain an `allDay` default**, and `updateCollectionSchema` intentionally has no `parentId`; both absences are load-bearing.

## Focused verification

```bash
npx vitest run tests/integration/db.test.ts
npx vitest run tests/unit/event-cache.test.ts
npx vitest run tests/unit/task-cache.test.ts
npx vitest run tests/integration/tasks.test.ts tests/integration/tasks-api.test.ts
npx vitest run tests/integration/auth.test.ts
npx vitest run tests/integration/preferences-api.test.ts
npm run docs:check
npm run lint && npm run typecheck
```
