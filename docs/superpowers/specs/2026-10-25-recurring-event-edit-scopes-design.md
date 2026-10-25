# Recurring-event edit scopes (Google Calendar parity) — design

**Date:** 2026-10-25
**Status:** approved for planning (three scopes; drag, resize and the Edit dialog)
**Touches:** `lib/db/schema.ts` + migration `0005`, `lib/services/events.ts`,
`lib/api/handlers/events.ts`, `lib/validation/events.ts`, `lib/recurrence/*`,
`lib/query/events.ts`, `components/calendar/{CalendarShell,EventDialog}.tsx`,
tests, and the component docs / `docs/DEBUGGING.md` (per `AGENTS.md`).

## 1. Goal

Copy Google Calendar's handling of repeating events so a household member can
change **one occurrence**, **this and following occurrences**, or **the whole
series** from:

- dragging an occurrence to another day/time (month, week and day grids);
- resizing an occurrence;
- saving the Edit form.

Today `CalendarShell.handleEventMove` reverts every drag on `base.rrule` and toasts
“This event repeats. Edit the series to change its time.”, and `EventDialog` always
PATCHes the series. Deleting already offers “This event” / “All events”; it gains
“This and following events” for parity.

Success is Google's behaviour, not merely “the drag is no longer blocked”: the
original slot must disappear, later occurrences must be untouched (or shifted,
depending on scope), reload must preserve the result, a series edit must still
reach the instances that were not customised, and undo must restore the prior
state.

## 2. Data model — one nullable link, no expansion change

Repeating rows stay the only expanded thing. A per-instance exception is a
**normal event row** linked to its series:

```ts
// event table additions (migration 0005, nullable)
recurrenceParentId: text("recurrence_parent_id").references((): AnySQLiteColumn => event.id, { onDelete: "cascade" }),
/** Original occurrence key replaced: YYYY-MM-DD for all-day, ISO instant for timed. */
recurrenceId: text("recurrence_id"),
```

plus `event_recurrence_parent_idx` on `recurrence_parent_id`.

Why an exception row instead of a RECURRENCE-ID table / JSON overrides:

- `lib/recurrence/expand.ts` and every renderer already handle plain rows. The
  series keeps an EXDATE for the original slot; the exception is range-filtered
  by `listEvents` like any other event. No change to expansion, `toFcEvent`,
  search, mini-month or details display.
- An exception can be moved, resized, renamed, duplicated and **moved to another
  calendar** through the existing (already documented, already tested) single-event
  paths.
- `ON DELETE CASCADE` means “delete series” removes its exceptions for free, and
  “this and following” can trust linked rows.
- Importer-created Google overrides keep their current representation (standalone
  rows with `external_*`); this change does not migrate them. Documented
  limitation, not a regression.

`EventView` inherits the new columns through `EventRow`.

## 3. Scope semantics

### 3.1 This event

| Surface | Behaviour |
|---|---|
| Drag / resize | Create an exception from the series row with the dropped times, append the occurrence key to the series `exdates`. |
| Edit dialog Save | Create an exception from the form values (title, notes, location, calendar, all-day, start/end; `rrule = null`), append the EXDATE. |
| Delete | Existing behaviour: append the EXDATE (the row is not deleted). |
| Already an exception | The moved/edited/blank instance has no `rrule`, so it is now an ordinary event: dragging, editing and deleting it act on that row directly, with no chooser. |

Rules:

- The original occurrence key must not already be in `exdates`; the service
  validates that it is a real occurrence of the series (expand around it).
- **Repeat changes force a wider scope.** If the dialog’s repeat controls changed,
  “This event” is disabled with the note “Changing the repeat applies to the
  series.” Choosing “This event” ignores `rrule` (the exception is a single event).
- The exception copies `tzid` (timed series) so later edits keep the source zone;
  it does not copy `external_*` (it is a native row).
- The operation is one `db.transaction` (insert exception + EXDATE append).

### 3.2 This and following events

Split the series at the occurrence, then apply the change to the later segment.

1. Validate the occurrence and count occurrences before it.
2. **Old segment** stays on the same row, truncated:
   - `COUNT` present → replace the value with the number of occurrences strictly
     before the split;
   - otherwise → set `UNTIL` to one second before the split occurrence, written in
     the rule’s own coordinate (DATE for all-day, `…Z` instant for timed, honouring
     `event.tzid ?? household zone`);
   - other rule parts are preserved byte-for-byte (advanced rules included);
   - EXDATEs before the split stay; the rest move to the new segment;
   - if there are **no** occurrences before the split, the old row is deleted.
3. **New segment** is a new row: the edited form values (or, for drag/resize, the
   moved occurrence’s times), `rrule` =
   - unchanged repeat → old rule with `COUNT` reduced by the occurrences moved
     away (an `UNTIL` rule is copied unchanged);
   - drag/resize → old rule shifted by the drag delta (§3.4);
   - repeat edited in the dialog → rebuilt from the repeat controls
     (`formatRepeatRule`, existing behaviour).
