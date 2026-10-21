# Domain libraries

Framework-free rules that everything else builds on: the OKLCH colour ramp behind calendar
shading, RRULE/EXDATE expansion, the all-day-vs-timed time contract, and the env/error/class-name
primitives. Read it when a colour looks wrong, an occurrence is missing or duplicated, a date
shifts by a day, or an API error carries the wrong code or status.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, update its section and run `npm run docs:check`.

| File | Role |
|---|---|
| lib/color/palette.ts | Ten OKLCH hue families x eight shades; the single source of calendar colour |
| lib/recurrence/expand.ts | Turns one stored event row into concrete occurrences for a window, applying EXDATEs |
| lib/recurrence/label.ts | Human summary of an RFC 5545 repeat rule |
| lib/time/format.ts | Every human-facing time/date string in the app |
| lib/time/zone.ts | Wall-clock/locale-date <-> UTC instant conversion; the all-day contract |
| lib/env.ts | Zod-validated `process.env`, parsed once at import |
| lib/errors.ts | `AppError` and the five error codes services throw |
| lib/utils.ts | `cn()` — clsx plus Tailwind conflict resolution |

## Colour and shade inheritance

### lib/color/palette.ts

**Purpose** — Defines every calendar colour. Each of ten hue families has one OKLCH hue+chroma pair and steps through a fixed eight-value lightness ramp, so all shades of a family share a perceptual hue.

**Public API**
- `HUE_FAMILIES: readonly ["teal","green","lime","amber","orange","rose","violet","indigo","sky","slate"]`, `type HueFamily`.
- `SHADE_COUNT = 8`; `PARENT_SHADE_INDEX = 3`; `CHILD_SHADE_ORDER = [4, 2, 5, 1, 6, 0, 7] as const`; `MAX_CHILDREN = CHILD_SHADE_ORDER.length` (7).
- `interface ShadeTokens { main: string; mainHex: string; container: string; containerHex: string; onContainer: string }`.
- `shadeTokens(family: HueFamily, shadeIndex: number): ShadeTokens` — throws `RangeError` when `shadeIndex` is not an integer in `0..7`.
- `isHueFamily(value: string): value is HueFamily`.

**The eight-shade family rule** — `MAIN_LIGHTNESS` is one shared ramp `[0.86, 0.79, 0.72, 0.65, 0.58, 0.51, 0.44, 0.37]`; a family contributes only `{hue, chroma}` from the private `FAMILIES` table. So `shadeTokens("amber", 3)` and `shadeTokens("sky", 3)` differ in hue/chroma but share the same lightness, and no two shades of one family collide. `shadeIndex` is a *slot on that ramp*, not an ordinal: a parent renders at slot 3 (lightness 0.65, the most saturated-looking mid step) and its children claim slots in `CHILD_SHADE_ORDER` order — `4, 2, 5, 1, 6, 0, 7` — deliberately alternating lighter/darker so siblings stay distinguishable and never reuse the parent's slot 3. That is also why seven children is the hard maximum while eight shades exist.

**Derived values** — `container` = same hue, chroma x 0.55, lightness `clamp(main + 0.17, 0.70, 0.97)` (rounded to 2dp), so event fills are pale enough for ink text. `mainHex`/`containerHex` are the same colours converted by the private `oklchToHex` (OKLCH -> linear sRGB -> gamma -> hex, channels clamped) because FullCalendar's colour parser only understands sRGB; the `oklch()` strings are for CSS. `onContainer` is `#273540` when container lightness is >= 0.62 and `#ffffff` below — with the 0.70 floor the white branch is currently unreachable.

**State & side effects** — None. Pure functions over module-level constant tables; no caching, no I/O.

