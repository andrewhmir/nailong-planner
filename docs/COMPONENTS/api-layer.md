# API layer

The HTTP boundary: `app/api/*/route.ts` handlers are thin adapters that run through `withViewer` into one function per verb in `lib/api/handlers/*`, which validates input and delegates all SQL and business rules to `lib/services/*`. Read this doc when a route returns the wrong status, the wrong body shape, or a field-error map the client does not recognise.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, update its section and run `npm run docs:check`.

| File | Role |
|---|---|
| lib/api/route.ts | Session resolution, `ViewerContext` construction, DB access, `AppError` to HTTP mapping |
| lib/api/handlers/collections.ts | Calendar list/create/update/delete handlers |
| lib/api/handlers/events.ts | Event range/list, search, create/update/delete handlers plus the default month range |
| lib/api/handlers/preferences.ts | Per-user preference read/patch handlers |
| lib/api/handlers/settings.ts | Household and profile patch handlers |
| lib/api/handlers/tasks.ts | Task list/read/create/patch/delete and manual-order handlers |
| lib/api/handlers/support.ts | `guarded` error wrapper, JSON body reader, Zod issue to `fields` mapper |

## Request pipeline

The chain is always the same four hops, and each hop owns exactly one concern.

```
app/api/events/route.ts        GET/POST = withViewer(({ db, ctx, request }) => handler(db, ctx, request))
  -> lib/api/route.ts          withViewer: Better Auth session -> member row -> { ctx, session, db, request }
  -> lib/api/handlers/events   guarded(): read query/body, Zod safeParse, throw AppError
  -> lib/services/events.ts    household-scoped SQL + business rules (Drizzle, better-sqlite3)
  -> lib/db/schema.ts          SQLite tables
  <- Response, or AppError -> apiError() -> { error: { code, message, fields? } }
```

1. Next calls the exported `GET`/`POST`/`PATCH`/`DELETE` in `app/api/**/route.ts`. Each file sets `export const dynamic = "force-dynamic"` and delegates in a single expression. Routes with a dynamic segment await `context.params` (a `Promise` in Next 16) and pass `{ id }` as `withViewer`'s second argument, which becomes part of the handler args.
2. `withViewer` calls `viewerFromRequest`: `getAuth().api.getSession({ headers: request.headers })`, then reads the `member` row for `session.user.id`. No session throws `UNAUTHENTICATED` 401; no membership throws `FORBIDDEN` 403. The resulting `ctx` is `{ userId, householdId }` — `householdId` always comes from the `member` table, never from the URL, query or body.
3. `withViewer` runs `assertSameOrigin(request)` and opens the singleton `getDb()`, then calls the handler with `{ ctx, session, db, request, ...extra }`, catching anything thrown and returning `apiError(error)`. `assertSameOrigin` rejects a non-GET request whose `Origin` is neither the request's own origin nor `BETTER_AUTH_URL`, and any request carrying `Sec-Fetch-Site: cross-site`, with 403 `FORBIDDEN`; requests without an `Origin` header (scripts, integration tests) pass. This is the CSRF guard: `SameSite=Lax` does not separate sibling hosts on Railway's default `*.up.railway.app` domain, which is not on the Public Suffix List.
4. The handler itself is wrapped in `guarded` (same mapping). That duplication is deliberate: integration tests call handlers directly with a `db` and `ctx` and still get real `Response` objects. Handlers never authenticate; they only validate and delegate.
5. Handler order: read `new URL(request.url).searchParams` or `readJson(request)`; `schema.safeParse`; on failure `throw fieldErrors(parsed.error)`; call one service function; wrap the result in `NextResponse.json`.
6. `apiError` serialises `{ error: { code, message, fields? } }` with `error.status`. Any non-`AppError` logs `[api] unhandled error` and becomes `{ error: { code: "INTERNAL", message: "Something went wrong." } }` with 500.

