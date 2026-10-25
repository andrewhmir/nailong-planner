# Tests

The suites are documented as lookup tables rather than one section per file: find the behaviour, read the command, run that one file. `tests/` is intentionally excluded from `npm run docs:check`, which does not gate this area — but a new or renamed suite still needs its row here.

**How to update this doc:** add a row to the matching table, then add or amend the entry in `## Which spec covers what`.

## How to run tests

| What | Command | Notes |
|---|---|---|
| Unit + integration, once | `npm test` | `vitest run`; Node environment, in-memory SQLite, no dev server |
| Unit + integration, watch | `npm run test:watch` | `vitest` in watch mode |
| One unit or integration file | `npx vitest run tests/unit/view.test.ts` | Same config; run from the repository root |
| All E2E specs | `npm run test:e2e` | `tsx scripts/seed-test-db.mts && playwright test` |
| One E2E spec | `npx playwright test tests/e2e/undo.spec.ts` | Seed first with `npx tsx scripts/seed-test-db.mts` |
| Refresh the committed screenshots | `CAPTURE_SCREENSHOTS=1 npm run test:e2e` | Without the flag `tests/e2e/screenshot.spec.ts` skips itself |

- **Vitest never touches a file.** `vitest.config.mts` sets `DATABASE_URL=file::memory:` and `TZ=Asia/Taipei`, and `tests/helpers/db.ts` opens a fresh `new Database(":memory:")` per test with `foreign_keys = ON` and the real migrations applied. Nothing writes to `data/`.
- **`.playwright/test.db` is the E2E database.** `scripts/seed-test-db.mts` creates it, truncates every table, seeds two users, ten calendars and four events, and writes `.playwright/fixtures.json`. `playwright.config.ts` points its dev server at the same file with `NEXT_DIST_DIR=.next-e2e`, `AUTH_RATE_LIMIT=off` and `TZ=Asia/Taipei`.
- **The `:3100` dev-server caveat.** Playwright starts `npm run dev -- -p 3100` itself and, locally, reuses a server that is already listening there (`reuseExistingServer` is only off in CI). A leftover `:3100` server serves stale code and an old database — stop it, or re-run the seed script, before trusting a result. Your own `npm run dev` on `:3000` is a different process because the E2E server builds into `.next-e2e/`.
- **E2E state is shared.** `workers: 1` and `fullyParallel: false` mean the specs run in file order against one database, so several specs create and delete their own probe events instead of relying on seeded rows. `tests/e2e/preferences.spec.ts`, `tests/e2e/shortcuts.spec.ts` and `tests/e2e/view-preference.spec.ts` reset the preferences they change in `afterEach`.

## Unit tests