**Depends on / Used by** — No imports. Consumers: `lib/services/calendars.ts` (assigns the next free `CHILD_SHADE_ORDER` slot on create, enforces `MAX_CHILDREN`, and `resolveShade` for a row), `lib/services/events.ts` (`toView` attaches tokens to each event; `shadeTokens("slate", 3)` fallback), `lib/query/events.ts`, `lib/validation/calendars.ts` (`z.enum(HUE_FAMILIES)`), `components/sidebar/CalendarDialog.tsx`, `CalendarRow.tsx`, `CalendarTree.tsx`, `components/calendar/CalendarShell.tsx`, `lib/ui/calendarPicker.ts`.

**Debugging**
- Two sub-calendars of one family look identical -> two rows stored the same `shadeIndex` (or a row is a root, so it always renders slot 3) -> check `calendar.shade_index` for the parent's children and the assignment in `createCalendar`.
- A grid block renders FullCalendar blue instead of the family colour -> an `oklch()` string was handed to FullCalendar instead of the hex twin -> grep the caller's `backgroundColor`/`borderColor` for `main` vs `mainHex`.
- `RangeError: shadeIndex must be an integer between 0 and 7` -> a child row was inserted with slot 3 or an out-of-range value -> check the insert in `lib/services/calendars.ts` and any migration seed.

**Tests** — `tests/unit/palette.test.ts`; `tests/unit/calendarPicker.test.ts` asserts swatch hexes for parent and child rows.

## Recurrence

### lib/recurrence/expand.ts

**Purpose** — Expands one stored `event` row into the concrete occurrences that fall inside a visible window, anchored to the series' own start (`DTSTART`) rather than to page-load time, in the series' own wall-clock timezone, and drops the instances listed in `exdates`.

**Public API**
- `interface Occurrence { eventId: string; startKey: string; startAt: number | null; endAt: number | null; startDate: string | null; endDate: string | null }` — `startKey` is the stable identity the UI passes around as `occurrenceStart`: the local `YYYY-MM-DD` for all-day events, the ISO instant for timed ones.
- `interface OccurrenceRange { from: number; to: number }` — UTC epoch ms bounds.
- `expandOccurrences(event: EventRow, range: OccurrenceRange, timezone: string): Occurrence[]`.

**How the window is expanded**
- No `event.rrule` (or a rule `rrulestr` cannot parse — `safeRule` swallows the throw) returns a single `plainOccurrence`. A stored EXDATE is *not* applied on that path, and a corrupt rule renders one block instead of none.
- The rule is built as `DTSTART:<stamp>\nRRULE:<rule>`, where `<stamp>` is `YYYYMMDDTHHMMSSZ` from `event.startAt` for timed events and `YYYYMMDDT000000Z` from `event.startDate` for all-day events. Occurrences are then filtered to `>= event.startAt` / `>= event.startDate`, so a rule whose `BY*` parts precede the series start cannot leak earlier dates.
- **Timed**: the series zone is `event.tzid ?? timezone` (household zone). Expansion happens in **floating wall time**: the stored start becomes a floating `YYYYMMDDTHHMMSSZ` stamp, `rule.between` runs over the window's floating bounds (widened backwards by one event length so an occurrence that starts before the window but still overlaps it is returned), and every hit is converted back to a real instant in the series zone. That keeps a London 09:00 series at 09:00 after the March change instead of drifting to 10:00. Duration is `max(0, (endAt ?? startAt) - startAt)`; `between` is inclusive on both ends. An occurrence inside the spring-forward gap is shifted forward an hour (RFC 5545 §3.3.5) instead of being dropped.
- **All-day**: duration is `daysInclusive(startDate, endDate ?? startDate)` (end is inclusive). The window is padded by one day on each side and occurrences are bucketed by their **UTC** date (`utcDateOf`), because the all-day rule's `DTSTART` is a UTC-midnight surrogate. Each hit becomes `{ startDate, endDate: addDaysToDate(startDate, durationDays - 1) }`, so a 3-day all-day series keeps its 3-day span at every occurrence.
- **EXDATEs** are applied after generation, never by the rrule library. `event.exdates` is JSON text; `parseExdates` returns two sets: `dates` for entries shaped `YYYY-MM-DD` and `instants` for entries shaped `YYYY-MM-DDTHH:MM` (converted with `localWallTimeToUtc(entry, event.tzid ?? timezone)`) or anything else `Date.parse` accepts. Malformed JSON, a non-array, and non-string entries are silently ignored. Timed events consult `instants` only; all-day events consult `dates` only and call `parseExdates(event, "UTC")`, so a wall-time EXDATE on an all-day series is interpreted as UTC.

