# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Imported calendars are separated by person** — a new Google import creates
  its `From Google` tree under the person who ran it instead of the shared
  ("Ours") group, and never reuses the partner's import tree. Hiding "Ours" no
  longer hides person 2's imported events; mapping to an existing shared
  calendar still gives a shared import. A `From Google` tree imported before
  this change stays shared until it is re-imported (events move idempotently) or
  its owner is changed in the calendar dialog.

## [0.1.0] - 2026-10-22

### Added — roadmap rail

- **The roadmap lives in the rail** — Calendar is live; Tasks
  (`Coming in v0.2.0`), Today, Notes and Focus sit greyed beside it. Each opens a
  short "what's coming" dialog with what it will do and which release it belongs
  to, instead of linking to a dead route; hovering still names the promise. Only
  the next release is ever committed to a version — everything after it reads
  `Planned` — and the rail itself never scrolls or carries version text.
- **One source of truth** — `lib/roadmap.ts` holds the destinations, the version
  and the gate labels, so promoting a feature is a single `status` flip and an
  `APP_VERSION` that is test-locked to `package.json`.

### Added — daily-driver parity

- **Anchored event details** — one click opens a popover with the repeat summary,
  a Maps link for the location, clamped notes with "Show more", and
  Edit / Duplicate / Close / Delete actions. Repeating occurrences show the
  clicked occurrence's own date. Focus moves to Edit and returns to the event
  block on close; phones get the same body in a dialog.
- **Google-Calendar-style quick create** — click a day or time slot, drag a
  range, or press `Shift+C`; type a title, pick a calendar, press Enter. "More
  options" carries the draft into the full editor. `+ Event` and `c` still open
  the full editor.
- **Session undo** — deleting, moving/resizing and creating show a 10-second
  `Undo` toast; `z` and `Ctrl/Cmd+Z` undo the last change even after the toast is
  gone, unless you are typing in a text field. A failed drag snaps back.
- **Household-wide search** — `/` focuses a header search over event titles,
  notes and locations with ranked, highlighted results grouped by month. Picking
  a result jumps the grid to the event's date and opens its details, even when
  that month is not loaded.
- **Per-user preferences** — time format (12/24-hour), default view (`Auto`
  resolves to agenda on phones and month on desktop), week numbers, keyboard
  shortcuts toggle, and default event calendar. The Settings → Calendar card
  applies each change immediately and stores it in the database.
- **Keyboard shortcuts** — `c`, `Shift+C`, `/`, `t`, `g`, `j`/`n`, `k`/`p`,
  `d`/`w`/`m`/`l`, `e`, `Delete`/`Backspace`, `z`, `Ctrl/Cmd+Z`, `Esc`, plus a
  `?` shortcut sheet. Single-key shortcuts never fire while typing.
- **Mini-month and jump-to-date** — a neutral-dot mini calendar in the sidebar
  navigates by date, the toolbar title opens a date picker, and `?date=` deep
  links open any month.
- **Remembered view and mobile first run** — the last view per device survives a
  reload; `Auto` lands phones on the agenda with a floating **+ Event** button.
- **Optimistic mutations** — create, edit, move and delete render instantly and
  roll back on a server error.
- **Nested calendar hierarchy** — root calendars own a hue family, sub-calendars
  take a new shade of it, so "School" reads as one family while "Math" and
  "Biology" stay distinguishable.
- **Two-person permissions** — a per-calendar view-only flag enforced
  server-side on every write, with sub-calendars inheriting the protection.
- **Private by design** — sign-up disabled, exactly two accounts provisioned,
  TOTP two-factor available, DB-backed sessions.
- **Google Calendar import** — Settings → Google Calendar import uploads the
  `.ics` files from a Google export, previews per-calendar counts and warnings,
  maps each calendar under a new **From Google** root or an existing one, commits
  in one transaction, and can undo the whole batch. Idempotent by Google UID, so
  a re-import updates in place. Imported series keep their source timezone
  (`event.tzid`) and recurrence expands in local wall time, so a DST transition
  does not shift them. No OAuth and no Google Cloud project.
- **Nailong logo** — the project mark is used for the browser tab icon and the
  home-screen icon.
- **Small footprint** — SQLite in WAL mode, one Docker image, one volume.

### Added — foundation (initial build)

- Two-person household calendar on Next.js 16 (App Router), React 19 and
  Tailwind CSS 4, wearing a Canvas-LMS-inspired shell: dark global rail,
  breadcrumb bar and course-style calendar panel.
- FullCalendar 7 month / week / day / list views with drag-to-create,
  drag-to-move, resize, recurring events (RFC 5545 RRULE + EXDATE) and IANA
  timezone handling.
- Per-calendar visibility filters and a per-calendar view-only flag enforced
  server-side.
- Better Auth 1.7 email + password, sign-up disabled, TOTP two-factor,
  DB-backed sessions; household provisioning keeps it to exactly two accounts.
- SQLite (better-sqlite3, WAL) with Drizzle ORM and committed SQL migrations;
  online gzipped backups.
- Unit/integration suites (Vitest), end-to-end suites (Playwright), and CI
  (lint, typecheck, tests, build, E2E, CodeQL, Dependabot).

### Changed

- Grid polish: 15-minute drag snap, 30-minute slot lines, week/day views open
  around the current time, `+N more` is a real touch target, overlapping events
  sit side by side, and short landscape viewports keep the whole month visible.
- Deleting a calendar asks in a Canvas dialog instead of `window.confirm`.
- Phones now default to the agenda view (`Auto`); the month grid is one tap away.

### Fixed

- The page no longer scrolls: the shell is pinned to the viewport (`h-dvh`), so
  the rail and breadcrumb bar stay put, and the calendar fills the remaining
  height (`height="100%"` + `expandRows`). The whole month is visible at once on
  desktop, tablet, and phone sizes; week/day/list views scroll inside the
  calendar panel.
- Dialogs are capped to the viewport (`90dvh`) and scroll internally.
- Neutral, non-partner-centric copy for shared and view-only calendars.
- Repeating-event details now show the clicked occurrence's date instead of the
  series start.
- A failed drag or resize reverts instead of leaving the block in the wrong
  place.
- Focusing the event dialog's title field no longer shaves the left side off its
  focus ring: the dialog's scroll area clips at its padding box, so it now keeps
  horizontal padding on both sides instead of only under the scrollbar.

[0.1.0]: https://github.com/andrewhmir/nailong-planner/releases/tag/v0.1.0