| File | What it locks down | Command |
|---|---|---|
| `tests/unit/permissions.test.ts` | `canWriteCollection` + `assertWritable` truth table over `{shared, view_only, private} × {owner me, owner partner, owner null}`: shared reads/writes for both, view-only partner write 403, private partner/none read and write 404, foreign household 404 | `npx vitest run tests/unit/permissions.test.ts` |
| `tests/unit/time.test.ts` | Wall-time→UTC round-trips, the 47-hour DST day, rejection of DST-gap and malformed times, inclusive all-day ranges | `npx vitest run tests/unit/time.test.ts` |
| `tests/unit/recurrence.test.ts` | `expandOccurrences`: series anchored to its stored start, preserved duration, EXDATE skipping, monthly-31st, all-day expansion, and wall-clock expansion across both DST changes in the series' own `tzid` | `npx vitest run tests/unit/recurrence.test.ts` |
| `tests/unit/recurrence-rule.test.ts` | The structured repeat adapter: every Google-style RRULE shape round-trips; contextual preset defaults; re-anchoring on a moved start date; DATE vs UTC `UNTIL`; `COUNT`; unsupported `FREQ`/parts; the 730-occurrence cap | `npx vitest run tests/unit/recurrence-rule.test.ts` |
| `tests/unit/ics-parse.test.ts` | `parseIcs`: timed events with `TZID`, escaped text, exclusive all-day `DTEND`, RRULE + EXDATE, `RECURRENCE-ID` overrides, unknown-TZID skip, floating times, `DURATION`, content-hash stability | `npx vitest run tests/unit/ics-parse.test.ts` |
| `tests/unit/format.test.ts` | 12h/24h time, inclusive multi-day all-day text, midnight-crossing ranges, occurrence-relative headings (F28) | `npx vitest run tests/unit/format.test.ts` |
| `tests/unit/recurrence-label.test.ts` | `describeRrule` wording for Google-style rules: weekdays, intervals, monthly day-of-month, `COUNT`/`UNTIL` end clauses, timezone-aware `UNTIL` dates, and the empty string for unknown input | `npx vitest run tests/unit/recurrence-label.test.ts` |
| `tests/unit/palette.test.ts` | Eight distinct shades per family, pinned parent shade and child order, hex twins for FullCalendar, 4.5:1 container contrast | `npx vitest run tests/unit/palette.test.ts` |
| `tests/unit/toFcEvent.test.ts` | Occurrence→FullCalendar mapping, `id::startKey` ids, inclusive→exclusive all-day end, accent/container colours | `npx vitest run tests/unit/toFcEvent.test.ts` |
| `tests/unit/event-cache.test.ts` | `applyEventPatch`/`removeEvent`/`replaceEvent` stay immutable and keep order when a temp event is swapped for the server row | `npx vitest run tests/unit/event-cache.test.ts` |
| `tests/unit/quick-create-defaults.test.ts` | Next-half-hour default for today, 09:00 elsewhere, quarter-hour snapping, midnight rollover, drag selections | `npx vitest run tests/unit/quick-create-defaults.test.ts` |
| `tests/unit/event-payload.test.ts` | The rule-preservation contract: an untouched complex RRULE reaches the server byte-identically, an edited repeat rebuilds it (keeping interval/end), all-day DATE vs timed UTC `UNTIL`, all-day payloads, inverted all-day ranges, empty text→null | `npx vitest run tests/unit/event-payload.test.ts` |
| `tests/unit/timeSlots.test.ts` | The 15-minute slot grid and coarser/finer steps, `minutesOfDay`/`formatMinutes` round-trips and out-of-day wrapping, nearest-row rounding and clamping, and the format-aware typed-time parser: 24-hour input rejects an am/pm suffix, 12-hour accepts `am`/`pm`/`a.m.`/`p.m.` and inherits the fallback, hour bounds | `npx vitest run tests/unit/timeSlots.test.ts` |
| `tests/unit/view.test.ts` | `resolveInitialView`: `auto` → list on phones, month elsewhere; explicit views pass through | `npx vitest run tests/unit/view.test.ts` |
| `tests/unit/visibility.test.ts` | Ours/mine/partner grouping, pill × checkbox multiplication, parent hides child, a sub-calendar groups by its parent's owner (stale child row ignored), "only this calendar" outranks both | `npx vitest run tests/unit/visibility.test.ts` |
| `tests/unit/visibleCollections.test.ts` | The id set fed to the grid: isolated sub-calendar survives a hidden parent, a hidden root prunes its branch, a stale shared child under a person-owned root stays drawn when Ours is off | `npx vitest run tests/unit/visibleCollections.test.ts` |
| `tests/unit/treeFold.test.ts` | Sidebar fold defaults are expanded, one group/collection folds without touching its siblings, toggles stay immutable, corrupt or non-boolean storage falls back to expanded | `npx vitest run tests/unit/treeFold.test.ts` |
| `tests/unit/calendarPicker.test.ts` | Picker rows and depth, expand/collapse, parent vs assigned shade colours, slate fallback, auto-expand for a selected child | `npx vitest run tests/unit/calendarPicker.test.ts` |
| `tests/unit/icons.test.ts` | Icon contract: 1.5px `currentColor` stroke, no fill, 20px default, `aria-hidden` unless a `title` is given | `npx vitest run tests/unit/icons.test.ts` |
| `tests/unit/roadmap.test.ts` | `APP_VERSION` matches `package.json`; unique roadmap ids and hrefs; exactly one promised version; `gateLabel` wording; the live set is Calendar + Settings | `npx vitest run tests/unit/roadmap.test.ts` |
| `tests/unit/env.test.ts` | `assertProductionEnv`: no-op outside production, complete env, missing/short `BETTER_AUTH_SECRET`, implicit `DATABASE_URL`, non-absolute `BETTER_AUTH_URL`, http/localhost warning | `npx vitest run tests/unit/env.test.ts` |
| `tests/unit/route-origin.test.ts` | `assertSameOrigin`: same-origin write allowed, no-Origin callers allowed, foreign `Origin` rejected, `Sec-Fetch-Site: cross-site` rejected, reads unrestricted | `npx vitest run tests/unit/route-origin.test.ts` |
| `tests/unit/wheelNav.test.ts` | Wheel-to-navigate gesture maths: mouse-sized deltas step immediately, trackpad deltas accumulate to the 40 threshold, horizontal swipes and ctrl/meta pinch-zoom ignored, and one navigation per 500 ms cooldown | `npx vitest run tests/unit/wheelNav.test.ts` |

