# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **File a task under a list or a calendar in place** — the List cell on every
  `/tasks` row and board card (and the task panel's list chip) is now an inline
  **LIST** picker. It lists every writable collection — the same calendars,
  sub-calendars, lists and sub-lists the sidebar shows, sub-collections labelled
  `Parent / Child` — marks the task's current one, and moves the task with the
  usual `Task moved` toast and targeted undo. A task may be filed under a
  calendar (the subject its events use) without becoming an event: it is always
  a task row and never draws on the calendar grid. The former "Tasks live in
  lists." server rule is retired.

- **Filter tasks by calendar or sub-calendar** — the toolbar's Filter menu now
  groups the sidebar tree into **Calendar** and **List**. Picking a calendar
  includes its sub-calendars' tasks; picking a sub-calendar narrows to that one;
  the choice lives in `?list=<id>` so a filtered view is shareable, and Clear
  filters resets it.

### Removed

- **Task chips on the calendar** — a dated task no longer draws on the month,
  week or list grid at all: the grid shows events only. Tasks keep their due
  date in the row/card/panel pickers, and dragging a task row onto the sidebar
  mini month (or a day cell) still sets its due date. The `?task=<id>` deep link
  remains for shareable links.

## [0.2.0] - 2026-10-26

### Added — tasks and triage

- **Capture from any screen** — `Shift+K` opens a global capture dialog on every
  signed-in page. A title is enough: the task lands in your private Inbox, and
  the `Task captured` toast can undo it without leaving the calendar.
- **The `/tasks` workspace** — Inbox · Today · Week · Someday buckets with live
  counts, a Plan picker that sends a task to a day or to Someday, and a task
  editor with notes, an optional due date and a checklist.
- **Keyboard triage** — `j`/`k` move the selection, `1`/`2` schedule it for Today
  or the end of the week, `3` clears its dates (and files an already-undated
  Inbox task into a list, so it leaves the Inbox for Someday), `4` moves it to
  the next writable list, `x` completes it, `Enter` opens it, and `z`/`Ctrl+Z`
  undo the last action. The single-key layer is page-scoped, stays inert while
  you type, and respects the keyboard-shortcuts preference.
- **Task chips on the calendar** — a scheduled task draws as a read-only
  all-day chip in Month, Week, Day and List; clicking it opens
  `/tasks?task=<id>` with the editor, and dragging a row onto the sidebar mini
  month plans it onto that day with a targeted undo.
- **Lists and privacy** — task lists live in the same nested tree as calendars
  (a list glyph replaces the hue swatch) and can be private, shared or
  view-only. A private list and its tasks never appear in the partner's tree or
  API, and each person's Inbox is created lazily by `GET /api/collections`.

### Added — collections and privacy

- **`collection` replaces `calendar`** — one table now holds calendars and task
  lists (`kind: "calendar" | "list"`), events point at `collection_id`, and the
  sidebar tree, pickers, visibility pills and calendar dialogs all work on the
  mixed tree. Sub-calendars still mirror their root's owner.
- **Three-state visibility** — `visibility` (`shared` / `view_only` / `private`)
  replaces the `is_view_only_for_partner` flag. Private collections are filtered
  server-side on every read and write, not just in the sidebar.
- **Migration `0006`** — renames in place (`calendar` -> `collection`,
  `event.calendar_id` -> `collection_id`), adds `kind`/`visibility`, backfills
  the old flag, and creates `task` + `task_checklist_item`. It runs after main's
  `0005_sloppy_praxagora` (the recurring-scope exception columns), which this
  release also ships and leaves untouched.

### Added — recurring event edit scopes

- **Google's three scopes** — a repeating event can now be changed as **This
  event**, **This and following events** or **All events** from a drag, a resize,
  the Edit form or Delete. "This event" moves just that occurrence into an
  ordinary linked exception (`recurrence_parent_id` self-FK plus
  `recurrence_id`, migration `0005_sloppy_praxagora`) and excludes the original
  slot; "this and following" splits the series and re-links later exceptions to
  the new segment; "all events" shifts the series start, rule and EXDATEs and
  carries its exceptions with it, returning the relink data every undo needs.
- **DST-safe series moves** — the series maths are wall-clock based (whole days
  plus minutes, never a raw millisecond offset), so moving a London 09:00 series
  across a DST boundary keeps 09:00, and its undo restores the same wall clock.
- This shipped on `main` (PR #10) after this branch forked; it is part of the
  integrated v0.2.0 release, not a local-only change.

### Changed

- **The API moved with the model** — `/api/calendars` is now
  `/api/collections`; handlers, query hooks and types are collection-shaped
  (`CollectionRow`, `useCollections`) with no `calendar` alias left in the
  TypeScript layer.
- **The roadmap flipped** — Tasks is `live` and no longer gated; Today is the
  one promised destination, now reading `Coming in v0.3.0`.
- **Version 0.2.0** — `package.json`, `package-lock.json` and `APP_VERSION`
  (`lib/roadmap.ts`) move together; the unit suite keeps them in lockstep.
- **Mixed-tree copy** — the sidebar landmark is "Collection tree", the phone
  sheet "Collections", and the New menu creates lists alongside calendars.

### Fixed

- **Imported calendars are separated by person** — a new Google import creates
  its `From Google` tree under the person who ran it instead of the shared
  ("Ours") group, and never reuses the partner's import tree. Hiding "Ours" no
  longer hides person 2's imported events; mapping to an existing shared
  calendar still gives a shared import. A `From Google` tree imported before
  this change stays shared until it is re-imported (events move idempotently) or
  its owner is changed in the calendar dialog.
- **Sub-calendars follow their parent's owner** — re-owning a top-level calendar
  now writes the new owner to its sub-calendars in the same transaction, and
  setting a sub-calendar's owner directly is rejected. Visibility folds the root
  owner, so a sub-calendar under a person's calendar no longer hides with the
  "Ours" pill. Migration `0004` backfills rows left behind by the old
  non-cascading owner move.

### Upgrade note

- Migrations `0005_sloppy_praxagora` and `0006_collections_and_tasks` apply
  automatically the first time the app opens the database (`migrate()` already
  runs on boot); there is no manual step. `0005` (main's recurring-scope columns)
  runs first; `0006` renames rows and ids in place, so no calendar or event data
  is recreated.
- **Reset a pre-merge dev/staging database.** While this branch was in review it
  carried the collection migration as `0005_collections_and_tasks`. The merged
  journal gives that slot to main's `0005_sloppy_praxagora` and moves the
  collection migration to `0006`, so a database that already applied the
  pre-merge migration no longer matches it: Drizzle records each migration's
  `when` timestamp, and the next boot therefore replays `0005` and tries to run
  the `0006` rename again against an already-renamed schema, where it fails and
  rolls back on every retry. Delete the dev/staging database file (or
  `DATABASE_URL`) and reseed/re-provision. Production never ran the pre-merge
  branch migration, so no production action is required.
- Any client calling `/api/calendars*` must switch to `/api/collections*`; the
  old route no longer exists.
- Visibility and sidebar-fold state saved by v0.1.0 stored a `calendars` map
  that the new parsers deliberately ignore. It resets to the defaults
  (everything visible, everything expanded) and is rewritten on the next toggle.

## [0.1.0] - 2026-10-22

### Added — roadmap rail

- **The roadmap lives in the rail** — Calendar is live; Tasks, Today, Notes and
  Focus sit greyed beside it. Each opens a short "what's coming" dialog with what
  it will do and which release it belongs to, instead of linking to a dead
  route; hovering still names the promise. Only the next release is ever
  committed to a version — everything after it reads `Planned` — and the rail
  itself never scrolls or carries version text.
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

[0.2.0]: https://github.com/andrewhmir/nailong-planner/releases/tag/v0.2.0
[0.1.0]: https://github.com/andrewhmir/nailong-planner/releases/tag/v0.1.0
