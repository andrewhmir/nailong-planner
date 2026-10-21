# Nailong Planner — Calendar UX Parity & Google Calendar Migration Design

- **Date:** 2026-10-21
- **Status:** Draft for morning review. Nothing has been implemented; no files outside `docs/` change.
- **Versioning:** **nothing has been released yet.** The app is still being built as **v0.1.0, unreleased**. The existing specs/README's "v0.1.0" labels describe the working build, not a shipped release. The implementation plan delivered with this spec is the remaining scope for the **v0.1.0 first release**, not a later version; the release train in §8 starts at v0.1.0 and moves forward from there.
- **Author:** overnight planning session (Lead), autonomous — the owner could not answer questions.
- **Goal:** define the UX work that makes a two-person household living in **Google Calendar** able to move to Nailong Planner without feeling downgraded, and stage it into releasable slices.
- **Consumes:** six parallel audits (Google Calendar UX, best-in-class calendar benchmark, migration/sync feasibility, code-level UX inventory, live Playwright interaction audit, calendar usability/a11y research). Raw reports are in `.playwright/ux-audit/` (gitignored scratch); the claims that matter are summarised here and sourced in Appendix A.
- **Related:** [`2026-10-19-nailong-planner-design.md`](2026-10-19-nailong-planner-design.md) (§6 UX, §15 deferred decisions), [`2026-10-20-canvas-ui-redesign-design.md`](2026-10-20-canvas-ui-redesign-design.md) (visual system, non-goals), `README.md` (out-of-scope list).

---

## 0. Morning brief (five-minute read)

**Diagnosis.** v0.1.0 is a faithful *small* Google Calendar — same calendar model, colour-coded calendars, drag-create, drag-move, week/day/month/list, recurrence — but it is not yet a *daily driver*. Measured against the question "what would make us stop opening Google Calendar?", five things matter and v0.1.0 has none of them:

1. **No reminders.** No notification of any kind exists (no table, no scheduler, no email/push). A calendar without reminders is an address book for time.
2. **No bridge to the calendars we still live in.** No ICS import/export, no subscription to a Google secret iCal feed, no sync. Switching means abandoning history and co-existing calendars.
3. **No search.** Google Calendar's most-used affordance (a search box always visible in the header) has no equivalent; finding "when was the dentist" means paging months.
4. **Capture is slower than Google Calendar.** Clicking or dragging a slot opens the *full* modal dialog every time; Google Calendar opens a one-line quick-create bubble and offers "More options". There is also no undo anywhere: deleting a non-recurring event is a single click, irreversibly.
5. **Navigation is coarser.** No mini-month calendar, no jump-to-date picker, no remembered view, no keyboard shortcuts. Moving two months back costs four clicks; in Google Calendar it is one click on a date.

Secondary but still material: the details popover **shows the series' first occurrence rather than the clicked one** and never shows the location (`F28`, `F6`); it cannot be dismissed with Escape or an outside click; the Delete action is styled like the primary Save and is irreversible (`F5`); overlapping timed events paint over each other instead of sitting side by side (`F29`); the week grid opens at 06:00 with the "now" line off-screen and creates 30-minute events rather than 60 (`F30`); 24-hour time is hard-coded, mobile opens on a cramped month grid that truncates every title ("Kyot…", "M…") whereas Google Calendar's phone default is Schedule, recurring edits only support "all events" (no "this and following"), the repeat dropdown can silently destroy a complex rule, and the phone's create dialog hides Save below the fold (`F26`).

**Recommendation.** Run two tracks, not one:

- **Track A — daily-driver parity** (makes staying pleasant): search, keyboard shortcuts, quick-create popover, richer event popover, undo, mini-month + jump-to-date, per-user view/time preferences, mobile agenda default.
- **Track B — switch kit** (makes leaving possible at all): ICS export → ICS import wizard → read-only ICS subscriptions (the Google Calendar bridge), plus a reminder bridge that keeps alarms working through the transition, then native reminders.

The shortest path to "we don't open Google Calendar any more" is **A first for the habit, then B for the unblock**. A is bounded and immediately useful; B is what actually converts the household from "trying Nailong" to "switched", but it carries the correctness risk (ICS parsing, the series-timezone defect, subscriptions) and is easier to plan once the preference and cache groundwork from A exists. The implementation plan delivered with this spec details the first release (`v0.1.0`: Track A), because it is well-bounded and every task is independently useful; the switch kit is specified to the milestone/task level in §8 and gets its own plan document once you accept this direction.

**Decisions I made for you** (rationale in §6, alternatives in the decision log):