## Integration tests

| File | What it locks down | Command |
|---|---|---|
| `tests/integration/db.test.ts` | Migrations apply; a calendar delete cascades to its children and their events; foreign keys reject orphans; all-day and timed columns stay separate; migration `0004` backfills sub-calendar owners from the root; migration `0005` renames `calendar` -> `collection`, backfills `visibility`, keeps events/ids, repoints the event FK/indexes and cascades tasks | `npx vitest run tests/integration/db.test.ts` |
| `tests/integration/auth.test.ts` | Sign-up is closed by default, exactly two accounts are allowed, a session cookie round-trips, passwords are stored hashed | `npx vitest run tests/integration/auth.test.ts` |
| `tests/integration/collections.test.ts` | Shade assignment and reuse, the eighth-child conflict, no grandchildren, tenant isolation, hue re-derivation, view-only enforcement, owner moves cascading to sub-calendars, direct child-owner writes rejected, a private list + subtree absent from the partner's tree and 404 on get/getAccess/update/delete, view-only list readable but not writable, private-without-owner create/update 400, kind-mismatched child 400, Inbox idempotence and per-viewer privacy | `npx vitest run tests/integration/collections.test.ts` |
| `tests/integration/events.test.ts` | Mixed all-day/timed payloads, inverted times, UTC vs local-date storage, recurrence range filtering, EXDATE idempotency, view-only writes, invalid RRULE, a private calendar's events absent from the partner's list and 404 on get/update/delete/create (including a child of a private root) | `npx vitest run tests/integration/events.test.ts` |
| `tests/integration/collections-api.test.ts` | Handler status codes: 401 without a viewer, 201 on create, 400 with field errors, 409 eighth child, 403 view-only, 404 other household, 204 delete; GET creates one private Inbox per viewer and never exposes the partner's | `npx vitest run tests/integration/collections-api.test.ts` |
| `tests/integration/events-api.test.ts` | Range validation, colour tokens in the response, 403 on every verb for a view-only calendar, `scope=this` idempotency, 201 create, 404 cross-household | `npx vitest run tests/integration/events-api.test.ts` |
| `tests/integration/settings-api.test.ts` | Household name/timezone/week-start updates and validation; member display-name update | `npx vitest run tests/integration/settings-api.test.ts` |
| `tests/integration/preferences-api.test.ts` | Defaults without a stored row, partial PATCH persistence, rejection of unknown view/format, per-user scoping | `npx vitest run tests/integration/preferences-api.test.ts` |
| `tests/integration/regressions.test.ts` | Review- and UAT-found regressions: a view-only root protects its children, ownership claiming rules, title-only PATCH of an all-day event, refusing a view-only move target, deleting one occurrence of a series with corrupt `exdates`, the 15 s busy timeout | `npx vitest run tests/integration/regressions.test.ts` |
| `tests/integration/search-api.test.ts` | Title/location/description matching, the two-character floor, household scoping, one row per series, LIKE escaping, title-first ranking and the limit, and exclusion of events in a private collection the caller does not own | `npx vitest run tests/integration/search-api.test.ts` |
| `tests/integration/import-schema.test.ts` | External-key uniqueness per household, many NULL keys, `tzid`/external columns round-trip, `import_change` cascades with its batch | `npx vitest run tests/integration/import-schema.test.ts` |
| `tests/integration/import-service.test.ts` | Preview without writes, transactional commit and calendar creation, idempotent re-import, in-place update with `before_json`, view-only refusal, per-member separation (each importer's own `From Google` tree, no partner reuse), a spoofing list named `From Google` ignored and only shared calendars created, unknown-TZID warning, size cap, rollback and the edited-after-import skip rule, rollback permission check, batch history | `npx vitest run tests/integration/import-service.test.ts` |
| `tests/integration/import-api.test.ts` | Multipart preview/commit through the handlers, missing/malformed mapping 400s, list + rollback status codes (409/404), `withViewer` wiring | `npx vitest run tests/integration/import-api.test.ts` |

## E2E specs

| File | What it locks down | Command |
|---|---|---|
| `tests/e2e/auth.spec.ts` | Unauthenticated redirect, login fields, a wrong password error, a successful sign-in, session survival across reload | `npx playwright test tests/e2e/auth.spec.ts` |
| `tests/e2e/shell.spec.ts` | 54px rail, breadcrumb derived from the route, visible focus on the dark rail, 320px no-scroll, long-name truncation, real sign-out and a failed sign-out | `npx playwright test tests/e2e/shell.spec.ts` |
| `tests/e2e/roadmap-nav.spec.ts` | Gated destinations render as dimmed buttons (never links), the rail itself never scrolls, a gated dialog shows its promise and returns focus, and the phone drawer lists the same gates | `npx playwright test tests/e2e/roadmap-nav.spec.ts` |
| `tests/e2e/sidebar.spec.ts` | Household groups, child shade strip, visibility persistence, add sub-calendar, owned calendar creation, view-only toggle, person pill, long-name truncation, panel scrolling, parent and group folding with reload persistence, auto-open on add sub-calendar | `npx playwright test tests/e2e/sidebar.spec.ts` |
| `tests/e2e/events.spec.ts` | Month grid with seeded events, create from the toolbar, edit/delete via the popover, drag to another day, weekly series in the next month, skipping one occurrence, week view | `npx playwright test tests/e2e/events.spec.ts` |
| `tests/e2e/event-fields.spec.ts` | Dialog date/time controls: quick-pick a start and an end time then save/delete, arrow-key navigation with Enter picking the row, a typed off-grid minute and the invalid-text alert, Escape closing the list without closing the dialog, the date field picking a day next month | `npx playwright test tests/e2e/event-fields.spec.ts` |
| `tests/e2e/repeat.spec.ts` | Google-style repeat controls: a daily repeat ending after three occurrences, a weekly repeat on two weekdays, an `On <date>` end shown in the details summary, and the "Every weekday" preset | `npx playwright test tests/e2e/repeat.spec.ts` |
| `tests/e2e/quick-create.spec.ts` | Click-a-day bubble, Enter saves, Escape discards, clicking another control on the page dismisses it, "More options" carries the draft, dirty-dialog guard, `Shift+C`, clicking an existing event replaces the bubble | `npx playwright test tests/e2e/quick-create.spec.ts` |
| `tests/e2e/details.spec.ts` | Details show calendar and repeat summary, a later occurrence shows its own date (F28), Escape returns focus, Duplicate then Undo restores the count, no actions for the partner | `npx playwright test tests/e2e/details.spec.ts` |
| `tests/e2e/undo.spec.ts` | Toast Undo, `Ctrl+Z`, `z`, `z` after the toast expires, a failed drag PATCH snapping back, `z` inside a title field doing nothing | `npx playwright test tests/e2e/undo.spec.ts` |
| `tests/e2e/shortcuts.spec.ts` | `t`/`w` navigation, `c` opens the editor, `?` opens the sheet, the toolbar button opens it too, `z` vs `Delete`, the settings toggle disabling single keys | `npx playwright test tests/e2e/shortcuts.spec.ts` |
| `tests/e2e/search.spec.ts` | Finds an event outside the loaded month and opens it, `/` focuses search, Escape closes results, the short-query hint, opening the panel does not resize the field, LIKE wildcards end to end, a quick-create started mid-deep-link never stacks two popups, a chosen result replaces an open bubble | `npx playwright test tests/e2e/search.spec.ts` |
| `tests/e2e/calendar-picker.spec.ts` | Nested picker reveals children only when expanded, the 320px scroll container, Escape closing only the list, the dialog's field using the same picker | `npx playwright test tests/e2e/calendar-picker.spec.ts` |
| `tests/e2e/only-this-calendar.spec.ts` | Isolation shows and hides the right events, new events target the isolated calendar, isolating dismisses an open bubble and the next bubble targets it, "Show all" restores without touching saved boxes, a re-check leaves isolation, a view-only calendar can still be isolated | `npx playwright test tests/e2e/only-this-calendar.spec.ts` |
| `tests/e2e/viewonly.spec.ts` | A partner sees a view-only event without edit affordances, the event still renders, visibility can still be toggled | `npx playwright test tests/e2e/viewonly.spec.ts` |
| `tests/e2e/preferences.spec.ts` | 12-hour format reaches the grid and survives reload, default view persists, the Calendar card is reachable from the sub-nav, week numbers and shortcut toggles persist | `npx playwright test tests/e2e/preferences.spec.ts` |
| `tests/e2e/view-preference.spec.ts` | Desktop defaults to month and phone to list, the last view survives reload, a stored default beats `auto` after `localStorage` is cleared, overlapping events sit side by side | `npx playwright test tests/e2e/view-preference.spec.ts` |
| `tests/e2e/settings.spec.ts` | Household name saves and repopulates, sub-nav marks the hash, password and 2FA panels exist, 2FA setup shows the code field and backup codes, security headers on a real response | `npx playwright test tests/e2e/settings.spec.ts` |
| `tests/e2e/mini-month.spec.ts` | Mini-month jumps the grid, next-month navigation, a wheel gesture over the grid moving to the next month (and the same change without the slide under reduced motion), the toolbar title opens a date picker, `?date=` deep link, the title stays a heading | `npx playwright test tests/e2e/mini-month.spec.ts` |
| `tests/e2e/import.spec.ts` | Settings → importer, upload a Google `.ics`, preview counts, map to a new `From Google` calendar, commit, event visible on the calendar, undo from the history table; the partner's import lands in their own group and survives hiding Shared | `npx playwright test tests/e2e/import.spec.ts` |
| `tests/e2e/mobile.spec.ts` | At 375px the month grid does not overflow horizontally and the calendar tree opens as a sheet that closes | `npx playwright test tests/e2e/mobile.spec.ts` |
| `tests/e2e/viewport-fit.spec.ts` | Eight viewports: document never scrolls, whole month fits, grid does not scroll internally, chrome cannot move; week hours and the settings page scroll inside their panels | `npx playwright test tests/e2e/viewport-fit.spec.ts` |
| `tests/e2e/design-tokens.spec.ts` | Canvas tokens on `:root` (`--color-ink`, `--color-accent`, `--color-link`, `--color-rail`, `--color-field`, `--radius-md`) and self-hosted Lato actually loading | `npx playwright test tests/e2e/design-tokens.spec.ts` |
| `tests/e2e/calendar-style.spec.ts` | Canvas hairlines, the blue today badge, the saturated 3px event bar over a pale fill, theme variables beating FullCalendar's defaults, the view switch as a segmented control | `npx playwright test tests/e2e/calendar-style.spec.ts` |
| `tests/e2e/primitives.spec.ts` | Primary button is 38px with a 4px radius and no shadow; dialogs are square-cornered over the Canvas scrim | `npx playwright test tests/e2e/primitives.spec.ts` |
| `tests/e2e/screenshot.spec.ts` | Refreshes the seven tracked screenshots under `docs/screenshots/`; skips unless `CAPTURE_SCREENSHOTS=1` | `npx playwright test tests/e2e/screenshot.spec.ts` |

## Test helpers

| File | What it provides | Used by |
|---|---|---|
| `tests/helpers/db.ts` | `makeTestDb()`: a fresh `:memory:` database with `foreign_keys = ON` and all migrations applied; `makeTestDb({ upTo })` applies a temporary migrations folder truncated at a journal tag (for migration-by-migration tests) | Every integration test |
| `tests/helpers/fixtures.ts` | `makeSeededDb()`: two households, two members in `h1`, one in `h2`, and the `ctxA`/`ctxB`/`ctxOther` viewer contexts | `tests/integration/collections.test.ts`, `events.test.ts`, `collections-api.test.ts`, `events-api.test.ts`, `settings-api.test.ts`, `preferences-api.test.ts`, `regressions.test.ts`, `search-api.test.ts` |
| `tests/e2e/helpers.ts` | `loadFixtures()` from `.playwright/fixtures.json`, the `ANDREW`/`PARTNER` emails, and `signIn(page, email, password)` | Every spec in `tests/e2e/` |

## Which spec covers what

| Behaviour | Where it is locked down |
|---|---|
| Undo (toast, `Ctrl+Z`, `z`, expired toast, failed drag) | `tests/e2e/undo.spec.ts`; the `z` vs `Delete` path in `tests/e2e/shortcuts.spec.ts`; `tests/unit/event-cache.test.ts` for the cache primitives |
| Viewport fit and no-scroll layout | `tests/e2e/viewport-fit.spec.ts`; 320px in `tests/e2e/shell.spec.ts`; 375px in `tests/e2e/mobile.spec.ts` |
| Keyboard shortcuts | `tests/e2e/shortcuts.spec.ts`; `Shift+C` in `tests/e2e/quick-create.spec.ts`; `/` and `Escape` in `tests/e2e/search.spec.ts` |
| Calendar visibility (pills, checkboxes, parent cascade, isolation) | `tests/unit/visibility.test.ts`, `tests/unit/visibleCollections.test.ts`, `tests/e2e/sidebar.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`, `tests/e2e/viewonly.spec.ts` |
| Private visibility (server-side filter) | `tests/unit/permissions.test.ts` (effective truth table), `tests/integration/collections.test.ts` (tree/get/update/delete 404), `tests/integration/events.test.ts` (event reads/writes 404), `tests/integration/search-api.test.ts` (search exclusion) |
| Inbox creation and privacy | `tests/integration/collections.test.ts` (`ensureInbox` idempotence, per-viewer tree), `tests/integration/collections-api.test.ts` (GET creates it once per viewer) |
| Search | `tests/e2e/search.spec.ts`; ranking/escaping/scoping in `tests/integration/search-api.test.ts` |
| Nested calendar picker | `tests/e2e/calendar-picker.spec.ts`; row/depth/shade rules in `tests/unit/calendarPicker.test.ts` |
| Settings and preferences | `tests/e2e/settings.spec.ts`, `tests/e2e/preferences.spec.ts`, `tests/e2e/view-preference.spec.ts`, `tests/integration/settings-api.test.ts`, `tests/integration/preferences-api.test.ts` |
| Quick create | `tests/e2e/quick-create.spec.ts`; default ranges in `tests/unit/quick-create-defaults.test.ts` |
| Event details and repeat summary | `tests/e2e/details.spec.ts`, `tests/e2e/repeat.spec.ts`; formatting in `tests/unit/format.test.ts` and `tests/unit/recurrence-label.test.ts` |
| Repeat editor (interval, weekdays, monthly patterns, ends) | `tests/unit/recurrence-rule.test.ts`, `tests/unit/event-payload.test.ts`, `tests/e2e/repeat.spec.ts`; expansion of the written rules in `tests/unit/recurrence.test.ts` |
| Event dialog date/time fields | `tests/e2e/event-fields.spec.ts`; the slot grid and typed-time parser in `tests/unit/timeSlots.test.ts` |
| Mobile layout and sheets | `tests/e2e/mobile.spec.ts`; the phone default view in `tests/e2e/view-preference.spec.ts` and `tests/unit/view.test.ts` |
| Design tokens and theme | `tests/e2e/design-tokens.spec.ts`; palette maths and contrast in `tests/unit/palette.test.ts` |
| Auth and session | `tests/e2e/auth.spec.ts`; the two-account cap and hashing in `tests/integration/auth.test.ts` |
| App shell, rail and breadcrumbs | `tests/e2e/shell.spec.ts`; gated roadmap rail in `tests/e2e/roadmap-nav.spec.ts` |
| Roadmap promises and gated destinations | `tests/e2e/roadmap-nav.spec.ts`; version parity and one-promised-version rule in `tests/unit/roadmap.test.ts` |
| Sidebar tree and calendar management | `tests/e2e/sidebar.spec.ts`; nested-picker rendering in `tests/e2e/calendar-picker.spec.ts`; fold-state rules in `tests/unit/treeFold.test.ts` |
| FullCalendar Canvas styles | `tests/e2e/calendar-style.spec.ts`; the primitives' geometry in `tests/e2e/primitives.spec.ts` |
| UI primitives (button, dialog, scrim) | `tests/e2e/primitives.spec.ts` |
| Screenshots and fonts | `tests/e2e/screenshot.spec.ts` (with `CAPTURE_SCREENSHOTS=1`); the Lato assertion in `tests/e2e/design-tokens.spec.ts` |
| Event CRUD, drag and occurrence deletion | `tests/e2e/events.spec.ts`; service-level rules in `tests/integration/events.test.ts` |
| Recurrence expansion (RRULE, EXDATE, duration, DST wall-clock) | `tests/unit/recurrence.test.ts`; the stored-EXDATE side in `tests/integration/events.test.ts` |
| Google Calendar import | `tests/unit/ics-parse.test.ts`, `tests/integration/import-service.test.ts`, `tests/integration/import-api.test.ts`, `tests/integration/import-schema.test.ts`, `tests/e2e/import.spec.ts` |
| View-only permissions | `tests/unit/permissions.test.ts`, `tests/integration/events.test.ts`, `tests/integration/regressions.test.ts`, `tests/e2e/viewonly.spec.ts` |
| Schema, foreign keys and tenancy | `tests/integration/db.test.ts`; the cross-household 404s in `tests/integration/collections-api.test.ts` and `events-api.test.ts` |
| Event payload building | `tests/unit/event-payload.test.ts`; the occurrence mapping in `tests/unit/toFcEvent.test.ts` |
| Icon contract | `tests/unit/icons.test.ts` |
| Production environment validation | `tests/unit/env.test.ts`; the 503 in `app/api/health/route.ts` |
| CSRF / same-origin writes | `tests/unit/route-origin.test.ts`; the foreign-Origin refusal documented in `COMPONENTS/api-layer.md` |
| Month-relative E2E dates | `currentMonthLabel()`/`dayMonthLabel()` in `tests/e2e/helpers.ts`; `tests/e2e/view-preference.spec.ts`, `tests/e2e/details.spec.ts`, `tests/e2e/import.spec.ts` derive the month instead of hardcoding it. CI pins `TZ=Asia/Taipei` for the Node runner too (`.github/workflows/ci.yml`). |

## Focused verification

```bash
npm run lint && npm run typecheck
npm test
```
