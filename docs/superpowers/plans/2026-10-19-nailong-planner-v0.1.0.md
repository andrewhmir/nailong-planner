# Nailong Planner v0.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a private two-person shared calendar with a two-level, shade-inheriting calendar hierarchy, deployable as one Docker container on Railway.

**Architecture:** One Next.js App Router application. Server Components load the initial shell; every mutation goes through route handlers that call household-scoped service functions (validation → permission → two-level invariant → Drizzle query). SQLite (better-sqlite3, WAL) holds auth and domain tables. The client keeps calendars/events in TanStack Query and renders them with FullCalendar v7 using a custom toolbar and per-calendar color tokens.

**Tech Stack:** Next.js 16 (App Router, TypeScript strict, `output: "standalone"`), React 19, Tailwind CSS 4 + shadcn/ui, FullCalendar 7.1.3 (`@fullcalendar/react`, `@fullcalendar/rrule`, `rrule`, `temporal-polyfill`), Drizzle ORM + better-sqlite3, TanStack Query, Better Auth 1.7 (Drizzle adapter, admin + twoFactor plugins), Zod, Vitest, Playwright, Docker on Railway.

**Spec:** `docs/superpowers/specs/2026-10-19-nailong-planner-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- **Runtime:** Node >= 22 (Docker image `node:22-bookworm-slim`); npm with committed `package-lock.json`.
- **Versions are pinned exact** (no `^`, no `~`) in `package.json`. Resolve versions once in Task 1 and never drift.
- **FullCalendar must be `7.1.3` exactly** and installed as `@fullcalendar/react@7.1.3` + `@fullcalendar/rrule@7.1.3` only. Do not install v6 packages (`@fullcalendar/core`, `daygrid`, `timegrid`, `interaction`, `luxon3`).
- **All data access goes through `lib/services/*`.** Route handlers never call `db.select()` directly; every query carries `household_id`.
- **Permissions are server-side.** UI hiding is cosmetic; every mutation re-checks in the service layer.
- **Time rules:** timed events store UTC epoch milliseconds (`start_at`, `end_at`); all-day events store local `YYYY-MM-DD` (`start_date`, `end_date`, `end_date` **inclusive**). Never convert an all-day date through UTC.
- **Color rules:** 10 hue families, 8 shades; parent renders shade index 3; children take `[4, 2, 5, 1, 6, 0, 7]`; **max 7 sub-calendars per root**; children never store a hex color.
- **Error shape everywhere:** `{ "error": { "code": "VALIDATION|UNAUTHENTICATED|FORBIDDEN|NOT_FOUND|CONFLICT", "message": string, "fields"?: Record<string,string> } }`.
- **No public sign-up route.** Exactly two users; the cap is enforced both by `emailAndPassword.disableSignUp` (production) and a `databaseHooks.user.create.before` guard.
- **Non-goals (do not build):** reminders/notifications, Google/ICS sync, per-occurrence overrides, dark mode, PWA, tasks/notes, multi-household, realtime.
- **UI copy:** English; app brand "Nailong Planner"; household default name "Our Nest"; timezone default `Asia/Taipei`; week starts Sunday.
- **Every task ends green:** `npm run lint && npm run typecheck && npm test` pass, then commit.

## Execution notes (this host)

- `npm install`, `npx`, `docker build`, and `next build` need **network egress**. The confined sandbox blocks it. Run those commands with a one-shot `sandbox_permissions: danger-full-access` escalation (the harness reports `EPERM`/hangs otherwise) — do not retry them inside the sandbox.
- Shell is Windows PowerShell 5.1: use `powershell`, never `pwsh`. Check `$LASTEXITCODE` rather than trusting wrapped stderr.
- Bash-based superpowers helper scripts cannot run in the confined sandbox; this plan does not require them.
- Commit after every task; do not batch tasks into one commit.

## Review Focus

These are the failure modes the spec implies but no single task's happy path exercises. Each has a named test in the task that owns the code.

1. **All-day event rendered across a DST change or near midnight** must keep its calendar date; it must never shift a day. (Task 4 unit tests, Task 10 mapping test.)
2. **Recurring events on the 29th/30th/31st and `exdates` matching** — skipping "this occurrence" must remove exactly that occurrence, including February and month-end series. (Task 4.)
3. **View-only bypass through the event endpoints** — a partner must get `403` on `PATCH`/`DELETE /api/events/:id` for an event in a view-only calendar, even with a valid calendar id and a crafted body. (Task 8 integration test.)
4. **Eighth sub-calendar created concurrently** — must return `409` with a friendly error, never a duplicate shade or a `500`. (Task 3 + Task 7.)
5. **375 px viewport month grid and bottom sheet** — the grid must not overflow horizontally and the tree sheet must be usable. (Task 11 Playwright mobile test.)

---

## File Structure

```
package.json, tsconfig.json, next.config.ts, postcss.config.mjs, drizzle.config.ts,
vitest.config.ts, playwright.config.ts, Dockerfile, .dockerignore, railway.json, docker-entrypoint.sh
app/
  layout.tsx, globals.css
  login/page.tsx
  (app)/layout.tsx            # auth gate + shell (top bar, sidebar, content)
  (app)/page.tsx              # calendar page
  (app)/settings/page.tsx
  api/health/route.ts
  api/auth/[...all]/route.ts
  api/session/route.ts
  api/calendars/route.ts
  api/calendars/[id]/route.ts
  api/events/route.ts
  api/events/[id]/route.ts
components/
  shell/TopBar.tsx, shell/Brand.tsx
  sidebar/CalendarTree.tsx, CalendarRow.tsx, PersonPills.tsx
  calendar/CalendarView.tsx, Toolbar.tsx, EventDialog.tsx, EventPopover.tsx, toFcEvent.ts
  ui/                         # shadcn primitives (button, dialog, popover, select, checkbox, input, label, textarea, dropdown-menu, sonner, switch)
lib/
  env.ts
  errors.ts
  db/schema.ts, db/auth-schema.ts, db/client.ts, db/migrate.ts
  color/palette.ts
  time/zone.ts
  auth/server.ts, auth/users.ts
  api/route.ts
  services/permissions.ts, services/calendars.ts, services/events.ts
  validation/calendars.ts, validation/events.ts
  query/calendars.ts, query/events.ts
  ui/visibility.ts
scripts/provision.mjs, reset-password.mjs, migrate.mjs, backup.mjs, seed-test-db.mjs
tests/unit/*, tests/integration/*, tests/helpers/db.ts, tests/e2e/*
docs/OPERATIONS.md
```

---

### Task 1: Scaffold + color palette

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/color/palette.ts`, `tests/unit/palette.test.ts`, `.github/workflows/ci.yml`
- Test: `tests/unit/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `HUE_FAMILIES: readonly ['teal','green','lime','amber','orange','rose','violet','indigo','sky','slate']`
  - `type HueFamily`
  - `SHADE_COUNT = 8`, `PARENT_SHADE_INDEX = 3`, `CHILD_SHADE_ORDER: readonly number[] = [4,2,5,1,6,0,7]`, `MAX_CHILDREN = 7`
  - `interface ShadeTokens { main: string; container: string; onContainer: string }`
  - `function shadeTokens(family: HueFamily, shadeIndex: number): ShadeTokens`
  - `function isHueFamily(value: string): value is HueFamily`

- [ ] **Step 1: Resolve exact versions and scaffold**

Run (full access needed; PowerShell):

```powershell
npm view next version; npm view react version; npm view @fullcalendar/react version
npm view better-auth version; npm view drizzle-orm version; npm view @tanstack/react-query version
npm view zod version; npm view vitest version; npm view tailwindcss version
```

Write `package.json` with those exact versions (scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`, `test:e2e`, `db:generate`, `db:migrate`, `provision`, `reset-password`, `backup`). Install:

```powershell
npm install next react react-dom @fullcalendar/react@7.1.3 @fullcalendar/rrule@7.1.3 rrule temporal-polyfill better-auth drizzle-orm better-sqlite3 @tanstack/react-query zod
npm install -D typescript @types/node @types/react @types/react-dom vitest @vitejs/plugin-react tailwindcss @tailwindcss/postcss postcss eslint eslint-config-next drizzle-kit
```

- [ ] **Step 2: Add build config**

`next.config.ts` sets `output: "standalone"`; `tsconfig.json` sets `strict: true`, `paths: { "@/*": ["./*"] }`; `postcss.config.mjs` registers `@tailwindcss/postcss`; `app/globals.css` starts with `@import "tailwindcss";`; `vitest.config.ts` uses `environment: "node"`, `include: ["tests/unit/**/*.test.ts","tests/integration/**/*.test.ts"]`; `.github/workflows/ci.yml` runs `npm ci`, lint, typecheck, test on push/PR.

