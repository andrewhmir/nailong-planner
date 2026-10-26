# App routes and HTTP API

Everything the Next.js App Router exposes: the root layout and the global stylesheet it imports, the authenticated shell layout, the signed-in pages, the login page with its client form, and every `/api/*` handler. Read this when a request returns an unexpected status, a page redirects when it should not, the viewport scrolls the document instead of a panel, or a design token is missing. Pipeline internals live in `api-layer.md`; the SQL and business rules behind each handler live in `lib-services.md`.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a route or page, update its section and run `npm run docs:check`.

| Route / file | Purpose |
|---|---|
| `app/globals.css` | Tailwind 4 entry, `@theme` design tokens, base layer, motion and coarse-pointer rules |
| `app/layout.tsx` | Root layout: Lato via `next/font/local`, metadata, app icon files, `<html>`/`<body>` |
| `app/providers.tsx` | Client boundary mounting TanStack Query and the sonner `Toaster` |
| `app/(app)/layout.tsx` | Auth guard + `AppShell` for every signed-in page; owns the viewport contract |
| `app/(app)/page.tsx` | `/` — the calendar page, renders `CalendarShell` |
| `app/(app)/tasks/page.tsx` | `/tasks` — the task workspace, renders `TasksShell` |
| `app/(app)/settings/page.tsx` | `/settings` — household, profile, preferences and security form |
| `app/api/auth/[...all]/route.ts` | Better Auth catch-all (sign-in, sign-out, two-factor, password, session) |
| `app/api/collections/route.ts` | `GET` visible collection tree (lazily creates the caller's Inbox), `POST` calendar or list (top-level or sub-collection) |
| `app/api/collections/[id]/route.ts` | `PATCH` and `DELETE` one calendar |
| `app/api/events/route.ts` | `GET` events in a range, `POST` event |
| `app/api/events/search/route.ts` | `GET` household-wide event search |
| `app/api/events/[id]/route.ts` | `PATCH` one event, `DELETE` the series or one occurrence |
| `app/api/health/route.ts` | Unauthenticated liveness probe with a `SELECT 1` |
| `app/api/session/route.ts` | `GET` current user, household and members |
| `app/api/settings/household/route.ts` | `PATCH` household name, timezone, week start |
| `app/api/settings/preferences/route.ts` | `GET` and `PATCH` per-user calendar preferences |
| `app/api/settings/profile/route.ts` | `PATCH` the signed-in user's display name |
| `app/login/LoginForm.tsx` | Client sign-in form: credentials, then TOTP or backup code |
| `app/login/page.tsx` | `/login` — public page that redirects a signed-in visitor to `/` |

## App shell, providers and styling

### app/globals.css

**Purpose** — The styling source of truth. `@import "tailwindcss"` plus one `@theme` block; each custom property becomes a Tailwind utility (`bg-surface`, `text-ink`, `border-field`, `rounded-card`, `shadow-dialog`), so changing a token here changes every screen.

**Tokens** — Surfaces: `--color-paper`/`--color-surface`/`--color-card` `#ffffff`, `--color-well` `#f2f4f4`, `--color-line` `#e8eaec`, `--color-line-strong` `#d7dade`, `--color-field` `#8d959f`, `--color-ink` `#273540`, `--color-ink-soft` `#586874`, `--color-ink-mute` `#6a7883`, `--color-placeholder` `#9ea6ad`.
Brand ("two blues, never one"): `--color-accent` `#2b7abc`, `--color-accent-hover` `#0e68b3`, `--color-accent-press` `#0a5a9e`, `--color-link` `#0e68b3`. Callouts: `--color-info-soft` `#e0ebf5`, `--color-info-ink` `#334451`. Chrome: `--color-rail` `#334451`, `--color-rail-hover` `#273540`, `--color-rail-active-bg` `#ffffff`, `--color-scrim` `#334451bf`. Status triples: success `#03893d`/`#027634`/`#dceee4`, warning `#cf4a00`/`#b34000`/`#fce5d9`, danger `#e62429`/`#c71f23`/`#fce4e5`. Task workspace (v0.2.1, consumed only by `components/tasks/*`): violet selection `--color-violet` `#7b68ee`, `--color-violet-soft` `#efedfd`, `--color-violet-press` `#6a55e8`; status dots `--color-status-todo` `#87909e` with `--color-status-todo-soft` `#eceef0`, and `--color-status-progress` `#4a90e2` with `--color-status-progress-soft` `#e8f1fc`.
Type: `--font-sans` is `var(--font-lato)` (the variable `app/layout.tsx` sets) then Helvetica/Arial fallbacks; `--font-mono` is Menlo/Consolas/Monaco/Andale Mono. Heading sizes `--text-h1` and `--text-h2` are both `1.8rem`, `--text-h3` `1.5rem`, `--text-h4` `1.125rem`, all with line-height `1.5`.
Radii ("Canvas is nearly square"): `--radius-sm` 3px, `--radius-md` 4px, `--radius-lg` 6px, `--radius-card` 4px, `--radius-pill` 9999px. Elevation: `--shadow-menu`, `--shadow-dialog`, `--shadow-flash` only — borders do the work. Spacing is deliberately **not** redefined: components use Tailwind's default 4px scale (`p-3`, `gap-2`, `h-14`).

**State & side effects** — Base layer sets `html`/`body` to `height: 100%`, `body` to `overscroll-behavior-y: none`, paper background, `--font-sans`, line-height 1.5; `h1`-`h4` are weight 400; `a` uses `--color-link`; `*:focus-visible` gets a 2px link-colored outline at 2px offset. Two global keyframes drive picker motion: `popover-in` animates opacity 0 + `translateY(-4px) scale(0.98)` to opacity 1 at `translateY(0) scale(1)`, and `field-ack` pulses a `box-shadow` from `0 0 0 0 rgb(43 122 188 / 0.45)` to `0 0 0 6px rgb(43 122 188 / 0)`. Pickers opt in with `data-[state=open]:animate-[popover-in_…]` and a committed field with `data-[flash=true]:animate-[field-ack_460ms_ease-out]`. `prefers-reduced-motion` collapses animation and transition durations to `0.001ms`, which neutralises both. Under `(pointer: coarse)` the "Cross-check calendars" group and the Previous/Next/"Keyboard shortcuts" buttons grow to at least 44px hit targets while keeping their visible box.

**FullCalendar** — Overrides are **not** imported here. `components/calendar/CalendarView.tsx` imports `@fullcalendar/react/skeleton.css`, `@fullcalendar/react/themes/classic/theme.css`, `@fullcalendar/react/themes/classic/palette.css`, then `./fullcalendar-overrides.css`; that last file restyles the grid using the tokens above and wins on specificity rather than import order.

**Depends on / Used by** — Imported only by `app/layout.tsx`. There is no `tailwind.config.*`; Tailwind 4 reads `@theme` from this file.

**Debugging** — A utility such as `bg-surface` is undefined -> the token is missing or misspelled in `@theme` -> add `--color-surface` (not `--surface`). FullCalendar renders stock-blue and square-cornered -> the override sheet is not loaded or lost specificity -> check the four imports at the top of `components/calendar/CalendarView.tsx`. The whole document rubber-bands on iOS -> `overscroll-behavior-y: none` is being overridden by a wrapper -> check `app/(app)/layout.tsx` and the page wrapper.

**Tests** — `tests/e2e/design-tokens.spec.ts`, `tests/e2e/calendar-style.spec.ts`, `tests/e2e/primitives.spec.ts`.

### app/layout.tsx

**Purpose** — The single root layout: loads Lato, imports `globals.css`, declares metadata, renders `<html lang="en">` with the font variable class and a bare `<body>`. The sibling metadata images `app/icon.png` (256 px), `app/apple-icon.png` (180 px) and `app/favicon.ico` (16/32/48 px) are the Nailong logo cropped to its head with the dark backdrop keyed out (transparent alpha); they are the browser-tab and home-screen icons, and Next emits their `<link>` tags from the file convention, so no `metadata.icons` entry is needed.

**Public API** — Default export `RootLayout({ children })`; `export const metadata: Metadata` with `title: "Nailong Planner"` and `description: "A private planner for two."`; `localFont` registers `./fonts/lato-400.woff2` and `./fonts/lato-700.woff2` as `--font-lato` with `display: "swap"`.

**State & side effects** — None at request time: no session read, no database, no providers. The font CSS is emitted by `next/font/local` at build time.

**Depends on / Used by** — `./globals.css`, `./fonts/lato-*.woff2`, `next/font/local`. Renders every route, including `/login`; `--font-sans` in `globals.css` resolves through the `--font-lato` variable set here.

**Debugging** — Text renders in Helvetica -> the `className={lato.variable}` on `<html>` was dropped or the font files are missing -> check `localFont` and the class. A second `<html>`/`<body>` appears in the DOM -> a nested layout added one -> only this file may render them. Toasts or TanStack Query are missing on `/login` -> expected, `Providers` is mounted in `app/(app)/layout.tsx`, not here. The browser tab still shows a blank/Next icon -> the metadata images were deleted or the server predates them -> restart `npm run dev` (rebuild for `next start`) and confirm the `<link rel="icon">` and `<link rel="apple-touch-icon">` tags in the page head.

**Tests** — `tests/e2e/design-tokens.spec.ts` (asserts Lato is self-hosted and applied).

### app/providers.tsx

**Purpose** — The client boundary for the signed-in app: one `QueryClient` and the global sonner `Toaster`.

**Public API** — `Providers({ children })`. The client is created once through a `useState` initializer, so a re-render never discards the cache.

**State & side effects** — Query defaults: `staleTime: 10_000`, `refetchOnWindowFocus: false`, `retry: 1`. Renders `<Toaster {...TOASTER_PROPS} />` after `children`, so any toast raised by a descendant mounts here.

**Depends on / Used by** — `@tanstack/react-query`, `sonner`, `TOASTER_PROPS` from `components/ui/toast`. Used only by `app/(app)/layout.tsx`; every hook in `lib/query/*` depends on this provider being above it.

**Debugging** — "No QueryClient set, use QueryClientProvider" -> a component using `lib/query/*` was rendered outside `(app)` (for example on `/login`) -> move it under the shell. Data refetches on every tab focus -> someone changed `refetchOnWindowFocus` here or set `staleTime: 0` on a query. A `toast.success` call is silent -> the component is outside the shell, so no `Toaster` is mounted.

**Tests** — No direct test coverage; the toaster is exercised indirectly by `tests/e2e/undo.spec.ts`.

### app/(app)/layout.tsx

**Purpose** — The authenticated shell. Resolves the session, the membership row, the household and the member list, then renders `AppShell` inside `Providers`; anything unresolved redirects to `/login`.

**Public API** — Default export `AppLayout({ children })`, a server component. `export const dynamic = "force-dynamic"` is required because every request reads the session cookie.

**State & side effects** — `getAuth().api.getSession({ headers })` -> `redirect("/login")` when null. A `member` row is looked up by `member.userId`; **a signed-in user with no membership row is also redirected to `/login`**, not shown an error. Then the `household` row is read, `listMembers(db, householdId)` is mapped to `MemberSummary[]` (name from the `user` row, `"Member"` fallback, `isSelf` from the session), and one `getPreferences(db, session.user.id)` snapshot is read. Passed to `AppShell`: `currentUser`, `members`, `householdName` (fallback `"Our Nest"`), `timezone` (fallback `"Asia/Taipei"`), `preferences` (the whole `UserPreferences` snapshot, which supplies the header's `timeFormat` and seeds `GlobalCapture`). No cache, revalidation or cookie writes.

**Viewport / layout contract** — `AppShell`'s outermost element is `flex h-dvh flex-col overflow-hidden`; the document itself can never scroll. The only scroller is `<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain bg-surface p-3 sm:p-6">`. Consequences a page must honour: do not add `h-screen`, `min-h-screen` or another `overflow-hidden` wrapper — content then clips instead of scrolling; `min-h-0` on flex ancestors already exists, so a long page scrolls inside `main` (both `tests/e2e/viewport-fit.spec.ts` cases assert this). The shell also renders a visually hidden `<h1 class="sr-only">Nailong Planner</h1>`, so a page with its own `h1` (settings) has two by design. Breadcrumb text is route-derived from `ROUTE_CRUMBS` in `components/shell/AppShell.tsx` — a new `(app)` route needs an entry there or it falls back to `"Calendar"`.

**Depends on / Used by** — `@/lib/auth/server`, `@/lib/db`, `@/lib/db/schema`, `@/lib/services/household` (`listMembers`), `@/lib/services/preferences` (`getPreferences`), `@/app/providers`, `@/components/shell/AppShell`. Wraps `app/(app)/page.tsx`, `app/(app)/tasks/page.tsx` and `app/(app)/settings/page.tsx`. The mounted `GlobalCapture` makes `Shift+K` available on every one of those routes.

**Debugging** — A signed-in user bounces back to `/login` -> no `member` row for that user id -> check the `member` table, `scripts/provision`. A page is cut off with no scrollbar -> the page added a fixed-height or `overflow-hidden` wrapper -> remove it and let `main` scroll. Wrong breadcrumb on a new route -> `ROUTE_CRUMBS` was not extended. Prerender/build error about `headers()` -> `force-dynamic` was removed.

**Tests** — `tests/e2e/shell.spec.ts`, `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/mobile.spec.ts`.

## Pages

### app/(app)/page.tsx

**Purpose** — The `/` calendar page: resolves the household and the viewer's preferences, then renders `CalendarShell`.

**Public API** — Default export `CalendarPage()`, a server component with no segment config of its own (it inherits `force-dynamic` from `app/(app)/layout.tsx`).

**State & side effects** — Re-resolves the session (`redirect("/login")` when null) and the membership row (again `redirect("/login")`), reads the household row, and calls `getPreferences(db, session.user.id)`. Renders `<CalendarShell timezone={household?.timezone ?? "Asia/Taipei"} currentUserId={session.user.id} weekStartsOn={household?.weekStartsOn ?? 0} preferences={...} />`. The session and membership queries repeat the layout's work on every request; that is cost, not a correctness issue, because the layout has already proven the membership exists. No writes, no revalidation.

**Depends on / Used by** — `@/components/calendar/CalendarShell`, `@/lib/services/preferences`, `@/lib/auth/server`, `@/lib/db`, `@/lib/db/schema`.

**Debugging** — The grid shows the wrong week start -> `household.weekStartsOn` is 0/1 and falls back to `0` (Sunday) when the row is missing -> check the household row and that `SettingsForm.saveHousehold` still calls `router.refresh()`. Grid times are shifted -> `timezone` came from the household, not the browser -> check `household.timezone`. A preferences change does not reach the grid until reload -> `getPreferences` is read server-side per request -> check `router.refresh()` in the settings form.

**Tests** — `tests/e2e/events.spec.ts`, `tests/e2e/view-preference.spec.ts`, `tests/e2e/mobile.spec.ts`.

### app/(app)/tasks/page.tsx

**Purpose** — The `/tasks` page: resolves the household and the viewer's preferences, then renders the task workspace.

**Public API** — Default export `TasksPage()`, a server component with `export const dynamic = "force-dynamic"` (the signed-in layout also sets it; this page repeats it because every request reads the session cookie).

**State & side effects** — Re-resolves the session (`redirect("/login")` when null) and the membership row (again `redirect("/login")`), reads the household row, and calls `getPreferences(db, session.user.id)`. Renders an `h1` "Tasks" and `<TasksShell timezone={household?.timezone ?? "Asia/Taipei"} weekStartsOn={household?.weekStartsOn === 1 ? 1 : 0} shortcutsEnabled={preferences.shortcutsEnabled} currentUserId={session.user.id} />`. The `weekStartsOn` normalisation turns the plain integer column into the shell's `0 | 1` contract. No writes, no revalidation.

**Depends on / Used by** — `@/components/tasks/TasksShell`, `@/lib/services/preferences` (`getPreferences`), `@/lib/auth/server`, `@/lib/db`, `@/lib/db/schema`. Reached by URL (`/tasks`) and, since v0.2.0, from the rail and phone drawer; `ROUTE_CRUMBS` (built from `LIVE_ENTRIES`) labels the breadcrumb "Tasks".

**Debugging** — A signed-in user bounces to `/login` -> no `member` row -> check the `member` table. The breadcrumb says "Calendar" -> the route has no `status: "live"` roadmap entry: `ROUTE_CRUMBS` is built from `LIVE_ENTRIES` -> `lib/roadmap.ts` plus `components/shell/AppShell.tsx`. Tasks bucket against the wrong "today" -> `household.timezone`/`weekStartsOn` are read here, not from the browser -> check the household row. A preference change does not reach the workspace -> `getPreferences` is read per request -> check `router.refresh()` in the settings form.

**Tests** — `tests/e2e/tasks.spec.ts`; the components it renders are documented in `docs/COMPONENTS/components-tasks.md`.

### app/(app)/settings/page.tsx

**Purpose** — The `/settings` page: reads the household and preferences, then hands them to `SettingsForm` as initial values.

**Public API** — Default export `SettingsPage()`, a server component. Renders a `max-w-5xl` column, a phone-only back link, an `h1` "Settings", then `SettingsForm`.

**State & side effects** — Session read (`redirect("/login")` when null), membership read (`redirect("/login")` when absent), household read, `getPreferences` read. Props passed down: `initialName` (session user name), `currentUserEmail` (session user email, for the Password form's hidden username input), `initialHousehold` (`name` fallback `"Our Nest"`, `timezone` fallback `"Asia/Taipei"`, `weekStartsOn` fallback `0`), `initialPreferences`, `currentUserId`. All writes happen in `SettingsForm`, not here.

**Depends on / Used by** — `@/components/settings/SettingsForm`, `ChevronLeftIcon` from `@/components/ui/icons`, `@/lib/services/preferences`, `@/lib/auth/server`, `@/lib/db`, `@/lib/db/schema`.

**Debugging** — On a phone there is no way back to the calendar -> the `md:hidden` "Back to calendar" link was removed; below `md` the rail is a top bar with no home link. The page does not scroll on a phone -> a wrapper replaced `main`'s scrolling (see the layout contract). A saved household name is not visible on reload -> the page reads the row server-side -> check `router.refresh()` in `SettingsForm.saveHousehold`.

**Tests** — `tests/e2e/settings.spec.ts`, `tests/e2e/preferences.spec.ts`.

### app/(app)/settings/import/page.tsx

**Purpose** — The `/settings/import` page: the Google Calendar import wizard and the import history.

**Public API** — Default export `ImportPage()`, a server component. Renders a `max-w-3xl` column, a "Back to settings" link, an `h1` "Import from Google Calendar", then `ImportWizard` with `currentUserId`.

**State & side effects** — Session read (`redirect("/login")` when null) and membership read (`redirect("/login")` when absent); no other reads. Every write happens through the wizard's API calls.

**Depends on / Used by** — `@/components/import/ImportWizard`, `ChevronLeftIcon`, `@/lib/auth/server`, `@/lib/db`, `@/lib/db/schema`. Linked from the "Google Calendar import" card in `components/settings/SettingsForm.tsx`.

**Debugging** — A signed-in user is bounced to `/login` -> no `member` row -> run provisioning. The wizard shows "No imports yet." after a commit -> the `["import-batches"]` query was not invalidated -> check `ImportWizard.commit`. The page overflows on a phone -> the wizard's tables scroll horizontally by design; the page itself must not (viewport contract).

**Tests** — `tests/e2e/import.spec.ts`.

### app/login/page.tsx

**Purpose** — The only public page. Sends an already-signed-in visitor to `/`, otherwise renders the brand tile and `LoginForm` on a full-height rail-colored background.

**Public API** — Default export `LoginPage()`, a server component with `export const dynamic = "force-dynamic"`.

**State & side effects** — One session read; `if (session) redirect("/")`. No household or membership lookup, so a signed-in user without a membership row passes this guard and is then bounced back to `/login` by `app/(app)/layout.tsx` — a redirect loop between the two guards is possible in that state. No providers are mounted here (no QueryClient, no toaster).

**Depends on / Used by** — `@/components/shell/Brand`, `./LoginForm`, `@/lib/auth/server`.

**Debugging** — The browser loops between `/login` and `/` -> the user has a session but no `member` row -> check the `member` table. The page loses its dark rail background -> the `bg-rail` utility no longer resolves -> check the `@theme` tokens in `app/globals.css`. An authenticated visit still shows the form -> the `redirect("/")` guard was removed or the session cookie is not being read (`force-dynamic` missing).

**Tests** — `tests/e2e/auth.spec.ts`.

### app/login/LoginForm.tsx

**Purpose** — The client sign-in form, in three states: email and password, then either the authenticator code or a backup code when two-factor is enabled.

**Public API** — `LoginForm()`; local `type Step = "credentials" | "totp" | "backup"`. Two module-level class constants, `FIELD` (38px tall, 1px `border-field`, 4px radius, 16px text, flat 2px accent outline on focus) and `LABEL`.

**State & side effects** — Local `step`, `email`, `password`, `code`, `error`, `pending` only; nothing is cached. Credentials step: `POST /api/auth/sign-in/email` with `{ email, password }`. `429` shows "Too many attempts. Wait a minute, then try again."; any other non-`ok` shows "Incorrect email or password."; a body with `twoFactorRedirect: true` moves to `step: "totp"` (no session cookie exists yet at that point); otherwise `router.replace("/")` then `router.refresh()`. Code step: `POST /api/auth/two-factor/verify-totp` or `/api/auth/two-factor/verify-backup-code` with `{ code }`; non-`ok` shows a per-step message; success runs the same `finish()`. A thrown `fetch` shows "Could not reach the planner. Try again.".

**Depends on / Used by** — `@/components/ui/button` (`Button`), `next/navigation` router. Rendered by `app/login/page.tsx`. The endpoints are served by `app/api/auth/[...all]/route.ts`.

**Debugging** — Correct password still shows "Incorrect email or password." -> the response was not `ok` for another reason (rate limit is handled separately, so check the network tab for a 403 or 5xx) -> inspect `POST /api/auth/sign-in/email`. A valid TOTP loops back to the code step -> the verify response was not `ok`, often because the code was already used -> check `/api/auth/two-factor/verify-totp`. Sign-in succeeds but the page does not move -> `finish()` runs `replace` then `refresh`; check for a thrown error before it and that `/` does not redirect back to `/login`.

**Tests** — `tests/e2e/auth.spec.ts` (wrong password, correct password, session survives reload).

## Auth and session routes

Two exceptions to the shared pipeline: the Better Auth catch-all speaks its own protocol, and `/api/session` is the only route that reads the session without touching `lib/api/handlers`.

### app/api/auth/[...all]/route.ts

**Purpose** — Forwards every `/api/auth/*` request to the Better Auth handler built by `createAuth` in `lib/auth/server.ts`.

**API** — `GET` and `POST` both call `getAuth().handler(request)` and return its `Response`; `export const dynamic = "force-dynamic"`. No auth requirement of its own — this is the authentication surface. Endpoints used by this app: `sign-in/email`, `sign-up/email`, `sign-out`, `change-password`, `session`, `two-factor/enable`, `two-factor/verify-totp`, `two-factor/verify-backup-code`. Request and response bodies are Better Auth's shapes, not the `{ error: { code, ... } }` envelope: a rejection is Better Auth's own JSON with its own status.

**State & side effects** — Writes sessions, accounts and two-factor secrets through the Drizzle adapter; sets and clears the session cookie (`httpOnly`, `sameSite: "lax"`, `secure` only when `BETTER_AUTH_URL` starts with `https://`). Configuration that changes behaviour: sign-up is disabled in the running app (`disableSignUp` unless `allowSignUp`), the user hook rejects a third account with Better Auth `FORBIDDEN` ("This planner is limited to two accounts."), in-memory rate limiting is 100 requests per 60s with a `/sign-in/email` rule of 5 per 60s (`AUTH_RATE_LIMIT=off` disables it), sessions last 7 days and refresh after 1 day, `trustedOrigins` is exactly `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET` is mandatory outside `NODE_ENV=test`.

**Depends on / Used by** — `getAuth` from `@/lib/auth/server` (which reads `lib/env`). Called by `app/login/LoginForm.tsx`, `components/settings/SettingsForm.tsx` (change password, two-factor enable/verify) and `components/shell/GlobalNavRail.tsx` (sign-out).

**Debugging** — `403` "This planner is limited to two accounts." -> `MAX_USERS` reached in the `user` hook -> count rows in `user`. `429` on the first sign-in attempt of the minute -> another client shares the limiter window -> confirm `AUTH_RATE_LIMIT` and retry after 60s. The cookie is set but the next request is unauthenticated -> `BETTER_AUTH_URL`/`trustedOrigins` mismatch, or `secure` cookies over plain HTTP -> check `lib/env` and the browser's cookie list. The first auth request throws "BETTER_AUTH_SECRET is required" -> `resolveSecret` found no secret and `NODE_ENV` is not `test` -> set a 32+ character secret in `.env.local`.

**Tests** — `tests/integration/auth.test.ts` (drives `createAuth(...).handler` directly with rate limiting off), `tests/e2e/auth.spec.ts`.

### app/api/session/route.ts

**Purpose** — Returns the signed-in viewer, the household and the member list in one call.

**API** — `GET`, authenticated through `withViewer` (401 `UNAUTHENTICATED` when there is no session, 403 `FORBIDDEN` when the account has no household row); no request body or query. Success is `200` with `{ user: { id }, household: { id, name, timezone, weekStartsOn } | null, members: [{ id, name, role, isSelf }] }`. The user object exposes the id only — no name or email. `household` is `null` rather than a 404 when the row is missing, because the route selects the household directly instead of calling `getHousehold` (which throws `NOT_FOUND`).

**State & side effects** — Read-only: one `household` select, `listMembers`, and one `user` select per member for the display name (`"Member"` fallback). No cache, no cookie.

**Depends on / Used by** — `withViewer` from `@/lib/api/route`, `listMembers` from `@/lib/services/household`, `household`/`user` from `@/lib/db/schema`. No client caller was found in `lib/query/*` or `components/` — the shell resolves the same data server-side in `app/(app)/layout.tsx`.

**Debugging** — `403` while signed in -> missing `member` row -> check the `member` table. `household: null` -> the singleton household row was deleted -> `ensureHousehold` recreates it the next time `scripts/provision.mts` runs. Member names all read "Member" -> the `user` rows are missing for those ids.

**Tests** — No direct test coverage.

## Collection routes

Both routes are thin `withViewer` re-exports over `lib/api/handlers/collections.ts`; every rule (nesting limit, shade assignment, effective visibility, the private read filter, Inbox creation) lives in `lib/services/collections.ts`.

### app/api/collections/route.ts

**Purpose** — Lists the household's collection tree and creates a top-level collection or a sub-collection.

**API** — `GET` → `listCollections`, `200` `{ collections: CollectionNode[] }` where `CollectionNode` is a `CollectionRow` plus `children: CollectionRow[]` (roots first, ordered by `sortOrder` then `createdAt`; children ordered by `shadeIndex`). The tree is built from `resolveVisibleCollections`, so a private collection the caller does not own is absent (and a private root takes its subtree). `POST` → `createCollectionHandler`, body `createCollectionSchema` (`name` required, trimmed, 1-60 chars; optional `parentId`, `kind`, `hueFamily`, `ownerId`, `visibility`) → `201 { collection }`. Errors: 401 unauthenticated, 403 when the account has no household, 403 `FORBIDDEN` when `ownerId` is the partner's id ("You can only create calendars for yourself or shared ones."), 409 `CONFLICT` at the `MAX_CHILDREN` limit, and 400 `VALIDATION` with a `fields` map for: a missing `hueFamily` on a top-level collection ("Top-level calendars need a color family."), a non-shared `visibility` without an owner, a `private` visibility without an owner ("A private collection needs an owner.", `fields.ownerId`), a child whose `kind` disagrees with its parent, a parent that is itself a sub-collection (nesting stops at two levels), or an empty/over-long name.

**State & side effects** — `GET` calls `ensureInbox` first, so it may insert one root `kind="list"`, `visibility="private"` Inbox row owned by the caller (idempotent: a later request returns the same row); it then reads every `collection` row the resolver keeps for `ctx.householdId`. `POST` writes one row with a generated UUID, `sortOrder = max + 1` among its siblings, and either `PARENT_SHADE_INDEX` (top-level, needs `hueFamily`) or the first free `CHILD_SHADE_ORDER` index (sub-collection). A sub-collection inherits `ownerId` and `kind` from its parent and is always created with `visibility: "shared"`; `hueFamily` and `visibility` sent for a sub-collection are silently ignored, while a mismatched `kind` is a 400. No revalidation.

**Depends on / Used by** — `withViewer`; `ensureInbox`, `listCollectionTree`, `createCollection`; `createCollectionSchema`. Clients: `useCollections` and `useCreateCollection` in `lib/query/collections.ts` (query key `["collections"]`, invalidated on success), consumed by `components/sidebar/CollectionTree.tsx`, `components/sidebar/SidebarMiniMonth.tsx`, `components/calendar/CalendarShell.tsx`, `components/calendar/SearchResultsOverlay.tsx` and `components/settings/CalendarPreferencesCard.tsx`.

**Debugging** — `400` "Top-level calendars need a color family." -> the picker sent no `parentId` and no `hueFamily` -> check the caller's payload. A new sub-calendar does not appear -> the `["collections"]` invalidation was removed -> `useCreateCollection`. `409` on a parent that looks empty -> orphaned children still reference it -> count `collection` rows by `parent_id`. Two roots share a colour -> expected: every top-level calendar uses the parent shade index of its own family.

**Tests** — `tests/integration/collections-api.test.ts`, `tests/e2e/sidebar.spec.ts`.

### app/api/collections/[id]/route.ts

**Purpose** — Updates or deletes a single collection; the dynamic route unwraps `params` itself because Next 16 hands it a `Promise`.

**API** — `PATCH` body `updateCollectionSchema` (`name`, `hueFamily`, `ownerId` nullable, `visibility`, `sortOrder`; all optional) → `200 { collection }`. `DELETE` takes no body → `204` with an empty body. Errors: 401/403 from `withViewer`, 404 `NOT_FOUND` ("Calendar not found.") for an id outside the household **or a private collection the caller does not own** (existence hidden), 403 `FORBIDDEN` "This collection is view-only." when the effective permissions deny the write, 403 for changing the owner of a collection owned by someone else, 403 for assigning ownership to the partner or changing `visibility` when the viewer is not the owner, 400 `VALIDATION` when `hueFamily`, `visibility` or `ownerId` is sent for a sub-collection (all three are inherited from the root) or when `visibility: "private"` would leave the owner `null` ("A private collection needs an owner.", `fields.ownerId`).

**State & side effects** — `PATCH` builds a patch from the defined fields only; an empty patch returns the existing row unchanged without bumping `updatedAt`. Clearing `ownerId` to `null` also resets `visibility` to `shared`, and a root's owner change is copied to its sub-collections in one transaction. `DELETE` removes the row; the schema's foreign keys are `onDelete: "cascade"` and `lib/db/client.ts` sets `PRAGMA foreign_keys = ON`, so deleting a root also deletes its sub-collections and every event in them. No revalidation.

**Depends on / Used by** — `withViewer<{ id: string }>`; `updateCollectionHandler`, `deleteCollectionHandler`; `updateCollectionSchema`. Clients: `useUpdateCollection` and `useDeleteCollection` in `lib/query/collections.ts`; delete also invalidates `["events"]` because cascade removed events.

**Debugging** — `403` "This collection is view-only." while the patch only renames it -> the parent root is non-shared and the visibility is inherited -> inspect `getCollectionAccess`/`effective`. `404` for a collection that exists -> it is private and owned by the partner; that is the hidden-existence rule, not a routing bug -> `assertWritable`/`getCollectionAccess`. `400` on `hueFamily` -> the request targeted a sub-calendar -> change the root instead. A rename appears to do nothing -> the body was empty or every value was already stored -> the handler returns the unchanged row with `200`.

**Tests** — `tests/integration/collections-api.test.ts`, `tests/integration/regressions.test.ts`, `tests/e2e/viewonly.spec.ts`.

## Event routes

Handlers in `lib/api/handlers/events.ts`; range parsing, search clamping and the delete body live there, while shape, RRULE and permission rules live in `lib/services/events.ts` and `lib/validation/events.ts`.

### app/api/events/route.ts

**Purpose** — Lists events for a time range and creates an event.

**API** — `GET` query `from` and `to` as epoch milliseconds → `200 { events: EventView[] }` (`EventView` is the row plus resolved `color` shade tokens). Send both bounds or neither: neither means "the household's current month", computed in the household timezone as `[first of this month, first of next month)`; one missing, a non-finite number, or `from >= to` is `400 VALIDATION` with a `fields.from` message. `POST` body `createEventSchema` (`collectionId`, `title` 1-200, `allDay` defaulting to `false`, plus `description`, `location`, `startAt`/`endAt` for timed, `startDate`/`endDate` as `YYYY-MM-DD` for all-day, `rrule`, `exdates`) → `201 { event }`. Errors: 401/403 from `withViewer`, 404 when the calendar is not in the household, 403 when the target calendar is view-only for this viewer, 400 for a Zod failure, an all-day/timed shape violation ("All-day events need a start and end date.", "Timed events need a start and end time.", an end not after the start, a date that does not exist) or an RRULE without `FREQ=` / unparseable by `RRule.fromString`.

**State & side effects** — `GET` reads every recurring row in the household **regardless of the requested range** plus the non-recurring rows that intersect it, then sorts them (all-day rows by `startDate`, timed rows by zero-padded `startAt`) — recurring series are expanded on the client so they are never truncated at the range edge. `POST` inserts one row with a generated UUID, `householdId` from the context, `createdBy` from the session, and `exdates` stored as JSON. No revalidation.

**Depends on / Used by** — `withViewer`; `listEventsHandler`, `createEventHandler`; `listEvents`, `createEvent`, `EventRange`; `createEventSchema`; `getHousehold`, `localWallTimeToUtc`, `utcToLocalDate`. Clients: `useEvents` (query key `["events", from, to]`) and `useCreateEvent` (optimistic `temp-` row, replaced by the server row, then `["events"]` invalidated) in `lib/query/events.ts`, rendered by `components/calendar/CalendarShell.tsx`.

**Debugging** — A series vanishes when scrolling past its start month -> the recurring rows were filtered by range, or client expansion dropped them -> check `listEvents` and `lib/recurrence/expand`. `400` "Provide both from and to." -> only one bound was sent -> check the `URLSearchParams` in `useEvents`. New events land in the wrong month -> the range came from the client, but the no-params fallback uses the household timezone -> compare `household.timezone` with the browser. `403` only for the partner -> the target calendar is view-only and the flag is inherited from its root.

**Tests** — `tests/integration/events-api.test.ts`, `tests/integration/regressions.test.ts`, `tests/e2e/events.spec.ts`, `tests/e2e/quick-create.spec.ts`.

### app/api/events/search/route.ts

**Purpose** — Household-wide search over event title, location and description.

**API** — `GET` query `q` (required) and optional `limit` → `200 { events: EventView[] }`. A missing `q` parameter is `400 VALIDATION` with `fields.q`; `q=` (present but empty) is not an error and returns an empty list, as does any term shorter than 2 characters after trimming. `limit` is parsed with `Number`; a non-finite value falls back to the default of 50, and the service clamps the result to 1-50 (`Math.max(1, Math.min(trunc(limit) || 50, 50))`), so `limit=0` or a negative value still returns one row. Errors otherwise: 401/403 from `withViewer`.

**State & side effects** — One `LIKE` query limited to 200 candidate rows, with `%`, `_` and `\` escaped so `100%` cannot match everything; results are ranked in memory (exact title, title prefix, title contains, location, description) and then by title and id. One row per stored event: a recurring series is a single hit, not one per occurrence. Read-only.

**Depends on / Used by** — `withViewer`; `searchEventsHandler`; `searchEvents` from `@/lib/services/search`. Client: `useSearchEvents` in `lib/query/search.ts`, which uses the shared key prefix `["events", "search", normalized]` (so any event mutation invalidates search too), enables itself at 2+ characters, and keeps previous data on screen. Called by `components/calendar/SearchBox.tsx`.

**Debugging** — Typing a percent sign matches everything -> `escapeLike` or the `ESCAPE '\'` clause was dropped -> check `lib/services/search.ts`. A series shows up once when several occurrences match -> expected; expansion happens on the client. Search returns nothing for a term that is visibly stored -> SQLite `LIKE` folds ASCII case only, so the non-ASCII characters must match exactly -> compare the query with the stored title. Results go stale after an edit -> the key no longer starts with `["events"]`.

**Tests** — `tests/integration/search-api.test.ts`, `tests/e2e/search.spec.ts`.

### app/api/events/[id]/route.ts

**Purpose** — Edits one event, applies one of the three Google-style recurring scopes, or deletes a whole event / a range of a recurring series.

**API** — `PATCH` body `updateEventSchema` (every field optional; `allDay` carries no default, so omitting it keeps the stored value) plus an optional scope envelope `{ scope?: "this" | "following" | "all", occurrenceStart?: string }`:
- no scope (or scope without `occurrenceStart`) → today's series PATCH → `200 { event }`;
- `scope: "this"` → requires a non-empty `occurrenceStart`; `VALIDATION` 400 with `fields.occurrenceStart` otherwise → `200 { event }` (the new exception row);
- `scope: "following"` → requires `occurrenceStart` → `200 { event, truncated, relinked, relinkedPrevious }` (the later segment plus the undo data);
- `scope: "all"` **with** `occurrenceStart` → a drag/resize **or Edit-form** change relative to that occurrence; requires `allDay` → `200 { event, relinked, relinkedPrevious }` (the shifted series plus the moved exceptions for undo). A series edit with `scope: "all"` but no `occurrenceStart` takes the normal series path.
`DELETE` reads a JSON body `{ scope?: "all" | "this" | "following", occurrenceStart?: string }`; `scope` defaults to `"all"`, `"this"` and `"following"` without a non-empty `occurrenceStart` are `400 VALIDATION` with `fields.occurrenceStart`. `scope: "this"` keeps the original `204` empty body; `scope: "all"` returns `200 { deleted, truncated: null }`; `scope: "following"` returns `200 { deleted, truncated, segmentId }` — every deleted row, the old segment's post-truncation state (`null` when it was removed) and the removed later segment's id so undo can exclude it. Errors: 401/403 from `withViewer`, 404 "Event not found." for an id outside the household or in a private collection the viewer does not own, 403 "This collection is view-only." when the event's collection denies the write, 400 for a shape/RRULE violation, an occurrence that the rule does not generate, or a target collection that is a list ("Events live in calendars."). Moving an event with `collectionId` requires write access on both the source and the target, and the target must be a `kind: "calendar"` collection.

**State & side effects** — `PATCH` without a scope recomputes the all-day/timed shape from the merged row, nulls the fields that do not belong to the resulting shape, bumps `updatedAt`, and writes only the fields present in the body. A scoped `PATCH` delegates to the service scope functions: `"this"` inserts a linked exception and appends the EXDATE in one transaction; `"following"` truncates the old row and inserts the later segment (re-linking later exceptions); `"all"` with `occurrenceStart` shifts the series timing, rule, EXDATEs and linked exceptions relative to the occurrence and applies any edited fields — a text-only save has deltas of zero and leaves DTSTART alone. `DELETE scope: "this"` appends `occurrenceStart` to the JSON `exdates` array (idempotent); `scope: "all"` removes the row and lets the self-FK cascade remove linked exceptions; `scope: "following"` splits and deletes the later segment. No revalidation.

**Depends on / Used by** — `withViewer<{ id: string }>`; `updateEventHandler`, `deleteEventHandler`; `updateEventSchema`; `createException`, `updateEvent`, `moveSeries`, `splitSeries`, `deleteEvent`, `deleteFollowing`. Clients: `useUpdateEvent` and `useDeleteEvent` in `lib/query/events.ts` (unscoped writes patch `["events"]` optimistically and restore on error; scoped writes rely on invalidation), used by the event dialog, the scope chooser for drag/resize/delete and the undo toast.

**Debugging** — `400` "The end time must be after the start time." on a PATCH that only moved `startAt` -> the merged row's `endAt` was not updated with it -> send both bounds. A `204` still leaves the occurrence on the grid -> `scope: "this"` only appends to `exdates`, so a renderer that ignores `exdates` keeps drawing it -> check `parseExdates` and the expansion in `lib/recurrence/expand`. Deleting one occurrence removed the whole series -> the row has no `rrule` (the service then deletes it) or `scope` was not exactly `"this"` -> check the stored row and the request body. `400` "occurrenceStart is required when scope is 'this'." -> the drawer sent no `occurrenceStart` -> check the call site. `400` "That occurrence is not part of this series." -> the key was an EXDATE/not generated, or came in the wrong shape -> check the occurrence key (`YYYY-MM-DD` vs ISO). A whole-series ``200 { deleted: [] }`` looks like a failed delete to an old client that expects `204` -> the response contract changed with `0005`; the current client parses the body for undo. `403` after a drag into the partner's view-only calendar -> the target calendar denied the write after the optimistic move.

**Tests** — `tests/integration/events-api.test.ts` (incl. the `recurring edit scopes API` suite), `tests/e2e/events.spec.ts`, `tests/e2e/recurring-scope.spec.ts`, `tests/e2e/undo.spec.ts`, `tests/e2e/details.spec.ts`.

## Task routes

Four thin routes over `lib/api/handlers/tasks.ts`; bucketing (`lib/domain/tasks.ts`), privacy, ordering and the checklist transaction all live in `lib/services/tasks.ts`.

### app/api/tasks/route.ts

**Purpose** — Lists the tasks of one view (or one list) and creates a task, defaulting to the caller's Inbox.

**API** — `GET` query `view` in `inbox | today | week | someday | all` (optional; absent means `all`), optional `collectionId`, and optional `includeClosed` (`"true"`/`"false"` only; any other value is `400 VALIDATION` with `fields.includeClosed`) → `200 { tasks: TaskView[], counts: TaskCounts }`. `TaskView` is the row plus `checklist: ChecklistItemView[]` and `collection: { id, name, kind, hueFamily, shadeIndex }`; `TaskCounts` is `{ inbox, today, week, someday, overdue }`. An invalid `view` or an empty `collectionId` is `400 VALIDATION` with `fields.view` / `fields.collectionId`; an unknown or invisible `collectionId` is `200` with `tasks: []` while `counts` stays global. `POST` body `createTaskSchema` (`title` required, trimmed, 1-200; optional `notes`, `collectionId`, `scheduledOn`, `dueOn` as `YYYY-MM-DD`, `priority` in `none|low|normal|high|urgent` (default `none`), and `status` in `open|in_progress` only (default `open`; a `done`/`dropped` create is `400 VALIDATION` by design — closing a task is a PATCH transition) → `201 { task }`. Without `collectionId` the task lands in the caller's private Inbox; a calendar target is `400 VALIDATION` "Tasks live in lists.", a view-only target `403`, and the partner's private list `404` "Calendar not found." (the collection resolver, not the task lookup).

**State & side effects** — `GET` reads the household for `timezone`/`weekStartsOn` (the bucket maths is household-local), may lazily create the caller's Inbox (`ensureInbox`), and returns active visible tasks only: done/dropped tasks are never listed unless `includeClosed=true`, in which case they join the bucket their dates imply (`bucketOfIncludingClosed`) while `counts` stay active-only. A task dated beyond this week appears only under `all`. `POST` inserts one row with a generated UUID, `createdBy` from the session, `status` from the body (`open`/`in_progress`, default `open`) and `sortOrder = max + 1` in the target list. No revalidation.

**Depends on / Used by** — `withViewer`; `listTasksHandler`, `createTaskHandler`; `getHousehold`; `listTasksQuerySchema`, `createTaskSchema`. Clients: `useTasks(view?, collectionId?, includeClosed?)` (query key `["tasks", view, collectionId, "open"|"closed"]`) and `useCreateTask()` in `lib/query/tasks.ts`.

**Debugging** — Badge counts do not move when a collection filter is applied -> expected: `counts` always covers every visible active task -> compare `useTasks()` with `useTasks(view, id)`. A task created without `collectionId` appears under Inbox -> intended (`ensureInbox`). `400 fields.view` -> the caller sent a bucket name `lib/domain/tasks.ts` does not define -> `taskViewSchema`. A new task is missing from `view=today` -> it has no `scheduledOn`/`dueOn` yet, so it sits in Inbox or Someday -> check the body.

**Tests** — `tests/integration/tasks-api.test.ts`; the workspace that calls it is covered by `tests/e2e/tasks.spec.ts` and documented in `docs/COMPONENTS/components-tasks.md`.

### app/api/tasks/[id]/route.ts

**Purpose** — Reads, patches or deletes one task; the dynamic route unwraps `params` itself because Next 16 hands it a `Promise`.

**API** — `GET` → `200 { task }`. `PATCH` body `updateTaskSchema` (every create field optional plus `status: open|in_progress|done|dropped`, `priority: none|low|normal|high|urgent`, `checklist: { title, done }[]` up to 50, `sortOrder`; a present `checklist` replaces the whole list) → `200 { task }`. `DELETE` takes no body → `204` with an empty body. Errors: 401/403 from `withViewer`; `404` "Task not found." for an id outside the household **or a private list the caller does not own** (existence hidden); `403` "This collection is view-only." when the task's list denies the write; `400` "Tasks live in lists." when `collectionId` moves the task into a calendar, and 400 for a malformed body. A move needs write access on both the source and the target and appends at the target's end; `status` stamps `completedAt`/`droppedAt` only on a real transition.

**State & side effects** — `PATCH` writes only the defined fields; a body that changes nothing returns the current row without bumping `updatedAt`. A checklist replacement shares one transaction with the row patch. `DELETE` hard-deletes; the checklist rows cascade. No revalidation.

**Depends on / Used by** — `withViewer<{ id: string }>`; `getTaskHandler`, `updateTaskHandler`, `deleteTaskHandler`; `updateTaskSchema`; `getTask`, `updateTask`, `deleteTask`. Clients: `useUpdateTask` (optimistic patch of every cached `["tasks", …]` payload, snapshot rollback, settle invalidate) and `useDeleteTask` (invalidate only) in `lib/query/tasks.ts`.

**Debugging** — A row snaps back after an edit -> the optimistic patch rolled back because the PATCH failed; read the thrown `Error` message and the response status, `restoreTasks` replayed the snapshot. A done task disappears from the list without a manual refresh -> expected: done/dropped rows are excluded from `listTasks` after the settle refetch. `404` for a task that exists -> its list is private and owned by the partner, or the id is another household's. `403` -> the list is view-only for this viewer (effective visibility is inherited from its root).

**Tests** — `tests/integration/tasks-api.test.ts`; the optimistic cache helpers in `tests/unit/task-cache.test.ts`.

### app/api/tasks/order/route.ts

**Purpose** — Rewrites the manual order of one list from the full active-task id set.

**API** — `PATCH` body `reorderTasksSchema` (`collectionId`, `orderedIds` of at least one id) → `200 { tasks: TaskView[] }` in the requested order. Errors: 401/403 from `withViewer`; `400 VALIDATION` with `fields.collectionId`/`fields.orderedIds` for a malformed body, `400` "Send exactly the active tasks of this list." when the ids are partial, duplicated or from another list (a stale client must refetch, never guess), `400` "Tasks live in lists." for a calendar, `403` for a view-only list, and `404` "Calendar not found." for the partner's private list.

**State & side effects** — One transaction writes `sortOrder = index` and `updatedAt` for every id, then returns the fresh views in the sent order. No revalidation.

**Depends on / Used by** — `withViewer`; `reorderTasksHandler`; `reorderTasksSchema`; `reorderTasks`. Client: `useReorderTasks()` in `lib/query/tasks.ts`, which invalidates `["tasks"]` on settle instead of reordering the cache optimistically.

**Debugging** — `400` "Send exactly the active tasks of this list." -> another session created or completed a task between the read and the drop; refetch `["tasks"]` and retry -> `reorderTasks`. The order survives a drop but resets on reload -> the PATCH failed or never fired; the hook invalidates `["tasks"]`, so a failed request restores the server order. `404`/`403` on a list the caller can see -> privacy is checked before kind; a view-only list can be read but not reordered.

**Tests** — `tests/integration/tasks-api.test.ts` (reorder round-trip plus the partial-set 400).

### app/api/tasks/counts/route.ts

**Purpose** — Serves the per-list badge payload the sidebar reads: bucket counts plus an active-task count per visible collection.

**API** — `GET` (no query) → `200 { counts: TaskCounts, byCollection: Record<string, number> }`. `counts` carries the same meaning as `GET /api/tasks`'s (active tasks only, `overdue` included); `byCollection` has one key per collection id that holds at least one active task, so neither an empty list nor a private list the caller cannot read can appear. 401/403 come from `withViewer`; no other error path exists.

**State & side effects** — Reads the household for `timezone`/`weekStartsOn`, may lazily create the caller's Inbox (`ensureInbox`), and resolves visibility through `resolveVisibleCollections`; the read is active-only and never writes task rows. No revalidation.

**Depends on / Used by** — `withViewer`; `taskCountsHandler`; `getTaskCountSummary` in `lib/services/tasks.ts`. Client: `useTaskCounts()` in `lib/query/tasks.ts` (query key `["tasks", "counts"]`, `enabled` defaults to true), called by `components/sidebar/CollectionTree.tsx` with `enabled: pathname.startsWith("/tasks")`; badges render only for writable list rows and hide at `0`, and the calendar issues no counts request.

**Debugging** — An empty `byCollection` while tasks exist -> every task is done/dropped or in a private list the viewer does not own -> compare with `GET /api/tasks`. A count differs from the list's badge -> the two requests used different `weekStartsOn` (the household changed) or a stale cache -> `useTaskCounts` invalidates with the `["tasks"]` prefix. 404 for the route itself -> the file was added after a build; restart the dev server.

**Tests** — `tests/integration/tasks-api.test.ts` (payload shape, partner-private exclusion, unauthenticated 401).

## Import routes

Google Calendar import over `lib/api/handlers/import.ts`: the browser uploads exported `.ics` files as `multipart/form-data` (repeated `files` fields) plus an optional JSON `mapping` field. No OAuth, no network calls; the service parses in memory and caps the payload at 5 MB / 50 000 events. All four read the viewer through `withViewer`, so 401/403 behave like every other route.

### app/api/import/preview/route.ts

**Purpose** — Parses the uploaded calendars and reports what a commit would do, without writing.

**API** — `POST` multipart: one to twenty `files` fields (each an `.ics` document) → `200 { preview: ImportPreview }` with per-calendar `{ name, events, recurring, overrides, earliest, latest, createCount, updateCount, unchangedCount }`, totals, `nonHouseholdTimezones` (series whose source zone differs from the household zone), `warnings` (unknown TZIDs, skipped events, duplicate UIDs) and `dropped` ({ alarms, attendees, attachments }). Errors: 400 "Send the export as multipart/form-data.", "Choose at least one .ics file.", "That export is too large (5 MB max).", "That file is not an iCalendar (.ics) document.".

**State & side effects** — Read-only: parses the files, looks up existing rows by `external_key` to classify create/update/unchanged, and returns counts. Nothing is persisted, not even the upload.

**Depends on / Used by** — `withViewer`; `previewImportHandler`; `previewImport` from `lib/services/import.ts`. Client: step 1 of `components/import/ImportWizard.tsx`, which posts the selected `File[]` and keeps them in state for the commit.

**Debugging** — Preview shows fewer events than the file contains -> the skipped events are named in `warnings` -> unknown TZID or missing UID/DTSTART -> check `parseIcs`. Every event says `createCount` on a re-import -> `external_key` is unstable -> compare two parses.

**Tests** — `tests/integration/import-api.test.ts`, `tests/unit/ics-parse.test.ts`.

### app/api/import/commit/route.ts

**Purpose** — Applies the mapping and writes the events in one transaction.

**API** — `POST` multipart: the same `files` fields plus a required JSON `mapping` field (`{ [sourceCalendarName]: { mode: "new" } | { mode: "existing", collectionId } }`) → `201 { report: ImportReport }` with `{ batchId, created, updated, unchanged, calendarsCreated, warnings, dropped }`. Errors: 400 for a missing/malformed `mapping` ("Send the calendar mapping as JSON.", "Choose where each calendar goes."), a missing entry per source calendar (`fields["mapping.<name>"]`), a target that is a task list ("Imported events need a calendar."), or the preview's file errors; 403 "This calendar is view-only." when a chosen existing target denies the write (nothing is written — the transaction is rolled back); 404 for a calendar outside the household.

**State & side effects** — One SQLite transaction: creates `From Google` roots/children as needed (reusing a same-named child on a re-import), inserts or updates events by `external_key`, writes one `import_batch` plus one `import_change` per event. `unchanged` events are not written.

**Depends on / Used by** — `withViewer`; `commitImportHandler`; `commitImport` from `lib/services/import.ts`. Client: step 3 of `ImportWizard.tsx`, which then shows the report and invalidates `["events"]`/`["collections"]`.

**Debugging** — Commit 403s -> the target calendar is view-only for the viewer -> pick a writable calendar; nothing was written. Commit 400s with "Imported events need a calendar." -> the mapping pointed at a task list -> choose a calendar; the wizard offers only calendars and nothing was written. Commit succeeds but the calendar shows no events -> the events landed in the mapped calendar, which may be collapsed in the sidebar -> check `calendarsCreated` and the calendar tree. Re-import counts everything as `unchanged` after editing an event in Nailong -> the import compares the source file's hash, not the row.

**Tests** — `tests/integration/import-api.test.ts`, `tests/integration/import-service.test.ts`, `tests/e2e/import.spec.ts`.

### app/api/import/batches/route.ts

**Purpose** — Import history for Settings, newest first.

**API** — `GET` → `200 { batches: ImportBatchView[] }` with `{ id, sourceName, createdAt, status: "committed" | "rolled_back", rolledBackAt, created, updated }`. Errors: 401/403 from `withViewer`.

**State & side effects** — Read-only, household-scoped: reads `import_batch` and the counts stored in its JSON report.

**Depends on / Used by** — `withViewer`; `listImportBatchesHandler`; `listImportBatches`. Client: `components/import/ImportBatchesCard.tsx`.

**Debugging** — A batch is missing -> it belongs to the other household (queries are household-scoped) -> check `household_id`. Counts are 0 -> the stored report JSON is absent/corrupt -> `parseStoredReport` falls back to zeros.

**Tests** — `tests/integration/import-api.test.ts`.

### app/api/import/batches/[id]/rollback/route.ts

**Purpose** — Undoes one committed import batch.

**API** — `POST` (empty body) → `200 { rollback: { batchId, deleted, restored, skipped, calendarsDeleted } }`. Errors: 404 "Import batch not found." for an unknown or other-household id, 409 "This import has already been undone." when the batch is not `committed`.

**State & side effects** — One transaction: deletes events the batch created, restores updated events from `before_json`, skips any event whose `updatedAt` is newer than the batch (the user edited it), deletes the now-empty calendars the batch created, and marks the batch `rolled_back` with `rolled_back_at`. `skipped` tells the caller what was left alone.

**Depends on / Used by** — `withViewer<{ id: string }>`; `rollbackImportBatchHandler`; `rollbackImportBatch`. Client: the report step and the history card in `components/import/ImportWizard.tsx` / `ImportBatchesCard.tsx` both expose "Undo".

**Debugging** — Undo leaves an event behind -> it was edited after the import (`skipped`) or belongs to another batch -> check `import_change.batch_id` and `event.updated_at`. Undo removes the calendars but not the events -> events were skipped because of later edits; deleting a non-empty calendar would cascade, so the importer leaves it.

**Tests** — `tests/integration/import-api.test.ts`, `tests/integration/import-service.test.ts`, `tests/e2e/import.spec.ts`.

## Settings routes

Three one-handler routes over `lib/api/handlers/settings.ts` and `lib/api/handlers/preferences.ts`. None of them is restricted by role — both members are equal, and every field is per-user or household-wide.

### app/api/settings/household/route.ts

**Purpose** — Updates the single household's name, timezone and week start.

**API** — `PATCH` body `updateHouseholdSchema` (`name` trimmed 1-60, `timezone` 1-64, `weekStartsOn` restricted to the literal `0` or `1`; all optional) → `200 { household }`. Errors: 401/403 from `withViewer`, 404 `NOT_FOUND` "Household not found." when the singleton row is missing, 400 `VALIDATION` with `fields.timezone` "Pick a valid IANA timezone, like Asia/Taipei." when `Intl.DateTimeFormat` rejects the value, 400 for an empty name or a `weekStartsOn` other than 0/1.

**State & side effects** — Patches only the provided fields (an empty patch still returns the current row after a `getHousehold` lookup) and trims `name`. The timezone is validated by constructing `Intl.DateTimeFormat("en-US", { timeZone })`, not by a list. Household-wide: both members see the change. No revalidation; the client refreshes the route.

**Depends on / Used by** — `withViewer`; `updateHouseholdHandler`; `updateHousehold`, `getHousehold` from `@/lib/services/household`; `updateHouseholdSchema`. Client: `saveHousehold` in `components/settings/SettingsForm.tsx`, which shows a toast and calls `router.refresh()` so server-rendered timezone/week start update.

**Debugging** — `400` on a timezone that looks valid -> ICU in the deployed Node build does not know it -> check with `new Intl.DateTimeFormat("en-US", { timeZone })` on the server. Saved values revert on reload -> `router.refresh()` was removed -> `SettingsForm.saveHousehold`. An extra key in the body is silently dropped (the schema strips unknown keys), but `weekStartsOn: 2` is a hard 400 -> check the submitted value.

**Tests** — `tests/integration/settings-api.test.ts`, `tests/e2e/settings.spec.ts`.

### app/api/settings/preferences/route.ts

**Purpose** — Reads and patches the signed-in user's calendar preferences.

**API** — `GET` → `200 { preferences: UserPreferences }` (`defaultView`, `timeFormat`, `showWeekNumbers`, `shortcutsEnabled`, `lastEventCalendarId`). `PATCH` body `updatePreferencesSchema` → `200 { preferences }` with the merged row. Errors: 401/403 from `withViewer`, 400 `VALIDATION` for an unknown enum value or for any unrecognised key — this is the only `.strict()` schema in the API, so a stray field is rejected rather than dropped.

**State & side effects** — `GET` never writes: a missing `user_preference` row is returned as `DEFAULT_PREFERENCES` (`auto`, `24h`, no week numbers, shortcuts on, `lastEventCalendarId: null`), so first read is a pure read. `PATCH` merges the patch over the current values and upserts on `userId`; `lastEventCalendarId` is the one field where `null` is meaningful and is applied only when the key is present. Stored enum values from older builds fall back to defaults on read. Per-user, never household-wide.

**Depends on / Used by** — `withViewer`; `getPreferencesHandler`, `updatePreferencesHandler`; `getPreferences`, `updatePreferences`, `DEFAULT_VIEWS`, `TIME_FORMATS`; `updatePreferencesSchema`. Clients: `usePreferences` (key `["preferences"]`, seeded with server data and `staleTime: Infinity`) and `useUpdatePreferences` (optimistic, sequence-guarded so an older response cannot overwrite a newer toggle) in `lib/query/preferences.ts`; both are consumed by `components/calendar/CalendarShell.tsx` and `components/settings/CalendarPreferencesCard.tsx`.

**Debugging** — A toggle reverts immediately -> the PATCH was rejected with 400 (likely an extra key) -> inspect the request body against the `.strict()` schema. Preferences are lost after a reload -> the upsert wrote a default row instead of the merge, or `getPreferences` returned defaults for a missing row -> check `user_preference`. A default-view change does not apply on the next visit -> `auto` resolves per viewport, so a phone still opens the list -> check `lib/ui` view resolution.

**Tests** — `tests/integration/preferences-api.test.ts`, `tests/e2e/preferences.spec.ts`, `tests/e2e/view-preference.spec.ts`.

### app/api/settings/profile/route.ts

**Purpose** — Renames the signed-in account.

**API** — `PATCH` body `updateProfileSchema` (`name` required, trimmed, 1-60) → `200 { user: { id, name } }`. Errors: 401/403 from `withViewer`, 400 `VALIDATION` with `fields.name` when empty or too long, 404 `NOT_FOUND` "Account not found." when no `user` row matches the session id.

**State & side effects** — Updates the Better Auth `user` row's `name` and `updatedAt` for `ctx.userId` only; the household and the partner are untouched. The response contains just id and name, not the whole account. No session invalidation.

**Depends on / Used by** — `withViewer`; `updateProfileHandler`; `updateMemberName` from `@/lib/services/household`; `updateProfileSchema`. Client: `saveProfile` in `components/settings/SettingsForm.tsx` (toast plus `router.refresh()`, which is what updates the breadcrumb and person pills).

**Debugging** — The name changes in settings but not in the sidebar -> `router.refresh()` was removed, or the shell is cached -> `AppShell` receives `currentUser` from `app/(app)/layout.tsx`. `404` "Account not found." -> the session points at a deleted `user` row -> sign out and back in.

**Tests** — `tests/integration/settings-api.test.ts`, `tests/e2e/settings.spec.ts`.

## Health

### app/api/health/route.ts

**Purpose** — Liveness and database probe for deploys and containers.

**API** — `GET`, no authentication, no body or query. Success is `200 { ok: true, app: "Nailong Planner" }`; any thrown database error is `503 { ok: false }` and is logged with `console.error("[health] database check failed", ...)`. There is no other status: the route never returns 401/403 and does not expose table counts or versions.

**State & side effects** — Calls `getSqlite()`, which opens the database, applies pending migrations and validates the production environment, then runs `SELECT 1` and `SELECT COUNT(*) FROM household`. Read-only; no session, no cookie, no write. The schema probe is deliberate: `SELECT 1` alone answered 200 on an empty or half-migrated database, which let Railway mark an unusable deploy healthy.

**Depends on / Used by** — `getSqlite` from `@/lib/db` and, through it, `assertProductionEnv` from `@/lib/env` (a missing `BETTER_AUTH_SECRET` or explicit `DATABASE_URL` makes this route 503). Used as `healthcheckPath` in `railway.json`, so a `503` restarts the container; referenced by `docs/OPERATIONS.md`.

**Debugging** — The container restarts in a loop while the app responds -> `/api/health` returns `503` -> check the `[health]` log line and that the mounted `data/` volume is writable. `503` with "Invalid production environment" in the log -> a required variable is missing or too short -> fix the service variables. Health passes but every API call fails -> the probe covers the database and config, not every feature; check migrations via `npm run db:migrate` and the auth logs. A reverse proxy reports the upstream unhealthy -> the probe is being served without the SQLite file (`DATABASE_URL` path wrong) -> check `lib/env` and `lib/db/client.ts`.

**Tests** — No direct test coverage; `docs/OPERATIONS.md` treats it as the deploy gate.

## Focused verification

```bash
npx vitest run tests/integration/auth.test.ts tests/integration/collections-api.test.ts tests/integration/events-api.test.ts tests/integration/search-api.test.ts tests/integration/settings-api.test.ts tests/integration/preferences-api.test.ts tests/integration/tasks-api.test.ts
npx playwright test tests/e2e/auth.spec.ts tests/e2e/shell.spec.ts tests/e2e/viewport-fit.spec.ts tests/e2e/design-tokens.spec.ts
npm run docs:check && npm run lint && npm run typecheck
```
