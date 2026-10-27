# Task due date + optional time (v0.2.1 follow-up) — design

**Status:** approved in chat 2026-10-27 (user: "go ahead then implement").
**Supersedes for task dates:** the two-date model of
`2026-10-26-tasks-clickup-ui-design.md` (`scheduledOn` + `dueOn`).

## Why

Two adjacent date chips ("scheduled" and "due") read as two competing deadlines
and the due chip wore a clock glyph for a date-only field. The user asked for a
single deadline: **one due date, optionally with a time on that day, set from one
concise button per row.**

## What changes

1. **`scheduledOn` is retired.** A task has exactly one date: `dueOn`.
2. **`dueTime` is new:** nullable `HH:MM` wall-clock in the household zone. A task
   without a time is due "sometime that day"; a task without a date is Someday.
3. **Buckets and overdue anchor on the due date.**
   - `bucketOf`: no due → Someday; `dueOn <= today` → Today; `dueOn <= endOfWeek`
     → Week; later → no bucket (`all` only). Status rules unchanged.
   - `isOverdue`: active && due set && (`dueOn < today` or `dueOn === today &&
     dueTime !== null && dueTime < nowTime`) where `nowTime` is the household's
     local wall clock. Date-only due today is not overdue until tomorrow.
   - `counts.overdue` uses the same predicate. `TaskView` carries the
     server-computed `overdue` flag so the client never reads the device clock.
4. **Sort "Due date"** orders by `dueOn` ascending (undated last), then `dueTime`
   ascending with untimed after timed on the same day.
5. **API** drops `scheduledOn` from every task payload and adds `dueTime` to
   create/patch. A time requires a date (`400 VALIDATION`); clearing the date
   clears the time. `GET /api/tasks` rows gain `dueTime` and `overdue`.
6. **One button per task** (`components/tasks/TaskDueChip.tsx`, replacing
   `TaskDateChips.tsx`): shows `Tue 27 Oct, 18:00` (year only when not the current
   year; red when overdue), or just the calendar icon when unset. Its popover holds
   the existing mini-month plus the calendar's own `TimeField` slot picker for the
   optional time — `TimeField` gains `value: string | null`, `placeholder`,
   `disabled` and `onClear` so it can represent "no time", show "Set a date first",
   and offer "Clear time" — then a "Done" close and a "Clear due date" action.
   Picking a day keeps the popover open so the time is set in the same visit; each
   edit stays one PATCH with its own toast + targeted undo.
7. **Every former scheduling path targets the due date:** keyboard `1` due today,
   `2` due end of week, `3` clear due (both fields), `4` move list unchanged;
   capture `Shift+Enter` = due today; calendar task chips render on the due date
   (read-only all-day, as before); dragging a row onto the mini-month sets the due
   date and keeps the time.
8. **Delete undo** restores `dueOn` + `dueTime`; the drag payload carries the
   previous due date.

## Migration `0008`

```sql
ALTER TABLE `task` ADD `due_time` text;
UPDATE `task` SET `due_on` = `scheduled_on`
  WHERE `due_on` IS NULL AND `scheduled_on` IS NOT NULL;
DROP INDEX `task_scheduled_idx`;
ALTER TABLE `task` DROP COLUMN `scheduled_on`;
```

`task_due_idx` stays. Snapshot chains from `0007`. Every existing scheduled date
becomes that task's due date; nothing is stranded.

## Out of scope

Timed task chips on the calendar month grid (chips stay all-day on the due date),
per-task time zones (the time is household-local), and reminders/notifications.
Version stays `0.2.1`.

## Testing

Unit: buckets (due-only + beyond-week), overdue (date-only vs timed, boundary at
the minute), due sort with times, drag payload, triage resolver, undo restore,
cache optimistic patch, calendar chip. Integration: migration 0008 backfill +
column shape, task service reads/patch/create normalisation, API payload
validation (time without date), counts with a timed overdue row. E2E: tasks spec
fixtures and a due-chip edit; events spec chip source. Docs gate + lint + tsc +
vitest + Turbopack build.