- [ ] **Step 3: Write the failing palette test**

```ts
// tests/unit/palette.test.ts
import { describe, expect, it } from "vitest";
import { CHILD_SHADE_ORDER, HUE_FAMILIES, MAX_CHILDREN, SHADE_COUNT, isHueFamily, shadeTokens } from "@/lib/color/palette";

describe("palette", () => {
  it("exposes 8 distinct main shades per family", () => {
    for (const family of HUE_FAMILIES) {
      const mains = Array.from({ length: SHADE_COUNT }, (_, i) => shadeTokens(family, i).main);
      expect(new Set(mains).size).toBe(SHADE_COUNT);
    }
  });
  it("pins the parent shade and the child order", () => {
    expect(shadeTokens("teal", 3).main).toBe("oklch(0.65 0.09 190)");
    expect(CHILD_SHADE_ORDER).toEqual([4, 2, 5, 1, 6, 0, 7]);
    expect(MAX_CHILDREN).toBe(7);
  });
  it("uses dark ink on light containers and paper on dark ones", () => {
    expect(shadeTokens("rose", 0).onContainer).toBe("#4a3f36");
    expect(shadeTokens("rose", 7).onContainer).toBe("#fffdfa");
  });
  it("narrows hue family strings", () => {
    expect(isHueFamily("teal")).toBe(true);
    expect(isHueFamily("blue")).toBe(false);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run tests/unit/palette.test.ts`
Expected: FAIL — cannot resolve `@/lib/color/palette`.

- [ ] **Step 5: Implement the palette**

`lib/color/palette.ts` holds a family table of `{ hue, chroma }` — teal 190/0.09, green 150/0.10, lime 125/0.12, amber 85/0.13, orange 55/0.14, rose 10/0.12, violet 310/0.12, indigo 275/0.13, sky 235/0.10, slate 250/0.02. Main lightness ramp `[0.86, 0.79, 0.72, 0.65, 0.58, 0.51, 0.44, 0.37]`; container lightness is `main + 0.10` with 55% chroma; `onContainer` is `containerL < 0.62 ? "#fffdfa" : "#4a3f36"`. Emit CSS `oklch(L C H)` strings rounded to two decimals (e.g. `oklch(0.65 0.09 190)`).