**State & side effects** — None. No caching, no clock reads, no storage.

**Depends on / Used by** — `rrulestr` from `rrule`; `EventRow` from `lib/db/schema`; `addDaysToDate`, `localWallTimeToUtc` and `utcToLocalWallTime` from `lib/time/zone`. Called by `components/calendar/CalendarShell.tsx` (one pass over the visible events), `components/sidebar/SidebarMiniMonth.tsx`, and `lib/query/search.ts` (fixed two-year window to find the next occurrence).

**Debugging**
- A weekly series shows only its first block -> the stored `rrule` failed `safeRule` (for example a rule without `FREQ=`) and the fallback is a single plain occurrence -> inspect `event.rrule` and `safeRule`.
- An imported series shifts by an hour after a DST change -> `event.tzid` is null (so it expanded in the household zone) or the expansion is UTC-anchored -> check the row's `tzid` and the floating expansion in `expandTimed`.
- An occurrence is missing at the edge of the visible range -> the window is too narrow; timed events are widened by their duration, all-day by only one day -> check `effectiveRange` in `CalendarShell` and the `OccurrenceRange` handed in.
- A skipped occurrence still renders, or an unskipped one vanishes -> EXDATE shape mismatch: a date for a timed event (or vice versa), or a wall-time string resolved against the wrong zone -> dump `event.exdates` and step through `parseExdates`.

**Tests** — `tests/unit/recurrence.test.ts`.

### lib/recurrence/label.ts

**Purpose** — Translates the stored Google-style repeat rule into one human line for the details card (`spec D9`). It must never throw, so anything it does not recognise yields `""` or a shortened sentence.

**Public API** — `describeRrule(rrule: string): string`.
- `""` in, `""` out; a rule without `FREQ` or with a frequency outside `DAILY|WEEKLY|MONTHLY|YEARLY` also returns `""`.
- `INTERVAL` defaults to 1; a non-integer or `< 1` returns `""`. Interval 1 gives `Daily|Weekly|Monthly|Yearly`, anything else `Every N days|weeks|months|years`.
- `BYDAY` is only described for two frequencies. `MONTHLY` accepts ordinals via `/^(-?\d)?([A-Z]{2})$/`: `-1` renders "last", `1..5` render first..fifth, so `1MO` -> "Monthly on the first Monday". `WEEKLY` maps codes to full weekday names, so `MO,WE` -> "Weekly on Monday and Wednesday" (`joinList` formats `A, B and C`).
- If *any* `BYDAY` value cannot be described, the weekday clause is dropped silently and the frequency sentence is still returned. `COUNT`, `UNTIL`, `BYMONTHDAY`, `WKST` and unknown keys are ignored.

**State & side effects** — None. Parsing is `split(";")` plus `indexOf("=")`; keys are uppercased, values keep their case.

**Depends on / Used by** — No imports. Called by `components/calendar/EventDetails.tsx` (`repeat = event.rrule ? describeRrule(event.rrule) : ""`).

**Debugging**
- The Repeat row is blank for a rule that clearly repeats -> `FREQ` missing or misspelled; the writer validates with `assertValidRrule` in `lib/services/events.ts`, so check the stored value instead of the editor.
- "Weekly" with no weekday named -> `BYDAY` absent, or one value is not a two-letter code -> check the stored rule text; the all-or-nothing clause is why one bad value hides the rest.
- "Monthly on the …" missing for `BYDAY=MO` -> an unordinaled weekday is valid RFC but not described here -> `describeOrdinalWeekday` returns null.