4. Exceptions of the old series whose `recurrence_id >= occurrenceStart` are
   re-linked to the new segment. A drag/resize following-move also shifts their
   `recurrence_id`, start and end by the same delta (modified instances keep their
   relative custom placement); a dialog edit leaves their times alone.
5. Preconditions: advanced/unparseable rules are allowed here (truncation is
   textual); a series whose occurrence is already excluded is rejected
   `VALIDATION` 400.

Because the whole series module is client-expanded, no migration of existing
series is needed: the split simply produces two ordinary repeating rows.

### 3.3 All events

| Surface | Behaviour |
|---|---|
| Drag / resize | Shift the whole series by the delta (§3.4): series start/end, rule pattern, `UNTIL`, EXDATEs. Linked exceptions keep their own times (an individually moved instance stays where the user put it). |
| Edit dialog Save | Existing series PATCH, plus: title/description/location/calendar changes are copied to linked exceptions; their times and `recurrence_id` are untouched. If Repeat is turned off, the exceptions are detached (`recurrenceParentId = null`) so they remain valid standalone events. |
| Delete | Delete the row; FK cascade deletes its exceptions. |

All-events drag/resize is **disabled** when `parseRepeatRule(...)` cannot represent
the rule (`null` or `advanced`), because shifting an unknown pattern cannot be done
safely. The chooser shows the option disabled with “This series uses a custom
repeat rule; edit the series instead.” “This event” remains available.

### 3.4 Delta shift (drag/resize)

For all-day: `deltaDays = dateDiff(newStartDate, occurrenceStartDate)`, series
start/end dates shift by `deltaDays`.
For timed: `deltaMs = newStartAt - occurrenceStart`, series start/end instants
shift by `deltaMs`, `deltaDays = dateDiff(localDate(newStartAt), localDate(occurrenceStart))`.

- **Rule pattern** (only when `deltaDays ≠ 0`):
  - `FREQ=WEEKLY` — every `BYDAY` token shifts by `deltaDays mod 7`
    (“every weekday” dragged by one day becomes Tuesday–Saturday);
  - `FREQ=MONTHLY` — re-anchored on the new start date (`anchorRepeat`): a
    day-of-month rule moves to the new day, an nth-weekday rule to the new
    date’s ordinal/weekday;
  - `FREQ=DAILY` / `FREQ=YEARLY` — unchanged.
- `UNTIL` shifts by the same delta (DATE by days, `…Z` by the instant delta).
- EXDATEs shift by the same delta, format-aware (all-day `YYYY-MM-DD` by days,
  parseable instants by milliseconds; unrecognised values are left alone).
- `COUNT` is unchanged (the series keeps the same number of occurrences).

## 4. API

### PATCH `/api/events/:id`

Body = today’s update fields plus an optional scope envelope:

```jsonc
{ "scope": "this" | "following" | "all", "occurrenceStart": "…", /* event fields */ }
```

- omitted scope → today’s series PATCH (kept for compatibility);
- `this` → requires `occurrenceStart`. Creates/updates the exception. `rrule` is
  ignored. Returns `200 { event }` (the exception).
- `following` → requires `occurrenceStart`. Splits, applies the payload to the new
  segment. Returns
  `200 { event, truncated, relinked }` where `truncated` is the old segment row
  (`null` when it was removed) and `relinked` are the exceptions now owned by the
  new segment.
- `all` → series PATCH incl. propagation. Returns `200 { event }`.

### DELETE `/api/events/:id`

- `this` → today’s EXDATE append, `204`.
- `all` → **changes from 204 to `200 { deleted: EventView[] }`** (the series row
  and every linked exception) so undo can restore moved instances.
- `following` → split, then delete the new segment (cascade removes its
  exceptions). Returns `200 { deleted, truncated, relinked }`-shaped undo payload:
  every row removed plus the old segment’s post-truncation state (`null` when the
  split started at the first occurrence, i.e. the old row was removed too).

### POST `/api/events`

Accepts optional `recurrenceParentId`/`recurrenceId` so undo can recreate an
exception under its series. The service validates the parent is a recurring event
in the same household; the field is otherwise invisible to the product.

## 5. Undo

Every new action pushes the existing 10-second Undo action; replayed operations
use the existing mutations.

| Action | Undo |
|---|---|
| This event move/edit | delete the new exception; PATCH the series `exdates` back (captured before). |
| This event delete | PATCH the series `exdates` back. |
| This and following move | shift re-linked exceptions back by the reverse delta, PATCH them to the old parent; delete the new segment; PATCH the old segment back from its cached row (recreate it if the split removed it). |
| This and following edit | PATCH re-linked exceptions back to the old parent; delete the new segment; PATCH/recreate the old segment. |
| This and following delete | recreate the removed rows (parent first, remapping `recurrenceParentId`); restore the old segment. |
| All events move/edit | PATCH the series back with its cached pre-change payload. |
| All events delete | recreate the removed rows, parent first. |

