# Debugging Nailong Planner

Read this before grepping the source. It is the shortest path from a symptom to
the file that owns it: the layer map, the data contract, the traps that have
already cost time, and a symptom lookup table with the exact command to run.

If something here is wrong or missing, fix it in the same change — this file is
part of the definition of done in [`../AGENTS.md`](../AGENTS.md).

## 1. Fast commands

```bash
# Reproduce locally
npm run dev                                   # http://localhost:3000
npm run db:migrate && npm run provision       # empty database / no household

# Smallest failing check first — never the full suite as an edit loop
npx vitest run tests/unit/view.test.ts        # one unit file
npx vitest run tests/integration/events.test.ts
npx vitest run tests/unit/recurrence.test.ts -t "exdate"   # one test name
npx tsx scripts/seed-test-db.mts              # reseed .playwright/test.db + fixtures.json
npx playwright test tests/e2e/events.spec.ts  # one spec
npx playwright test tests/e2e/tasks.spec.ts   # the tasks workspace (seeded lists/tasks)
npx playwright test tests/e2e/events.spec.ts --headed --debug

# Before claiming done
npm run lint && npm run typecheck && npm run docs:check
npm test                                      # Vitest unit + integration (in-memory SQLite)
npm run test:e2e                              # Playwright: seeds .playwright/test.db, serves :3100
```

- Vitest uses an **in-memory SQLite** database built from the committed
  migrations (`tests/helpers/db.ts`); nothing touches `data/planner.db`.
- Playwright seeds `.playwright/test.db` and starts its own dev server on
  **:3100**. Next allows one dev server per project directory — stop your own
  `npm run dev` first if E2E reports the port is taken.
- The dev server logs to `devserver.log` / `devserver.err.log` in the repo root
  when it was started by a helper; an unhandled API error logs
  `[api] unhandled error` there and returns a generic 500.

## 2. Layer map — where the bug lives

```
Browser
  components/{calendar,shell,sidebar,settings,ui}   React UI, FullCalendar adapter
  lib/ui/*                                         client state: view, visibility, undo, shortcuts
  lib/query/*                                      TanStack Query hooks + optimistic cache updates
        │ fetch
        ▼
  app/api/**/route.ts                              thin Next route handlers (export POST/GET/…)
        │
  lib/api/route.ts    withViewer(): session -> member -> ViewerContext, error -> JSON envelope
  lib/api/handlers/*  auth + Zod validation, then call a service
        │
  lib/services/*      business rules + all SQL (drizzle). The only layer that touches the DB.
  lib/db/*            schema, client (better-sqlite3, WAL), migrations
  lib/time/* lib/recurrence/* lib/color/*   pure domain helpers used by services and UI
        │
        ▼
  SQLite ./data/planner.db (or /data/planner.db in Docker)
```

| Symptom area | Look here first | Documented in |
|---|---|---|
| Wrong value from an endpoint, status code, auth | `app/api/**/route.ts` → `lib/api/handlers/*` | `COMPONENTS/app-routes.md`, `COMPONENTS/api-layer.md` |
| Wrong stored data, permission, calendar/event rule | `lib/services/*` | `COMPONENTS/lib-services.md` |
| Schema, query key, stale UI after mutation, session/member | `lib/db/*`, `lib/query/*`, `lib/auth/*`, `lib/validation/*` | `COMPONENTS/lib-data.md` |
| Date/time off by hours or days, recurrence, shades, error codes | `lib/time/*`, `lib/recurrence/*`, `lib/color/*`, `lib/errors.ts` | `COMPONENTS/lib-domain.md` |
| View/visibility/shortcut/undo state | `lib/ui/*` | `COMPONENTS/lib-ui.md` |
| Rendering, layout, interaction | `components/*` | `COMPONENTS/components-*.md` |
| Script, migration, deploy, CI, env | `scripts/*`, `drizzle/*`, config files | `COMPONENTS/scripts-and-ops.md`, `OPERATIONS.md` |

The request pipeline in one line:
`route.ts` → `withViewer(handler)` in `lib/api/route.ts` (session cookie →
`member` row → `ViewerContext`, then `apiError`) → `lib/api/handlers/*` (Zod
`*Schema.parse` + service call) → `lib/services/*` (rules + SQL) → SQLite.

## 3. The data contract — check this before debugging dates or permissions

**Events** (`lib/db/schema.ts`, `lib/time/zone.ts`)

- `allDay = 1`: `startDate` / `endDate` are **local calendar dates**
  `YYYY-MM-DD`; `endDate` is **inclusive** in storage. FullCalendar wants an
  exclusive end, so `components/calendar/toFcEvent.ts` adds one day when
  converting. Do **not** round an all-day date through a timestamp.
- `allDay = 0`: `startAt` / `endAt` are **UTC epoch milliseconds** (instants).
  Wall-clock conversion goes through `localWallTimeToUtc` / `utcToLocalWallTime`
  in `lib/time/zone.ts` with the **household** timezone, never the process TZ.
- `localWallTimeToUtc` throws `VALIDATION` ("That time does not exist…") for a
  daylight-saving spring-forward gap. That is correct behaviour, not a bug.
- `addDaysToDate` shifts a date without constructing a local `Date` — use it
  whenever you need "the next calendar day".

**Recurring events** (`lib/recurrence/expand.ts`)

- `rrule` is an RFC 5545 RRULE string; `DTSTART` is reconstructed from the
  event's **own stored start**, never from "now".
- A timed series is expanded in its **own wall-clock zone**: `event.tzid` when
  set (imported Google series), otherwise the household zone. Expansion runs on
  floating wall times and converts each occurrence back to an instant, so a
  London 09:00 series stays at 09:00 after a DST change. A series that drifts by
  an hour after a transition has a null/wrong `tzid`, not a bad start time —
  do not "fix" it by editing `startAt`.
- An invalid/unparseable RRULE **silently degrades to a single event** (`safeRule`
  returns null). If a series is not repeating, check the stored rule string first.