**Tests** — `tests/unit/recurrence-label.test.ts`.

## Import (Google Calendar)

### lib/import/ics.ts

**Purpose** — Parses a Google Calendar `.ics` export into the normalised event list the importer upserts: one calendar per file (`X-WR-CALNAME`), timed and all-day events, recurrence rules and exclusions, and `RECURRENCE-ID` overrides materialised as standalone rows.

**Public API**
- `interface IcsEvent { calendarName; uid; recurrenceId: string | null; title; description; location; allDay; startAt; endAt; startDate; endDate; tzid: string | null; rrule; exdates: string[]; externalKey; contentHash }` — `recurrenceId` is the date (`YYYY-MM-DD`) or ISO instant the row overrides; `exdates` are ISO instants for timed series and `YYYY-MM-DD` for all-day series.
- `interface IcsWarning { uid; title; reason }`, `interface IcsCalendarSummary { name; events; recurring; overrides; earliest; latest }`, `interface IcsDropped { alarms; attendees; attachments }`, `interface ParsedIcs { calendars; events; warnings; dropped }`.
- `parseIcs(text: string, householdTimezone: string, fallbackCalendarName?): ParsedIcs`.

**State & side effects** — Pure: no I/O, no clock read. It throws `AppError("VALIDATION", "That file is not an iCalendar (.ics) document.")` only when the text is not iCalendar at all; one malformed VEVENT becomes a warning and the rest still import.

**Parsing rules that matter**
- `externalKey = sha256("ics|<uid>|<recurrenceId or empty>")` is the idempotency key; `contentHash` covers the imported fields and decides whether a re-import updates a row.
- `tzid` is the property's `TZID` parameter (ical.js reports the value itself as floating); a `Z` timestamp or `UTC`/`Z` zone is stored as `tzid: null`, and a floating time is resolved in the household zone with `tzid: null`.
- An unknown `TZID` (not accepted by `Intl.DateTimeFormat`) skips the event with a warning — never guess (spec R4). A wall time inside the spring-forward gap is shifted an hour later (RFC 5545 §3.3.5), and one unreadable VEVENT becomes a warning instead of aborting the file.
- All-day `DTEND` is exclusive in iCalendar and becomes an inclusive `endDate`; a missing `DTEND` falls back to `DURATION`, then to a one-day event.
- A `RECURRENCE-ID` VEVENT becomes its own row with `rrule: null`, and its parent series gains that value in `exdates`, so the moved occurrence renders once.
- VALARM / ATTENDEE / ATTACH are counted into `dropped` and not imported.

**Depends on / Used by** — `ical.js` (2.2.1, pinned), `node:crypto`, `AppError`, and `addDaysToDate`/`localWallTimeToUtc`/`utcToLocalDate` from `lib/time/zone`. Called by `lib/services/import.ts` and `tests/unit/ics-parse.test.ts`; fixtures live in `tests/fixtures/ics/`.

**Debugging**
- An imported event lands at the wrong time -> the `TZID` parameter was dropped or the floating time resolved in the wrong zone -> check `resolveTime` and the event's stored `tzid`.
- An all-day import gains a day -> the exclusive `DTEND` was stored as-is -> check the all-day branch in `parseVevent`.
- An event is missing from the preview -> it was skipped with a warning (unknown zone, missing UID/DTSTART) -> read `warnings`.
- Re-import duplicates rows -> `externalKey` changed (UID or `RECURRENCE-ID` read differently) -> compare `externalKey` across two parses.
- Local date-times come back mangled from ical.js (`2026--1-1-...`) -> the raw ICS used jCal separators instead of RFC 5545 compact values (`20261103T090000`); Google exports are correct, hand-written fixtures must be too.