| # | Decision | Chosen |
|---|---|---|
| D1 | What "mirror Google Calendar" means | mirror its *interaction model* and *feature set*, never its visual design — Canvas LMS stays |
| D2 | Where new events are created from | slot click/drag or `Shift+C` → lightweight quick-create bubble; "More options" escalates to the full dialog; `+ Event` and `c` keep opening the full dialog (Google's split) |
| D3 | Destructive actions | undoable toasts (10 s, `z`/`Ctrl+Z`) instead of confirmation dialogs for single events; confirmations stay for calendar deletion and series deletes |
| D4 | Mobile default | agenda/list first on phones (Google Calendar's phone default), month remembered per device |
| D5 | View/time preferences | a new per-user `user_preference` row (server-side), not localStorage, so both devices agree |
| D6 | Reminders end state | native (PWA web push + optional email), but a *bridge* first: Nailong exports an ICS feed; GCal stays installed, subscribed to it, with notifications turned **on for the subscription** (it ignores VALARMs), until native reminders ship |
| D7 | Google sync | **no two-way sync**. Read-only ICS subscription for calendars that stay in GCal; one-time ICS import for history. Revisit only if the bridge proves painful |
| D8 | Recurrence | preserve existing rules; add a real repeat editor and "this and following" before adding per-instance overrides; exceptions table is a later, separate milestone |
| D9 | Search | first-class, household-wide, keyboard-first — not a filter on the current month |
| D10 | Visual scope | no dark mode, year view, tasks, or AI in the first two releases; Canvas tokens and the viewport-fit contract are frozen |

**Open decisions for you** — all with a recommended default so the plan is executable without you: see §10. Nothing in the plan is blocked on them.

**What to read first:** §3.2 (friction inventory) and §5.3 (backlog) for the evidence; §8 for the release train; then the v0.1.0 plan.

---

## 1. Problem, goal and success criteria

### 1.1 The switching test

A household can stop opening Google Calendar when, for two consecutive weeks, none of these requires it:

1. **Completeness** — every event they need to see is in Nailong: history imported, calendars that remain in Google visible read-only.
2. **Reminders** — they are told about events before they happen, on the device they carry.
3. **Capture** — adding an event is not slower or more fiddly than Google Calendar.
4. **Retrieval** — finding a past or future event is not slower than Google Calendar.
5. **Safety** — a mis-drag or mis-delete is recoverable in one action.

v0.1.0 satisfies none of the five (capture is the closest, but the modal-per-click flow is measurably heavier). That is the whole problem this design solves.

### 1.2 Goals of this work

- Close the five switch-test gaps above with the smallest coherent feature set, in an order that lets the household start using Nailong daily *before* the last gap closes.
- Keep Nailong's identity: two people, one household, a nested shade-inheriting calendar hierarchy, Canvas LMS visual language, viewport-fit shell, server-enforced view-only permissions. Do not become a worse Google Calendar by copying its enterprise surface.
- Every new interaction must be reachable by mouse, touch and keyboard, and must degrade to an existing behaviour when the underlying feature is unavailable (e.g. no notification permission, no network).
- Leave the data model and API extensible for the switch kit (external event identity, subscriptions, reminders) so v0.2.0 does not require a rewrite.

### 1.3 Non-goals

- Guest invitations, RSVP, free/busy scheduling, meeting booking links, rooms/resources, out-of-office, working location, organisation-wide availability.
- Two-way Google Calendar API sync, CalDAV *server*, multi-household, public sharing links, more than two accounts.
- Tasks/notes/meals/budgets modules, natural-language AI scheduling, dark mode, PWA offline editing, year view — deferred, tracked in §8.4.
- Replacing the Canvas visual system; changing the shade/hierarchy model; changing the viewport-fit contract.

---

## 2. Method and evidence

The review was done autonomously overnight in four layers. Each claim in §3 carries a `file:line` reference or a live-observation reference; each external claim carries a source in Appendix A.

1. **Code read-through** — all of `components/`, `app/`, `lib/`, `tests/e2e`, plus both existing specs, the README's feature/out-of-scope list, and the Drizzle schema. Produced the capability inventory in §3.1 and the friction list in §3.2.
2. **Live interaction audit** — the seeded test database (two users, ten calendars, four events) driven in Chromium at 1440×900, 1024×768, 768×1024 and 375×812: click-drag create, drag, resize, popovers, dialogs, keyboard-only pass, mobile sheet, recurrence deletion, persistence after reload. Observations marked **[live]** below.
3. **Google Calendar UX research** — official help documentation and recent product-update coverage for web, Android and iOS; the parity reference in §4.1.
4. **Benchmark + migration + usability research** — Apple Calendar, Outlook, Notion Calendar, Fantastical, Vimcal, Amie, Morgen, Proton Calendar, BusyCal and agenda-first apps for patterns worth borrowing (§4.2); RFC 5545 / Google API / Web Push documentation for the migration plan (§8.3); NN/g, WCAG 2.2 and WAI-ARIA guidance for interaction requirements (§5.5, Appendix C).

**Bias note.** The owner's stated preference is "mirror Google Calendar", so this document treats Google Calendar's interaction model as the reference by default. Where a pattern from another product is clearly better *and cheap*, it is proposed explicitly as a deviation (§4.4). Everything else defaults to Google Calendar's behaviour.

---

## 3. Current state — verified audit of Nailong Planner v0.1.0

### 3.1 Capability snapshot

Where "evidence" cites a file, that file is the implementation today; the citation is the reason the claim is true. Details and limitations per area are in §3.2.

| Area | What exists today | Evidence |
|---|---|---|
| Shell | Canvas rail (Calendar/Settings/account), breadcrumb bar, 224px calendar tree, person pills; viewport-locked (no page scroll) | `components/shell/AppShell.tsx`, `GlobalNavRail.tsx`, `BreadcrumbBar.tsx` |
| Views | Month (default), Week, Day, List; custom toolbar; prev/Today/next; title is static h2, not a picker | `components/calendar/Toolbar.tsx`, `CalendarView.tsx` |
| Calendar model | Two-level roots + up to 7 children, hue families with auto shades, per-calendar visibility (localStorage), view-only flag enforced server-side, group pills | `lib/color/palette.ts`, `lib/ui/visibility.ts`, `lib/services/permissions.ts` |
| Calendar CRUD | Create/edit/delete root and child via dialog; owner + view-only settings; no reorder UI, no colour picker beyond hue family | `components/sidebar/CalendarDialog.tsx`, `CalendarTree.tsx`, `lib/services/calendars.ts` |
| Event model | title, description, location, all-day or timed (UTC instants + local dates), RRULE, EXDATE; no reminders, colour, attachments, guests, external ids | `lib/db/schema.ts:67-102`, `lib/validation/events.ts` |
| Event CRUD | Full modal dialog for create/edit; toolbar `+ Event`; click-drag select opens the same dialog; drag-move + resize; toast success/failure | `components/calendar/CalendarShell.tsx:223-258`, `EventDialog.tsx` |
| Event details | Fixed bottom-right card: title, when, description, "Repeats", view-only note; Close/Edit/Delete text buttons; **no location, no calendar name, no repeat summary** | `components/calendar/EventPopover.tsx:26-73` |
| Recurrence | Presets only (none/daily/weekly/monthly/yearly); whole-series edit; delete "this event" (EXDATE) or all; drag of a recurring event is blocked with a toast | `EventDialog.tsx:11-26`, `CalendarShell.tsx:276-356` |
| Feedback | sonner toasts (Canvas flash styling); no undo; no optimistic update; full query invalidation after every mutation | `components/ui/toast.tsx`, `lib/query/events.ts:52-56` |
| Settings | Display name; household name/timezone/week-start; password; TOTP; sessions (via Better Auth). Timezone list is 8 hard-coded zones | `components/settings/SettingsForm.tsx:20-29`, `app/(app)/settings/page.tsx` |
| Time handling | Household IANA timezone; UTC instants for timed events; local dates for all-day; DST-gap validation; 24-hour format hard-coded | `lib/time/zone.ts`, `CalendarView.tsx:119` |
| Responsive | Desktop rail/sidebar; phone dark top bar + bottom-sheet calendar tree; grid fitted to viewport; month view on all device sizes | `AppShell.tsx`, `tests/e2e/mobile.spec.ts`, `viewport-fit.spec.ts` |
| Absent entirely | search, keyboard shortcuts, mini-month/jump-to-date, quick-create, undo, reminders/notifications, ICS import/export, subscriptions/sync, event colour override, duplicate, drag between calendars, week numbers, year view, dark mode, PWA, tasks, natural-language quick add | verified by grep + live audit; see §3.2 |

### 3.2 Friction inventory

Severity is judged by the switching test: **Blocker** = cannot complete the switch; **High** = will use Google Calendar anyway for this; **Medium** = noticeable daily tax; **Low** = polish.

| # | Friction | Severity | Evidence |
|---|---|---|---|
| F1 | No reminders/notifications of any kind — no schema, service, scheduler, email or push | Blocker | No `reminder` table in `lib/db/schema.ts`; no scheduler; README "Out of scope: Reminders and notifications" |
| F2 | No way to bring existing Google calendars in: no ICS import/export, no subscription, no sync | Blocker | README out-of-scope; no such routes in `app/api/`; no iCal dependency in `package.json` |
| F3 | No search of any kind, anywhere; header has no search field | High | No search route/handler; `lib/api/handlers/events.ts` only lists by range |
| F4 | Every create goes through the full modal dialog; Google Calendar's one-line quick-create bubble does not exist. Click-drag also opens the full dialog | High | `CalendarShell.tsx:240-258` calls `setDialog` directly; `EventDialog.tsx` is a 10-field form |
| F5 | No undo; deleting a non-recurring event is immediate and permanent (single Delete click) | High | `CalendarShell.tsx:317-335`; `EventPopover.tsx:60-73`; no undo in `lib/query/events.ts` |
| F6 | Event popover omits location and the owning calendar name; it is a fixed bottom card rather than anchored to the event; no click-outside/Escape dismissal ([live] outside click leaves it open, Escape does not remove it); it has no dialog role and focus is not moved into it | Medium | `EventPopover.tsx:26-73`; live probe `.playwright/ux-audit/` (screens 15–16) |
| F7 | No mini-month calendar; no "jump to date" (the month title is static text); far navigation is repeated prev/next | High | `Toolbar.tsx:29-33` h2 not interactive; no mini calendar component |
| F8 | View does not persist: every reload returns to Month; no default-view setting | Medium | `CalendarShell.tsx:89` `useState("dayGridMonth")`; no preference storage |
| F9 | 24-hour time hard-coded; no 12/24-hour setting, no per-user time format | Medium | `CalendarView.tsx:119` `hour12: false`; dialog `<input type="time">` has no format control |
| F10 | Mobile lands on the month grid; event titles truncate to "Kyot…", "M…"; Google Calendar's phone default is Schedule | High | `CalendarShell.tsx:214-216` comment; [live] phone screenshot `docs/screenshots/calendar-mobile.png` |
| F11 | Recurring edit has no "this event" scope and no "this and following" — only the whole series; dialog warns but cannot do better | High | `EventDialog.tsx:307-311`, `CalendarShell.tsx:321-323` |
| F12 | Repeat control is five presets; cannot author `FREQ=WEEKLY;BYDAY=TU;INTERVAL=2` or an end date; changing the dropdown rewrites a complex rule to a simple one | High | `EventDialog.tsx:13-26, 113-124` |
| F13 | No keyboard shortcuts and no shortcut help; the grid is not keyboard-navigable (cells are `role="cell"` with no tabindex; events are focusable but there is no arrow-key navigation); no skip link; reaching `+ Event` by Tab takes **36 presses**; closing a dialog returns focus to `<body>` | Medium | grep found no `keydown` handlers; [live] keyboard-only pass (screen 26) |
| F14 | No optimistic updates: drag/resize/delete wait for a full refetch before the UI settles | Medium | `lib/query/events.ts:52-56` invalidates all `["events"]` after every mutation |
| F15 | Timezone picker lists only 8 zones; a household in any other zone cannot set its timezone | Low | `SettingsForm.tsx:20-29` |
| F16 | No "schedule"/infinite agenda; List is one calendar month at a time | Low | `CalendarView.tsx` `listMonth` only; `Toolbar.tsx:9-14` |
| F17 | No week numbers, no year view | Low | FullCalendar `weekNumbers` option never set (`CalendarView.tsx:65-121`) |
| F18 | No duplicate event; no "copy to another calendar" | Low | No menu action or API support |
| F19 | No event colour override; every event is the calendar's shade | Low | `EventView` has no colour column (`lib/db/schema.ts:67-102`) |
| F20 | No natural-language quick add ("Lunch Thu 12pm") | Low | no parser/input exists |
| F21 | No PWA install/metadata: no web manifest (`/manifest` 404), no favicon (`/favicon` 404), no service worker, no push capability; phone always opens in a browser tab | Medium | `app/layout.tsx` has no manifest; [live] metadata probe |
| F22 | Day-cell `+N more` behaviour relies on FullCalendar's default popover; no styling/verification | Low | `CalendarView.tsx:107` `dayMaxEventRows={3}`, `moreLinkClick` never set |
| F23 | Week/Day render a full 24-hour axis whose labels are 12-hour ("9am") while event times are 24-hour ("09:00"); the view opens at FullCalendar's default 06:00 rather than near the current time; no `scrollTime`/time-format control | Low | `CalendarView.tsx:104-119`; live probe week/day views (screens 06, 12) |
| F24 | No network-offline state or retry messaging beyond a toast; a failed fetch leaves an empty grid | Low | `app/providers.tsx:13-17` (retry 1), no error UI in `CalendarShell.tsx` |
| F25 | Calendar deletion uses `window.confirm`, not the Canvas dialog component; inconsistent with the rest of the app | Low | `CalendarTree.tsx:133-145` |
| F26 | On a 375×812 phone the full event dialog is 731 px tall with the **Save button below the fold** ([live] `saveVisible: false`); touch drag-select on the grid does not open a create flow (gesture becomes a scroll); toolbar grows to 130 px | High | [live] phone dialog/touch pass (screens 31–33); `components/ui/dialog.tsx` |
| F27 | The event dialog closes on Escape with no unsaved-changes guard ([live]: "escape-unsaved-closed: true", title lost on reopen); a mis-click on the scrim loses a half-typed event | Medium | `CalendarShell.tsx:383`; [live] event dialog semantics |
| F28 | **Details popover shows the series' first occurrence, not the clicked one** ([live]: clicking *Weekly class* on 27 Oct displays `2026-10-15T13:00 → 14:00`), and it renders a raw ISO string. The user cannot confirm which occurrence they are about to edit or delete — the severity of a wrong action is amplified by F11 | High | `EventPopover.tsx:26-33` (uses `event.startAt`/`startDate`, never the occurrence key); [live] recurring popover |
| F29 | **Overlapping timed events render cascaded and clipped** — at 1440 px two overlapping events are 75 px wide, offset 48 px, one painted over the other, titles clipped to "10:00 – 11:3…"; not GCal's readable side-by-side columns and a normal case in a two-person calendar | Medium-high | [live] week overlap (screen 10); `fullcalendar-overrides.css` |
| F30 | **Week/Day grid defaults are coarse:** 24-hour axis opening at 06:00 with the current-time line off-screen, a slot click defaults to 30 minutes (GCal 60), and drags snap to 30 minutes rather than GCal's 15 | Medium | [live] week/day views (screens 06–08, 12); `CalendarView.tsx` |

**Not friction (verify before "fixing").** The viewport-fit contract, the shade hierarchy, the two-person permission model, the Canvas visual language, the custom toolbar (Google Calendar's header is also custom-built), and the localStorage visibility persistence all earn their keep; the design keeps them.

### 3.3 Structural constraints that shape the plan

These are facts about the codebase, not opinions; every task in the plan is written against them.

1. **One container, one SQLite file.** A reminder scheduler can live in-process (`instrumentation.ts` or an interval started once on the server) — but there is no message queue, no cron service and no second process. Notification work must be resilient to restarts and must not double-send (see §8.3).
2. **No email provider.** Password reset is deliberately manual (`docs/OPERATIONS.md`), `.env` has no SMTP variables. Email reminders require new env + a transport dependency; this is *optional* in the switch kit, not the default delivery path.
3. **No user-level settings.** `household` is household-wide; visibility is in localStorage. A user-preference table is unavoidable for view default, time format, and notification defaults (§6 D5).
4. **The event row is the whole event.** No partial fetch-by-id, no ETag/version, no external identity. Search, import idempotency and subscriptions each need new fields or tables (§8.3).
5. **Recurrence is expanded client-side** from RRULE + EXDATE (`lib/recurrence/expand.ts`). "This and following" can be implemented as a series split without an exceptions table; per-instance edits ("only this Tuesday moved to 15:00") cannot — they need a `RECURRENCE-ID`-style exceptions table.
6. **All mutations invalidate the entire `["events"]` query** and refetch; there is no optimistic cache. Undo and quick-create must be built on a proper cache-update layer, not toasts alone.
7. **FullCalendar 7 already supports the mechanics we need** but the app uses only a subset: `dateClick`, `select`, `navLinks`, `navLinkDayClick`, `moreLinkClick`, `weekNumbers`, `slotMinTime`, `scrollTime`, `eventMaxStack`, `eventAllow`, `eventsSet` are all available in the installed version's types (`node_modules/@fullcalendar/react/chunks/ecfc1219.d.ts`) and unused today. Quick-create, mini-month navigation, week numbers and "+N more" polish are therefore UI work, not engine work.
8. **Tests pin the current contract.** `tests/e2e/` asserts accessible names and flows (e.g. `New event`, `Edit`, `Save`, `Delete`, `This event`, `All events`, `/sign in/i`, `Calendars` dialog label, viewport-fit). Any renamed or relocated control must update the spec deliberately, not loosen assertions (same rule as the Canvas spec §11). Task list in the plan accounts for this.
9. **The API contract is small and uniform**: `withViewer` wraps every handler, Zod validates, `AppError` maps to an error envelope; new endpoints must follow `lib/api/handlers/*` + `guarded`/`readJson` conventions.
10. **No WebSocket/SSE.** Two devices converge by invalidate-and-refetch (`staleTime: 10 s`, no focus refetch). "Partner edited this" live signals are out of scope; the plan should not introduce polling without a UX reason.
11. **Series recurrence is anchored in UTC, not local wall time — a latent correctness defect.** `expandTimed` builds `DTSTART` from `utcStamp(event.startAt)` (`lib/recurrence/expand.ts:27-33,122`), but RFC 5545 §3.3.10 defines a recurrence in the local time of `DTSTART`. The existing tests only use Asia/Taipei (no DST), where the two are identical. A throwaway Europe/London probe shows a weekly 09:00 series rendering **10:00 after the March 2026 transition** (evidence: `.playwright/ux-audit/`, DST probe; verify with the same fixture in `tests/unit/recurrence.test.ts`). Invisible today, corrupting the moment a DST-zone calendar is imported; fixed by v0.2.0 S0 (D16).
12. **Live-audit observations worth preserving as facts:** FullCalendar 7 events already render as `role="button" tabindex="0"` (keyboard focus exists today; the gaps are a visible focus ring, an accessible name that includes calendar/time, and arrow-key navigation — grid cells are `role="cell"` with no tabindex, reaching `+ Event` takes 36 Tab presses, and closing a dialog returns focus to `<body>`). The week-view time axis renders 12-hour labels ("9am") while event times render 24-hour ("09:00") — fixed by the time-format preference. Clicking a day cell opens the full 10-field dialog with focus in the title field (the capture gap in F4). The `+N more` link already opens a proper dialog with Escape/Close and returns focus correctly — only its target size and styling need work. On a 375×812 phone the full dialog's Save button sits below the fold, and touch drag on the grid does not create (F26). There is no search input, no mini-month grid, and clicking the toolbar title does nothing.

### 3.4 What works and must survive

- The **viewport-fit contract** (`tests/e2e/viewport-fit.spec.ts`): no page scroll, whole month visible on eight viewports. New toolbars/popovers must not break it — they overlay rather than expand the shell.
- The **nested shade hierarchy** and its tests (`palette`, `toFcEvent`): the strongest original idea in the product; not touched.
- **Server-enforced view-only permissions** and the two-account model: every new mutation (undo, import) goes through the same services.
- **Canvas visual language** and tokens: new components (search results, mini-month, quick-create) must be built from the existing primitives, not a new design language.
- **Accessible names and roles** the e2e suite relies on; the plan updates tests only when an interaction deliberately changes.

---

## 4. Reference analysis — what good calendars do

The reference standard is not "the most features". It is: **Google Calendar's muscle memory, plus the capture speed of a power-user calendar, with all the collaboration machinery removed.** Every product below is judged against that bar for a two-person household.

### 4.1 Google Calendar — the parity target

Google Calendar is the baseline because it is what the household uses today; its interaction grammar is the switching requirement. The parts that a two-person calendar actually uses:

**Layout and navigation**

- A permanent **search field** in the top bar, plus a settings/menu cluster, view switcher, `Today`/previous/next, and a **clickable date-range title** that opens a date picker — the four ways back to "a different time".
- A left panel with: a **mini-month calendar** (today ring, event dots, previous/next month) that jumps the main grid; **My calendars** and **Other calendars** groups with colour checkboxes; a `+ Create` entry point.
- View modes: **Day, Week, Month, Year**, and **Schedule** (an infinite agenda). The web remembers the last-used view per browser; the phone apps open on **Schedule** by default because a month grid is unreadable at phone width.

**Capture**

- Clicking an empty time slot opens a **quick-create bubble** with a title field, the proposed time, the destination calendar, and a `More options` escalation to the full editor. Click-dragging a range does the same with the dragged range. Enter saves.
- The full editor carries title, date/time (with an explicit time-zone field), all-day toggle, repeat (presets plus a **custom recurrence panel**: interval, weekday selection, end after N / on a date), location, description, guests, conferencing, attachments, calendar, visibility, colour, and notification settings.
- A recurring event's edit/delete flow offers **three scopes**: This event · This and following events · All events. A drag of one occurrence asks the same question instead of refusing.

**Inspect and edit**

- Clicking an event opens a **details popover** with title, time, calendar, location (with a map link), description, guests, attachments, notifications, and `Edit` / `Delete` actions plus an overflow menu. Unread is cheap; editing is one more click.
- Drag to move, drag the edge to resize (15-minute snap), drag all-day bars across days; the grid never blocks an overlap.
- Deleting shows an **undo toast**; deletion is recoverable from **Trash for 30 days**; `Ctrl/Cmd+Z` undoes the last edit.

**Retrieve and be reminded**

- Search is a header primitive: type two characters, results arrive instantly as a navigable list, selecting one jumps the grid to that date and opens the event.
- Reminders are per event and per calendar, for timed and all-day events, delivered as mobile push, desktop browser notifications, and email; defaults are configurable per calendar.
- Keyboard shortcuts are a documented set (`c`, `/`, `t`, `j`/`k`, `m`/`w`/`d`, `?` for the sheet, `Esc` to back out), surfaced in a help sheet — the shortcut sheet is the discoverability mechanism, not the shortcut itself.
- Peripheral-but-expected: week numbers, second time zone, world clock, working hours/focus time, out-of-office, Tasks, import `.ics`, subscribe to "Other calendars" via secret iCal URL, export `.ics`, dark mode, print, offline-capable mobile apps.

**What Google Calendar does badly (for this household).** It is clutter: guests, RSVP, meeting rooms, availability polls, working location, "Gemini" prompts, and a settings surface with dozens of irrelevant toggles. It is also a cloud service with an account boundary — the household wants one private shared calendar, not a work scheduling tool. We mirror the *loops* and leave the collaboration machinery out.

**Verified specifics (official Google Help / Workspace Updates, accessed 2026-10-21) and two corrections to assumptions.**

- **Views:** web offers Day, Week, Month, Year, **Schedule**, **4 days** and a configurable custom view; Android adds **3 Day**; iOS has no 3/4-day view. Year and Schedule matter; 3/4-day and custom do not.
- **Default view:** official wording is "the last view you chose becomes your default until you change it"; the mobile apps open to a **list of upcoming events** (Schedule-style). This is the source of D4.
- **Density:** Settings → Appearance → Responsive / Comfortable / Compact, plus 2026 changes that fit a 12–15 h range to large monitors. Recorded as a P2 borrow, not a v0.1.0 feature.
- **Quick create:** clicking an empty slot opens an inline "Add title and time" popover with Save and **More options**; `Shift+C` opens quick create from anywhere; **`c` opens the full editor** (not the bubble); the `Create` button also opens the full editor. The plan was corrected to follow this split.
- **Keyboard (official set):** `c` create · `Shift+C` quick create · `/` search · `t` today · `g` go to date · `j`/`n` next range · `d`/`w`/`m`/`y` and `1`–`5` views · `e` details · `Delete`/`Backspace` delete · `z` undo · `?` shortcut help · `Esc` back; shortcuts are **off until enabled** in Settings. Nailong will enable them by default (open decision O8) and add `k`/`p` as previous-range aliases.
- **Recurring:** preset list includes "Every weekday", and "Custom…" exposes interval, weekday selection, and end never/on date/after N; **series are capped at 730 occurrences**. Edit and delete both ask This event / This and following / All. The three scopes are a data-model requirement (exception table), not just UI.
- **Notifications:** per-calendar defaults for timed and all-day events; per-event multiple reminders, each Notification or Email; browser notifications only while the tab is open; Chrome snooze on the last reminder. Trash/restore exists; **retention is not documented in the Help page** (30 days is commonly reported but UNVERIFIED).
- **Search:** overlay with incremental results, matching name/description/location/guest, with What/Who/Where/calendar/date filters and a **200-event cap**; `/` focuses it. Future work may add filters; v0.1.0 ships text search + date navigation, which is the household-relevant core.
- **Per-event colour:** since 2026-06-17, 24 defaults plus up to 200 custom colours and an RGB picker on web. P2 for Nailong.
- **Time zones:** web supports a secondary/secondary-plus-third time-zone column since 2026-09-25. P2.
- **Correction — drag between calendars is *not* a Google Calendar behaviour.** Moving an event is done by editing its calendar field. Therefore Nailong's lack of drag-between-calendars is **not** a parity gap and is removed from the backlog as a parity item (it remains an optional delight, not a requirement).
- **Correction — no evidence that GCal docks a details panel on the right.** The Help pages do not describe one and the 2026 "large monitor" posts are about grid scaling. The anchored popover is a deliberate choice, not a claim about GCal's layout.
- **Explicitly not parity targets:** guests/RSVP, Google Meet, rooms, "Find a time", working hours/location, appointment schedules, out-of-office auto-decline, per-event busy/free. All Workspace-gated or guest-shaped; no household case.

### 4.2 Other best-in-class calendars — patterns worth borrowing

| Product | Distinctive bet | What is worth taking for Nailong | Cost | Priority |
|---|---|---|---|---|
| **Fantastical** | A text box that understands time; quick entry from anywhere; calendar sets | **Persistent quick add with an editable parse preview** (never parse silently); `⌥`-drag duplicate; 15-minute snap with a modifier for fine placement; selected-event keyboard nudging; templates | M–L | Quick add P1/P2 (v0.4.0); duplicate/nudge P1 |
| **Apple Calendar** | The calendar is an OS service | **Month grid + inline day agenda** on phones so the month is never lost; travel-time alarms; week numbers as a setting; `.ics` subscription; screenshot-to-event capture | S–M | Month/day hybrid P2; ICS subscription v0.2.0; travel time v0.4.0 |
| **Outlook (new)** | The calendar is a module of mail | Working-hours shading of the day grid; `show as` states (busy/free) hatched on the block; a "My Day" rail for loose ends | M | Working-hours shading P2; `show as` P2 |
| **Notion Calendar** | The menu bar is the real app | A **`?` sheet that is searchable and shows live bindings**; a persistent `Next up` glance with countdown; second time-zone ruler | S–M | Shortcut sheet P0 (v0.1.0); "next up" P1; second TZ P2 |
| **Vimcal** | Speed is the feature; time zones are the problem | Keyboard path as the *primary* path; time-zone overlap ribbon; keyword→colour rules | M | Keyword rules P2; keyboard P0 |
| **Morgen** | Planner on top of task sources | Buffers/travel time as simple rules; "proposed ≠ committed" interaction contract; carry-over reminders | M | P1/P2 (after reminders) |
| **Proton Calendar** | Privacy forces minimalism | Conservative defaults (one reminder, simple repeats); "share with exactly one person, two permission levels" is a complete product — corroborates Nailong's model | — | Confirms scope, no build |
| **Amie / Timepage / Structured** | Agenda-first, task-as-block | Agenda scroll on phones; day "heat" density cue; drag a list item into time; "Up next" pinned | S–L | Agenda-first P0 (v0.1.0); heat cue P2; tasks P3 |
| **Command-palette grammar (Linear/Notion/Vimcal)** | One input does everything | `⌘K` palette with actions + records; every command also exists as a visible control; recents first; `>` action scoping | M | Search v0.1.0; palette P2 later (reuses search) |

The benchmark's hard-won lessons that shape this spec:

- **Capture speed is the product.** The median household task is "get `Thu 7pm dentist` out of my head in under five seconds, from whatever view I am on, without a modal".
- **Undo is what makes direct manipulation safe.** Undo and optimistic updates are one project; without them drag/resize feels scary and gets used less.
- **Search is a primitive, not a filter panel.** A calendar without search forces scrolling as a retrieval strategy — the clearest "this is a toy" signal.
- **Recurring events are the household's native data type** (school run, bins, swim class). Refusing to drag them is a dead end users hit weekly.
- **Density beats decoration** inside the grid; the Canvas system belongs in the chrome, not in the cells.
- **Keyboard is a power layer, never a requirement.** Every shortcut has a visible equivalent; single-key shortcuts die while a text field has focus.
- **Mobile is a glance-and-capture device.** Agenda-first; one-tap add; never a thumbnail month grid as the primary surface.

### 4.3 Capability comparison matrix

Legend: ✓ shipped and usable · ◐ partial or awkward · — absent. Cells describe the *household-relevant* state, not the enterprise feature set. Google Calendar and Apple/Outlook rows are the baseline a switcher knows; Fantastical/Notion/Proton illustrate where "best-in-class" sits.

| Capability | Nailong v0.1.0 | Google Cal | Apple Cal | Outlook | Notion Cal | Fantastical | Proton Cal |
|---|---|---|---|---|---|---|---|
| Month / week / day views | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Infinite agenda ("Schedule") | ◐ List is per-month | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ |
| Year / multi-month overview | — | ✓ | ◐ | ✓ | — | ✓ | ◐ |
| Clickable date range → date picker | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mini-month calendar in the sidebar | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Keyboard shortcuts + in-app sheet | — | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ |
| Global search (all dates) | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Quick-create bubble on click/drag | — | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ |
| Natural-language quick add | — | ◐ | ◐ (Siri) | ◐ | — | ✓ | — |
| Drag-create, drag-move, resize | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recurrence: presets | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recurrence: custom rule editor | — | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ |
| Recurrence: this / following / all scopes | ◐ (this-delete, all-edit only) | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ |
| Event details popover (location, calendar) | ◐ (missing both) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Duplicate event | — | ◐ (no first-class duplicate; copy via editor) | ✓ | ✓ | ◐ | ✓ | ◐ |
| Undo + trash/restore | — | ✓ (`z` + toast; trash) | ◐ | ✓ | ◐ | ✓ | ◐ |
| Reminders / notifications of any kind | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Multiple reminders per event | — | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ |
| Colour-coded calendars + visibility | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Per-event colour override | — | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ |
| Read-only calendar subscriptions (ICS) | — | ✓ | ✓ | ✓ | ◐ | ✓ | ◐ |
| ICS import / export | — | ✓ | ✓ | ✓ | — | ◐ | ✓ |
| Two-way sync with Google | — (not planned) | n/a | ✓ | ✓ | ✓ | ✓ | — |
| Mobile agenda-first default | — | ✓ | ✓ | ◐ | ✓ | ✓ | ◐ |
| Installable web app / PWA | — | n/a | n/a | ◐ | ✓ | n/a | ◐ |
| Dark mode | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Density presets (compact/comfortable/responsive) | — | ✓ (web) | — | ◐ | ◐ | ◐ | — |
| Second/third time-zone column | — | ✓ (up to 3) | ◐ | ◐ | ✓ | ✓ | ◐ |
| Week numbers | — | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ |
| Tasks / checklists | — | ✓ | ◐ (Reminders) | ✓ | ✓ | ◐ | — |
| Keyboard-operable grid (ARIA grid) | — | ✓ | ✓ (native) | ✓ | ◐ | ◐ | ◐ |
| Self-hosted, no account/cloud | ✓ | — | — | — | — | — | — |

**Read of the matrix.** Nailong already matches the *calendar engine* row-for-row (views, recurrence presets, drag/resize, colour model). It is behind on exactly four clusters: **find (search, mini-month, date picker)**, **capture (quick-create, duplicate)**, **safety (undo/trash)**, and **time notification (reminders)** — plus one data-flow cluster (**import/subscribe/sync**) that is not a UX feature but gates the switch. That is a much shorter list than the raw feature count suggests, and it is the basis of the roadmap.

### 4.4 What not to copy

Recorded so the plan does not drift into feature maximalism:

- **Guests, RSVP, scheduling assistant, booking links, rooms, availability polls, out-of-office org-wide.** Two people, one household; none of this has a user.
- **Menu-bar/OS-only daily loops.** Notion Calendar's best surface is macOS-only; a web app must not design its core loop around an OS affordance.
- **View-mode proliferation.** Month, week, day, agenda are enough. Fantastical's DayTicker/Quarter/Tear are bug surface forever; a heatmap is a cheaper answer if "how busy was the year" is ever asked.
- **Kitchen-sink grid metadata.** Weather, moon phases, ribbons, badges. The month cell shows title + time, and every optional decoration is off by default.
- **Modal-first everything.** The full editor is the escalation, not the entry point.
- **Notification spam.** One reminder per event by default, quiet hours respected; a household of two does not need a digest of digests.
- **Silent AI/NL mis-parses.** If natural-language quick add ships, the resolved date/time is shown in an editable preview before save (LLMs are measurably bad at date arithmetic — see Appendix A, DateLogicQA).
- **Colour as the only identity channel.** Person/calendar identity always carries text (calendar name in details, accessible names in the grid).

---

## 5. Gap analysis and prioritisation

### 5.1 The three blockers and the two retention gaps

Sorting §3.2's friction list by the switching test (§1.1) produces a very short list of things that actually decide whether the household switches:

| # | Gap | Why it blocks | What closes it | Release |
|---|---|---|---|---|
| B1 | **No reminders of any kind** (F1) | A calendar without alarms is not a calendar; the phone is the safety net for school runs and appointments | Reminder data + editor + delivery; interim ICS-export bridge keeps GCal's alarms firing | v0.2.0 (bridge) → v0.3.0 (native) |
| B2 | **No bridge to existing Google data** (F2) | Switching means abandoning history and any calendar that stays shared elsewhere | ICS import wizard + read-only ICS subscriptions (Google secret addresses) + export | v0.2.0 |
| B3 | **No search** (F3) | Finding a past/future event is a daily task; scrolling months is not retrieval | Header search + results overlay + deep links | v0.1.0 |
| R1 | **Capture is heavier than GCal** (F4) | Every event pays the full-dialog tax; the habit erodes | Quick-create bubble with full dialog behind "More options" | v0.1.0 |
| R2 | **Navigation, details and safety are coarse** (F5–F8, F10, F13, F14, F26, F28–F30) | No mini-month/jump-to-date/shortcuts; details can show the wrong occurrence and hide location; no undo; overlap unreadable; drag snap-back; mobile month is unreadable and hides Save | Mini-month, date picker, shortcuts, undo + optimistic cache, details rebuild, grid polish, agenda default | v0.1.0 |

Everything else in the friction inventory is real but secondary: recurrence scopes (F11–F12) is the largest *remaining* parity gap after these five and is scheduled next; the rest are polish.

### 5.2 Priority model

Each candidate is scored on three factors, then sequenced by dependency and release coherence:

1. **Switching pain** — would the household open Google Calendar anyway without it? (blocker / high / medium / low)
2. **Daily frequency** — how often a two-person household hits the interaction (every session / weekly / monthly / rare)
3. **Effort confidence** — S/M/L with the codebase's real surface (from the code audit: prefs S, search M, details popover M, undo M, mini-month M, import L, notifications L)

Rules used:

- **P0 = blocker or every-session friction with known implementation.** Ships in v0.1.0/v0.2.0.
- **P1 = parity gaps that are hit weekly and have a clear design.** v0.2.0–v0.4.0.
- **P2 = delight/edge features, or features whose design depends on usage data.** v0.4.0+.
- **Skip = enterprise collaboration surface, OS-only loops, view proliferation.**
- A P1 item may ship earlier if it is cheap and unblocks a P0 (e.g. the ICS export feed is S and converts reminders from blocker to inconvenience, so it leads v0.2.0).

### 5.3 Backlog

Effort: S ≤ 1 day, M 2–4 days, L 1–2 weeks (from the code audit, not optimism). "Release" is the proposed home; see §8 for the train.

| # | Item | Evidence | Priority | Release | Effort |
|---|---|---|---|---|---|
| 1 | Per-user preferences (view default, 12/24 h, week numbers, shortcuts, default calendar) | F8/F9; code audit data-model gaps | P0 | v0.1.0 | M |
| 2 | Quick-create bubble on click/drag and `Shift+C`; `+ Event` and `c` keep the full editor | F4; GCal verified | P0 | v0.1.0 | M |
| 3 | Event details popover upgrade: clicked occurrence's time (fix F28), location, calendar, repeat summary, anchored, focus/Escape, duplicate, danger-styled delete | F6/F28 | P0 | v0.1.0 | M |
| 4 | Undo toasts + compensating mutations + optimistic cache + failed-drag revert; `z`/`Ctrl+Z` | F5/F14 | P0 | v0.1.0 | M |
| 5 | Global search endpoint + header field + results overlay + deep links | F3 | P0 | v0.1.0 | M |
| 6 | Keyboard shortcuts + `?` sheet + settings toggle | F13 | P0 | v0.1.0 | S/M |
| 7 | Mini-month + clickable date picker (jump-to-date) | F7 | P0 | v0.1.0 | M |
| 8 | Remembered view + mobile agenda default + FAB + grid polish (scroll-to-now, 15-min snap, 60-min default, readable overlaps, sticky dialog footer, coarse-pointer targets) | F8/F10/F22/F23/F26/F29/F30 | P0 | v0.1.0 | M |
| 9 | ICS export feed (`/api/feed/<token>.ics`) with `VALARM` — the reminder bridge | F1/F2 | P0 | v0.2.0 | S |
| 10 | ICS import wizard: upload → preview → map calendars → dry run → commit → rollback | F2 | P0 | v0.2.0 | M–L |
| 11 | Read-only ICS subscriptions ("Other calendars") with refresh + read-only enforcement | F2 | P0 | v0.2.0 | M |
| 12 | Reminder data model + editor + per-event/per-calendar/per-user defaults (bridge v0.2.0, native delivery v0.3.0) | F1 | P0 | v0.2.0 | M |
| 13 | Recently deleted / 30-day trash + restore (undo for the long tail) | F5; UX research UD-3 | P1 | v0.2.0 | M |
| 14 | Fix RRULE anchoring in UTC: expand timed series in local wall time, add `event.tzid` (prerequisite for import correctness) | §3.3 items 11–12; migration research S0 + DST probe | P0 | v0.2.0 | S |
| 15 | Native notifications: PWA + Web Push + optional email; scheduler + notification log; snooze; per-calendar defaults | F1/F21 | P0 | v0.3.0 | L |
| 16 | Repeat editor: interval, weekday picker, "every weekday", end never/on/after; 730-occurrence cap; preserve rules | F12; GCal verified | P1 | v0.4.0 | M |
| 17 | Recurrence edit scopes: "this event", "this and following" (series split), drag asks instead of blocking; per-instance overrides table | F11; GCal verified | P1 | v0.4.0 | L |
| 18 | Month-grid keyboard model (APG grid, roving tabindex, screen-reader labels for cells/events, keyboard nudge) | F23; a11y research A11Y-2/3 | P1 | v0.4.0 | L |
| 19 | Event colour override (GCal now 24 defaults + custom) | F19; GCal 2026-06 | P2 | v0.5.0 | S |
| 20 | Week numbers | F17 | P2 | v0.1.0 (folded into preferences) | S |
| 21 | Year view via FullCalendar `multimonth` plugin | F17 | P2 | v0.5.0 | S |
| 22 | Natural-language quick add (rule-based, preview-first) | F20; GCal web quick add | P2 | v0.5.0 | L |
| 23 | Templates / saved events | benchmark | P2 | v0.5.0 | S |
| 24 | Duplicate event — **delight, not parity** (GCal has no first-class duplicate) | benchmark | P2 | v0.1.0 (folded into details) | S |
| 25 | "Next up" glance in the shell / phone | benchmark #4 | P1 | v0.5.0 | S |
| 26 | Second/third time-zone column (GCal: up to 3 since 2026-09) + world clock | GCal 2026-09; benchmark #6 | P2 | v0.5.0 | M |
| 27 | Density presets (Responsive / Comfortable / Compact) | GCal 2026 Appearance; code audit | P2 | v0.5.0 | S/M |
| 28 | Right-click context menu on events (Delete, more actions) | GCal verified | P2 | v0.5.0 | S |
| 29 | Dark mode | README out-of-scope | P2 | v0.5.0 | M |
| 30 | Tasks / checklists module | benchmark; GCal Tasks | P2 | v0.5.0 (only if chores demand it) | L |
| 31 | Google API pull / two-way sync | migration research S4/S5 | — | defer / never | XL |
| — | ~~Drag event between calendars~~ | **Removed: not a Google Calendar behaviour** (move = edit the calendar field); not a parity gap | — | optional delight only | — |

### 5.4 Interaction requirements (acceptance level)

These are the requirements the plan's tests are written against. They are lifted from the research with IDs so they can be quoted verbatim.

**Capture and time (DT/QA)**
- Typing is always possible for dates/times; a picker is an optional helper, never the only path.
- End is canonical (`endAt`); duration shortcuts write `endAt`; invalid ranges show an inline error and are never auto-swapped.
- All-day is a mode: toggling hides time inputs; dates round-trip as local `YYYY-MM-DD` and never through UTC midnight.
- 12/24-hour comes from a user preference (default 24 h here), never hard-coded.
- Quick create must show the resolved time before save; a natural-language parse (when it ships) must be an editable preview, never silent.

**Drag (DD)**
- Every drag action has a single-pointer, non-drag alternative (WCAG 2.2 SC 2.5.7): the details popover's `Edit` form is that alternative for move/resize; it must never be removed in favour of drag.
- Commit on drop (pointer-up), allow abort; `+N more` and resize handles are ≥ 24 px (44 px on coarse pointers).
- Touch drag uses long-press (300 ms) and never disables page zoom/scroll.
- A dropped event that the server rejects snaps back and says why.
- Week/day snap is **15 minutes**; a create default is **60 minutes** (GCal); the grid scrolls the current time into view on open.
- Overlapping timed events render as **readable side-by-side columns**, never painted over one another.
- The details surface shows the **clicked occurrence's** local date/time, never the series start, and closes on Escape/outside click with focus returned to the event.

**Keyboard, focus, undo (KS/UD)**
- `?` opens a shortcut sheet; single-key shortcuts can be disabled and are inert in text fields (SC 2.1.4).
- Dialogs trap and restore focus; popovers are dismissible with `Escape` and return focus to the event; toasts announce via `role="status"` and never take focus.
- Single-event delete is immediate + undoable; confirmations are reserved for cascades; undo remains reachable after the toast expires (`z` or `Ctrl/Cmd+Z` in-session; trash in v0.2.0).
- Focus order: rail → breadcrumb/person pills/search → calendar tree → toolbar → grid → overlay.

**Search and mobile (SR/MT/MI)**
- Results update as you type (~150 ms), are keyboard navigable, and activating one moves the calendar and opens the event.
- Empty search state teaches what is searched; no-results echoes the query.
- Phone: agenda default, tap targets ≥ 44 px for primary controls (live audit: person pills are 24 px tall, toolbar buttons 38 px), bottom sheet editor with a **sticky Save/Cancel footer so Save is never below the fold** (live audit: it is), safe-area padding, `+N more` is a named button.
- Reflow works at 320 px / 400% zoom; no page-level horizontal scroll (pinned by tests).

### 5.5 Accessibility and mobile acceptance summary

The full checklist from the research is in **Appendix C**. The five criteria most likely to fail in this codebase, in order:

1. **2.5.7 Dragging Movements** — keep the form path for move/resize (Task 4/5 in the plan).
2. **2.1.4 Character Key Shortcuts** — settings toggle + input suppression (Task 7).
3. **2.4.11 Focus Not Obscured + popover focus return** — details popover (Task 4).
4. **2.5.8 Target Size** — `+N more`, resize handle, row menus, FAB-adjacent controls (Task 9).
5. **4.1.3 Status Messages** — undo toasts, search counts, "moved to…" announcements (Tasks 3/6).

`1.4.1 Use of Color` is already handled by the Canvas redesign (accessible names carry calendar identity; event text always present); `1.4.3 Contrast` is pinned by `tests/unit/palette.test.ts`; `2.3.3` reduced motion is in `app/globals.css`. The plan keeps those tests unchanged.

---

## 6. Decisions

Each decision names what was rejected, so it is a decision and not an omission. Decisions are recorded for the owner to veto in the morning; the plan executes the chosen option.

| # | Decision | Rationale | Rejected alternative |
|---|---|---|---|
| D1 | **Mirror Google Calendar's interaction model and expected feature set; keep Canvas as the visual language.** Where the two conflict, behaviour wins over pixel-copying. | The owner's muscle memory is the product requirement; the Canvas redesign is three days old and explicitly approved. Copying GCal's look would undo it; inventing an interaction model adds switching cost. | (a) Re-skin as Google Calendar — discards the Canvas work and the hierarchy's visual identity. (b) "Do our own UX" — maximal switching cost for a two-person tool. |
| D2 | **Two-step creation, split exactly like Google Calendar: clicking a slot or dragging a range opens a lightweight quick-create bubble with "More options" escalating to the full dialog; `+ Event` and `c` open the full dialog (GCal's `c` behaviour); `Shift+C` opens quick-create from anywhere.** | Google Calendar's capture loop is one line of typing then Enter for the slot path, while `c` is muscle memory for "fill the editor properly". Matching that split avoids relearning and still removes the modal tax from the common case. | Keep modal-only (current); make every entry point quick-create (breaks GCal's `c` habit); create immediately with title only and no time confirmation (too error-prone on the month grid). |
| D3 | **Undo, not confirmation, for single-event destructive actions** (delete, drag-move, resize; series "this event" delete). **Confirmations stay** for: deleting a calendar (cascades), deleting a whole recurring series, and disconnecting a subscription. Undo is reachable from the toast (10 s), **`z`** (Google's shortcut) and `Ctrl/Cmd+Z`, both session-scoped. | Google Calendar users expect delete to be fast and reversible; a confirmation tax is paid on every delete and protects only the rare mistake. Undo protects the same mistake without the tax, and `z` is the shortcut they already know. | Confirmation dialogs everywhere (slow, habituating), soft-delete/trash table (a migration and cleanup job for a 10-second window — staged separately in v0.2.0, D17). |
| D4 | **Mobile default view is the agenda (List), not the month grid.** The month view remains one tap away. Calendar/view choice is remembered per device after the user changes it. | Google Calendar's phone app defaults to Schedule; our month at 375 px truncates every event title ("Kyot…", "M…") and the live audit confirms it. The viewport-fit month remains for check-the-month moments. | Current "month on every device" (documented in `CalendarShell.tsx:214-216`, but the evidence is against it); per-user server default only (would not adapt to the device actually in hand). |
| D5 | **A new per-user preference row (`user_preference`) holds cross-device preferences**: default view, time format (12/24 h), week numbers, keyboard-shortcuts enabled, notification defaults, last-used new-event calendar. Calendar visibility stays in `localStorage` (device-scoped by design). | View behaviour and time format must agree across the two devices a person uses; Google Calendar syncs these. A household-level setting would leak one person's preferences to the other. | Extend `household` (wrong scope), localStorage for everything (phone and laptop disagree, no server-rendered correctness). |
| D6 | **Reminders, two stages.** Stage 1 (switch kit): reminder data model + editor + **ICS export carrying `VALARM`**. Stage 2 (standalone): native delivery via **PWA Web Push**, with **optional email** as fallback. The interim bridge is "keep Google Calendar installed, subscribed to Nailong's ICS feed, with notifications turned on for that subscription" — not "Google will honour the alarms in the file". | Cannot ship reliable notifications overnight, but the household cannot switch without alarms. A feed with per-subscription notifications keeps GCal as the alarm engine for a few weeks without keeping it as the data source. Caveats discovered in research: Google Calendar **ignores `VALARM` inside subscribed calendars** (notifications must be enabled on the subscription itself), and Google refreshes iCal subscriptions on the order of hours, so the bridge is good for 30–60-minute reminders, not 10-minute ones. That is acceptable as a stopgap, not as a destination. | Native-first (delays the switch by the whole push/email build); email-only (needs SMTP config the app does not have, and email is a worse alarm than a phone notification); promising that subscribed VALARMs will fire (they will not); doing nothing (the switch fails). |
| D7 | **No two-way Google Calendar sync in this program.** Read-only ICS subscription for calendars that stay in Google; one-time ICS import for history; ICS export for portability. Revisit only if the bridge proves painful after a month. | Google OAuth + incremental sync + watch channels + conflict resolution is a multi-week subsystem with high correctness risk for two users. A secret iCal URL needs no auth, no consent screen and no token refresh. | Google API one-way/two-way sync, CalDAV client/server, "just keep using both" (fails the switching test). |
| D8 | **Recurrence work is incremental and preserves rules**: rich repeat editor first, then "this and following" via a series split, then (only if used) per-instance overrides via an exceptions table. Never silently rewrite an existing RRULE. | The current dropdown can destroy `FREQ=WEEKLY;BYDAY=TU` (F12); correctness risk is higher than the feature's cost. "This and following" via split needs no schema change. Per-instance overrides need a new table and are the least-used scope. | Big-bang recurrence rework with an exceptions table now (delays everything else); leave as is (a documented blocker for GCal parity). |
| D9 | **Search is a first-class, household-wide, server-side feature** with a permanent header field on desktop, a header icon/overlay on mobile, and `/` as its shortcut. | Google Calendar's search field is its primary retrieval affordance; a month filter is not search. Server-side (SQLite `LIKE` over title/location/description, household-scoped) is enough for two people. | Client-side filtering of the fetched range (misses other months), full-text index (YAGNI at this size). |
| D10 | **Visual scope is frozen for the next two releases**: Canvas tokens, 3/4/6 px radii, Lato, viewport-fit shell, left tree. New surfaces are composed from `components/ui/*`. No dark mode, year view, tasks, or AI scheduling. | The interface just passed a full redesign; adding a second design language while adding features multiplies risk. Dark mode is a token exercise deferred until features settle. | Parallel visual refresh; add dark mode now (doubles every new component's review surface). |
| D11 | **Undo is a compensating mutation, not a hidden trash state.** Undo-delete recreates the event (or removes its exdate); undo-move PATCHes the previous times back; undo-create deletes the created event. Failures surface as a toast ("Couldn't undo — it was changed"). | Keeps the data model honest, needs no background cleanup, and matches GCal's observed behaviour closely enough. | Trash table + purge job; in-memory undo queue that dies on reload. |
| D12 | **Optimistic cache updates live in `lib/query/*`** using TanStack Query `onMutate`/rollback; no new state library. | The mutation layer is 100 lines; the library is already installed; undo and quick-create need the cache to move before the server answers. | Add Zustand/Redux; keep invalidate-all and accept snap-back. |
| D13 | **Dependencies are added only when the feature needs them, pinned exact, and justified here**: `ical.js` (ICS parse/write) in the switch kit; `web-push` (VAPID) in the standalone-notifications release; nothing else. Email transport is optional and config-gated. | Mirrors the existing dependency policy (`package.json` pins exact versions); keeps the Docker image small and supply-chain surface low. | A calendar-library rewrite (Schedule-X etc.), a UI kit, a sync framework. |
| D14 | **The switch kit must not require a Google Cloud project.** The household pastes secret iCal URLs from Google Calendar's settings; nothing OAuth-shaped enters the self-hosted setup. | Keeps self-hosting trivial; avoids consent-screen/quota/token maintenance; works with Apple/Fastmail/Outlook feeds too. | OAuth-only import, which adds a setup manual for every deployment. |
| D15 | **Every UX feature ships with Playwright coverage of the interaction it introduces** (and Vitest for pure logic), and the existing accessible-name contract is preserved or deliberately updated in the same task. | This repo's tests are its regression net; new interactions without tests will rot. The Canvas plan set the same precedent (§14). | Manual QA only; "add tests later". |
| D16 | **Fix the series-timezone defect before any import work.** `expandTimed` anchors RRULE expansion in UTC (`lib/recurrence/expand.ts:27-33,122`); RFC 5545 §3.3.10 defines recurrence in the local time of `DTSTART`. A probe (Europe/London weekly 09:00) renders **10:00 after the March DST change**; the existing tests only use Asia/Taipei, where the defect is invisible. Add `event.tzid` (null = household zone), expand timed series in the event zone's wall clock, and add a DST-crossing regression test. | Importing a Google account with any DST-zone series would silently shift every occurrence by an hour after the transition — the worst kind of migration bug: invisible until it ruins a meeting, and hard to attribute. Fix is small (S) and must lead the switch kit. | Import first and patch later (silent data corruption and lost trust); store a UTC-anchored rule and accept drift (violates RFC and GCal behaviour). |
| D17 | **Undo is staged, not skipped.** v0.1.0 ships a session undo stack (`z` and `Ctrl/Cmd+Z`) + undo toasts + optimistic mutations + a failed-drag revert. A Google-Calendar-style **"Recently deleted"/trash** (retention is commonly reported as 30 days — Google's Help page does not document the number — and trash also satisfies WCAG 2.2 SC 2.2.1 for time-limited undo) ships in v0.2.0 as part of the switch kit, because it needs a tombstone column, filtered queries and a purge path. No destructive action ships with *no* recovery path. | The UX research is explicit that a 3–10-second toast is a timed action and not a sufficient undo mechanism (SC 2.2.1/4.1.3). But the trash table is real schema work that would bloat the interaction-parity release; staging it keeps the household safe in the interim and the migration honest. | Ship no undo until trash exists (unsafe for months); fake trash in memory (lost on reload); 30-day trash in v0.1.0 (delays search/quick-create for a low-frequency path). |

---

## 7. Target UX model

The model is described as the five loops a calendar user actually repeats. Everything in the roadmap serves one of them; if a feature serves none, it does not belong.

### 7.1 Principles

1. **Google Calendar muscle memory, Canvas surface.** Same verb placement and shortcuts as GCal; same visual system as today.
2. **One screen, no page scroll.** The shell contract stays; new surfaces overlay (popovers, dialogs, sheets), never expand the frame.
3. **Capture is one click or `Shift+C` away; retrieval is `/` away.** The slot bubble, the Create editor and the search field are the three controls that decide whether the app feels like a calendar.
4. **Progressive disclosure.** Quick-create bubble → full dialog → advanced fields. Never show 10 fields to someone typing a title; never hide the full editor from someone pressing `c`.
5. **Nothing destructive is unrecoverable.** Undo covers single events (`z`, `Ctrl/Cmd+Z`, toast); confirmations guard cascades.
6. **The partner is never a surprise.** Shared calendars are visible by default; view-only state is legible on rows, events and dialogs.
7. **Keyboard parity, then accessibility parity.** Every new interaction is keyboard-operable with visible focus; drag-only creation gets a keyboard alternative.

### 7.2 Loop 1 — Capture ("I need to add this now")

- Click a time slot or day cell → **quick-create bubble anchored at the click**, containing: title input (autofocused, placeholder "Add title and time"), the proposed time summary ("Tue 21 Oct · 09:00–10:00" or "All day"), the destination calendar (colour dot + name, defaulting to the last calendar used), and three actions: **Save** (also Enter), **More options** (opens the full dialog with everything prefilled), **×** / Escape to dismiss.
- Click-drag a range or an all-day span → same bubble with the dragged range.
- **`+ Event` in the toolbar and `c` anywhere → the full dialog** (Google's behaviour); **`Shift+C` opens the quick-create bubble from anywhere**, anchored at the viewport centre. This split is deliberate (D2).
- Defaults: the next half-hour start when creating "now"; 1-hour duration; the last-used writable calendar; the clicked day for the slot path.
- On save: optimistic insert, toast "Event created", with **Undo** in the toast and in the shared undo stack.
- The full dialog remains the only place for repeat rules, notes, location, all-day/time toggle, calendar change and advanced repeat. "More options" is the bridge.

### 7.3 Loop 2 — Navigate ("I need to see a different time")

- **Toolbar title becomes a date-range button** ("October 2026 ▾") opening a **date picker popover** (mini-month + "Today"), matching GCal's jump-to-date behaviour.
- **Mini-month calendar** at the top of the calendar tree on desktop (above Shared): month grid, today ring, dots for days with visible events, prev/next month chevrons; click or Enter navigates the main grid. The same component is reused inside the toolbar date picker and on mobile inside the calendar sheet.
- **Keyboard (Google's set where it maps):** `t` today; `j`/`n` next range, `k`/`p` previous range (k/p kept as aliases even though the current GCal help no longer documents them); `d`/`w`/`m` day/week/month (List via `l`); `g` opens the date picker; `←`/`→` inside week/day views; all single-key shortcuts are inert while typing and can be disabled via the preference toggle (D5).
- **Remember the last view** per device (D4); the default from preferences applies on first visit only.

### 7.4 Loop 3 — Retrieve ("When was that?")

- **Search field** in the breadcrumb bar on desktop (replaces empty header space between crumb and person pills); a search icon in the phone top bar opening a full-screen search sheet.
- `/` focuses it from anywhere; `Escape` clears/closes; `↑`/`↓` move through results; `Enter` opens the highlighted one.
- **Results overlay** (not a page): grouped by month, each row shows date + title + calendar swatch + time, and matching text is emphasised. Debounced 150 ms, cancels stale requests, shows "Searching…" then "No matches for …".
- Selecting a result: `calendar.gotoDate(date)`, switch to a view that shows it (keep current view), open the event's details popover, and highlight the event block momentarily.
- Server endpoint: `GET /api/events/search?q=…&limit=…`, household-scoped, matches title/location/description, case-insensitive, returns full `EventView` rows (which carry colour), ordered by start (future first, past second, or simple relevance-then-recency — decided in the plan). Recurring series match once (the row), with the next occurrence date shown.

### 7.5 Loop 4 — Inspect and edit ("What is this and change it")

- **Event details popover**, anchored to the event block (desktop) or a bottom sheet (phone), showing in GCal order: colour bar + title → date/time (with 12/24 format and repeat summary) → calendar name with swatch → location (linkified to maps) → description (2–3 lines, expandable) → view-only notice when applicable.
- Actions: **Edit** (pencil, full dialog), **Duplicate** (a cheap borrow from Fantastical; Google Calendar has no first-class duplicate, so this is a delight, not parity), **Delete** (trash, undo toast), **More options** (menu: repeat details, copy fields — phased).
- Keyboard: `Enter` on a focused event opens details; `Escape` closes and returns focus to the event; `e` opens details (GCal's shortcut), `Delete` deletes with undo, `z` undoes the last change.
- Recurring series: details show "Repeats weekly on Tuesday"; edit offers **This event** / **This and following** / **All events** once the scope UI ships (v0.4.0); until then the dialog keeps its current whole-series warning.

### 7.6 Loop 5 — Be reminded ("Don't let me miss it")

- **Stage 1 (bridge).** Reminders are stored on the event (`reminder` rows: minutes before, channel), exported in the ICS feed as `VALARM`, and Google Calendar (or Apple Calendar) subscribed to that feed provides the alarm. A `README`/`OPERATIONS` recipe covers the one-time setup; the app shows a banner "Reminders are delivered through your subscribed calendar until native notifications ship."
- **Stage 2 (native).** PWA install + Web Push: event reminders, all-day reminders ("9:00 on the day"), multiple reminders per event, per-user defaults (e.g. 10 min before timed, 9:00 for all-day), a 5-minute snooze action in the notification, and a fallback email channel if enabled. Delivery is based on a due-reminders query over the next N minutes with a `notification_log` for idempotency; a restart re-computes rather than replays.
- The event editor gains a **Notification** control (GCal-like: "10 minutes before", "Add another", "None") in the switch-kit release.

### 7.7 Layout and chrome changes

- **Breadcrumb bar** gains the search field (desktop ≥1024 px). Person pills stay right-aligned; on narrow desktop the search collapses to an icon.
- **Calendar tree** gains the mini-month above the groups, and an "Other calendars" group below the three person groups for subscriptions (v0.2.0). The existing `New calendar` action stays.
- **Toolbar**: title becomes the date button; view segmented control and `+ Event` keep their positions (GCal puts the view switcher top-right too). A subtle `?` shortcut-help affordance appears at the end of the toolbar on first run, then lives in the account menu.
- **Mobile**: 56 px dark top bar gains a search icon; `+ Event` becomes a floating action button (bottom-right, above safe area) *in addition to* the toolbar button on small screens; the calendar sheet gains the mini-month. Nothing may increase page height — overlays only.

### 7.8 Preferences (Settings additions)

`Settings → Calendar` (new card, per-user):
- Time format: 12-hour / 24-hour (default: 24-hour, matching today).
- Start your week on: follows household (kept in Household settings).
- Default view: Auto (agenda on phones / month on desktop) / Month / Week / Day / List.
- Show week numbers: on/off.
- Keyboard shortcuts: on/off (satisfies WCAG 2.1.4 for single-key shortcuts).
- Default event calendar: the calendar preselect used by quick-create.
- Notifications (when reminders ship): default reminders for timed and all-day events, channel toggles.

### 7.9 Empty, loading, error and offline states

- Empty month: a quiet line "No events this month" + "Rest of the month is clear." (not a blank grid).
- Search: "Searching…", "No matches for 'x'", "Search is one word, then Enter."
- Fetch error: an inline banner in the calendar panel with Retry (not a silent empty grid), respecting the existing toast vocabulary.
- Offline/network failure on mutation: toast with Retry where the mutation is idempotent.
- Skeleton: the calendar panel keeps its size; a subtle shimmer replaces the grid only on first load, never on refetch (no layout jump).

### 7.10 Copy and naming rules

- Use Google Calendar's vocabulary (Event, Calendar, Repeat, All day, This event, This and following events, All events, Today, Month/Week/Day/List) so muscle memory transfers; where Nailong is different (nested calendars, shade families, view-only), the copy explains it in one clause.
- "Schedule" replaces "List" as the label? **No** — keep "List" (existing tests, Canvas tone) and document the equivalence; revisit if the owner prefers GCal's word.
- All new copy is sentence case per the Canvas spec; no exclamation marks; errors say what happened and what to do.

---

## 8. Release roadmap

Five planned releases: the current **v0.1.0** (in development, not shipped) and four follow-ups. Each is independently shippable and leaves the app working; each has an exit criterion tied to the switching test (§1.1). Effort is engineering-days for one developer with agent support, including tests and review — deliberately rounded up, not promised. The sequence is chosen for dependency and for "what reduces dependence on Google Calendar fastest", not for feature count.

### 8.1 `v0.1.0` — Daily-driver parity (Track A) — the first release, in development

**Status:** this is the version currently being worked on; nothing has shipped. The plan below is what takes v0.1.0 from "functionally complete calendar engine" to "ready for the household to live in".
**Theme:** make the app pleasant enough that opening Google Calendar is not the reflex.
**Detailed plan:** [`2026-10-21-ux-parity-v0.1.0.md`](../plans/2026-10-21-ux-parity-v0.1.0.md) — 10 tasks, TDD steps, file map.

**Contents (nine features, one preference table):**

1. Per-user preferences table + Settings → Calendar card (D5): default view, 12/24-hour time, week numbers, shortcut toggle, default event calendar.
2. Time-format support wired through grid, dialog, details and search (F9).
3. Quick-create bubble on slot click/drag and `Shift+C`; `+ Event` and `c` keep opening the full dialog (Google's split), with "More options" escalating the bubble to the dialog (D2, F4).
4. Event details popover rebuild: the clicked occurrence's time (F28), location, calendar name, repeat summary, anchored placement, Escape/outside-click, focus return, danger-styled delete, duplicate (F6).
5. Undo toasts + compensating mutations + optimistic cache + failed-drag revert + `z`/`Ctrl/Cmd+Z` (D3, D11, D12, F5, F14).
6. Global search: header field, `/` shortcut, debounced results overlay, `/api/events/search`, deep links (D9, F3).
7. Keyboard shortcuts + `?` shortcut sheet + settings toggle (F13).
8. Mini-month in the sidebar + clickable date-range picker (jump to date) + `?date=` deep links (F7).
9. Remembered view, mobile agenda-first default, floating create button, **mobile sheet with sticky Save footer**, and grid polish: scroll-to-now, 15-minute snap, 60-minute default, readable overlap columns, styled `+N more`, canvas delete confirmation (D4, F8, F10, F22, F23, F26, F29, F30).

**Exit criteria:** both partners use Nailong for a week; preferences hold across devices; search finds an event from three months ago and opens it in under 5 seconds; deleting or mis-dragging is recoverable; the phone opens to an agenda you can create from in two taps. **~20–25 days.**

### 8.2 `v0.2.0` — Switch kit + series-timezone fix (Track B)

**Theme:** remove the last reasons to keep Google Calendar open as the source of truth, and fix the one correctness defect that would poison an import.
**Order matters within the release:**

0. **Series-timezone fix (S0)** — `event.tzid`, wall-clock recurrence expansion, DST regression test (D16). Must land before the importer touches real data.
1. **ICS export feed** (`GET /api/feed/<token>.ics`): RFC 5545 output with `VTIMEZONE`, `RRULE`, `EXDATE` and, once reminders exist, `VALARM`; revocable token in Settings; "Add this URL to Google Calendar and turn on notifications" recipe. Highest leverage per line of code in the whole programme (D6).
2. **ICS import wizard** (`Settings → Import`): upload Takeout `.zip` or per-calendar `.ics` → parse → **preview** (per-source-calendar counts, date range, recurring counts, overrides materialised, alarms/guests/attachments not imported) → **map calendars** (create children under a new "From Google" root or map to existing) → **dry run diff** → transactional commit → result report → **undo batch**. Idempotent by `sha256(source|UID|RECURRENCE-ID)`; re-import updates instead of duplicating; rollback supported.
3. **Read-only ICS subscriptions** ("Other calendars" group): add by secret iCal URL (Google's per-calendar *Secret address in iCal format*), 30-minute conditional refresh, cached rows, read-only enforcement in UI **and** services, stale/error state, disconnect. No OAuth anywhere (D7, D14).
4. **Reminders, stage 1:** `reminder` table (multiple rows per event from day one, one delivered default), editor control in the event dialog, per-event and per-user defaults, `VALARM` in the export feed, bridge documentation. No native delivery yet.
5. **Recently deleted (30-day trash)**: tombstone/soft-delete, restore from Settings, purge job — completes the undo story for the long tail (D17, UX research UD-3).
6. **Data-model groundwork in one migration:** event `external_source|external_uid|external_recurrence_id|external_key|external_content_hash|tzid`, calendar subscription fields, `import_batch`/`import_change`, `reminder`.

**Exit criteria:** the household's Google history is imported and any calendars that stay in Google are visible read-only; every event they had is visible; their phones still alarm (through the feed + subscription notifications); new events are entered in Nailong; a deliberately deleted event is restorable from Settings; a DST-zone weekly series imported from Google keeps its wall-clock time through the transition. Google Calendar may still be installed, but it is no longer edited. **~25–32 days** (import ~6–9, export feed ~2, subscriptions ~4, reminders stage 1 ~6–8, trash ~4, S0 ~1–2).

### 8.3 `v0.3.0` — Standalone notifications

**Theme:** stop depending on Google Calendar for the alarm.
**Contents:**

1. **PWA**: manifest, icons, service worker, install prompt, cached read-only shell.
2. **Web Push reminders**: VAPID keys, `push_subscription` table, scheduler loop (`instrumentation.ts`, guarded by `SCHEDULER_ENABLED` and never during build/tests), server-side occurrence expansion (reusing the fixed expander), `reminder_schedule` + `notification_log` with claim-then-send idempotency, snooze action, deep link into the event.
3. **Optional email reminders** behind env config (SMTP or transactional provider), disabled by default; the same transport unblocks Better Auth's forgot-password flow (today there is no mailer at all).
4. Native reminder UI: multiple reminders per event, **per-calendar default notifications** (timed and all-day separately, matching Google's model), per-user defaults, all-day reminder time, quiet-hours warning, snooze, permission pre-prompt copy (never on page load; iOS requires home-screen install).
5. **Deployment prerequisite:** public HTTPS for push (Cloudflare Tunnel / Caddy / Tailscale cert). This is a documented operational task, not code — a LAN-only container cannot push.

**Exit criteria:** Google Calendar uninstalled from both phones for two weeks; alarms fire for timed and all-day events; a restart or missed window does not duplicate or double-send; snooze works; iOS users are guided to install the PWA. **~15–20 days.**

### 8.4 `v0.4.0` — Recurrence parity and keyboard/accessibility grid

**Theme:** make repeating events behave like Google Calendar and make the grid operable without a mouse.
**Contents:**

1. **Repeat editor**: interval, weekday picker, "every weekday" preset, monthly patterns, end never/on/after; display "Custom" truthfully; never rewrite an existing rule unless the user edits the repeat; enforce Google's **730-occurrence cap** per series with a clear message.
2. **Edit scopes**: This event · This and following events · All events for edit and delete; dragging a recurring occurrence opens the scope chooser instead of the current dead-end toast; `event_override` table for per-instance edits.
3. **Per-occurrence overrides** applied in `expandOccurrences`, with EXDATE reconciliation when a series' start moves.
4. **Month-grid keyboard model**: APG `grid` with roving tabindex, arrow-key day navigation, Enter to open/create, `PageUp/Down` by month, screen-reader labels ("Tuesday 21 October, 3 events"; "Event 1 of 3: …"), live announcements for keyboard move/resize; keyboard nudge (`Alt+←/→` day, `Alt+↑/↓` time) as the non-drag alternative.
5. Accessibility audit against Appendix C: axe scan in CI, focus-visible on every new surface, 200%/400% zoom reflow, forced-colors pass.

**Exit criteria:** a weekly series edited "this and following" behaves correctly across the boundary; "only this occurrence" edits are reversible; a keyboard-only user can create, open, move, resize and delete an event; 320 px / 400% zoom never scrolls horizontally. **~20–25 days.**

### 8.5 `v0.5.0` — Delight and parity polish (only what usage proves necessary)

Candidate list, each explicitly deferrable and chosen after v0.4.0 by observed friction: **"next up" glance** in the shell/phone; **year view** (FullCalendar `multimonth` plugin is already installed — S); **per-event colour override**; **event-specific timezone** with converted-time chip; **secondary timezone / world clock**; **natural-language quick add** (rule-based, preview-first, never silent); **templates**; **drag event between calendars**; **travel time**; **print/PDF month**; **week-start Sat/Sun/Mon flexibility** (validation is currently `z.union([0,1])`); **dark mode** (extend, don't replace, the pinned design-token tests); **tasks/checklists** only if household chores genuinely outgrow the calendar rows. This is a menu, not a commitment.

### 8.6 Dependency and sequencing notes

- **S0 (series-timezone fix) precedes the importer.** Importing DST-zone series with UTC-anchored expansion corrupts every post-transition occurrence (verified: London weekly 09:00 → 10:00 after the March change). Fix and regression-test first.
- **v0.1.0 preferences and optimistic cache are prerequisites** for reminder defaults and for import progress/report UI.
- **The export feed precedes native notifications** — it converts the reminder gap from a blocker into an inconvenience while v0.3.0 is built properly.
- **Subscriptions reuse the importer's parser and external-identity columns**; add the columns once, in one migration.
- **Reminders require server-side occurrence expansion**; today expansion is browser-only (`CalendarShell.tsx:170`). The fixed expander becomes a shared server/client module in v0.2.0.
- **No release depends on the Google API.** If true sync is ever wanted it is a separate project after v0.5.0, with a published OAuth app, conflict model and watch-channel infrastructure — the research recommendation is defer one-way and never build two-way.
- Each release gets its own writing-plans document when started; this spec is the contract they argue from.

---

## 9. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Scope creep turns the switch into a six-month project; the household keeps using Google Calendar meanwhile | High | High | Two releases only before the switch review; v0.1.0 has nine fixed features; anything new goes to §8.4. The ICS bridge means the switch can happen before native notifications. |
| R2 | FullCalendar resists the custom surfaces (anchored popover, keyboard grid navigation, quick-create on drag) | Medium | High | Prototype the anchored popover and `dateClick`/`select` flows in the first plan task; fall back to a fixed-position popover (current pattern) for details if anchoring fights FC's DOM. No fork of FC. |
| R3 | Undo corrupts data when the partner edited the same event meanwhile | Medium | Medium | Compensating mutations are validated server-side; a 409/write conflict surfaces "Couldn't undo — it was changed since"; last-write-wins is already documented (design spec §2 non-goals). |
| R4 | ICS import mangles timezones, recurrence or all-day dates (silent data corruption) | Medium | High | Dry-run preview before commit; import report; round-trip tests (export → import → compare); use `ical.js` + Temporal; refuse unknown `TZID` with a warning rather than importing a guessed time. |
| R5 | Subscriptions leak or fetch hostile URLs (SSRF, bearer secrets in DB) | Medium | High | Scheme allowlist (`https` only), block private IP ranges via DNS resolution check, cap size and redirects, store feed URLs in the DB (not logs), mask in UI, document that the URL is a secret. |
| R6 | Reminder delivery duplicates or misses after restart/clock change/DST | Medium | High | `notification_log` unique on `(event_id|reminder_id, occurrence_start, channel)`; scheduler computes due set from a window rather than a timer queue; DST unit tests; catch-up window documented. |
| R7 | iOS Web Push limitations surprise the household | High | Medium | Document the install-to-home-screen requirement (iOS 16.4+); email fallback; the ICS bridge remains available as a third channel. |
| R8 | Test-suite churn: every UX change breaks e2e selectors | High | Medium | Each task updates its specs deliberately; the plan preserves accessible names; no assertion loosening (Canvas spec §11 rule). |
| R9 | New global keyboard shortcuts fire while typing in the partner's notes/dialog fields | Medium | Medium | Shortcut layer ignores `input/textarea/select/contenteditable` and modifier combinations; toggle in settings (WCAG 2.1.4); e2e test for typing "c" in the title field. |
| R10 | Search misses recurring events or is painfully slow | Low | Medium | Search the series row once (not expanded occurrences); SQLite `LIKE` with index-friendly prefixes; cap 50; debounce; integration tests with recurring data. |
| R11 | Performance/layout regressions on the 8 viewports the suite pins | Low | Medium | `viewport-fit.spec.ts` runs on every task that touches shell/toolbar; new overlays must not change document scroll height. |
| R12 | The owner disagrees with a decision after reading (e.g. wants GCal-first sync) | Medium | Medium | Decisions are separated from facts in §6; every open decision has a recommended default and a reversal cost noted in §10. |
| R13 | **Import ships before the RRULE timezone fix**, silently shifting every DST-zone series by an hour after a transition | Medium (if sequence is ignored) | High | D16 makes S0 the first task of v0.2.0; a Europe/London weekly regression test is a merge gate; the import dry-run reports series with a non-household `tzid`. |
| R14 | The reminder bridge disappoints because Google ignores `VALARM` in subscribed calendars and refreshes feeds on the order of hours | High | Medium | The bridge copy says "turn on notifications for the subscription" and recommends 30–60-minute reminders; the feed is refreshed every 15 min; native push is the stated destination (v0.3.0). Do not promise 10-minute alarms until then. |
| R15 | Subscription URLs are bearer secrets and user-supplied fetch targets (SSRF, token leakage in logs) | Medium | High | Encrypt at rest with a key derived from `BETTER_AUTH_SECRET`; mask in every API response and never log; allow only `https`, resolve DNS and block private/loopback/link-local ranges, 10 MB cap, 15 s timeout, fixed User-Agent. |
| R16 | Scheduler duplicates or misses reminders after restart, clock change or DST | Medium | High | Unique `(reminder_id, occurrence_key, channel)` in `notification_log`; claim-then-send transaction; catch-up policy (≤15 min late sends, older marks skipped and sends one summary); DST unit tests on the fixed expander. |
| R17 | Web Push unavailable on the household's phones (iOS < 16.4, not installed to Home Screen) or no public HTTPS | Medium | Medium | Detect and explain in Settings; email fallback; the ICS bridge remains available; TLS terminator documented as a deployment prerequisite before promising push. |
| R18 | v0.1.0 slips because nine features are too many for one release | Medium | Medium | The plan is task-grained and each task is independently useful; if time runs out, ship Tasks 1–5 (prefs, time format, undo, details, quick-create) and defer search/mini-month/shortcuts to a v0.1.0.1 without breaking the architecture. |
| R19 | FullCalendar DOM resists anchored popovers or accessible grid semantics | Medium | Medium | Task 4 prototypes the anchored popover first; fall back to a fixed-position card with the same content/focus contract; the grid keyboard model is a v0.4.0 project with its own plan, not a v0.1.0 dependency. |

---

## 10. Open decisions for morning

Everything below has a recommended default; the plan is executable without answers. Reverse them explicitly if you disagree. Reversal cost is engineering effort, not user data (nothing is built yet).

| # | Question | Recommended default | Why | Reversal cost |
|---|---|---|---|---|
| O1 | Do we do Track A (daily-driver parity) first, Track B (switch kit) first, or interleave? | **A first** (`v0.1.0`), then B | A is self-contained and immediately useful; B needs research-level care (ICS parsing, subscriptions) and is easier to plan once the preference/cache groundwork exists. | Deferred switch by ~2 weeks, not data risk. |
| O2 | Do we keep Google Calendar installed read-only during the transition (subscription bridge) or cut over with import only? | **Bridge** | Keeps reminders and any calendars that must stay in Google visible without maintaining two data sources; makes the cut-over reversible. | Cutting earlier is fine; the import-only release is the same work minus one feature. |
| O3 | Reminder end state: PWA Web Push (plus optional email) or email-only? | **Web Push, email optional** | A phone notification is what a calendar reminder is; email is a fallback for people who won't install a PWA. | Email-only removes the PWA work but degrades the reminder experience; net cheaper by ~1 week, worse product. |
| O4 | Default time format: keep 24-hour (current) or switch to 12-hour? | **24-hour** | The household is in Taiwan and the app has always rendered 24-hour; the setting exists for whoever wants 12. | One-line default flip. |
| O5 | Smartphone default view: agenda first (recommended) or month first? | **Agenda** | Matches Google Calendar's phone default and the live evidence that month titles truncate. | One preference default flip. |
| O6 | How much Google history to import: everything or last 12 months? | **Everything** (with a date-range option in the wizard) | Household history is small; old events cost nothing in SQLite and "where did we go in 2023" is a real use. | Range option is in the wizard either way. |
| O7 | Confirm no two-way Google sync in this program. | **No sync; read-only subscription** | See D7. | If you want sync, it is a separate multi-week project after v0.4.0; nothing in this plan blocks it. |
| O8 | Keyboard shortcuts on by default (with a settings toggle) or off by default? | **On** | They are the main capture/retrieval speed-up; the toggle satisfies accessibility and preference. | One default flip; the toggle exists either way. |
| O9 | Should the quick-create bubble appear on a plain single click on a month cell, or only on drag/`+ Event`? | **Yes — single click opens quick-create** | Google Calendar does exactly this; it is the fastest capture path. Risk: accidental clicks create drafts (dismissed with Escape, never persisted until Save). | Restricting to drag/`+ Event` is a small UI change. |
| O10 | Do you consider the List view's label "Schedule" (GCal's word) or keep "List"? | **Keep "List"** | Existing tests, Canvas tone, and "List" is clearer about what it is. | Copy change + test update. |
| O11 | Is the household OK with an in-app banner explaining the reminder bridge until native notifications ship? | **Yes** | Honest about the temporary architecture; dismissible per user. | Banner removal is trivial. |
| O12 | Do both partners adopt Nailong at the same time, or does one pilot it for a week? | **Both start together** | The product is shared-calendar-shaped; one pilot creates two sources of truth. But the plan works either way. | Process decision, not engineering. |

---

## Appendix A — Sources

All URLs accessed 2026-10 unless a publication year is given. Product claims that were search-surfaced but not fully readable are marked *(secondary)*; they are used only where two independent descriptions agree.

**Google Calendar (the parity target)**

- Google Calendar Help — [Create & edit events](https://support.google.com/calendar/answer/37234), [Keyboard shortcuts](https://support.google.com/calendar/answer/37034), [Search your calendar](https://support.google.com/calendar/answer/37129), [Change notifications](https://support.google.com/calendar/answer/37242), [Export events](https://support.google.com/calendar/answer/37111), [Import events](https://support.google.com/calendar/answer/37118), [Sync with computer programs (secret iCal address)](https://support.google.com/calendar/answer/37648), [Restore deleted events](https://support.google.com/calendar/thread/209700393/how-to-restore-deleted-calendar-events?hl=en)
- Google Workspace Updates blog — 2023–2026 product-update posts covering calendar UI changes *(secondary where only headlines were available)*
- Google Calendar API — [Sync guide (`syncToken`)](https://developers.google.com/workspace/calendar/api/guides/sync), [Push notifications](https://developers.google.com/workspace/calendar/api/guides/push), [Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota), [`events.list` reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Choose scopes](https://developers.google.com/workspace/calendar/api/auth)
- Gmail Help — [Keyboard shortcuts](https://support.google.com/mail/answer/6594) (`/`-to-search convention)

**Benchmark products**

- Flexibits — [Fantastical product page](https://flexibits.com/fantastical), [Mac keyboard shortcuts](https://flexibits.com/fantastical/help/keyboard-shortcuts)
- Notion — [Notion Calendar product page](https://www.notion.com/product/calendar), [Notion Calendar keyboard shortcuts](https://www.notion.com/help/notion-calendar-keyboard-shortcuts), [Introducing Notion Calendar (2024)](https://www.notion.com/blog/introducing-notion-calendar)
- Vimcal — [Homepage](https://www.vimcal.com/)
- Morgen — [Homepage](https://www.morgen.so/)
- Microsoft — [Outlook calendar app](https://www.microsoft.com/en-us/microsoft-365/outlook/calendar-app); new Outlook board view *(secondary, 2025)*
- Wikipedia — [Calendar (Apple)](https://en.wikipedia.org/wiki/Calendar_(Apple)) (travel-time/weather, per-event zones), [Proton AG § Proton Calendar](https://en.wikipedia.org/wiki/Proton_AG) (E2E encryption)
- BusyCal — [Quick Entry](https://www.busymac.com/docs/busycal/70605-quick-entry/), [Natural Language on iOS](https://www.busymac.com/docs/busycalios/70669-natural-language/) *(secondary — vendor docs unreachable from the audit sandbox; titles/URLs confirmed by search)*
- Amie — [Tasks & Todos docs](https://amie.so/documentation/features/tasks) *(secondary)*; Timepage/Bonobo Labs and Structured — App Store listings *(secondary)*
- Setapp — [Fantastical vs Apple Calendar (2025)](https://setapp.com/app-reviews/fantastical-vs-apple-calendar)
- The Verge — [iOS 26 screenshot-to-calendar (2025)](https://www.theverge.com/tech/696885/ios-26-visual-intelligence-calendar-screenshot-gemini-assistant) *(secondary)*

**iCalendar, sync and web-push standards**

- IETF — [RFC 5545 iCalendar](https://www.rfc-editor.org/rfc/rfc5545) (§3.1 folding/charset, §3.3.4 DATE, §3.3.5 floating time, §3.3.10 recurrence/UNTIL, §3.6.6 VALARM, §3.8.2.2 DTEND exclusive, §3.8.4.4 RECURRENCE-ID, §3.8.4.7 UID, §3.8.5.1 EXDATE)
- Google Workspace Updates (2023) — [third-party password-based sync winding down](https://workspaceupdates.googleblog.com/2023/09/winding-down-google-sync-and-less-secure-apps-support.html)
- Mozilla Calendar blog (2013) — [Google CalDAV endpoint change](https://blog.mozilla.org/calendar/2013/09/google-is-changing-the-location-url-of-their-caldav-calendars/)
- WebKit (2023) — [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/); (2017) [Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
- web.dev — [Web permissions best practices](https://web.dev/articles/permissions-best-practices) (77% of desktop prompts shown without intent, 12% allowed vs 30% after interaction)

**Usability, accessibility and design systems**

- W3C — [WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/): SC 1.4.1, 1.4.4, 1.4.10, 1.4.13, 2.1.1, 2.1.4, 2.2.1, 2.3.3, 2.4.3, 2.4.11, 2.5.2, 2.5.7, 2.5.8, 3.3.1, 3.3.3, 4.1.2, 4.1.3; [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/): grid, dialog (modal), combobox, listbox
- Nielsen Norman Group — [10 Usability Heuristics (1994, rev. 2020)](https://www.nngroup.com/articles/ten-usability-heuristics/), [Date-Input Form Fields](https://www.nngroup.com/articles/date-input/), [Website Response Times](https://www.nngroup.com/articles/website-response-times/)
- GOV.UK Design System — [Dates](https://design-system.service.gov.uk/patterns/dates/), [Date input](https://design-system.service.gov.uk/components/date-input/), [Validation](https://design-system.service.gov.uk/patterns/validation/), [Error summary](https://design-system.service.gov.uk/components/error-summary/), [Check answers](https://design-system.service.gov.uk/patterns/check-answers/)
- Aza Raskin, *Never Use a Warning When You Mean Undo*, A List Apart (2007) — [alistapart.com/article/neveruseawarning](https://alistapart.com/article/neveruseawarning)
- Apple — [HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Date pickers](https://developer.apple.com/design/human-interface-guidelines/date-pickers); Android — [accessibility guidance (48 dp)](https://developer.android.com/guide/topics/ui/accessibility/apps)
- FullCalendar — [Accessibility](https://fullcalendar.io/docs/accessibility), [Touch support](https://fullcalendar.io/docs/touch), [Event dragging & resizing](https://fullcalendar.io/docs/event-dragging-resizing), [Month view](https://fullcalendar.io/docs/month-view)
- DateLogicQA, *Benchmarking Temporal Biases in LLMs*, arXiv:2412.13377 (2024) — [arxiv.org/abs/2412.13377](https://arxiv.org/abs/2412.13377)

**Repository evidence** — every `file:line` claim in §3 comes from the code audit of this checkout (`audit-code.md`, `.playwright/ux-audit/`, gitignored scratch) and the live Playwright probe at 1440×900/375×812 against the seeded scratch DB. The DST defect was reproduced with a throwaway unit probe (`Europe/London`, weekly 09:00, March 2026: occurrences after 2026-03-29 render 10:00).

## Appendix B — Google Calendar parity checklist

The audit baseline used to build §3 and §4. `v0.1.0` = the current **unreleased** build (nothing has shipped); `Target` = release where the household case is closed. This is the checklist to re-run after each release.

| # | Capability (household-relevant) | v0.1.0 | Target |
|---|---|---|---|
| 1 | Month, week, day views | ✓ | — |
| 2 | Infinite agenda / Schedule | ◐ (per-month List) | v0.5.0 |
| 3 | Year / multi-month view | — | v0.5.0 |
| 4 | Prev / Today / Next | ✓ | — |
| 5 | Clickable date-range title → date picker | — | v0.1.0 |
| 6 | Mini-month in sidebar | — | v0.1.0 |
| 7 | Remembered view per device | — | v0.1.0 |
| 8 | Default view preference | — | v0.1.0 |
| 9 | Keyboard shortcuts + help sheet | — | v0.1.0 |
| 10 | Single-key shortcuts can be disabled | — | v0.1.0 |
| 11 | Click empty slot → quick-create bubble | — | v0.1.0 |
| 12 | Drag a range → create with dragged times | ◐ (opens full dialog) | v0.1.0 |
| 13 | Full editor reachable from quick-create | ✓ | v0.1.0 |
| 14 | Smart default duration / next half-hour | ◐ (09:00–10:00 fixed) | v0.1.0 |
| 15 | Default / last-used calendar | ◐ (first writable) | v0.1.0 |
| 16 | All-day + timed multi-day events | ✓ | — |
| 17 | Per-event timezone | — | v0.5.0 |
| 18 | Duplicate event | — | v0.1.0 |
| 19 | Event details: time, calendar, location (+map), notes | ◐ (no calendar/location) | v0.1.0 |
| 20 | Anchored details popover, Escape, focus return | — | v0.1.0 |
| 21 | Edit / delete from details | ✓ | — |
| 22 | Delete is immediate + undoable | — (immediate, no undo) | v0.1.0 |
| 23 | `Ctrl/Cmd+Z` undo | — | v0.1.0 |
| 24 | 30-day trash / restore | — | v0.2.0 |
| 25 | Recurring: presets | ✓ | — |
| 26 | Recurring: custom rule editor (interval/weekday/end) | — | v0.4.0 |
| 27 | Recurring: "this / this and following / all" | ◐ (delete this, edit all only) | v0.4.0 |
| 28 | Recurring: per-instance overrides | — | v0.4.0 |
| 29 | Drag/resize with 15-min snap and failed-drop revert | ◐ (no revert on error) | v0.1.0 |
| 30 | Search across all dates + keyboard navigation | — | v0.1.0 |
| 31 | Deep link to an event / date | — | v0.1.0 |
| 32 | Reminders: per event, multiple, timed + all-day | — | v0.2.0 (data) / v0.3.0 (delivery) |
| 33 | Reminder defaults per user | — | v0.3.0 |
| 34 | Notifications: push / browser / email | — | v0.3.0 |
| 35 | ICS import (Takeout + per-calendar, idempotent, rollback) | — | v0.2.0 |
| 36 | ICS export / feed with alarms | — | v0.2.0 |
| 37 | Read-only subscriptions ("Other calendars") | — | v0.2.0 |
| 38 | Colour-coded calendars + visibility toggles | ✓ | — |
| 39 | Per-event colour override | — | v0.5.0 |
| 40 | Week numbers | — | v0.1.0 |
| 41 | Second timezone / world clock | — | v0.5.0 |
| 42 | Working-hours shading / show-as state | — | v0.5.0 |
| 43 | Dark mode | — | v0.5.0 |
| 44 | PWA install / offline read | — | v0.3.0 |
| 45 | Mobile agenda-first default + one-tap create | — | v0.1.0 |
| 46 | Month-grid keyboard operability (APG grid) | — | v0.4.0 |
| 47 | Screen-reader labels for cells and events | ◐ (event text only) | v0.4.0 |
| 48 | `+N more` is a named, tappable control | ◐ (FC default) | v0.1.0 |
| 49 | Tasks / checklists | — | v0.5.0 (if demanded) |
| 50 | No guests/RSVP/rooms/booking links (deliberate) | ✓ (absent) | never |

## Appendix C — Accessibility acceptance checklist (to copy into v0.1.0/v0.4.0 tasks)

**Perception & contrast**

- [ ] 1.4.3 Contrast AA — event text on every shade ≥ 4.5:1 (already pinned by `tests/unit/palette.test.ts`); location/time metadata ≥ 4.5:1.
- [ ] 1.4.11 Non-text Contrast AA — focus rings, `now` indicator, drag handles, checkbox borders ≥ 3:1.
- [ ] 1.4.1 Use of Color A — calendar identity always carries a text/accessible name, never hue alone.
- [ ] 1.4.4 Resize Text AA — 200% text zoom with no loss of content.
- [ ] 1.4.10 Reflow AA — 320 CSS px / 400% zoom: agenda layout, no horizontal page scroll.
- [ ] 1.4.13 Content on Hover/Focus AA — popovers are dismissible (Esc), hoverable and persistent.

**Operability**

- [ ] 2.1.1 Keyboard A — create, edit, move, resize, delete, change view, search, toggle calendars, undo — all keyboard-operable.
- [ ] 2.1.2 No Keyboard Trap A — dialogs trap and release; `Esc` closes; focus returns to the invoking control.
- [ ] 2.1.4 Character Key Shortcuts A — settings toggle; inert while typing; `?` and `/` covered.
- [ ] 2.2.1 Timing Adjustable A — undo survives toast expiry (`Ctrl/Cmd+Z` session stack; trash in v0.2.0).
- [ ] 2.4.3 Focus Order A — rail → breadcrumb/search/pills → calendar tree → toolbar → grid → overlay.
- [ ] 2.4.7 Focus Visible AA — including grid event blocks (custom ring on `.fc-event:focus-visible`).
- [ ] 2.4.11 Focus Not Obscured AA — sticky header, toasts, popovers and sheets never fully cover the focused control.
- [ ] 2.5.2 Pointer Cancellation A — act on pointer-up; aborted drags revert.
- [ ] 2.5.7 Dragging Movements AA — move and resize each have a single-pointer, non-drag path (the Edit form).
- [ ] 2.5.8 Target Size AA — 24×24 CSS px minimum; 44 px on coarse pointers; audit `+N more`, resize handle, row menus, pills.

**Understandability & robustness**

- [ ] 1.3.1 Info & Relationships A — month grid exposes grid/row/gridcell + column headers; tree exposes nested list/tree with names.
- [ ] 2.4.6 Headings & Labels AA — the visible month is a programmatic heading; every control has a persistent label.
- [ ] 3.3.1 / 3.3.3 Errors A/AA — specific field-level errors with a suggested fix; never a lone toast for a field problem.
- [ ] 4.1.2 Name, Role, Value A — event blocks expose name + role + state; custom toggles are real buttons/checkboxes.
- [ ] 4.1.3 Status Messages AA — "Event deleted — Undo", "3 results", "Moved to Tuesday" announced via `role="status"` without moving focus.
- [ ] Month cell announces: "Tuesday 21 October, 3 events"; event: "Event 1 of 3: Math quiz, 13:00 to 14:00, School" (v0.4.0).
- [ ] `prefers-reduced-motion` disables view transitions/drop animations; 200%/400% zoom verified; Windows forced-colors pass (v0.4.0).