- [ ] **Step 6: Run the suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "feat: scaffold Next.js app and color palette"
```

---

### Task 2: Database schema, migrations, test DB helper

**Files:**
- Create: `lib/env.ts`, `lib/db/schema.ts`, `lib/db/client.ts`, `lib/db/migrate.ts`, `drizzle.config.ts`, `drizzle/0000_*.sql` (generated), `tests/helpers/db.ts`, `tests/integration/db.test.ts`, `.env.example`
- Test: `tests/integration/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `env` object (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NODE_ENV`)
  - `household`, `member`, `calendar`, `event` Drizzle tables (columns exactly as spec §4)
  - Row types: `type HouseholdRow = typeof household.$inferSelect`, `type CalendarRow = typeof calendar.$inferSelect`, `type EventRow = typeof event.$inferSelect`
  - `type Database = BetterSQLite3Database<typeof schema>`
  - `function createDb(databaseUrl: string): { db: Database; sqlite: Database.Database }`
  - `function migrate(db: Database): void`
  - `async function makeTestDb(): Promise<{ db: Database; sqlite: Database.Database; close(): void }>` — `:memory:`, migrations applied, `PRAGMA foreign_keys = ON`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/db.test.ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "../../tests/helpers/db";
import { calendar, event, household } from "@/lib/db/schema";

it("creates the domain tables and cascades deletes", async () => {
  const { db, close } = await makeTestDb();
  try {
    const h = db.insert(household).values({ id: "h1", name: "Our Nest" }).returning().all();
    expect(h[0].timezone).toBe("Asia/Taipei");
    const root = db.insert(calendar).values({ id: "c1", householdId: "h1", name: "School", hueFamily: "indigo" }).returning().all()[0];
    const child = db.insert(calendar).values({ id: "c2", householdId: "h1", parentId: "c1", name: "Math", shadeIndex: 4 }).returning().all()[0];
    expect(child.parentId).toBe("c1");
    db.insert(event).values({ id: "e1", householdId: "h1", calendarId: "c2", title: "Quiz", startAt: 1_700_000_000_000, endAt: 1_700_000_360_000, createdBy: "u1" }).run();
    db.delete(calendar).where(eq(calendar.id, "c1")).run();
    expect(db.select().from(event).all()).toHaveLength(0);
  } finally { close(); }
});
```

(Import `eq` from `drizzle-orm`.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/db.test.ts`
Expected: FAIL — module `@/lib/db/schema` not found.

- [ ] **Step 3: Implement env, schema, client, migrator**

`lib/env.ts` validates with Zod and throws a readable error listing missing vars. `lib/db/schema.ts` defines the four tables with the exact columns, defaults, `references(... { onDelete: "cascade" })`, and the indexes from spec §4. `lib/db/client.ts` opens better-sqlite3, runs `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` for file databases. `lib/db/migrate.ts` calls Drizzle's `migrate(db, { migrationsFolder: "drizzle" })`. Then generate the migration:

```powershell
npx drizzle-kit generate
```

Commit the generated SQL.

- [ ] **Step 4: Add the test helper and `.env.example`**

`tests/helpers/db.ts` builds an in-memory DB, enables foreign keys, applies migrations, returns `{ db, sqlite, close }`. `.env.example` lists `DATABASE_URL=file:./data/planner.db`, `BETTER_AUTH_SECRET=`, `BETTER_AUTH_URL=http://localhost:3000`, `NODE_ENV=development`, `TZ=Asia/Taipei`, `SEED_USER_1_NAME/EMAIL/PASSWORD`, `SEED_USER_2_NAME/EMAIL/PASSWORD`.

- [ ] **Step 5: Run the suite**

Run: `npm test && npm run typecheck`
Expected: green, including the cascade test.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: add SQLite schema, migrations, and test database helper"
```

---

### Task 3: Calendar service and permission predicate

**Files:**
- Create: `lib/errors.ts`, `lib/services/permissions.ts`, `lib/services/calendars.ts`, `lib/validation/calendars.ts`, `tests/unit/permissions.test.ts`, `tests/integration/calendars.test.ts`
- Test: `tests/unit/permissions.test.ts`, `tests/integration/calendars.test.ts`

**Interfaces:**
- Consumes: `db`/schema from Task 2.
- Produces:
  - `class AppError extends Error { constructor(code: ErrorCode, message: string, status: number, fields?: Record<string,string>) }`
  - `interface ViewerContext { userId: string; householdId: string }`
  - `function canWriteCalendar(viewer: ViewerContext, cal: CalendarRow): boolean`
  - `interface CalendarNode extends CalendarRow { children: CalendarRow[] }`
  - `function listCalendarTree(ctx: ViewerContext): Promise<CalendarNode[]>`
  - `function createCalendar(ctx: ViewerContext, input: CreateCalendarInput): Promise<CalendarRow>`
  - `function updateCalendar(ctx: ViewerContext, id: string, input: UpdateCalendarInput): Promise<CalendarRow>`
  - `function deleteCalendar(ctx: ViewerContext, id: string): Promise<void>`
  - Zod schemas `createCalendarSchema`, `updateCalendarSchema`

- [ ] **Step 1: Write the failing permission and service tests**

```ts
// tests/unit/permissions.test.ts
it("partner cannot write a view-only calendar they do not own", () => {
  expect(canWriteCalendar({ userId: "u2", householdId: "h1" }, { ownerId: "u1", isViewOnlyForPartner: true } as CalendarRow)).toBe(false);
  expect(canWriteCalendar({ userId: "u1", householdId: "h1" }, { ownerId: "u1", isViewOnlyForPartner: true } as CalendarRow)).toBe(true);
  expect(canWriteCalendar({ userId: "u2", householdId: "h1" }, { ownerId: null, isViewOnlyForPartner: false } as CalendarRow)).toBe(true);
});
```

```ts
// tests/integration/calendars.test.ts — key assertions
it("assigns child shades in the documented order and reuses freed shades", async () => { /* create 3 children under root; expect shadeIndex [4,2,5]; delete middle; next child gets 2 */ });
it("rejects an eighth sub-calendar with 409", async () => { /* 7 children ok, 8th throws AppError CONFLICT status 409 */ });
it("rejects grandchildren and cross-household parents", async () => { /* parent is a child -> VALIDATION; parent householdId differs -> NOT_FOUND */ });
it("re-derives child color when the root hue changes", async () => { /* update root hueFamily; children rows unchanged, tree nodes resolve new family */ });
it("only the owner can toggle view-only, and ours-calendars cannot be view-only", async () => { /* partner toggle -> FORBIDDEN; owner NULL + flag -> VALIDATION */ });
it("deleting a root removes its children", async () => { /* expect listCalendarTree to be empty */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/unit/permissions.test.ts tests/integration/calendars.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement errors, permissions, validation, service**

`canWriteCalendar` implements spec §3 exactly (member pre-checked by caller; view-only blocks everyone except the owner; owner `NULL` is always writable). `createCalendar` enforces: child creation requires a root parent in the same household; root requires a valid `hueFamily`; children get `shadeIndex = nextShadeIndex()` from `CHILD_SHADE_ORDER`; an eighth child throws `AppError("CONFLICT", "This calendar already has the maximum of 7 sub-calendars.", 409)`. `updateCalendar` allows hue changes on roots only, owner-move on own calendars only, and the view-only toggle on owned calendars only. All reads filter by `ctx.householdId`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: add calendar service with permissions and shade assignment"
```

---

### Task 4: Event service, time helpers, recurrence

**Files:**
- Create: `lib/time/zone.ts`, `lib/validation/events.ts`, `lib/services/events.ts`, `tests/unit/time.test.ts`, `tests/integration/events.test.ts`
- Test: `tests/unit/time.test.ts`, `tests/integration/events.test.ts`

**Interfaces:**
- Consumes: `HouseholdRow` (timezone, week start), `CalendarRow`, `canWriteCalendar`, `AppError`.
- Produces:
  - `interface EventView extends EventRow { color: ShadeTokens }`
  - `function listEvents(ctx: ViewerContext, range: { from: number; to: number }): Promise<EventView[]>` — non-recurring rows intersecting the range **plus every recurring row** in the household
  - `function createEvent(ctx: ViewerContext, input: CreateEventInput): Promise<EventView>`
  - `function updateEvent(ctx: ViewerContext, id: string, input: UpdateEventInput): Promise<EventView>` — always series-level
  - `function deleteEvent(ctx: ViewerContext, id: string, opts: { scope: "all" } | { scope: "this"; occurrenceStart: string }): Promise<void>`
  - `function assertEventShape(input): void` — all-day invariant
  - Time helpers in `lib/time/zone.ts`: `localWallTimeToUtc(wall: string, timeZone: string): number` (throws `AppError` on nonexistent local times), `utcToLocalWallTime(utc: number, timeZone: string): string`, `toAllDayRange(startDate: string, endDate: string): { startDate: string; endDate: string }`
  - Zod `createEventSchema`, `updateEventSchema`

- [ ] **Step 1: Write the failing time tests**

```ts
// tests/unit/time.test.ts
it("keeps all-day dates as calendar dates across DST", () => {
  expect(toAllDayRange("2026-03-08", "2026-03-08")).toEqual({ startDate: "2026-03-08", endDate: "2026-03-08" });
});
it("converts a Timed event to UTC and back without drift", () => {
  const utc = localWallTimeToUtc("2026-03-08T09:00", "Asia/Taipei");
  expect(utcToLocalWallTime(utc, "Asia/Taipei")).toBe("2026-03-08T09:00");
});
it("is DST-safe for a zone that observes DST", () => {
  // America/New_York 2026-03-08 02:30 does not exist; helper must throw AppError VALIDATION
  expect(() => localWallTimeToUtc("2026-03-08T02:30", "America/New_York")).toThrow(AppError);
});
```

- [ ] **Step 2: Write the failing event service tests**

Cover the Review Focus items explicitly:

```ts
it("rejects an event that mixes all-day and timed fields", async () => { /* allDay true with startAt set -> VALIDATION */ });
it("returns recurring rows regardless of range and non-recurring only when intersecting", async () => { /* weekly event with startAt in January is returned for an October range */ });
it("scope=this appends exactly that occurrence to exdates", async () => { /* weekly series -> delete this on 2026-10-20 -> deleteEvent twice is idempotent */ });
it("scope=this on a month-end series removes only that month", async () => { /* FREQ=MONTHLY on the 31st; remove 2026-01-31, February occurrence remains */ });
it("returns 403 for an event whose calendar is view-only and owned by the partner", async () => { /* updateEvent and deleteEvent */ });
it("returns color tokens resolved from the event's calendar", async () => { /* expect(e.color.main).toMatch(/^oklch/) */ });
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run tests/unit/time.test.ts tests/integration/events.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement time helpers, validation, service**

`lib/time/zone.ts` uses `Intl.DateTimeFormat` for wall-clock ⇄ UTC conversion in an IANA zone and throws `AppError("VALIDATION", ...)` for nonexistent local times (DST gap). `lib/services/events.ts` enforces the all-day invariant before writing, resolves the event's calendar and runs `canWriteCalendar` for every mutation, validates `rrule` by parsing with `rrule`'s `RRule.fromString`, and appends `occurrenceStart` to the JSON `exdates` array on `scope: "this"` (idempotent). It resolves `color` from the calendar's root `hueFamily` (children inherit) and its effective shade index.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: green, including every Review Focus test in this task.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: add event service with timezone handling and recurrence"
```

---

### Task 5: Better Auth core, provisioning, two-user cap

**Files:**
- Create: `lib/auth/server.ts`, `lib/auth/users.ts`, `lib/db/auth-schema.ts` (generated), `app/api/auth/[...all]/route.ts`, `scripts/provision.mjs`, `scripts/reset-password.mjs`, `tests/integration/auth.test.ts`
- Test: `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: `env`, `db`, schema.
- Produces:
  - `const auth` (Better Auth instance) with `emailAndPassword`, `plugins: [admin(), twoFactor()]`, `databaseHooks.user.create.before` two-user guard
  - `async function countUsers(): Promise<number>`
  - `scripts/provision.mjs` — idempotent; creates household + exactly 2 users + 2 member rows
  - `scripts/reset-password.mjs` — break-glass password reset

- [ ] **Step 1: Write the failing auth integration test**

```ts
// tests/integration/auth.test.ts
it("disables public sign-up when ALLOW_SIGNUP is unset", async () => { /* auth.api.signUpEmail -> rejects */ });
it("allows provisioning exactly two users and rejects a third", async () => { /* set ALLOW_SIGNUP=1; sign up 2 -> ok; third -> error from the create guard */ });
it("signs in an existing user and returns a session", async () => { /* signUp, signInEmail, getSession -> user.email matches */ });
```

The test imports `auth` after setting `process.env.ALLOW_SIGNUP` because the config reads it at module load. Use `vi.resetModules()` between cases.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — `@/lib/auth/server` not found.

- [ ] **Step 3: Generate auth tables and implement the config**

Run `npx @better-auth/cli generate` against the Drizzle schema to produce `lib/db/auth-schema.ts`, then regenerate the domain migration (`npx drizzle-kit generate`) and apply. `lib/auth/server.ts` configures: Drizzle adapter, `emailAndPassword: { enabled: true, disableSignUp: process.env.ALLOW_SIGNUP !== "1", minPasswordLength: 12 }`, admin and twoFactor plugins, `session: { expiresIn: 604800, updateAge: 86400 }`, `rateLimit: { enabled: true, storage: "database", window: 60, max: 20, customRules: { "/sign-in/email": { window: 60, max: 5 } } }`, `advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] }, defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: env.BETTER_AUTH_URL.startsWith("https://") } }`, `trustedOrigins: [env.BETTER_AUTH_URL]`, and the user-create guard rejecting creation past two users.

- [ ] **Step 4: Implement provisioning and reset scripts**

`scripts/provision.mjs` sets `process.env.ALLOW_SIGNUP = "1"`, dynamically imports the auth module, inserts the household if missing, then for each of `SEED_USER_1_*` / `SEED_USER_2_*` (name, email, password) signs the user up if the email is absent and inserts the `member` row. Prints a summary; never prints passwords. It aborts with a clear message if a third user exists. `scripts/reset-password.mjs --email x --password y` hashes with `hashPassword` from `better-auth/crypto` and updates the `account.password` row; if that export is unavailable in the installed version, stop and report rather than inventing a weaker scheme.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: add Better Auth with two-user provisioning and 2FA plugins"
```

---

### Task 6: Login page, auth gate, session route, Playwright harness

**Files:**
- Create: `app/login/page.tsx`, `app/(app)/layout.tsx` (shell placeholder), `app/(app)/page.tsx`, `lib/api/route.ts`, `app/api/session/route.ts`, `app/api/health/route.ts`, `playwright.config.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/helpers.ts`, `scripts/seed-test-db.mjs`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `auth`, `env`, `db`.
- Produces:
  - `function routeHandler<T>(fn: (args: { ctx: ViewerContext; req: NextRequest }) => Promise<T>): (req: NextRequest) => Promise<NextResponse>` — resolves the session, loads the member/household, maps `AppError` to the standard error shape, returns `401` when unauthenticated
  - `GET /api/session` → `{ user, household, members }`
  - `GET /api/health` → `{ ok: true }` when `SELECT 1` succeeds
  - Playwright config with `webServer` on port 3100 and `DATABASE_URL=file:./.playwright/test.db`
  - `tests/e2e/helpers.ts`: `export async function signIn(page: Page, email: string, password: string): Promise<void>` — fills `/login`, submits, waits for `/`

- [ ] **Step 1: Write the failing E2E test**

```ts
// tests/e2e/auth.spec.ts
test("unauthenticated visit redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
test("wrong password shows an error and does not sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("andrew@example.test");
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert")).toContainText(/incorrect|invalid/i);
});
test("correct password lands on the calendar page", async ({ page }) => {
  await signIn(page, "andrew@example.test", "test-password-1234");
  await expect(page).toHaveURL("/");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright install chromium; npx playwright test tests/e2e/auth.spec.ts`
Expected: FAIL — `/login` renders nothing / routes missing.

- [ ] **Step 3: Implement the auth gate, login page, and API plumbing**

`app/(app)/layout.tsx` calls `auth.api.getSession({ headers: await headers() })` and `redirect("/login")` when absent. (Route protection lives in the layout + each handler rather than edge middleware, because the SQLite adapter cannot run at the edge.) `app/login/page.tsx` is a client form posting to `/api/auth/sign-in/email` with inline error rendering. `lib/api/route.ts` implements `routeHandler` as specified. Health and session routes are thin wrappers over it.

- [ ] **Step 4: Implement the test seeding script**

`scripts/seed-test-db.mjs` deletes `.playwright/test.db`, runs migrations, creates household + 2 users (emails `andrew@example.test`, `partner@example.test`, password `test-password-1234`) and 2 member rows using the same provisioning logic. Add `test:e2e` script that seeds then runs Playwright.

- [ ] **Step 5: Run the E2E suite**

Run: `npm run test:e2e -- tests/e2e/auth.spec.ts`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: add login, session gate, health endpoint, and Playwright harness"
```

---

### Task 7: Calendar API routes

**Files:**
- Create: `app/api/calendars/route.ts`, `app/api/calendars/[id]/route.ts`, `tests/integration/calendars-api.test.ts`
- Test: `tests/integration/calendars-api.test.ts`

**Interfaces:**
- Consumes: `routeHandler`, calendar service, Zod schemas.
- Produces: `GET/POST /api/calendars`, `PATCH/DELETE /api/calendars/:id` exactly as spec §7.

- [ ] **Step 1: Write the failing integration tests**

```ts
it("returns 401 without a session", async () => { /* GET /api/calendars -> 401, error.code UNAUTHENTICATED */ });
it("returns the tree for the caller's household", async () => { /* seed 2 households; only own data returned */ });
it("maps validation errors to 400 with field errors", async () => { /* POST name:"" -> fields.name */ });
it("maps a view-only write to 403 and an eighth child to 409", async () => { /* as specified */ });
it("returns 404 for another household's calendar id", async () => { /* PATCH unknown id -> 404 */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/integration/calendars-api.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement the routes**

Thin handlers: parse with Zod, call the service with `ctx`, return `201` with the created row, `200` with updated rows, `204` for deletes. Add `export const dynamic = "force-dynamic"` to both route files. No business logic in the handlers.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: add calendar REST endpoints"
```

---

### Task 8: Event API routes

**Files:**
- Create: `app/api/events/route.ts`, `app/api/events/[id]/route.ts`, `tests/integration/events-api.test.ts`
- Test: `tests/integration/events-api.test.ts`

**Interfaces:**
- Consumes: `routeHandler`, event service, Zod schemas.
- Produces: `GET/POST /api/events`, `PATCH/DELETE /api/events/:id` exactly as spec §7, including `?from=&to=` range parsing and `{ scope, occurrenceStart }` on delete.

- [ ] **Step 1: Write the failing integration tests**

```ts
it("rejects a missing or malformed range with 400", async () => { /* GET /api/events -> 400 fields.from */ });
it("returns events with resolved color tokens", async () => { /* expect(body[0].color.container).toMatch(/^oklch/) */ });
it("blocks writes to a view-only partner calendar with 403 on every verb", async () => {
  // Review Focus #3: POST, PATCH, DELETE all -> 403, with a valid calendarId/eventId
});
it("supports scope=this delete and is idempotent", async () => { /* second call still 204, exdates has one entry */ });
it("returns 404 when the event belongs to another household", async () => { /* PATCH foreign id -> 404 */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/integration/events-api.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement the routes**

`GET` parses `from`/`to` as numbers (epoch ms), defaults to the current month when absent, and returns `{ events }`. `POST` returns `201`. `PATCH` returns the updated `EventView`. `DELETE` accepts an optional JSON body with `scope`/`occurrenceStart` and returns `204`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: add event REST endpoints"
```

---

### Task 9: Cozy design tokens, app shell, sidebar tree

**Files:**
- Create: `app/globals.css` (tokens + Tailwind theme), `components/shell/TopBar.tsx`, `components/sidebar/CalendarTree.tsx`, `components/sidebar/CalendarRow.tsx`, `components/sidebar/PersonPills.tsx`, `lib/ui/visibility.ts`, `lib/query/calendars.ts`, `tests/unit/visibility.test.ts`, `tests/e2e/sidebar.spec.ts`
- Modify: `app/(app)/layout.tsx`, `app/(app)/page.tsx`
- Test: `tests/unit/visibility.test.ts`, `tests/e2e/sidebar.spec.ts`

**Interfaces:**
- Consumes: `GET /api/calendars`, `GET /api/session`, palette.
- Produces:
  - `interface VisibilityState { groups: { ours: boolean; me: boolean; partner: boolean }; calendars: Record<string, boolean> }`
  - `function isCalendarVisible(state: VisibilityState, cal: CalendarRow, viewerId: string): boolean`
  - `function groupOf(cal: Pick<CalendarRow, "ownerId">, viewerId: string): "ours" | "me" | "partner"`
  - `function useVisibility(userId: string)` — persisted to `localStorage` key `nailong.visibility.<userId>`
  - `useCalendars()` TanStack Query hook in `lib/query/calendars.ts`
  - `CalendarTree`, `CalendarRow`, `PersonPills`, `TopBar` components

- [ ] **Step 1: Write the failing visibility unit test**

```ts
it("requires both the group toggle and the calendar checkbox", () => {
  const state = { groups: { ours: true, me: true, partner: false }, calendars: { c1: true } };
  expect(isCalendarVisible(state, { id: "c1", ownerId: null } as CalendarRow, "u1")).toBe(true);
  expect(isCalendarVisible({ ...state, groups: { ...state.groups, ours: false } }, { id: "c1", ownerId: null } as CalendarRow, "u1")).toBe(false);
  expect(isCalendarVisible(state, { id: "c1", ownerId: "u2" } as CalendarRow, "u1")).toBe(false);
});
it("groups calendars by ours / mine / partner", () => {
  expect(groupOf({ ownerId: null } as CalendarRow, "u1")).toBe("ours");
  expect(groupOf({ ownerId: "u1" } as CalendarRow, "u1")).toBe("me");
  expect(groupOf({ ownerId: "u2" } as CalendarRow, "u1")).toBe("partner");
});
```

- [ ] **Step 2: Write the failing E2E test**

```ts
test("sidebar shows groups, shades, and toggles visibility", async ({ page }) => {
  await signIn(page, "andrew@example.test", "test-password-1234");
  await expect(page.getByText("OURS", { exact: false })).toBeVisible();
  await page.getByRole("checkbox", { name: /school/i }).click();
  await expect(page.getByRole("checkbox", { name: /school/i })).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /school/i })).not.toBeChecked();
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run tests/unit/visibility.test.ts; npx playwright test tests/e2e/sidebar.spec.ts`
Expected: FAIL — components/modules not found.

- [ ] **Step 4: Add tokens and primitives**

Add the spec's CSS custom properties to `app/globals.css` and map them into a Tailwind 4 `@theme` block. Add shadcn primitives (`npx shadcn@latest add button checkbox dialog dropdown-menu input label popover select sonner switch textarea`).

- [ ] **Step 5: Implement visibility state, query hooks, and components**

`lib/ui/visibility.ts` implements the predicate and a `useEffect`-backed localStorage hook. `lib/query/calendars.ts` wraps `fetch("/api/calendars")`. `CalendarTree` renders group headers `OURS`, `MINE · <me>`, `<partner>`; `CalendarRow` renders the checkbox, swatch, name, child indent, shade strip on roots, `view only` pill, and a dropdown menu (Add sub-calendar / Rename / Change color / Delete). `TopBar` renders brand, month label, Today/nav, view switcher, "+ Event", and `PersonPills`.

- [ ] **Step 6: Run both suites**

Run: `npm test; npm run test:e2e -- tests/e2e/sidebar.spec.ts`
Expected: green; visibility survives a reload.

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "feat: add cozy app shell and calendar tree sidebar"
```

---

### Task 10: FullCalendar grid and event flows

**Files:**
- Create: `components/calendar/CalendarView.tsx`, `components/calendar/Toolbar.tsx`, `components/calendar/EventDialog.tsx`, `components/calendar/EventPopover.tsx`, `components/calendar/toFcEvent.ts`, `lib/query/events.ts`, `tests/unit/toFcEvent.test.ts`, `tests/e2e/events.spec.ts`
- Modify: `app/(app)/page.tsx`, `app/globals.css` (FullCalendar overrides)
- Test: `tests/unit/toFcEvent.test.ts`, `tests/e2e/events.spec.ts`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/events`, `EventView`, palette, visibility state.
- Produces:
  - `function toFcEvent(e: EventView, timeZone: string): EventInput` — `allDay ? { start: startDate, end: addDays(endDate, 1) } : { start: ISO, end: ISO }`, `color: e.color.container`, `borderColor: e.color.main`, `textColor: e.color.onContainer`, passes `rrule` and `exdate`
  - `CalendarView` with `plugins` module-scope, `timeZone`, `headerToolbar: false`, `selectable`, `editable`, `eventResizableFromStart`, custom `eventContent`
  - `useEvents(range: { from: number; to: number })`, `useCreateEvent()`, `useUpdateEvent()`, `useDeleteEvent()`

- [ ] **Step 1: Write the failing mapping unit test**

```ts
it("maps a timed event to ISO start/end with resolved colors", () => {
  const fc = toFcEvent({ allDay: false, startAt: 1_700_000_000_000, endAt: 1_700_000_360_000, color: { main: "m", container: "#fff", onContainer: "#000" }, title: "Quiz" } as EventView, "Asia/Taipei");
  expect(fc.start).toBe("2023-11-14T22:13:20.000Z"); // exact, asserted once
  expect(fc.backgroundColor).toBe("#fff");
  expect(fc.borderColor).toBe("m");
});
it("converts inclusive all-day end to FullCalendar's exclusive end", () => {
  const fc = toFcEvent({ allDay: true, startDate: "2026-03-07", endDate: "2026-03-08" } as EventView, "Asia/Taipei");
  expect(fc.allDay).toBe(true);
  expect(fc.start).toBe("2026-03-07");
  expect(fc.end).toBe("2026-03-09");
});
it("passes rrule and exdate through untouched", () => { /* expect(fc.rrule).toBe("FREQ=WEEKLY;BYDAY=TU"); expect(fc.exdate).toEqual(["2026-10-20"]) */ });
```

- [ ] **Step 2: Write the failing E2E tests**

```ts
test("creates an event by clicking a day cell", async ({ page }) => { /* click day 20 -> dialog -> title "Dentist" -> save -> expect "Dentist" visible in month grid */ });
test("moves an event by dragging it to another day", async ({ page }) => { /* drag source day 20 to day 23 -> reload -> expect on 23 */ });
test("edits and deletes an event", async ({ page }) => { /* click event -> popover -> edit title -> save -> delete -> gone */ });
test("a weekly recurring event appears next month", async ({ page }) => { /* create FREQ=WEEKLY on the 20th, next month -> expect occurrence */ });
test("skipping one occurrence leaves the rest", async ({ page }) => { /* delete -> "This event" -> that date empty, next week present */ });
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run tests/unit/toFcEvent.test.ts; npx playwright test tests/e2e/events.spec.ts`
Expected: FAIL — modules missing / grid absent.

- [ ] **Step 4: Implement the mapping and the grid**

`toFcEvent` is the single boundary where inclusive all-day ends become Exclusive ends. `CalendarView` keeps `plugins`, `eventSources` and handlers module-scope or memoized (FullCalendar warns inline arrays change identity every render). `datesSet` updates the visible range and triggers `useEvents`. `select` opens `EventDialog` with the slot's start/end. `eventDrop`/`eventResize` call `useUpdateEvent` with optimistic cache update and rollback on error, surfacing a toast. `eventClick` opens `EventPopover`.

- [ ] **Step 5: Implement the dialog and popover**

`EventDialog` fields exactly as spec §6, including the recurring-edit notice. On success, invalidate `["events", range]` and `["calendars"]`. `EventPopover` shows title/time/calendar/description with Edit and Delete buttons; Delete on a recurring event opens the scope choice (**This event** / **All events**).

- [ ] **Step 6: Run both suites**

Run: `npm test; npm run test:e2e -- tests/e2e/events.spec.ts`
Expected: green.

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "feat: integrate FullCalendar grid with event create/edit/drag flows"
```

---

### Task 11: Cross-check toggles, view-only UX, mobile polish

**Files:**
- Create: `components/sidebar/PersonPills.tsx` (wire to real state), `components/calendar/ReadOnlyNotice.tsx`, `tests/e2e/viewonly.spec.ts`, `tests/e2e/mobile.spec.ts`
- Modify: `app/(app)/layout.tsx`, `components/sidebar/CalendarTree.tsx`, `app/globals.css`
- Test: `tests/e2e/viewonly.spec.ts`, `tests/e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: visibility state, session (members), event APIs.
- Produces: working person pills, responsive shell (sidebar → icon rail → bottom sheet), view-only affordance hiding and 403 surfacing.

- [ ] **Step 1: Write the failing E2E tests**

```ts
// viewonly.spec.ts
test("person pill hides all of the partner's calendars at once", async ({ page }) => { /* partner pill off -> partner events gone; on -> back */ });
test("a view-only calendar shows no edit affordances and blocks PATCH", async ({ page }) => {
  await page.evaluate(async () => {
    const res = await fetch("/api/events/<seededViewOnlyEventId>", { method: "PATCH", body: JSON.stringify({ title: "hack" }), headers: { "content-type": "application/json" } });
    return res.status;
  }).then(status => expect(status).toBe(403));
});
```
```ts
// mobile.spec.ts — Review Focus #5
test.use({ viewport: { width: 375, height: 812 } });
test("month grid does not overflow and the tree opens as a sheet", async ({ page }) => {
  await signIn(page, "andrew@example.test", "test-password-1234");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx playwright test tests/e2e/viewonly.spec.ts tests/e2e/mobile.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Wire pills and checkboxes to `useVisibility` (group toggles write all calendars in the group; indeterminate when mixed). Hide edit controls on view-only calendars, show `ReadOnlyNotice` in the popover/dialog, and map a `403` response to a toast plus cache rollback. Add the three responsive breakpoints from spec §6: sidebar fixed ≥1024 px, icon rail 768–1023 px, bottom sheet <768 px with list view as the default. Add the spec's states (empty/loading/error) and accessibility pass: labelled icon buttons, visible focus rings, `prefers-reduced-motion`, and dots never the sole carrier of information (day cell tooltip + agenda text).

- [ ] **Step 4: Run the full E2E suite**

Run: `npm run test:e2e`
Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: add cross-check toggles, view-only UX, and responsive layout"
```

---

### Task 12: Settings, two-factor enrolment, security headers

**Files:**
- Create: `app/(app)/settings/page.tsx`, `components/settings/ProfileForm.tsx`, `components/settings/SecurityPanel.tsx`, `components/settings/HouseholdForm.tsx`, `app/api/settings/household/route.ts`, `app/api/settings/profile/route.ts`, `tests/e2e/settings.spec.ts`, `tests/integration/settings-api.test.ts`
- Modify: `next.config.ts` (headers), `app/(app)/layout.tsx` (2FA banner)
- Test: `tests/integration/settings-api.test.ts`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `auth`, `routeHandler`, household service functions.
- Produces: `updateHousehold(ctx, { name?, timezone?, weekStartsOn? })` and `updateProfileName(ctx, name)` in `lib/services/household.ts`; `PATCH /api/settings/household` (name, timezone, weekStartsOn), `PATCH /api/settings/profile` (name), `/settings` page, security headers on every response.

- [ ] **Step 1: Write the failing tests**

```ts
// integration: updating household timezone persists and is validated (invalid IANA zone -> 400)
// integration: unauthenticated PATCH -> 401
// e2e: settings page saves household name; 2FA enrol panel shows a QR and 10 backup codes (mock the TOTP endpoint only if the plugin needs a live secret)
// e2e + fetch: response headers include x-frame-options DENY, referrer-policy, x-robots-tag noindex, strict-transport-security
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/integration/settings-api.test.ts; npx playwright test tests/e2e/settings.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Settings page with the three panels from spec §6. 2FA enrolment uses the Better Auth twoFactor plugin client (`/api/auth/two-factor/enable`) showing the QR SVG and the backup codes once. `next.config.ts` adds the header set from spec §9; CSP starts as `Content-Security-Policy-Report-Only`. Add a dismissible banner until both members have `twoFactorEnabled` on the user row.

- [ ] **Step 4: Run everything**

Run: `npm test; npm run test:e2e`
Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: add settings, two-factor enrolment, and security headers"
```

---

### Task 13: Docker image, Railway deployment, backups and restore

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `railway.json`, `docker-entrypoint.sh`, `scripts/migrate.mjs`, `scripts/backup.mjs`, `scripts/restore-check.mjs`, `docs/OPERATIONS.md`
- Test: container smoke + backup/restore verification (commands below)

**Interfaces:**
- Consumes: the built Next standalone app, `drizzle/` migrations, env contract.
- Produces: a runnable image, `docker-entrypoint.sh` (migrate then `node server.js`), nightly backup, documented restore.

- [ ] **Step 1: Write the Dockerfile**

Multi-stage (`deps` → `build` → `runner`) on `node:22-bookworm-slim`; `deps` installs `python3 make g++` before `npm ci` so better-sqlite3 can build if no prebuild exists; `runner` copies `.next/standalone`, `.next/static`, `public`, `drizzle`, `scripts`, `docker-entrypoint.sh`, creates a non-root user, creates `/data`, sets `NODE_ENV=production`, `PORT=3000`, and `CMD ["sh","./docker-entrypoint.sh"]`. `.dockerignore` excludes `node_modules`, `.next`, `.git`, `data`, `tests`, `.playwright`.

- [ ] **Step 2: Verify the image builds and boots**

```powershell
docker build -t nailong-planner:test .
docker run --rm -d --name np-test -p 3123:3000 -e DATABASE_URL=file:/data/planner.db -e BETTER_AUTH_SECRET=test-secret-0123456789abcdef -e BETTER_AUTH_URL=http://localhost:3123 -v npdata:/data nailong-planner:test
Start-Sleep -Seconds 8; (Invoke-WebRequest http://localhost:3123/api/health).StatusCode
docker stop np-test; docker volume rm npdata
```

Expected: `200`, and the container log shows migrations applied.

- [ ] **Step 3: Add backup and restore scripts**

`scripts/backup.mjs` uses better-sqlite3's `.backup()` to write `backups/planner-<ISO date>.db` and gzips it; prunes to the last 14 files. `docs/OPERATIONS.md` documents: env vars, deploy (`git push` / `railway up`), nightly backup wiring, restoring a backup into a scratch container, break-glass password reset, 2FA recovery, and the Vercel+Neon migration note.

- [ ] **Step 4: Verify backup and restore**

```powershell
node scripts/backup.mjs --db .dev/planner.db --out .dev/backups
node scripts/restore-check.mjs --backup .dev/backups/<newest>.db.gz
```

Expected: restore-check prints matching row counts for `household`, `calendar`, `event`, and exits 0. (Add `scripts/restore-check.mjs` in this task.)

- [ ] **Step 5: Add Railway config and document first deploy**

`railway.json` uses the Dockerfile builder, health check `/api/health`, `ON_FAILURE` restart. `docs/OPERATIONS.md` lists the exact first-deploy steps: create project, add volume mounted at `/data`, set env vars, set spend cap, run `railway run npm run provision`, then sign in.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: add Docker image, Railway config, backups, and operations doc"
```

---

### Task 14: Full E2E pass, CI, README, release tag

**Files:**
- Modify: `.github/workflows/ci.yml` (add build + Playwright job), `README.md` (create)
- Test: full local verification below

**Interfaces:**
- Consumes: everything.
- Produces: a green CI pipeline and a documented v0.1.0.

- [ ] **Step 1: Write the README**

Quickstart (install, `.env` from `.env.example`, `npm run db:migrate`, `npm run provision`, `npm run dev`), the 2-user model, the hierarchy/shade rules, how to add a second device, troubleshooting, and a link to `docs/OPERATIONS.md` and the spec.

- [ ] **Step 2: Extend CI**

Add jobs: `test` (lint, typecheck, unit, integration), `build` (`npm run build`), `e2e` (install chromium, seed, run Playwright, upload trace on failure). Cache `~/.npm` and Playwright browsers.

- [ ] **Step 3: Run the full verification locally**

```powershell
npm run lint; npm run typecheck; npm test; npm run build; npm run test:e2e
```

Expected: every command exits 0.

- [ ] **Step 4: Verify against the spec's acceptance list**

Manually walk: create root + 7 sub-calendars (8th blocked), verify shades differ and re-shade on recolour, create timed/all-day/recurring events, drag across days, delete one occurrence, toggle partner pill, confirm view-only 403 via devtools, sign in on a phone-sized window, check `/settings` 2FA panel.

- [ ] **Step 5: Commit and tag**

```powershell
git add -A; git commit -m "docs: add README and CI; release v0.1.0"
git tag -a v0.1.0 -m "Nailong Planner v0.1.0"
```

---

## Self-review notes (for the executor)

- Spec §4 schema fields, defaults and indexes are implemented in Task 2; §5 rules in Tasks 1 and 3; §6 UI in Tasks 9–12; §7 endpoints in Tasks 7–8; §9 security in Tasks 5, 6, 12; §10 deployment in Task 13; §11 tests are distributed across each task; §12 milestones map M0→T1, M1→T2, M2→T5/T6, M3→T3/T7, M4→T4/T8, M5→T9, M6→T10, M7→T11, M8→T12, M9→T13, M10→T14.
- Known implementation deviation from the spec's wording: route protection is enforced in `app/(app)/layout.tsx` plus every route handler rather than edge middleware (the SQLite adapter cannot run at the edge). Behaviour is identical; the login redirect test in Task 6 pins it.
- Known simplification: the spec's "independent brute-force counter" is implemented as Better Auth `rateLimit.customRules` on `/sign-in/email` (5 attempts/60 s, DB-backed) rather than a second counter subsystem.