**Tests** — `tests/unit/ics-parse.test.ts` (timed, all-day, recurring, overrides, edge cases), fixtures in `tests/fixtures/ics/`.

## Time and timezone

### lib/time/zone.ts

**Purpose** — The only place that converts between household wall-clock strings, local calendar dates and UTC instants, using `Intl.DateTimeFormat` instead of a date library. It also owns the inclusive all-day range rule.

**Public API**
- `utcToLocalWallTime(utcMs: number, timeZone: string): string` -> `YYYY-MM-DDTHH:MM`.
- `utcToLocalDate(utcMs: number, timeZone: string): string` -> `YYYY-MM-DD`.
- `localWallTimeToUtc(wallTime: string, timeZone: string): number` -> epoch ms. Throws `AppError("VALIDATION", …, 400, { time })` for a string that is not `YYYY-MM-DDTHH:MM` and for a time that does not exist (DST spring-forward gap).
- `toAllDayRange(startDate, endDate): { startDate; endDate }` — validates both as `YYYY-MM-DD` and requires `endDate >= startDate`; both failures are `AppError("VALIDATION", …, 400)`.
- `addDaysToDate(date: string, days: number): string` — whole-day arithmetic in UTC, so DST never affects it; throws `AppError` `VALIDATION`/400 on a malformed date.

**The all-day vs timed contract** — Two shapes never mix.
- **All-day** is a pair of household-local `YYYY-MM-DD` dates with no time and no zone: `startDate` and an **inclusive** `endDate`. A one-day event has `startDate === endDate`; a span is `end - start + 1` days (see `daysInclusive` in `lib/recurrence/expand.ts` and `daysBetween` in `lib/time/format.ts`). Feeding an all-day date into `localWallTimeToUtc`, or treating `endDate` as exclusive, is the classic bug — it shifts or truncates the event by one day.
- **Timed** is a UTC epoch-ms instant pair (`startAt`/`endAt`); every display and every date comparison goes through `utcToLocalWallTime`/`utcToLocalDate` with the household `timezone`. Never compare a `startAt` to a `YYYY-MM-DD` string.

**State & side effects** — None. `partsAt` builds a new `Intl.DateTimeFormat` per call (no cache) with `hourCycle: "h23"`, so `formatToParts` yields `00`–`23` rather than `24` at midnight. `localWallTimeToUtc` runs two offset passes (`naiveUtc - offsetMsAt(...)` twice) then verifies the round trip: gaps throw, an ambiguous hour in an autumn fold silently resolves to whichever instant the passes converge on.

**Depends on / Used by** — `AppError` from `lib/errors`. Consumers: `lib/time/format.ts`, `lib/recurrence/expand.ts`, `lib/validation/events.ts` (`toAllDayRange`), `lib/services/events.ts`, `lib/api/handlers/events.ts`, `components/calendar/CalendarShell.tsx`, `EventDialog.tsx`, `QuickCreatePopover.tsx`, `quickCreateDefaults.ts`, `MiniMonth.tsx`, `toFcEvent.ts`, `components/sidebar/SidebarMiniMonth.tsx`.

**Debugging**
- An evening event lands on the next day in the grid -> an all-day `YYYY-MM-DD` was treated as an instant, or a non-household zone was passed -> check the `allDay === 1` branch at the call site and the `timezone` argument.
- An all-day event renders one day short or one day long -> `endDate` used as an exclusive upper bound (the usual culprit is `toFcEvent`, which adds a day for FullCalendar) -> check `daysInclusive`/`toFcEvent` and the writer in `lib/validation/events.ts`.
- Saving fails with "That time does not exist in this timezone" -> the picked wall time falls in a DST gap -> `localWallTimeToUtc`'s round-trip check; confirm `household.timezone` before changing the code.
- An instant displays an hour off in a DST zone -> something assumed a fixed offset instead of the instant's own -> `offsetMsAt`/`partsAt`.