| Situation | `code` | HTTP |
|---|---|---|
| No session cookie / expired session | `UNAUTHENTICATED` | 401 |
| Signed in, no `member` row | `FORBIDDEN` | 403 |
| Zod failure, bad `from`/`to`, missing `q`, missing `occurrenceStart` | `VALIDATION` | 400 |
| Row missing or in another household | `NOT_FOUND` | 404 |
| View-only calendar write | `FORBIDDEN` | 403 |
| Eighth sub-calendar | `CONFLICT` | 409 |
| Anything else | `INTERNAL` | 500 |

### lib/api/route.ts

**Purpose** — Turns a standard `Request` into an authenticated `RouteArgs` (`ctx`, `session`, `db`, `request`) and turns any thrown `AppError` back into the API's JSON error envelope.

**Public API** — `AppSession` = the non-null session type from `getAuth().api.getSession`; `RouteArgs` interface; `viewerFromRequest(request: Request): Promise<{ ctx: ViewerContext; session: AppSession }>`; `apiError(error: unknown): NextResponse`; `assertSameOrigin(request: Request): void` (exported so `tests/unit/route-origin.test.ts` can exercise it); `withViewer<Extra extends object = object>(handler: (args: RouteArgs & Extra) => Promise<Response> | Response): (request: Request, extra?: Extra) => Promise<Response>`.

- `viewerFromRequest` throws `AppError("UNAUTHENTICATED", "Sign in to continue.", 401)` or `AppError("FORBIDDEN", "Your account is not part of this household.", 403)`.
- `assertSameOrigin` throws `AppError("FORBIDDEN", "Cross-origin request rejected.", 403)`; it reads `Origin` and `Sec-Fetch-Site`, and needs no database.
- `apiError` never throws; it returns the envelope and preserves `fields` only when present.
- `withViewer` catches handler errors as well as resolution errors, so a route never needs its own `try/catch`.

**State & side effects** — Reads the session cookie through Better Auth and the `member` table (read-only); opens the shared DB via `getDb()`; logs unhandled errors to the server console with the `[api]` prefix. No writes, no transactions, no caching.

**Depends on / Used by** — `next/server` `NextResponse`, `getAuth` from `lib/auth/server.ts`, `getDb` from `lib/db/index.ts`, `member` from `lib/db/schema.ts`, `env` from `lib/env.ts` (the trusted origin), `AppError` from `lib/errors.ts`, `ViewerContext` from `lib/services/permissions.ts`. Used by every `app/api/**/route.ts` (`collections`, `collections/[id]`, `events`, `events/[id]`, `events/search`, `settings/*`, `session`); `lib/api/handlers/support.ts` imports `apiError` from here; `tests/integration/collections-api.test.ts` uses `withViewer` to assert the 401 envelope.

**Debugging**
- Every route 401s locally -> no valid Better Auth cookie, or the auth handler and the route resolve different `getAuth()` settings -> start at `viewerFromRequest` (`getAuth().api.getSession`).
- A freshly signed-up user gets 403 "not part of this household" -> no `member` row; provisioning (`scripts/provision.mts` -> `addMember`) never ran -> query the `member` table by `user_id`.
- A browser write returns 403 "Cross-origin request rejected" while curl works -> the page's origin differs from both the request host and `BETTER_AUTH_URL` (wrong scheme, `www.`, a proxy that rewrites `Host`) -> fix `BETTER_AUTH_URL`, or check a reverse proxy is forwarding the original host.
- A route returns 500 with `[api] unhandled error` in the log -> a non-`AppError` escaped a service (`TypeError`, SQL constraint, `JSON.parse`) -> read the logged stack, then the service named there.
- A client fails to parse the response on a delete -> 204 routes return `new Response(null, { status: 204 })`, which has no JSON body.

