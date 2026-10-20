# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-21

First public release.

### Added

- Two-person household calendar on Next.js 16 (App Router), React 19 and
  Tailwind CSS 4, wearing a Canvas-LMS-inspired shell: dark global rail,
  breadcrumb bar and course-style calendar panel.
- Nested calendar hierarchy: root calendars own a hue family, sub-calendars take
  a new shade of it, so "School" reads as one family while "Math" and "Biology"
  stay distinguishable.
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

### Fixed

- The page no longer scrolls: the shell is pinned to the viewport (`h-dvh`), so
  the rail and breadcrumb bar stay put, and the calendar fills the remaining
  height (`height="100%"` + `expandRows`). The whole month is visible at once on
  desktop, tablet, and phone sizes; week/day/list views scroll inside the
  calendar panel.
- Phones now open on the month grid instead of a taller agenda that had to
  overflow the viewport.
- Dialogs are capped to the viewport (`90dvh`) and scroll internally.
- Neutral, non-partner-centric copy for shared and view-only calendars.

[Unreleased]: https://github.com/andrewhmir/nailong-planner/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/andrewhmir/nailong-planner/releases/tag/v0.1.0