- `exdates` is a JSON array. Accepted entries: `YYYY-MM-DD` (all-day),
  `YYYY-MM-DDTHH:MM` (converted in the event's zone, `event.tzid ?? household
  zone`), or any `Date.parse`-able string. Malformed JSON or non-string entries
  are **ignored silently** — that is the usual reason a deleted occurrence comes
  back.
- v0.1.0 edits a recurring event **as a series**; only single-occurrence
  **deletion** exists (append to `exdates`).
- The repeat controls are a structured view over `rrule`
  (`lib/recurrence/rule.ts`): interval, weekly weekdays, monthly
  day-of-month/nth-weekday, and `Never`/`On`/`After N` ends. The dialog sends
  the stored rule **byte-identical** only while the controls still describe it
  (`keepInitialRule`: no repeat edit, start date and all-day toggle unchanged).
  Touching a repeat control intentionally rebuilds the rule, which may normalise
  its text — that is not corruption.
- Moving an event's start date re-anchors an uncustomised weekly/monthly pattern
  (`anchorRepeat`), so the start date is always an occurrence. A series whose
  first block appears days after its start date has a stored `BYDAY` that
  disagrees with `DTSTART` (the pre-editor bug, or an imported rule).
- The editor writes `UNTIL` as a DATE-only value for all-day series and as the
  UTC instant of end-of-day for timed series. `floatingRule` in `expand.ts`
  converts only the `…Z` form; an imported floating (no-`Z`) `UNTIL` is already
  in series-local time by design.
- `On` ends are validated by counting occurrences and `After N` is capped at 730
  (Google's limit). `Never` is allowed: expansion is client-side and does not
  stop at Google's 730 occurrences.

**Calendars**

- Root calendar (`parentId = null`) owns a hue family at shade 3 of 8.
  Sub-calendars take the next unused shade from `[4, 2, 5, 1, 6, 0, 7]` — at most
  7 children per root (`lib/color/palette.ts`, `lib/services/collections.ts`).
  Recolouring a root re-shades its family; do not "fix" a child's shade by hand.
- New `From Google` import trees are **owned by the importer** and reused only by
  them, so imported events sit in that person's group, not "Ours". A tree imported
  before that rule has `owner_id` NULL and stays shared until re-imported (the rows
  move idempotently) or re-owned in the calendar dialog (`lib/services/import.ts`
  `ownedImportRoots`).
- **A sub-calendar belongs to its root**: `owner_id` is copied at creation, an
  owner move on a root is cascaded to every child in one transaction, and setting
  `ownerId` on a child is rejected (`VALIDATION` 400). Migration `0004` backfilled
  legacy rows. Visibility folds the same way (`effectiveOwnerOf`/`groupOf(parent)`),
  so a stale child row can no longer hide behind "Ours" — see the trap below.

**Permissions** (`lib/services/permissions.ts`, `lib/services/collections.ts`)

- **Effective visibility is computed once, on the server.** `resolveVisibleCollections`
  (and `getCollectionAccess` for one id) folds the root into every child:
  `ownerId = root.ownerId ?? row.ownerId`, `visibility` = the most restrictive of
  root and row. `private` rows are readable only by that effective owner;
  `shared` and `view_only` by both household members.
- **The private filter is server-side and lives in one resolver; reads never
  filter ad hoc.** `listCollectionTree`, `listEvents` and `searchEvents` derive
  their readable ids from `resolveVisibleCollections`; `getCollection` and
  `getEvent` run `canReadCollection` and answer `NOT_FOUND` 404 for an invisible
  id. Do not add a local `visibility !== 'private'` check to a route or service —
  child rows are stored `shared`, so only the root fold is correct.
- `assertWritable` is the one write guard: foreign household -> 404; `private`
  not owned -> 404 (existence hidden, not 403); `view_only` not owned or
  ownerless -> 403 "This collection is view-only."; `shared` -> writable by both.
  `assertCollectionWritable` remains as a delegating wrapper. `canWriteCollection`
  is the pure owner predicate used by the client and fails closed for an
  ownerless non-shared row.
- **The Inbox is a real collection**, one per user: a root `kind='list'`,
  `visibility='private'` row created lazily by `ensureInbox` (called by
  `GET /api/collections`; task creation calls it too). It never appears in the
  partner's tree.
- **Visibility is inherited from the root**: nesting is capped at two levels;
  `updateCollection` rejects setting `visibility`, `ownerId` or `hueFamily` on a
  child, and setting `ownerId: null` also resets `visibility` to `shared`.
  Switching to `private` with an effective owner of `null` is a 400 "A private
  collection needs an owner.".
- **Household scoping happens before the permission check**, and out-of-household
  ids surface as `NOT_FOUND` 404 — never 403. A 403 means "your account is not in
  this household" (missing `member` row).
- Import commit/rollback and the root-owner cascade in `updateCollection` are the
  `db.transaction` users; ordinary calendar/event writes are single statements. A
  multi-statement non-import change (event upsert + `exdates` append) is still not
  atomic — do not assume all-or-nothing writes outside the importer and the owner
  cascade.
- A missing `member` row means the household was never provisioned → run
  `npm run provision`.

**Collections and tasks (migration 0005)**

- `calendar` was renamed in place to `collection`; SQL queries must use
  `collection`. The TypeScript layer imports `collection` and its row type is
  `CollectionRow` — there is no `calendar` alias left to import.
- `collection.kind` (`calendar`/`list`, default `calendar`) says what the node
  holds. `collection.visibility` (`shared`/`view_only`/`private`, default `shared`)
  replaced `is_view_only_for_partner`; migration `0005` backfilled `1` →
  `view_only`. There is no `is_view_only_for_partner` column any more — a query or
  a snapshot that mentions it is stale.
- `event.calendar_id` is now `event.collection_id`; the Drizzle property is
  `collectionId` and the index is `event_collection_idx`.
- `task.scheduled_on`/`task.due_on` are **date-only** household-local `YYYY-MM-DD`
  strings, not epochs: never pass `startAt`-style milliseconds. `task.status` is
  `open`/`done`/`dropped`; `task.sort_order` is the manual order; deleting a
  collection cascades its tasks, and deleting a task cascades its
  `task_checklist_item` rows. Task reads are task-scoped only through their
  collection: a hidden collection's 404 is rewritten to "Task not found." on
  every verb, and the list views derive buckets from the household's `timezone`
  and `weekStartsOn` (`lib/services/tasks.ts`, `lib/domain/tasks.ts`).
- `tests/helpers/db.ts` `makeTestDb({ upTo })` builds a temporary migrations folder
  truncated at a journal tag, so a migration test can insert pre-migration rows and
  then call `migrate(db)`. The real `drizzle/` folder is never modified.

**Visibility** (client-only, `lib/ui/visibility.ts`)

- `groups` (person pills) + `collections` (per-collection overrides, missing =
  visible) + the parent's checkbox must all agree; `only` ("display only this
  calendar") **outranks everything**. This client copy is a display preference,
  never a security boundary — the server's `resolveVisibleCollections` is.
- View/visibility/undo client state is persisted in `localStorage` via
  `lib/ui/view.ts`, `lib/ui/lastView.ts`, `lib/ui/visibleCollections.ts`; the undo
  stack (`lib/ui/undo.ts`) is **session-only** and disappears on reload.

**Client cache and database** (`lib/query/*`, `lib/db/*`)

- Query keys: `["collections"]`, `["events", from, to]`,
  `["events", "search", normalized]`, `["preferences"]`.
- Event mutations work on the `["events"]` **prefix**, so optimistic
  `temp-<uuid>` rows also appear in search results and search refetches after
  every event mutation. Rollback is wholesale (`snapshotEvents` /
  `restoreEvents`, private to `lib/query/events.ts`).
- Preferences **never invalidate**: mutations `setQueryData` the PATCH response,
  the query has `staleTime: Infinity` + server `initialData`, and a
  `latestIssued` sequence guards out-of-order responses. "Setting saved but not
  applied" is a cache/sequence issue, not a service one.
- Two timestamp conventions: domain tables (`household`, `member`, `calendar`,
  `event`, `user_preference`) store `integer` epoch **milliseconds** and hydrate
  as `number`; Better Auth tables use `mode: "timestamp_ms"` and hydrate as
  `Date`. Mixing them produces `NaN` or `[object Object]`.
- There are **no foreign keys** from `member.user_id`, `calendar.owner_id`,
  `event.created_by` or `user_preference.user_id` to `user.id` — the references
  are logical and validated in services. The two-account cap is a Better Auth
  `databaseHooks.user.create.before` check, not a DB constraint.
- Migrations run **lazily on the first `getDb()`**, not at `next build`, and
  `migrate()` resolves the `drizzle/` folder from `process.cwd()`. WAL allows one
  writer: a dev server and a script writing at the same time block each other.

**Layout contract** — the shell owns the viewport: `AppShell` is `h-dvh`,
`main` owns scrolling, and the calendar fills the rest
(`height="100%"` + `expandRows`). `tests/e2e/viewport-fit.spec.ts` asserts "no
page scroll, whole month visible" across eight viewports; run it after touching
any wrapper in the shell/calendar tree.

## 4. Traps that have already bitten

| Symptom | Likely cause | First check |
|---|---|---|
| Event shows one day early/late | all-day date went through a timestamp, or the exclusive/inclusive end conversion was skipped | `components/calendar/toFcEvent.ts`, `eventPayload.ts`, `lib/time/zone.ts` |
| Event time shifted by the user's UTC offset | timed event rendered from a wall-time string instead of `startAt` UTC ms (or vice versa) | `lib/time/format.ts`, `toFcEvent.ts` |
| 400 "That time does not exist in this timezone" | DST spring-forward gap — intended validation | `lib/time/zone.ts` `localWallTimeToUtc` |
| Recurring series shows only once | invalid RRULE silently degraded, or `exdates` swallowed every occurrence | `lib/recurrence/expand.ts` `safeRule` / `parseExdates` |
| Deleted occurrence reappears after reload | EXDATE string format not one of the accepted forms, or stored via a different timezone. Matching is shape-dependent: timed events only match instants, all-day events only match `YYYY-MM-DD`, and an all-day series resolves a `YYYY-MM-DDTHH:MM` EXDATE in **UTC**, not the household zone | `lib/recurrence/expand.ts` `parseExdates`; the raw `exdates` column |
| The repeat editor says "Does not repeat" for a repeating series | `parseRepeatRule` returned `null` because `FREQ` is outside DAILY/WEEKLY/MONTHLY/YEARLY (e.g. `FREQ=HOURLY` from an import); the stored rule is preserved until Repeat changes | `lib/recurrence/rule.ts` `parseRepeatRule`, the unsupported-rule note in `EventDialog.tsx` |
| A weekly series does not appear on its own start date | stored `BYDAY`/`BYMONTHDAY` disagrees with `DTSTART`; move the start date or re-pick the repeat days | `parseRepeatRule`/`anchorRepeat` in `lib/recurrence/rule.ts` |
| The repeat summary hides the end date | a timed `UNTIL` was rendered without the household `timezone` context, so the summary fell back to UTC or dropped it | `describeRrule` call in `components/calendar/EventDetails.tsx` |
| Drag/resize/create snaps back | optimistic update rolled back: API rejected (view-only, validation, 4xx) | browser network panel, then `lib/query/eventCache.ts` + `canWriteCollection` |
| Undo toast does nothing | the action was already undone (second click), dropped by the 20-action cap, never pushed, or the mutation failed and already rolled back; the stack is session-only | `lib/ui/undo.ts` `undoAction`, `lib/ui/undoToast.ts` |
| Cannot edit a calendar/event | collection `visibility = 'view_only'` or `'private'` and the viewer is not the owner; server re-checks on write | `lib/services/permissions.ts`, `lib/services/events.ts` |
| The partner can see a private collection or its events | a read path filtered the raw `visibility` column (child rows store `shared`) or skipped the resolver | `lib/services/collections.ts` `resolveVisibleCollections`/`getCollectionAccess`; `lib/services/events.ts` `getEvent`/`listEvents`; `lib/services/search.ts` |
| A private write returns 404 where 403 was expected | intended: `assertWritable` hides a private-not-owned row's existence | `lib/services/permissions.ts` `assertWritable` |
| An `Inbox` list appears in every tree after loading | `GET /api/collections` lazily calls `ensureInbox`; each member gets their own private list | `lib/services/collections.ts` `ensureInbox`; `lib/api/handlers/collections.ts` |
| Calendar row/checkbox does nothing | parent checkbox or `only` mode overriding it | `lib/ui/visibility.ts` `isCollectionVisible` |
| A sub-calendar renders under a person's heading but its events still vanish with the "Ours" pill | the child row's `owner_id` is NULL (or otherwise disagrees with its root) — an owner move from before the cascade fix; visibility must fold the root | that row's `owner_id` vs its root's; `effectiveOwnerOf`/`groupOf(parent)` in `lib/ui/visibility.ts`, migration `0004`, `updateCollection`'s owner cascade |
| Sub-calendar has the wrong colour | shade assigned on create from the parent's family; palette exhausted at 7 children | `lib/color/palette.ts`, `lib/services/collections.ts` |
| Person 2's imported events sit under "Ours" and vanish when the Ours pill is hidden | the import-created calendar's `owner_id` is NULL — a tree imported before imports became personal per importer | that calendar row's `owner_id`; re-import (creates the importer's own tree and moves the rows) or change the calendar's owner; `lib/services/import.ts` `ownedImportRoots` |
| Page scrolls / grid height wrong | shell wrapper lost `h-dvh`/`min-h-0`, or `main` got `overflow-visible` | `app/(app)/layout.tsx`, `components/shell/AppShell.tsx`, `tests/e2e/viewport-fit.spec.ts` |
| 401 on an API call | no session cookie (signed out, cookie origin/TTL) | `lib/api/route.ts` `viewerFromRequest`, `BETTER_AUTH_URL` |
| 403 "not part of this household" | `member` row missing — household not provisioned | `npm run provision` |
| 500 with generic message | a non-`AppError` was thrown; the real error is only in the server log | `[api] unhandled error` in the dev server output; throw `AppError` for expected failures |
| Zod/field errors on a valid form | request body shape vs `lib/validation/*.ts` schema (field names, `.strict()`) | the matching schema + the mutation in `lib/query/*` |
| Shortcut fires while typing | the input is not recognized as editable by the shared guard | `lib/ui/shortcutGuards.ts` `isTextEntryTarget` |
| Settings change has no effect | preference cached by TanStack Query; check the query key and invalidation | `lib/query/preferences.ts`, `lib/services/preferences.ts` |
| Wrong month on load / deep link | `?date=` / `?event=` parsing and remembered last view | `lib/ui/view.ts`, `lib/ui/lastView.ts`, `app/(app)/page.tsx` |
| Two popups at once (event details over a new-event bubble, or the reverse) | two surfaces were opened without dismissing each other: the search deep-link poll landed after the user started creating, or an opener skipped clearing the other state | `components/calendar/CalendarShell.tsx` (`overlaySeqRef`/`linkSeqRef`; `openQuickCreate`, `openDialog`, `requestDeleteFor`, `handleEventClick` each clear the others) |
| Clicking a toolbar or sidebar control leaves the quick-create bubble on screen | the desktop bubble's capture-phase `pointerdown` dismissal was removed, or the clicked element carries `data-dismiss-ignore` | `components/calendar/QuickCreatePopover.tsx` (the `pointerdown` effect), `CalendarPicker.tsx`'s portalled content |
| A new-event bubble proposes the previous calendar right after "display only this calendar" changes | the bubble is reused across drafts, so a default frozen in state at mount goes stale | `QuickCreatePopover.effectiveCollectionId` (`pickedCollectionId ?? defaultCollectionId`), `defaultEventCollectionId` in `CalendarShell.tsx` |
| Mini-month dots do not match the grid | mini month derives its own event summary from the same visible-range query | `components/calendar/MiniMonth.tsx`, `components/sidebar/SidebarMiniMonth.tsx` |
| Hydration mismatch in the calendar | `localStorage`/`matchMedia` read during render instead of in an effect | `lib/ui/useMediaQuery.ts`, `useVisibility.ts`, `view.ts` |
| A calendar renders editable though it is view-only | `CalendarShell` calls `canWriteCollection` with a viewer of `{ userId, householdId: "" }`; the predicate only reads `userId` today | `components/calendar/CalendarShell.tsx` (`readOnlyCollectionIds`), `lib/services/permissions.ts` |
| "Default view" setting seems ignored | `localStorage["nailong.lastView.<userId>"]` wins over the `defaultView` preference; only a fresh session falls back to it | `lib/ui/lastView.ts`, `lib/ui/view.ts`; clear storage as `tests/e2e/view-preference.spec.ts` does |
| `g` shortcut does nothing, or undo still fires with shortcuts disabled | `ShortcutHelpDialog` advertises `g` but `CalendarShell` never passes `onOpenDatePicker`; `useUndoHotkey()` is mounted unconditionally | `components/calendar/ShortcutHelpDialog.tsx`, `Components/calendar/CalendarShell.tsx`, `lib/ui/useUndoHotkey.ts` |
| Escape in the calendar picker loses the quick-create draft | `CalendarPicker`'s portalled popover must `stopPropagation` Escape so it does not bubble to `QuickCreatePopover` | `components/calendar/CalendarPicker.tsx`, `QuickCreatePopover.tsx` |
| Mini month weekday order or "today" differs from the grid; clicking a grey adjacent-month day does nothing | `MiniMonth` hardcodes a Sunday-first grid and uses the device clock, ignoring the household `weekStartsOn`/timezone that FullCalendar honours; leading/trailing adjacent days are decorative `aria-hidden` spans, not gridcells; the picker's Today button is household-local only when the caller passes `today` | `components/calendar/MiniMonth.tsx`, `DatePickerPopover.tsx`, `DateField.tsx`, `lib/time/zone.ts` |
| Clicking Undo reverts a different change than the toast names | the toast button is calling `undoLast()` (LIFO) instead of the `UndoHandle` its own `pushUndo` returned; only the `z`/`Ctrl+Z` hotkeys are LIFO | `lib/ui/undo.ts` (`pushUndo` returns the handle, `undoAction`), `lib/ui/undoToast.ts` |
| Clicking Undo loses the action | `undoAction()`/`undoLast()` remove the entry before running it, and the stack is session-only (max 20); a failed undo is not re-queued | `lib/ui/undo.ts`, `lib/ui/useUndoHotkey.ts` |
| Toast text/colours overridden by sonner's stylesheet | there is no project toast wrapper — call sites import `toast` from `sonner`; the `!` important modifiers in `TOASTER_PROPS` are load-bearing | `components/ui/toast.tsx` |
| A sidebar bug reproduces in only one place | `AppShell` renders the collection tree twice (desktop aside + phone sheet): shared query cache and one shared fold state, separate local dialog state | `components/shell/AppShell.tsx`, `components/sidebar/CollectionTree.tsx` |
| A folded sidebar branch is open again after reload, or folds by itself | fold state lives in `localStorage` under `nailong.treeFold.<userId>`; a failed write (private mode) degrades to session-only, and corrupt stored JSON falls back to everything expanded | `lib/ui/useTreeFold.ts`, `lib/ui/treeFold.ts` |
| The phone sheet's fold chevron expands the wrong list | both tree copies are in the DOM (hidden desktop aside + sheet), so disclosure ids must be per instance | `components/sidebar/CollectionTree.tsx` (`instanceId` from `useId`) |
| Sub-calendars stay visible after collapsing their root, or a group heading does not fold | the child/group `<ul>` lost its `hidden={!open}` or the heading button lost its toggle handler — folding never touches `isCollectionVisible` | `components/sidebar/CollectionTree.tsx`, `components/sidebar/CollectionRow.tsx` |
| A new `(app)` route shows the "Calendar" breadcrumb | `AppShell.ROUTE_CRUMBS` is derived from `LIVE_ENTRIES`; the route's roadmap entry is still `status: "planned"` | `lib/roadmap.ts` |
| A gated rail icon promises a release that already shipped, or names the wrong one | destinations, `version` and the gate label live in one array and nowhere else | `lib/roadmap.ts`, `ROADMAP[].status`/`ROADMAP[].version` |
| "Delete this occurrence" wiped the whole series | a DELETE sent with **no JSON body** defaults to `scope: "all"` in the handler; `scope: "this"` needs a non-empty `occurrenceStart` | `lib/api/handlers/events.ts` `deleteEventHandler`, the client mutation in `lib/query/events.ts` |
| Deleting an occurrence returns 500 | the stored `exdates` JSON is corrupt: the append path parses it strictly, while the read path tolerates it | `lib/services/events.ts` `deleteEvent`, `lib/recurrence/expand.ts` |
| Recurring events appear outside the requested range | `listEvents` returns **every** recurring row and lets the client expand it; only non-recurring rows are range-filtered. All-day overlap is compared against the local date of the exclusive `to` bound | `lib/services/events.ts` `listEvents` |
| Event list looks shifted when the client omits `from`/`to` | the handler defaults to the household-timezone **current month**, falling back to `Asia/Taipei` if the household row is missing | `lib/api/handlers/events.ts` |
| A task marked done or dropped vanishes from every task view | `listTasks` only loads `status = 'open'`; `view: "all"` is still open-only, so finished work is reachable only by its list/calendar, not by a bucket | `lib/services/tasks.ts` `listTasks`, the row's `status`/`completedAt`/`droppedAt` |
| Task shows in Today or Week although it is scheduled for later | the bucket anchor is the earliest commitment (`min(scheduledOn, dueOn)`), so an earlier deadline wins over a later schedule | `lib/domain/tasks.ts` `bucketOf`, `lib/services/tasks.ts` `listTasks` |
| A task scheduled next week is missing from Today/Week/Someday | by design: `bucketOf` returns `null` beyond `endOfWeek(today, weekStartsOn)`; only the calendar's `view=all` includes it | `lib/domain/tasks.ts` `bucketOf`, `lib/services/tasks.ts` `listTasks` |
| Reorder returns 400 "Send exactly the open tasks of this list." | the payload was not the full open set — partial, duplicate, done/dropped, cross-list or missing id; a stale client must re-fetch instead of patching order | `lib/services/tasks.ts` `reorderTasks` |
| Task counts stay the same after picking a list or a view | intended: `counts` are global over visible open tasks and ignore `collectionId`/`view` | `lib/services/tasks.ts` `listTasks` |
| A deleted task cannot be restored | there is no trash table: `deleteTask` hard-deletes and the checklist cascades, so undo re-creates the task with a new id | `lib/services/tasks.ts` `deleteTask`, `components/tasks/TasksShell.tsx` |
| A triage key silently does nothing after a row was completed/deleted | the row left the open view on the settle refetch while `selectedTaskId` still named it; the shell's selection-coherence effect must move the selection and focus to the nearest surviving row (or the switcher when none remain) | `components/tasks/TasksShell.tsx` (selection-coherence effect), `data-selected` on the rows |
| Checklist item ids change on every save | intended: a checklist PATCH is a full replacement (delete all, insert in array order), not a diff | `lib/services/tasks.ts` `replaceChecklist`, `components/tasks/TaskEditorDialog.tsx` |
| The task editor will not save | the title is blank after trimming (the field shows its alert and Save is disabled), or a PATCH is already in flight | `components/tasks/TaskEditorDialog.tsx` `save`, `useUpdateTask().isPending` |
| Escape closes the task editor instead of just the due-date calendar | the popover must be the topmost Radix `DismissableLayer` while it is open (portalled inside its own `PopoverPrimitive.Root`); that layer owns Escape via a `document` capture listener, and no `stopPropagation` is involved | `components/tasks/TaskEditorDialog.tsx` (`PopoverPrimitive.Root`/`Content`) |
| Undo after deleting a task restores it without its checklist or in the wrong position | the delete-undo is a create plus a follow-up PATCH (`checklist` + `sortOrder`): if that PATCH is dropped the extra fields are lost, and the re-created row has a new id | `components/tasks/TasksShell.tsx` `deleteTaskWithUndo` |
| Clicking a task on the calendar opens event details or the event edit form | task chips are FullCalendar events with `extendedProps.kind = "task"` — never route them to event details/edit. The `kind === "task"` branch in `CalendarShell.handleEventClick` must run before `parseOccurrenceFcId`, and `taskChip.ts` must keep the chip read-only (`editable: false`; no drag/resize) | `components/calendar/taskChip.ts`, `components/calendar/CalendarShell.tsx` `handleEventClick`, `components/calendar/CalendarView.tsx` `eventDidMount` |
| Dragging a task row onto the big month grid does nothing, or a cross-route drag is expected | `/tasks` and `/` are different routes, so an HTML5 row drag cannot cross them: the practical drop target is the **sidebar mini-month** (present on `/tasks`), while the full grid's day cells accept the same payload for any future/other drag source. Both call `useTaskPlanDrop` | `components/sidebar/SidebarMiniMonth.tsx`, `components/calendar/CalendarView.tsx` `dayCellDidMount`, `lib/ui/useTaskPlanDrop.ts` |
| A scheduled task is missing from the month grid | the chip is filtered by `status === "open"` and the grid's visible `range`/`visibleCollectionIds`; the day may also be at its `dayMaxEventRows` cap and hiding it behind "+N more" (tasks are all-day and sort before timed events) | `components/calendar/CalendarShell.tsx` `visibleTasks`, `dayMaxEventRows` in `CalendarView.tsx` |
| A chip stays on the grid after `x` / Drop | `visibleTasks` lost its `status === "open"` filter and the optimistic task cache still holds the finished row; chips also show in Week/Day/List by design (read-only superset on the shared `events` array) | `components/calendar/CalendarShell.tsx` `visibleTasks` |
| A dropped task plans the wrong day, or its Undo restores the wrong date | the drop date was built from a timestamp instead of the day cell's local date, or the handler stopped using the drag payload's `scheduledOn` (stamped at `dragstart` from the dragged row) and read a cache entry instead | `lib/ui/useTaskPlanDrop.ts`, `lib/ui/taskDrag.ts`, `components/tasks/TaskRow.tsx`, `CalendarView`'s `utcToLocalDate(info.date…)` |
| `/tasks?task=<id>` opens no editor (dev only), or reopens after closing | the deep link is one-shot, but `deepLinkHandledRef` may only be set **after** the lookup settles: `reactStrictMode: true` runs setup → cleanup → setup, so an early marker makes the second pass skip while the first `GET /api/tasks/{id}` closure is cancelled. The in-flight promise is cached by param so the second pass awaits it; `closeEditor` must `router.replace("/tasks")` to clear the param. `/tasks` carries no view parameter, so a chip click mounts the shell on the Inbox; closing only clears `?task=` | `components/tasks/TasksShell.tsx` (deep-link effect, `closeEditor`), `lib/ui/taskDeepLink.ts` |
| `z` / `Ctrl+Z` undoes an event while editing a rich-text field | the field is not a text-entry element the shared `isTextEntryTarget` recognizes (`INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`; a `div[role="textbox"]` is not) | `lib/ui/shortcutGuards.ts` |
| Child calendar renders identical to its parent | `shadeIndex` 3 is reserved for the root; children must come from `[4,2,5,1,6,0,7]`, so a child stored as 3 collides with the parent | `lib/color/palette.ts`, `lib/services/collections.ts` |
| An error response's status does not match its code | `AppError.status` is an explicit constructor argument, not derived from `code` | `lib/errors.ts`; the throw site |
| Changing `TZ` has no runtime effect | `TZ` is validated in `lib/env.ts` but nothing reads it; the household zone comes from `household.timezone` | `lib/env.ts`, `lib/time/zone.ts`, household settings |
| Content flashes the desktop layout on a phone | `useMediaQuery`'s server snapshot is `false`, so the first paint takes the desktop branch | `lib/ui/useMediaQuery.ts`, `components/shell/AppShell.tsx` |
| All-day events silently missing from the grid | `listEvents` converts the range with `household.timezone`; a wrong household zone filters them out | `household.timezone`, `lib/services/events.ts` |
| A script hangs on its first write while the dev server runs | SQLite WAL allows a single writer | stop `npm run dev` (or the script) before the other |
| Dates render as `NaN` / `[object Object]` | domain rows are epoch-ms `number`, Better Auth rows are `Date`; the two conventions were mixed | `lib/db/schema.ts` vs `lib/db/auth-schema.ts` |
| Sign-in succeeds but the app bounces between `/login` and `/` | a session exists without a `member` row: the layout redirects to `/login` while the API returns 403 | `app/(app)/layout.tsx`, `npm run provision` |
| `/api/auth/*` returns a differently shaped error body | that route delegates to Better Auth and bypasses the `{ error: { code, message, fields } }` envelope; `LoginForm` collapses every non-429 failure to "Incorrect email or password" | `app/api/auth/[...all]/route.ts`, `app/login/LoginForm.tsx` |
| A valid `PATCH /api/settings/preferences` returns 400 | it is the only `.strict()` schema — an extra/renamed key is rejected, while other schemas strip unknown keys silently | `lib/validation/preferences.ts` |
| `restore-check` cannot find a backup that `npm run backup` just made | `backup` defaults to `--out backups`, `restore-check` hardcodes `.dev/backups`; it also has no npm wrapper and no `loadEnv()` | `scripts/backup.mts`, `scripts/restore-check.mts` |
| A committed migration never runs | migration ordering comes from `drizzle/meta/_journal.json`, never filenames — an unlisted `.sql` is silently skipped | `drizzle/meta/_journal.json`, `lib/db/migrate.ts` |
| SQL still names `calendar` or `is_view_only_for_partner` after v0.2 | migration `0005` renamed the table and replaced the flag with `visibility`; the TypeScript layer is unconditionally `collection`/`CollectionRow` (no alias), so check the SQL/snapshot names, not an import name | `drizzle/0005_collections_and_tasks.sql`, `lib/db/schema.ts` |
| A script sees none of the `.env` values | each script must call `loadEnv()` **before** importing `lib/env` (hence the dynamic `await import(...)`); only the first of `.env.local`/`.env` is loaded, from `process.cwd()` | `scripts/load-env.mts`, `lib/env.ts` |
| E2E sign-in fails though the seed ran | `scripts/seed-test-db.mts` forces a fixed secret after loading env; `playwright.config.ts` must set the same one | both files |
| E2E passes now but fails on a later date | a spec hardcoded a month/day or assumed an empty task view: the seed derives every date from `localToday(household.timezone)` and now also seeds task rows. Derive dates with `currentMonthLabel()`/`householdToday()`/`endOfWeek()` and assert count deltas or `li[data-task-id]` titles | `tests/e2e/helpers.ts`, `tests/e2e/tasks.spec.ts`, `scripts/seed-test-db.mts` |
| An imported event is at the wrong time | the `.ics` used jCal-style date values instead of RFC 5545 compact ones, the `TZID` parameter was dropped, or the event's `tzid` is null so it expanded in the household zone | `lib/import/ics.ts` `resolveTime`, the event's `tzid`; fixtures in `tests/fixtures/ics/` |
| Re-importing a Google export duplicates events | `external_key` changed between parses (UID or `RECURRENCE-ID` read differently), or the old rows predate the external columns (null keys) | `lib/import/ics.ts` `externalKeyFor`, `event.external_key` |
| Re-import reports "unchanged" but events stay in the old calendar | a mapping change is only written when the target differs from the row's calendar; check the commit's `moved` branch in `lib/services/import.ts` | `commitImport` (`moved`), the `import_change` row |
| Import 500s with a SQLite UNIQUE error | two uploaded files carried the same UID; `parseFiles` should dedupe and warn before the transaction | `lib/services/import.ts` `parseFiles`, the preview warnings |
| Importing an event with an unknown timezone silently drops it | by design: the parser skips it and lists it under `warnings` (R4) | the preview warning list, `parseIcs` |
| "Undo this import" leaves events behind | they were edited in Nailong after the import (`updatedAt > batch.createdAt`) and are reported as `skipped`; or they belong to an earlier batch | `import_change.batch_id`, `lib/services/import.ts` `rollbackImportBatch` |
| Import commit returns 403 | the mapped target calendar is view-only for this viewer; the whole transaction rolled back | the mapping step, `canWriteCollection`, `lib/services/import.ts` `resolveTargets` |
| Migration/column missing | committed SQL migrations not applied; generated migration not committed | `npm run db:migrate`, `drizzle/`, `lib/db/schema.ts` |
| Header search field widens when clicked/focused | the results panel's `w-[26rem]` sat on an in-flow wrapper inside the shrink-to-fit header block, so the `w-full` field grew with it | `components/calendar/SearchBox.tsx`, `components/calendar/SearchResultsOverlay.tsx`; `tests/e2e/search.spec.ts` "does not resize the search field" |
| A focused field's ring is clipped on one side inside a dialog | an `overflow-y-auto` scroll area clips at its padding box; the 2px outline sits 2px outside the field, so a field flush with that edge loses 4px of ring. Give the scroll area horizontal padding, never just the side the scrollbar sits on | the scroll area's `px-*` in `components/calendar/EventDialog.tsx`; `tests/e2e/events.spec.ts` "keeps the focused field's ring clear of its scroll edges" |
| A time typed into the dialog's time field is rejected although it looks valid | `parseTypedTime` is format-aware: a 24-hour household rejects an am/pm suffix such as "8:37 PM" instead of guessing | `parseTypedTime` in `components/calendar/timeSlots.ts`; the household's `timeFormat` preference |
| The dialog's time field shows 12-hour text while the grid shows 24-hour | the `timeFormat` preference was not threaded from `CalendarShell` into `EventDialog`/`TimeField` | `timeFormat={preferences.timeFormat}` on `<EventDialog>` in `components/calendar/CalendarShell.tsx` |
| A picker popover appears with no enter animation | the global `popover-in` keyframes are missing from `app/globals.css`, or the content lost its `data-[state=open]:animate-[popover-in_…]` class | `app/globals.css`; the content class in `Toolbar.tsx`, `CalendarPicker.tsx`, `DateField.tsx` and `TimeField.tsx` |
| `docs:check` fails | a source file was added/moved/deleted without its `### <path>` section | output names the heading and the doc to edit |
| Deploy never turns healthy, `/api/health` 503, log says `SQLITE_CANTOPEN` or "database check failed" | the mounted volume is not writable by the `app` user, or `DATABASE_URL` points somewhere unmountable | `docker-entrypoint.sh` chowns `$DATA_DIR` at start; check the Railway volume is at `/data` and `DATA_DIR` matches it |
| Same `SQLITE_CANTOPEN`, but the logged path starts with a tab/space before `file:` (`could not open "<TAB>file:/data/planner.db"`) | `DATABASE_URL` has leading whitespace, so `resolveDatabasePath` never strips `file:`. The app `mkdir`s a directory whose name *contains* the whitespace, but better-sqlite3 trims the filename before opening (`filenameGiven.trim()`), so it opens a different relative path under `/app` whose parent does not exist | `printenv DATABASE_URL \| od -c` in the Railway console (must start with `f`, no `\t`/`\r`); re-enter the variable exactly as `file:/data/planner.db`, then redeploy — variable edits only reach a new container |
| Container exits with `getaddrinfo ENOTFOUND`, or health checks fail while the server logs "Ready" | `HOSTNAME` was overridden: the standalone `server.js` binds `process.env.HOSTNAME` verbatim and Docker sets it to the container id | keep `ENV HOSTNAME=0.0.0.0` from the Dockerfile; never set `HOSTNAME` as a service variable |
| Sign-in fails with "Incorrect email or password" but the log shows `403 INVALID_ORIGIN` / `MISSING_OR_NULL_ORIGIN` | `BETTER_AUTH_URL` is not the exact origin the browser sends (scheme, host, trailing slash) — `LoginForm` collapses every non-429 failure into the password message | set `BETTER_AUTH_URL` to the public origin; a `curl` with `-H "Origin: <origin>"` against `/api/auth/sign-in/email` reproduces it |
| A browser write returns 403 `Cross-origin request rejected` while curl/tests work | `assertSameOrigin` rejected a foreign `Origin` (or `Sec-Fetch-Site: cross-site`); a proxy may be rewriting `Host` | `lib/api/route.ts` `assertSameOrigin`, then fix `BETTER_AUTH_URL` / proxy host forwarding |
| A migration error repeats on every request and the deploy keeps restarting | intended fail-fast: `getDb()` no longer caches a connection whose `migrate()` threw, so health stays 503 | fix the migration; `/api/health` recovers only after it applies |
| "Undo this import" returns 403 for the partner | the import targeted a calendar that is view-only for them; rollback re-checks `canWriteCollection` for every affected calendar | `lib/services/import.ts` `rollbackImportBatch`; try it as the calendar owner |
| Backup writes into the container filesystem and vanishes on redeploy | default `--out` is `backups/` relative to the image workdir | set `BACKUP_DIR=/data/backups` or pass `--out /data/backups`; `node ops/backup.mjs` in the container |
| `npm run backup` prints success but the archive is tiny/empty | `DATABASE_URL` was wrong, so the script created a new empty database | the empty-database guard now exits 1; check `DATABASE_URL`, or pass `--allow-empty` deliberately |
| E2E fails only in some months | a spec hardcoded a month/day instead of deriving it (the October 2026 literals were removed) | use `currentMonthLabel()`/`dayMonthLabel()` from `tests/e2e/helpers.ts`; CI pins `TZ=Asia/Taipei` for the runner |
| A large import makes a concurrent write fail with `database is locked` | one transaction longer than `busy_timeout` blocks the next writer; 2000 events take ~4.8 s | `lib/db/client.ts` sets 15 s; keep single-batch imports under the 50 000-event cap and avoid parallel writers |
| A task shows in the wrong triage bucket, or a past-due task is missing from Today | buckets are derived at read time, never stored (a stored bucket goes stale at midnight); task dates are date-only strings, not event epochs; the earliest of scheduledOn/dueOn anchors a task, so a past-due task is never stranded | `lib/domain/tasks.ts` `bucketOf`'s `effective` anchor; `ctx.today`/`ctx.endOfWeek`/`ctx.inboxId` at the call site |
| Single-key task shortcuts never fire, or fire on the calendar | `/tasks` keys are page-scoped to `TasksShell` and blocked while typing or with any open overlay (dialog, menu, Plan popover); the calendar's `j`/`k` are period navigation, not row movement; `shortcutsEnabled` off removes the listener entirely | `lib/ui/useTaskShortcuts.ts` (`resolveTaskShortcut`, guards), `lib/ui/shortcutGuards.ts`, `components/tasks/TasksShell.tsx` (`data-shortcuts-enabled`) |
| `Shift+K` does nothing, or opens while typing | the gesture is gated on the same `shortcutsEnabled` preference (read live through `usePreferences`) and the shared typing/overlay guards; it is mounted once in `AppShell`, not by a page | `components/shell/GlobalCapture.tsx`, `components/shell/AppShell.tsx`, `lib/ui/shortcutGuards.ts` |

## 5. Adding a feature — the touch list

| You are adding | Touch these (and their doc sections) |
|---|---|
| An API endpoint | `app/api/<area>/route.ts` + `lib/api/handlers/<area>.ts` + `lib/services/<area>.ts` + `lib/validation/<area>.ts` + `tests/integration/*-api.test.ts` + `COMPONENTS/app-routes.md`, `api-layer.md`, `lib-services.md`, `tests.md` |
| A DB column/table | `lib/db/schema.ts` + `npm run db:generate` (commit SQL under `drizzle/`) + `COMPONENTS/lib-data.md` + `COMPONENTS/scripts-and-ops.md` migration row |
| A preference | `lib/validation/preferences.ts`, `lib/services/preferences.ts`, `lib/query/preferences.ts`, settings UI + `lib/ui` consumer + docs |
| A client-state hook | `lib/ui/<hook>.ts` + `tests/unit/<hook>.test.ts` + `COMPONENTS/lib-ui.md` |
| A component | `components/<area>/` + `tests/e2e/<behaviour>.spec.ts` + its section in `COMPONENTS/components-*.md` |
| A timestamp/date rule | `lib/time/*` + `tests/unit/time.test.ts` or `format.test.ts` + `COMPONENTS/lib-domain.md` |
| A recurring-event rule | `lib/recurrence/*` + `tests/unit/recurrence*.test.ts` + `COMPONENTS/lib-domain.md` |
| A script / CI job / env var | `scripts/`, `.github/workflows/`, `.env.example` + `COMPONENTS/scripts-and-ops.md` and `OPERATIONS.md` |

## 6. When you are done

Run `npm run lint && npm run typecheck && npm run docs:check`, then the owning
tests. Commit code and docs together. The full definition of done —
including the documentation-update rule — is in [`../AGENTS.md`](../AGENTS.md).