**Tests** — `tests/unit/time.test.ts`; exercised indirectly by `tests/unit/format.test.ts` and `tests/unit/recurrence.test.ts`.

### lib/time/format.ts

**Purpose** — Formats every time and date a human reads (`spec D2`). 24-hour is the default, 12-hour is a per-user preference, and everything that renders a time must come through here so the two formats cannot drift.

**Public API**
- `formatWallTime(wall: string, format: TimeFormat): string` — takes the **last five characters** of the input, so `"19:00"` and `"2026-10-21T19:00"` both format; `24h` echoes the `HH:MM`, `12h` runs a fixed `en-US`, `timeZone: "UTC"` formatter over a synthetic 2000-01-01 UTC date (no host-zone or DST dependence). Anything not matching `^\d{2}:\d{2}$` comes back untouched.
- `formatInstant(utcMs: number, timezone: string, format: TimeFormat): string` — `formatWallTime(utcToLocalWallTime(...))`.
- `fcEventTimeFormat(format): { hour: "2-digit" | "numeric"; minute: "2-digit"; hour12: boolean }` — FullCalendar's `eventTimeFormat`.
- `formatOccurrenceWhen(event: EventView, occurrenceStart: string, timezone: string, format: TimeFormat): string` — the details-card "when". All-day single day: `All day · 21 Oct`; multi-day: `All day · 21–23 Oct (3 days)`, with the span re-anchored to the occurrence's own start. Timed, same local date: `19:00 – 20:30`; across dates: `21 Oct 19:00 – 22 Oct 20:30`. Unparseable `occurrenceStart` gives `No time`; a missing `startAt`/`endAt` gives just date and start time.
- `occurrenceDate(event, occurrenceStart, timezone): string` — local `YYYY-MM-DD` a search result or breadcrumb should point at.
- `formatOccurrenceHeading(event, occurrenceStart, timezone): string` — `formatWallDate(occurrenceDate(...))`, i.e. `Wed, 21 Oct 2026` for the clicked occurrence (F28), not the series start.
- `formatWallDate(date: string): string` — `2026-10-28` -> `Wed, 28 Oct 2026`; unparseable input is returned unchanged.

**State & side effects** — None. Module-level `Intl.DateTimeFormat` instances (`en-US` for the clock, `en-GB` for month/weekday abbreviations, all pinned to `timeZone: "UTC"`) and two regexes.

**Derived rules** — All day/month/weekday parsing goes through `parseDate` on the string, never `new Date(string)`, so no host-zone drift. A timed occurrence's end is computed as `occurrenceStart + (event.endAt - event.startAt)`; a fixed millisecond duration, so an occurrence crossing a DST boundary shows an end wall time shifted by the offset change relative to the stored end.

**Depends on / Used by** — `EventView` from `lib/services/events`, `TimeFormat` from `lib/services/preferences`, `addDaysToDate`/`utcToLocalDate`/`utcToLocalWallTime` from `./zone`. Used by `components/calendar/EventDetails.tsx`, `CalendarShell.tsx`, `CalendarView.tsx`, `QuickCreatePopover.tsx`, `SearchResultsOverlay.tsx`, `lib/query/search.ts`.

**Debugging**
- 12-hour mode prints `19:00` unchanged -> the caller passed a string whose last five characters are not `HH:MM` (e.g. an ISO instant), so `formatWallTime` bailed out -> check the caller and add `formatInstant` instead.
- A time renders in UTC for a Taipei household -> raw epoch ms reached `formatWallTime` without `utcToLocalWallTime` -> check the caller's use of `formatInstant`.
- A multi-day all-day event shows the wrong length -> the span is recomputed from `event.startDate`/`endDate` and re-anchored to `occurrenceStart` -> check `daysBetween` and whether `occurrenceStart` is the occurrence's own date.

**Tests** — `tests/unit/format.test.ts`.

## Environment, errors and utilities

### lib/env.ts