**Tests** — `tests/integration/collections-api.test.ts` (unauthenticated 401 envelope, directly through `withViewer`); `tests/unit/route-origin.test.ts` (same-origin, no-Origin, foreign-Origin, `Sec-Fetch-Site`, read bypass); every handler integration test exercises `withViewer`'s error mapping indirectly.

### lib/api/handlers/collections.ts

**Purpose** — The four collection verbs: list the caller's tree (ensuring their Inbox exists), create a collection or sub-collection, patch one, delete one.

**Public API** — All four are `guarded`, so each returns `Promise<Response>`.

- `listCollections(db: Database, ctx: ViewerContext): Promise<Response>` -> `{ collections: CollectionNode[] }`, 200; calls `ensureInbox` first.
- `createCollectionHandler(db, ctx, request: Request): Promise<Response>` -> `{ collection: CollectionRow }`, 201.
- `updateCollectionHandler(db, ctx, id: string, request: Request): Promise<Response>` -> `{ collection: CollectionRow }`, 200.
- `deleteCollectionHandler(db, ctx, id: string): Promise<Response>` -> empty body, 204.

Validation: `createCollectionSchema` / `updateCollectionSchema` (`lib/validation/collections.ts`). Any Zod failure becomes `VALIDATION` 400 with `fields` keyed by the issue path. Everything else (409 eighth child, 403 view-only, 400 colour-on-child, 400 private-without-owner, 404 private-not-owned or foreign id) is thrown by `lib/services/collections.ts` and passes through unchanged.

**State & side effects** — `listCollections` calls `ensureInbox`, which may insert the caller's private Inbox row; otherwise there is no direct DB access and writes happen inside `createCollection` / `updateCollection` / `deleteCollection`. `deleteCollectionHandler` returns 204 even though the service cascades to sub-collections and their events (FK `onDelete: "cascade"`).

**Depends on / Used by** — `lib/services/collections.ts` (`ensureInbox`, `listCollectionTree`, CRUD), `lib/validation/collections.ts`, `ViewerContext`, `NextResponse`, and `fieldErrors`/`guarded`/`readJson` from `./support`. Called by `app/api/collections/route.ts` (`GET`, `POST`) and `app/api/collections/[id]/route.ts` (`PATCH`, `DELETE`); called directly by `tests/integration/collections-api.test.ts`; the client side is `lib/query/collections.ts`.

**Debugging**
- A new `Inbox` row shows up after the first tree load -> intended lazy creation by `ensureInbox`, one per member -> `lib/services/collections.ts` `ensureInbox`.
- 400 with `fields.name` -> the Zod schema trims and rejects empty names over 60 characters -> `createCollectionSchema` / `updateCollectionSchema`.
- 404 instead of 403 for another household's id or a partner's private collection -> visibility/household checks run before the permission check and hide existence -> `getCollection`, `assertWritable`.
- 409 on create -> the parent already has seven children -> `createCollection`'s `MAX_CHILDREN` guard.
- Client shows a stale tree after a mutation -> invalidation lives in `lib/query/collections.ts`, not here.

**Tests** — `tests/integration/collections-api.test.ts` (status codes, envelope, 404 scoping); `tests/integration/collections.test.ts` covers the underlying service.

### lib/api/handlers/events.ts

**Purpose** — The event endpoints: range listing with a household-month default, text search, create, patch (plain or scoped to one of the three recurring-edit scopes), and delete a whole series, a range from an occurrence, or one occurrence.

**Public API** — All exported handlers are `guarded`.

- `listEventsHandler(db, ctx, request): Promise<Response>` -> `{ events: EventView[] }`; range from `?from=&to=` epoch milliseconds.
- `searchEventsHandler(db, ctx, request): Promise<Response>` -> `{ events: EventView[] }`; `?q=` required, `?limit=` optional.
- `createEventHandler(db, ctx, request): Promise<Response>` -> `{ event: EventView }`, 201. The create schema carries the undo-only `recurrenceParentId`/`recurrenceId`.
- `updateEventHandler(db, ctx, id, request): Promise<Response>` -> `{ event, relinked, relinkedPrevious }` for `scope: "following"` and for an `"all"` PATCH carrying `occurrenceStart`; `{ event }` for a plain or `this` PATCH, 200.
- `deleteEventHandler(db, ctx, id, request): Promise<Response>` -> `204` empty body for `scope: "this"`; `200 { deleted, truncated }` for `scope: "all"`; `200 { deleted, truncated, segmentId }` for `"following"`.

