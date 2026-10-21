# Nailong Planner — productivity roadmap (v0.2 → v0.5) — design

- **Status:** Draft for review
- **Date:** 2026-10-21
- **Scope:** product direction, version plan and the gated-navigation mechanism. Each
  version gets its own spec; v0.2 is specified in
  `docs/superpowers/specs/2026-10-21-tasks-v0.2-design.md`.
- **Context:** the app is v0.1.0 (unreleased). It is a two-account, self-hosted,
  two-person planner whose only destinations today are Calendar and Settings
  (`components/shell/GlobalNavRail.tsx`).

## 1. Corrected brief

The first framing — "a shared household planner for two people who live together" —
was wrong. The corrected brief, in the user's words:

> it should still be a personal planner / study app for her and work app for me,
> basically somewhere we can manage tasks. We don't live together.

Therefore:

- **Two mostly-private personal planners on one instance**, plus a shared overlay.
- She uses it for **study**; he uses it for **work**. The planner must feel like
  *my* planner first, not like a couples' app.
- **Same timezone.** Dual-time rendering is not needed.
- The couple layer is a feature of the app (shared collections, "when are we both
  free"), not its premise.
- **Privacy is a first-class concept**, not an afterthought: some collections are
  private to one person.

## 2. Product thesis

Five primitives, one glue:

| Primitive | Means | Pillar |
|---|---|---|
| Calendar | time | shipped (v0.1.0) |
| Tasks | commitments | v0.2.0 |
| Today | the composition — "what now" | v0.3.0 |
| Notes | memory | v0.4.0 |
| Focus | attention | v0.5.0 |

The app is coherent only if there is a home that composes the primitives (Today)
and a way to reach them without navigating (command palette, deferred beyond v0.5).
Without those two, four pillars are four disconnected apps.

The distance layer — **"when are we both free"** — is one widget on Today, not a
pillar. It is the only coordination feature in scope; no presence/call-window chip,
no visit planner, no timezone work (same timezone, confirmed).

## 3. Decisions log

| # | Decision | Chosen |
|---|---|---|
| 1 | Pillars in the first cut | Tasks, Today, Notes, Focus |
| 2 | Gating UX | Version chip + "what's coming" dialog |
| 3 | Release shape | One pillar per minor version |
| 4 | Task/project list placement | Same tree as calendars |
| 5 | Container model | Unified `collection` table (`kind: calendar \| list`) |
| 6 | Visibility states | `shared` / `view_only` / `private` |
| 7 | Default visibility of a new list | Private to creator |
| 8 | Pillar order | Tasks → Today → Notes → Focus |
| 9 | Timezone | Same timezone for both users |
| 10 | Distance feature in scope | "When are we both free" overlap only |

## 4. Version plan

| Version | Pillar | Rail label | Theme |
|---|---|---|---|
| v0.2.0 | Tasks & triage | Tasks | Capture, triage, schedule, complete |
| v0.3.0 | Today | Today | My day, composed; shared strip |
| v0.4.0 | Notes | Notes | Personal notes, daily note, "Us" space |
| v0.5.0 | Focus | Focus | Pomodoro, per-task time, focus blocks |

### 4.1 Version policy

- **Only the next version gets a promise.** `Coming in v0.2.0` is allowed; later
  items render as `Planned`.
- Version strings come from one module (`lib/roadmap.ts`, exported `APP_VERSION`
  plus `ROADMAP`). A release bumps one constant; the rail, dialogs, About and
  changelog read from it. No version literal anywhere else.
- A version's gate opens by flipping `status` on its roadmap entry from `planned`
  to `live` — the rail item, tooltip, dialog and "what's coming" list all follow.
- Slipping scope does not rename a version. If a pillar moves, its roadmap entry's
  `version` field moves with it; the UI text is generated, never hand-written.

### 4.2 Deferred backlog (beyond v0.5, not gated in the rail)

`Planned`-only items live in one roadmap section, no rail slot until scheduled:

- Command palette (`Ctrl/Cmd+K`) — search and create across all entities
- PWA install + push reminders
- Rituals/habits and streaks (weekly call, visit cadence)
- Weekly review screen + insights (focus hours, throughput, time by collection)
- Shared lists with checkboxes (groceries, packing), contacts/places, templates
- Export (markdown / JSON / ICS)

### 4.3 Explicitly out of scope

Each of these is a second product. Recorded so it stops recurring:

- Kanban boards (triage + calendar already cover the need)
- Budget/finance tracking
- Email or message inbox
- Block-based document editor (a Notion clone)
- AI summarisation or generation
- Themes and cosmetic customisation
- Browser extension
- Chat/DMs, read receipts, notification badges meant to create obligation

## 5. Gated navigation

### 5.1 Mechanism

One config module, `lib/roadmap.ts`:

```ts
export type RoadmapStatus = "live" | "planned";

export interface RoadmapEntry {
  id: "calendar" | "tasks" | "today" | "notes" | "focus" | "settings";
  label: string;              // "Tasks"
  href: string;               // "/tasks"
  status: RoadmapStatus;
  version?: `v${number}.${number}.${number}`; // only when promised
  blurb: string;              // one line, rail tooltip + dialog subtitle
  capabilities: string[];     // what's coming, 3–5 bullets, in user language
}
```

`GlobalNavRail`, the phone top bar and (later) the command palette all render from
this array. `AppShell`'s `ROUTE_CRUMBS` gains the same entries so breadcrumbs stay
truthful.

### 5.2 Behaviour of a gated item

- Rendered as an **enabled `<button>`, never a disabled link**. Disabled anchors
  are focusable-but-inert and read as broken; a button that opens a dialog has a
  real accessible action.
- Rail icon keeps the live hover/open treatment at reduced emphasis; below it, a
  small version chip (`v0.2.0`) or the word `Planned`.
- `aria-label` includes the state: `"Tasks — Coming in v0.2.0"`.
- Click opens `ComingSoonDialog` (`aria-haspopup="dialog"`, focus trapped, `Esc`
  closes, focus returns to the rail item): title, `blurb`, capabilities list,
  version line, and a single action — `Got it`. No fake "Notify me" unless and
  until there is a real place to put the interest.
- One "What's coming" overview lists all planned entries; reachable from the
  dialog and the account menu, so the roadmap is discoverable in one place.
- Live items keep the current active-tile treatment and `aria-current="page"`.

### 5.3 Mobile parity

On phones the rail is the dark top bar plus the calendars drawer. Gated entries
appear in the drawer's destination list with the same chip and dialog. `AppShell`
must not grow a second source of destinations — both surfaces map over
`ROADMAP`.

### 5.4 Acceptance for the gating slice (v0.2.0 step 0, bounded)

1. Rail shows Calendar, Tasks, Today, Notes, Focus, Settings; every planned entry
   carries a version chip and opens the dialog.
2. `Esc`, backdrop click and `Got it` all close the dialog; focus returns to the
   item that opened it.
3. Changing `ROADMAP[i].status` to `live` makes the item navigate with no other
   edit.
4. No version literal exists outside `lib/roadmap.ts`.
5. `tests/e2e/shell.spec.ts` covers one gated item end to end; unit test asserts
   `APP_VERSION` matches `package.json`.

## 6. Cross-cutting rules for every version

- **Privacy is enforced server-side.** Queries filter by the requesting user's
  visibility; a private collection is never serialised to the other user, never
  merely hidden in the client. Every new endpoint gets a privacy test.
- **Timezone** stays single-zone until a second zone is confirmed. No silent
  multi-zone plumbing.
- **Docs ship with code** (`AGENTS.md` §3): every new file under `app/`,
  `components/`, `lib/`, `scripts/` needs its `docs/COMPONENTS` section, new
  routes/endpoints go in `app-routes.md`, schema and query keys in `lib-data.md`,
  business rules in `lib-services.md`; `npm run docs:check`, `lint`, `typecheck`
  and `test` gate every version.
- **No second universe.** Anything time-shaped is an event on a collection;
  anything commitment-shaped is a task on a collection; notes attach to either.
  A feature that needs its own storage should be challenged in review.

## 7. Risks

| Risk | Mitigation |
|---|---|
| `calendar` → `collection` migration breaks existing queries/import | One migration, mechanical rename, full unit+integration suite before UI work; import tests already cover calendar shapes |
| Personal-vs-shared ambiguity confuses the tree | Default-private for new lists; `Ours` is an explicit, named collection, not a state to remember |
| Four pillars feel like four apps | Today (v0.3) is scheduled immediately after Tasks and is the acceptance test for coherence |
| Gated rail looks like broken nav | Version chip + dialog + "What's coming" page; only the next version is promised |
| Scope creep from the deferred backlog | It is written down and not gated; adding it requires a new spec |

## 8. Success criteria

- **v0.2.0:** capture a task in under 3 seconds; triage an inbox of ten to zero in
  under a minute; a private list is provably invisible from the partner's session.
- **v0.3.0:** the Today page is the first screen opened on a weekday morning and it
  answers "what now" without touching another pillar.
- **v0.4.0:** a note attaches to an event or task from that item's own UI.
- **v0.5.0:** a focus session can be started from a task and appears on the shared
  calendar as a block — as `Busy`, never with a private title.