**Purpose** — Parses `process.env` once, at import time, through a Zod object and exports the typed result. Every module reads configuration from this object rather than from `process.env`.

**Public API** — `env` (the parsed object) and `type Env`. Schema and defaults:
- `NODE_ENV`: `development | test | production`, default `development`.
- `DATABASE_URL`: non-empty string, default `file:./data/planner.db`.
- `BETTER_AUTH_SECRET`: optional string, minimum length 32 (required in production — see below).
- `BETTER_AUTH_URL`: non-empty string, default `http://localhost:3000`.
- `AUTH_RATE_LIMIT`: `on | off`, default `on`; `off` is only for E2E runs where many sign-ins share one loopback IP.
- `TZ`: non-empty string, default `Asia/Taipei`.

**State & side effects** — `safeParse(process.env)` runs at module load. On failure it throws `Error("Invalid environment configuration:\n<path>: <message>" ...)`, joining every issue — so a bad variable fails the build or the first request, not a later code path. Values are validated but never logged.

**Depends on / Used by** — `zod`. Consumers: `lib/auth/server.ts` (`BETTER_AUTH_URL` for `baseURL`, `trustedOrigins` and the `secure` cookie flag; `AUTH_RATE_LIMIT !== "off"` for the limiter; `BETTER_AUTH_SECRET`, with a fixed `test-only-secret-…` fallback only when `NODE_ENV === "test"` and a thrown error otherwise) and `lib/db/index.ts` (`DATABASE_URL`).

**Debugging**
- Startup/build fails with "Invalid environment configuration" -> one variable violated its schema, most often the 32-character minimum on `BETTER_AUTH_SECRET` -> the joined list names the path and the message; fix `.env.local` (the file is required for dev, migrations and provisioning).
- The app boots but the first DB call creates an unexpected file -> `DATABASE_URL` default is a **relative** `file:./data/planner.db`, resolved from the process CWD -> check `resolveDatabasePath` in `lib/db/client.ts`.
- Production throws "BETTER_AUTH_SECRET is required" -> the variable is optional in the schema so it parses, then `resolveSecret()` rejects it -> set it; note `env.TZ` is validated but has no reader in `lib/` or `components/` (the household zone comes from `household.timezone`), so changing it changes nothing at runtime.

**Tests** — No direct test coverage.

### lib/errors.ts

**Purpose** — Defines `AppError`, the single error type services and validators throw. Route wrappers translate it into the API envelope; anything else becomes a 500.

**Public API**
- `type ErrorCode = "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT"`.
- `class AppError extends Error` — `readonly code: ErrorCode`, `readonly status: number`, `readonly fields?: Record<string, string>`; `name` is set to `"AppError"`; constructor `(code, message, status, fields?)`.

**Codes and status mapping** — `status` is passed explicitly at every throw site and is *not* derived from `code`, so the pair can be (and is) mismatched by mistake. In this repo:

| Code | Status used | Throw sites |
|---|---|---|
| `VALIDATION` | 400 | `lib/time/zone.ts`, `lib/validation/events.ts`, `lib/services/events.ts`, `lib/services/calendars.ts`, `lib/services/household.ts`, `lib/api/handlers/*` |
| `UNAUTHENTICATED` | 401 | `lib/api/route.ts` (`viewerFromRequest`) |
| `FORBIDDEN` | 403 | `lib/api/route.ts` (not a household member), `lib/services/calendars.ts` (view-only, ownership) |
| `NOT_FOUND` | 404 | `lib/services/calendars.ts`, `events.ts`, `household.ts` lookups |
| `CONFLICT` | 409 | `lib/services/calendars.ts` only — a parent already has `MAX_CHILDREN` sub-calendars |