The undo closures hold the pre-change row(s) (the series row is always in the
client cache because `listEvents` returns every recurring row) and the response’s
`deleted`/`truncated`/`relinked` arrays.

## 6. UI

- **Chooser** — one dialog used by drag/resize, Edit Save and Delete:
  title “Change repeating event” / “Delete repeating event”, body “This event
  repeats. What should change?”; buttons **This event**, **This and following
  events**, **All events**, Cancel. It replaces the details popover (same
  `overlaySeqRef` rule as the existing delete prompt). Cancel reverts the drag.
- **Drag/resize** — `handleEventMove` finds `base.rrule`; instead of reverting with
  a toast it calls `info.revert()` and stores `pendingScope` with the computed
  payload (event, occurrenceStart, timing fields, direction/delta). Confirming
  runs the scoped PATCH; failure shows the error toast (the grid already reverted).
- **Edit dialog** — opened for a repeating event from the *clicked occurrence*
  (start/end seeded from that occurrence, not the series start). Save now asks for
  scope unless the event does not repeat. The form stays mounted under the prompt
  so Cancel returns to the edits. “This event” is disabled when the repeat controls
  changed. The old “saving changes every occurrence” notice is replaced by the
  chooser.
- **Delete** — the existing prompt gains the middle option.
- Access: write checks stay in `writableEvent`; drag stays disabled on view-only
  calendars (`editable: false`).

## 7. Domain helpers (pure, unit-tested)

New module `lib/recurrence/exceptions.ts` (name TBD in the plan) with:

- `occurrenceKeyKind(event)` / key shifting (date vs instant, format-aware);
- `shiftSeries(event, occurrenceStart, newStart, newEnd)` → patch fields incl.
  shifted rule, EXDATEs, timestamp fields (all-day and timed);
- `truncateRuleBefore(rule, occurrenceStart, context, tzid)` and
  `continueRuleAfter(rule, occurrenceStart, beforeCount, remainderCount)` →
  rule text with `COUNT`/`UNTIL` adjusted, other parts preserved;
- validation that an occurrence belongs to the series.

The service layer owns SQL and transactions; the module owns no I/O.

## 8. Edge cases and documented limitations

- Dragging a row that is already an exception moves it directly (Google re-asks;
  we treat it as the single event it is). Same for editing/deleting it.
- `tzid` series: new segments keep `tzid`; split rule instants are computed in
  `tzid ?? household zone`.
- Imported Google series can be split or shifted like native ones, but the new
  segment has no `external_*` provenance, so re-importing the source may not match
  it. (Existing imported overrides are untouched.)
- A split at the first occurrence deletes the old row; its undo recreates it via
  `POST /api/events`.
- If the client omits scope, the API keeps the old all-series behaviour.
- Absolute-`COUNT` splits cap at the app’s existing 730-occurrence validation; a
  split leaving more than 730 future occurrences is rejected like the editor.

## 9. Testing and docs

- **Unit** (`tests/unit/...`): rule shift (weekly/monthly/daily, UNTIL, EXDATE),
  truncate/continue rule text, occurrence validation, key formatting.
- **Integration** (`tests/integration/events.test.ts`,
  `events-api.test.ts`): this/following/all scopes, exception insert + EXDATE,
  split rows and `COUNT`/`UNTIL`, exception re-linking, cascade delete,
  propagation on all-edit, view-only 403, 400 on an unknown occurrence, undo
  restoration endpoints (delete response shape, POST with parent link).
- **E2E** (`tests/e2e/events.spec.ts` / a new `recurring-scope.spec.ts`): drag a
  chosen occurrence → chooser → This event (original slot gone after reload);
  drag → All events (all occurrences move); Edit dialog → This and following
  (earlier occurrences stay, later move); Delete → middle option; Cancel reverts.
- **Docs (definition of done):** every changed file’s section in
  `docs/COMPONENTS/*`; new migration row in `scripts-and-ops.md`; schema/query
  cache columns in `lib-data.md`; scope semantics in `lib-services.md`;
  rule helpers in `lib-domain.md`; PATCH/DELETE contracts in `app-routes.md` and
  `api-layer.md`; drag/dialog behaviour in `components-calendar.md`; new
  `tests.md` rows; `docs/DEBUGGING.md` traps (the old “recurring drags revert” trap
  is removed and replaced by the new failure modes).

## 10. Delivery

One branch (`feat/recurring-event-edit-scopes`) with conventional commits:
1. schema + migration + domain helpers (pure, unit-tested);
2. service + API scopes + delete payload + integration tests;
3. client chooser, drag/resize, Edit-dialog scope prompt, undo;
4. E2E specs;
5. docs.

No push, PR or deploy unless asked. The full Vitest suite, Playwright events
specs, `lint`, `typecheck` and `docs:check` are the merge gate.