Private helpers: `pad2`, `currentMonthRange` (household timezone -> first of this month to first of next month, December rolls the year), `parseRange` (no bounds -> current month; exactly one bound -> `VALIDATION` 400 with `fields.from`; non-finite -> 400; `from >= to` -> 400). Search requires `q` (null -> 400 with `fields.q`); `limit` is `Number(...)` and dropped when not finite, so the service default of 50 applies. Delete reads the body with `request.json().catch(() => null)` — a body-less DELETE is legal and means `scope: "all"`; `scope: "this"` requires a non-empty string `occurrenceStart` or `VALIDATION` 400 with `fields.occurrenceStart`. On PATCH, `scope: "this"`/`"following"` require `occurrenceStart`; `scope: "all"` takes the move path only when `occurrenceStart` is present **and** `allDay` is sent.

**State & side effects** — The only direct read is `getHousehold` for the default month's timezone. All writes go through the service; `scope: "this"` inserts a linked exception + EXDATE, `scope: "following"` splits, the `scope: "all"` occurrence-relative branch shifts the series/rule/EXDATEs/exceptions and applies the edited fields, and the delete scopes remove rows/append EXDATEs.

**Depends on / Used by** — `lib/services/events.ts`, `lib/services/search.ts`, `lib/services/household.ts` (`getHousehold`), `lib/time/zone.ts` (`localWallTimeToUtc`, `utcToLocalDate`), `lib/validation/events.ts`, `./support`. Called by `app/api/events/route.ts`, `app/api/events/[id]/route.ts`, `app/api/events/search/route.ts`; called directly by `tests/integration/events-api.test.ts`; client side is `lib/query/events.ts` and `lib/query/search.ts`.

**Debugging**
- Events missing at the edge of the visible range -> non-recurring rows are filtered by overlap, recurring rows are always returned and must be expanded by the client -> `listEvents` (service).
- 400 "Provide both from and to." -> one bound was dropped while building the query string -> `parseRange`.
- A DELETE unexpectedly removes an entire series -> the request had no JSON body (or a body without `scope`), so the handler defaults to `"all"` -> `deleteEventHandler`.
- 400 `fields.q` -> the search box sent an empty string or omitted `q`; a 1-character `q` is not a 400, it returns `[]` from the service.
- Default month looks wrong near a month boundary -> the range is computed in the household timezone, not UTC -> `currentMonthRange` plus the `household.timezone` row.
- A scoped PATCH hits the plain series path -> `scope`/`occurrenceStart` were stripped before the branch, or `allDay` was missing on an `all`-move -> the destructuring at the top of `updateEventHandler`.
- A split response is `{ event }` only -> the handler treated `following` as a normal series edit -> the `scope === "following"` branch.

**Tests** — `tests/integration/events-api.test.ts` covers list/create/update/delete, all three recurring scopes and status mapping. `searchEventsHandler` has no direct unit or integration test; `tests/integration/search-api.test.ts` tests `searchEvents` itself.

### lib/api/handlers/preferences.ts

**Purpose** — Read and patch the signed-in user's calendar preferences.

**Public API** — `getPreferencesHandler(db, ctx): Promise<Response>` -> `{ preferences: UserPreferences }`; `updatePreferencesHandler(db, ctx, request): Promise<Response>` -> `{ preferences: UserPreferences }`. Both are `guarded` and validate with `updatePreferencesSchema` on the write path only.