**Route-wrapper mapping** — `apiError(error)` in `lib/api/route.ts`: an `AppError` becomes `{ error: { code, message, fields? } }` with `status` (the `fields` key is omitted when absent); anything else is logged as `[api] unhandled error` and returns `{ error: { code: "INTERNAL", message: "Something went wrong." } }` with 500. `INTERNAL` is *not* a member of `ErrorCode` — it exists only in that envelope. The wrappers are `withViewer` (session + db + `apiError`) and `guarded` (`lib/api/handlers/support.ts`, error mapping only). `fieldErrors(zodError)` collapses a `ZodError` into one `VALIDATION`/400 with the first message per `path.join(".")` key (`"form"` when the path is empty); `readJson` throws `VALIDATION`/400 "Send a JSON body.".

**State & side effects** — None; a plain `Error` subclass. Stack traces come from `Error`; there is no serialisation method.

**Depends on / Used by** — No imports. Thrown by `lib/time/zone.ts`, `lib/validation/events.ts`, `lib/services/{calendars,events,household}.ts`, `lib/api/route.ts`, `lib/api/handlers/{support,events}.ts`; consumed by `apiError` and by client form code reading `fields`.

**Debugging**
- The UI shows only "Something went wrong." for a handled failure -> the throw was not an `AppError` (a Drizzle or `TypeError`) -> `apiError` logged `[api] unhandled error`; read the server log for the original.
- Field errors do not highlight the input -> no `fields` object was passed, or the key does not match the form field name -> inspect the `new AppError(...)` call and `fieldErrors`' key derivation.
- The response status does not match the code -> `status` is a free constructor argument -> grep `new AppError(` for the throw and correct the literal.

**Tests** — `code`/`status` are asserted through local `expectAppError` helpers in `tests/integration/calendars.test.ts`, `tests/integration/events.test.ts` and `tests/integration/regressions.test.ts`; no unit test for this file itself.

### lib/utils.ts

**Purpose** — One function, `cn`, that joins conditional class names and lets later Tailwind utilities win over conflicting earlier ones.

**Public API** — `cn(...inputs: ClassValue[]): string`, implemented as `twMerge(clsx(inputs))`. `ClassValue` is re-exported by `clsx` (strings, arrays, objects of `className -> boolean`, `undefined`/`null`/`false`).

**State & side effects** — None. Pure, allocation only.

**Derived rules** — `clsx` flattens and drops falsy values; `twMerge` then removes earlier utilities that a later argument overrides *within the same Tailwind group* (e.g. `px-2` followed by `px-4` keeps `px-4`), so argument order is the precedence order. Non-Tailwind class names pass through untouched, but a class that merely looks like a Tailwind utility can be mistaken for one and dropped.

**Depends on / Used by** — `clsx`, `tailwind-merge`. Used by essentially every styled component: `components/ui/button.tsx`, `dialog.tsx`, `checkbox.tsx`, `dropdown-menu.tsx`, `components/shell/Brand.tsx`, `GlobalNavRail.tsx`, `components/sidebar/CalendarRow.tsx`, `CalendarDialog.tsx`, `components/settings/SettingsForm.tsx`, `CalendarPreferencesCard.tsx`, `components/calendar/Toolbar.tsx`, `MiniMonth.tsx`, `CalendarPicker.tsx`, `SearchResultsOverlay.tsx`.

**Debugging**
- A class you added is missing from the rendered `class` attribute -> `twMerge` treated it as a conflict overridden by a later argument -> move it after, or pass it via `className`.
- A custom/arbitrary class (e.g. a design-token utility) is stripped -> its name collides with a Tailwind group -> `cn` is the wrong tool for it; append it as a plain string.
- Conditional classes vanish -> the condition is `0`/`""` (falsy but also a valid class) -> check the object form in `clsx`.

**Tests** — No direct test coverage.

## Focused verification

```bash
npx vitest run tests/unit/palette.test.ts tests/unit/recurrence.test.ts tests/unit/recurrence-label.test.ts tests/unit/time.test.ts tests/unit/format.test.ts
npm run lint && npm run typecheck
```