**State & side effects** — Reads and upserts `user_preference`, always keyed by `ctx.userId` (never by household or a body field). No auth check beyond `withViewer`; a user can only touch their own row.

**Depends on / Used by** — `lib/services/preferences.ts` (`getPreferences`, `updatePreferences`), `lib/validation/preferences.ts`, `ViewerContext`, `./support`. Called by `app/api/settings/preferences/route.ts`; called directly by `tests/integration/preferences-api.test.ts`; client side is `lib/query/preferences.ts`.

**Debugging**
- 400 with `fields.form` -> the schema is `.strict()`, so any unknown key (for example `theme`) is rejected with an empty path that `fieldErrors` maps to `form` -> `updatePreferencesSchema`.
- A patch that should clear a field leaves it unchanged -> `undefined` means "leave"; only `lastEventCalendarId` accepts an explicit `null` -> `updatePreferences` (service).
- Preferences appear shared between the two members -> check the row's `user_id`; the handler never passes `ctx.householdId` -> `getPreferencesHandler`.

**Tests** — `tests/integration/preferences-api.test.ts` (defaults, partial patch, invalid enum values, per-user scoping).

### lib/api/handlers/settings.ts

**Purpose** — Patch the household record and the caller's own display name.

**Public API** — `updateHouseholdHandler(db, ctx, request): Promise<Response>` -> `{ household: HouseholdRow }`; `updateProfileHandler(db, ctx, request): Promise<Response>` -> `{ user: { id: string; name: string } }`. Both are `guarded`; validation uses `updateHouseholdSchema` / `updateProfileSchema`.

**State & side effects** — Writes `household.name`/`timezone`/`weekStartsOn`, or `user.name` (with `user.updatedAt`). There is no role check: any authenticated member may patch household settings. `updateProfileHandler` returns 404 `NOT_FOUND` "Account not found." when the Better Auth `user` row is missing (for example a hand-seeded member without a user row).

**Depends on / Used by** — `lib/services/household.ts` (`updateHousehold`, `updateMemberName`), `lib/validation/settings.ts`, `ViewerContext`, `./support`. Called by `app/api/settings/household/route.ts` and `app/api/settings/profile/route.ts`; called directly by `tests/integration/settings-api.test.ts`; client side is `components/settings/SettingsForm.tsx`.

**Debugging**
- 400 `fields.timezone` -> the string is not accepted by `new Intl.DateTimeFormat` -> `updateHousehold` / `assertTimeZone` in the service.
- Name saved but the UI still shows the old one -> the session/member list is rendered from `app/(app)/layout.tsx` and `app/api/session/route.ts` -> check client cache invalidation, not this handler.
- 404 "Account not found." on save -> the seeded `member` has no matching `user` row -> `updateMemberName`.

**Tests** — `tests/integration/settings-api.test.ts` (household name/timezone/week start, invalid timezone, blank name, profile name).

### lib/api/handlers/import.ts

**Purpose** — Adapters for the four Google Calendar import routes: reads the multipart upload (repeated `files` fields and an optional JSON `mapping` field), hands the text to `lib/services/import.ts`, and returns the preview, report, history or rollback result.

**Public API** — `previewImportHandler(db, ctx, request): Promise<Response>` -> `200 { preview }`; `commitImportHandler(db, ctx, request): Promise<Response>` -> `201 { report }`; `listImportBatchesHandler(db, ctx): Response` -> `200 { batches }`; `rollbackImportBatchHandler(db, ctx, id): Response` -> `200 { rollback }`.

**State & side effects** — Reads the uploaded text into memory (the service enforces the 5 MB / 20-file / 50 000-event caps); the handlers themselves write nothing. A missing or malformed `mapping` field is `400 VALIDATION` before the service runs; a non-object mapping is rejected with `fields.mapping`. Every other status (403/404/409) comes from the service and travels through `guarded` -> `apiError` unchanged.

**Depends on / Used by** — `guarded` from `./support`, `AppError`, `Database`, `ViewerContext`, and the four service functions. Used by `app/api/import/preview/route.ts`, `app/api/import/commit/route.ts`, `app/api/import/batches/route.ts` and `app/api/import/batches/[id]/rollback/route.ts`; those routes only add `withViewer` plus `dynamic = "force-dynamic"`.

**Limits** — a body over 25 MB is rejected from `content-length` before `formData()` buffers it (413), then per-file 5 MB and at most 20 files (400). The service still enforces its own 5 MB/50 000-event caps.

**Debugging**
- 400 "Send the export as multipart/form-data." -> the client posted JSON or an empty body -> check the `FormData` construction in `components/import/ImportWizard.tsx`.
- 400 "Send the calendar mapping as JSON." -> the mapping field was not serialised -> `readImportRequest`.
- The upload arrives with no files -> the form field name must be exactly `files`.
- A 500 on commit -> an unexpected throw outside `AppError` -> read the server log; the SQLite transaction rolled back.

**Tests** — `tests/integration/import-api.test.ts` (preview/commit/list/rollback through the handlers, mapping errors, status codes, route wiring).

### lib/api/handlers/tasks.ts

**Purpose** — The task endpoints: list a triage view (or one list) with the global rail counts, read/create/patch/delete one task, and rewrite a list's manual order.

**Public API** — All six are `guarded`, so each returns `Promise<Response>`.

- `listTasksHandler(db, ctx, request): Promise<Response>` -> `{ tasks: TaskView[]; counts: TaskCounts }`, 200. Query: `view` in `inbox|today|week|someday|all` (absent means `all`) and optional `collectionId`, both parsed by `listTasksQuerySchema`.
- `getTaskHandler(db, ctx, id): Promise<Response>` -> `{ task: TaskView }`, 200.
- `createTaskHandler(db, ctx, request): Promise<Response>` -> `{ task: TaskView }`, 201.
- `updateTaskHandler(db, ctx, id, request): Promise<Response>` -> `{ task: TaskView }`, 200.
- `deleteTaskHandler(db, ctx, id): Promise<Response>` -> empty body, 204.
- `reorderTasksHandler(db, ctx, request): Promise<Response>` -> `{ tasks: TaskView[] }`, 200.

`GET /api/tasks` reads the household with `getHousehold` and passes its `timezone` and normalized `weekStartsOn` (0 or 1) into `listTasks`, so bucket membership matches the rail. `counts` always covers every visible open task even when `view` or `collectionId` narrows `tasks`; an unknown or invisible `collectionId` is an empty list, never a 404 (the filter does not leak existence). Zod failures become `VALIDATION` 400 with `fields` keyed by the issue path (`fields.view` for an unknown bucket, `fields.collectionId` for an empty one, `fields.orderedIds` for a malformed reorder body). Every other status comes from `lib/services/tasks.ts` unchanged: 403 "This collection is view-only." for a non-writable list, 400 "Tasks live in lists." when the target is a calendar, and 400 "Send exactly the open tasks of this list." for a stale reorder set. The 404 **message depends on the path**: a task-by-id read/patch/delete in a private list the caller does not own answers "Task not found." (`taskAccess` rewrites the collection error so it hides existence exactly like a missing id), while `POST` with a `collectionId`, the target of a `PATCH` move and the reorder `collectionId` resolve the collection directly through `getCollectionAccess` and surface its own "Calendar not found.". The handler itself never repeats visibility logic.

**State & side effects** — The only direct read is `getHousehold`; `listTasks` may lazily create the caller's Inbox and builds the `TaskView` rows. `POST`/`PATCH`/`DELETE` delegate all writes to the service (checklist replacement and reorder run in transactions there). `deleteTaskHandler` answers 204 even though the task's checklist rows cascade.

**Depends on / Used by** — `lib/services/tasks.ts` (all six service functions), `lib/services/household.ts` (`getHousehold`), `lib/validation/tasks.ts` (`createTaskSchema`, `updateTaskSchema`, `reorderTasksSchema`, `listTasksQuerySchema`), `ViewerContext`, `NextResponse`, and `fieldErrors`/`guarded`/`readJson` from `./support`. Called by `app/api/tasks/route.ts` (`GET`, `POST`), `app/api/tasks/[id]/route.ts` (`GET`, `PATCH`, `DELETE`) and `app/api/tasks/order/route.ts` (`PATCH`); called directly by `tests/integration/tasks-api.test.ts`; client side is `lib/query/tasks.ts`.

**Debugging**
- 400 `fields.view` -> the caller sent something outside `inbox|today|week|someday|all` -> `listTasksQuerySchema` / `taskViewSchema`.
- A list shows fewer tasks than its badge -> expected: `counts` is global, the filter narrows `tasks` only -> compare `useTasks(view, collectionId)` with a bare `useTasks()`.
- 404 for a task that exists -> its list is private and owned by the partner, or the id belongs to another household; both answer exactly like a missing id -> `getTask` / `writableTask` in the service.
- 400 "Tasks live in lists." -> the task targeted a `kind="calendar"` collection (create, move or reorder) -> check the collection's kind.
- 400 "Send exactly the open tasks of this list." -> the reorder payload was partial, duplicated, or includes a done/cross-list id; refetch `["tasks"]` and resend the full set -> `reorderTasks`.
- A PATCH that echoes the stored status returns 200 without moving the audit stamps -> intended transition-only behaviour -> `updateTask` in the service.

**Tests** — `tests/integration/tasks-api.test.ts` (list shape and global counts, invalid view, 201/200/204 statuses, reorder and partial-set 400, partner 404, unauthenticated 401 through `withViewer`). Service rules live in `tests/integration/tasks.test.ts`.

### lib/api/handlers/support.ts

**Purpose** — The three helpers every handler uses: an error boundary, a JSON body reader, and a Zod-to-`fields` mapper.

**Public API** —
- `guarded<Args extends unknown[]>(handler: (...args: Args) => Promise<Response> | Response): (...args: Args) => Promise<Response>` — runs the handler and converts thrown errors with `apiError`.
- `readJson(request: Request): Promise<unknown>` — `request.json()`, converting a parse failure into `AppError("VALIDATION", "Send a JSON body.", 400)` with no `fields`.
- `fieldErrors(error: ZodError): AppError` — `VALIDATION` 400, message "Check the highlighted fields.", `fields[issue.path.join(".") || "form"] = first message per key`.

`fieldErrors` keeps only the first message for a repeated key, and maps a root-level issue to the key `form`.

**State & side effects** — None; no DB, no logging, no side effects beyond consuming the request body (`readJson` can only be called once per request).

**Depends on / Used by** — `apiError` from `lib/api/route.ts`, `AppError`, `ZodError` type, `NextResponse`. Imported by `handlers/collections.ts`, `handlers/events.ts`, `handlers/import.ts`, `handlers/preferences.ts`, `handlers/settings.ts`.

**Debugging**
- 400 "Send a JSON body." with no `fields` -> the body was empty or not JSON, so validation never ran -> `readJson` at the top of the handler.
- A field error is missing from the client's map -> the issue path did not match the form's field name, or a duplicate path was collapsed -> `fieldErrors`.
- A handler lets a malformed body through -> it used `request.json().catch(...)` instead of `readJson` (only `deleteEventHandler` does this, on purpose).

**Tests** — No direct test coverage; exercised by every handler integration test through the 400 envelopes.

## Focused verification

```bash
npx vitest run tests/integration/collections-api.test.ts tests/integration/events-api.test.ts tests/integration/preferences-api.test.ts tests/integration/settings-api.test.ts tests/integration/tasks-api.test.ts
npm run lint && npm run typecheck
```
