import { and, eq, gt, gte, isNotNull, lt, lte, or } from "drizzle-orm";
import { RRule } from "rrule";
import { shadeTokens, type ShadeTokens } from "@/lib/color/palette";
import type { Database } from "@/lib/db/client";
import { calendar, event, household, type EventRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  assertOccurrenceOf,
  continueRule,
  rulePositionBefore,
  shiftEventTiming,
  shiftExdates,
  shiftOccurrenceKey,
  shiftSeriesTiming,
  truncateRuleBefore,
  type ShiftDelta,
} from "@/lib/recurrence/scopes";
import { addDaysToDate, utcToLocalDate } from "@/lib/time/zone";
import {
  type CreateEventInput,
  type UpdateEventInput,
  assertEventShape,
} from "@/lib/validation/events";
import { getCalendarAccess, resolveShade, assertCalendarWritable } from "./calendars";
import { canWriteCalendar, type ViewerContext } from "./permissions";

export interface EventView extends EventRow {
  color: ShadeTokens;
}

export interface EventRange {
  /** Inclusive lower bound, UTC epoch ms. */
  from: number;
  /** Exclusive upper bound, UTC epoch ms. */
  to: number;
}

/** A scope-free event field patch: the handler strips the scope envelope first. */
export type EventPatch = Omit<UpdateEventInput, "scope" | "occurrenceStart">;

/** The result of a whole-series shift, including the moved exceptions (undo data). */
export interface SeriesMoveResult {
  event: EventView;
  /** Exceptions after the shift/text propagation. */
  relinked: EventView[];
  /** Exceptions before the shift (undo data). */
  relinkedPrevious: EventView[];
}

/** The result of splitting a series for “This and following events”. */
export interface SeriesSplitResult {
  /** The later segment (the row carrying the edit/move). */
  event: EventView;
  /** The old segment after truncation; null when the split removed it. */
  truncated: EventView | null;
  /** Exceptions that now belong to the later segment. */
  relinked: EventView[];
  /** The same exceptions before re-linking/shifting, for undo. */
  relinkedPrevious: EventView[];
}

function assertValidRrule(rrule: string | null | undefined): void {
  if (!rrule) {
    return;
  }
  if (!/FREQ=/.test(rrule)) {
    throw new AppError("VALIDATION", "That repeat rule is not valid.", 400, {
      rrule: "Use an RFC 5545 rule such as FREQ=WEEKLY;BYDAY=TU.",
    });
  }
  try {
    RRule.fromString(rrule);
  } catch {
    throw new AppError("VALIDATION", "That repeat rule is not valid.", 400, {
      rrule: "Use an RFC 5545 rule such as FREQ=WEEKLY;BYDAY=TU.",
    });
  }
}

function householdTimezone(db: Database, ctx: ViewerContext): string {
  const row = db.select().from(household).where(eq(household.id, ctx.householdId)).get();
  return row?.timezone ?? "Asia/Taipei";
}

/** The zone a series expands and shifts in: its source TZID, else the household zone. */
function seriesZone(db: Database, ctx: ViewerContext, row: EventRow): string {
  return row.tzid ?? householdTimezone(db, ctx);
}

/** Builds the client-facing row (adds the resolved colour tokens). */
export function toView(db: Database, row: EventRow): EventView {
  const owner = db.select().from(calendar).where(eq(calendar.id, row.calendarId)).get();
  const color = owner ? resolveShade(db, owner) : shadeTokens("slate", 3);
  return { ...row, color };
}

export function getEvent(db: Database, ctx: ViewerContext, id: string): EventRow {
  const row = db
    .select()
    .from(event)
    .where(and(eq(event.id, id), eq(event.householdId, ctx.householdId)))
    .get();
  if (!row) {
    throw new AppError("NOT_FOUND", "Event not found.", 404);
  }
  return row;
}

function writableEvent(db: Database, ctx: ViewerContext, id: string) {
  const row = getEvent(db, ctx, id);
  const access = getCalendarAccess(db, ctx, row.calendarId);
  assertCalendarWritable(ctx, access);
  return row;
}

function assertSeries(row: EventRow): void {
  if (!row.rrule) {
    throw new AppError("VALIDATION", "That event does not repeat.", 400, {
      rrule: "Choose a repeating event.",
    });
  }
}

function daysInclusive(startDate: string | null, endDate: string | null): number {
  if (!startDate) {
    return 1;
  }
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${(endDate ?? startDate).slice(0, 10)}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function durationMsOf(row: EventRow): number {
  return row.startAt !== null && row.endAt !== null ? row.endAt - row.startAt : 0;
}

/** Reads the stored EXDATE JSON defensively; the read path tolerates corruption. */
function parseStoredExdates(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function serializeExdates(values: string[]): string | null {
  return values.length > 0 ? JSON.stringify(values) : null;
}

function splitExdates(
  row: EventRow,
  occurrenceStart: string,
): { kept: string[]; moved: string[] } {
  const all = parseStoredExdates(row.exdates);
  return {
    kept: all.filter((key) => key < occurrenceStart),
    moved: all.filter((key) => key >= occurrenceStart),
  };
}

/**
 * Returns every recurring row in the household plus the non-recurring rows that
 * intersect the range. Recurring rows are expanded on the client so that a
 * series is never silently truncated at the edge of the visible range.
 */
export function listEvents(db: Database, ctx: ViewerContext, range: EventRange): EventView[] {
  const timezone = householdTimezone(db, ctx);
  const fromDate = utcToLocalDate(range.from, timezone);
  const toDate = utcToLocalDate(range.to, timezone);

  const rows = db
    .select()
    .from(event)
    .where(
      and(
        eq(event.householdId, ctx.householdId),
        or(
          isNotNull(event.rrule),
          and(eq(event.allDay, 0), lt(event.startAt, range.to), gt(event.endAt, range.from)),
          and(eq(event.allDay, 1), lte(event.startDate, toDate), gte(event.endDate, fromDate)),
        ),
      ),
    )
    .all();

  const sorted = rows.sort((left, right) => {
    const leftStart = left.allDay ? (left.startDate ?? "") : String(left.startAt ?? 0).padStart(15, "0");
    const rightStart = right.allDay ? (right.startDate ?? "") : String(right.startAt ?? 0).padStart(15, "0");
    return leftStart.localeCompare(rightStart);
  });

  return sorted.map((row) => toView(db, row));
}

export function createEvent(
  db: Database,
  ctx: ViewerContext,
  input: CreateEventInput,
): EventView {
  const access = getCalendarAccess(db, ctx, input.calendarId);
  assertCalendarWritable(ctx, access);
  assertEventShape(input);
  assertValidRrule(input.rrule);

  let parent: EventRow | null = null;
  if (input.recurrenceParentId) {
    parent = getEvent(db, ctx, input.recurrenceParentId);
    if (!parent.rrule) {
      throw new AppError("VALIDATION", "Only a repeating event can own an occurrence.", 400, {
        recurrenceParentId: "Choose a repeating series.",
      });
    }
  } else if (input.recurrenceId) {
    throw new AppError("VALIDATION", "An occurrence needs its repeating series.", 400, {
      recurrenceParentId: "Choose a repeating series.",
    });
  }

  const now = Date.now();
  const row: EventRow = {
    id: crypto.randomUUID(),
    householdId: ctx.householdId,
    calendarId: access.calendar.id,
    title: input.title.trim(),
    description: input.description ?? null,
    location: input.location ?? null,
    allDay: input.allDay ? 1 : 0,
    startAt: input.allDay ? null : (input.startAt ?? null),
    endAt: input.allDay ? null : (input.endAt ?? null),
    startDate: input.allDay ? (input.startDate ?? null) : null,
    endDate: input.allDay ? (input.endDate ?? null) : null,
    rrule: input.rrule ?? null,
    exdates: input.exdates?.length ? JSON.stringify(input.exdates) : null,
    recurrenceParentId: parent?.id ?? null,
    recurrenceId: parent ? (input.recurrenceId ?? null) : null,
    tzid: null,
    externalSource: null,
    externalUid: null,
    externalRecurrenceId: null,
    externalKey: null,
    externalContentHash: null,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(event).values(row).run();
  return toView(db, row);
}

export function updateEvent(
  db: Database,
  ctx: ViewerContext,
  id: string,
  input: UpdateEventInput,
): EventView {
  const row = writableEvent(db, ctx, id);

  // Moving an event between calendars needs write access on both ends.
  if (input.calendarId !== undefined && input.calendarId !== row.calendarId) {
    const targetAccess = getCalendarAccess(db, ctx, input.calendarId);
    assertCalendarWritable(ctx, targetAccess);
  }

  const allDay = input.allDay ?? row.allDay === 1;
  const candidate = {
    allDay,
    startAt: input.startAt === undefined ? row.startAt : input.startAt,
    endAt: input.endAt === undefined ? row.endAt : input.endAt,
    startDate: input.startDate === undefined ? row.startDate : input.startDate,
    endDate: input.endDate === undefined ? row.endDate : input.endDate,
  };
  assertEventShape(candidate);
  assertValidRrule(input.rrule === undefined ? row.rrule : input.rrule);

  const rrule = input.rrule === undefined ? row.rrule : (input.rrule ?? null);
  const exdates =
    input.exdates === undefined
      ? row.exdates
      : input.exdates?.length
        ? JSON.stringify(input.exdates)
        : null;

  const patch: Partial<EventRow> = {
    allDay: allDay ? 1 : 0,
    startAt: allDay ? null : (candidate.startAt ?? null),
    endAt: allDay ? null : (candidate.endAt ?? null),
    startDate: allDay ? (candidate.startDate ?? null) : null,
    endDate: allDay ? (candidate.endDate ?? null) : null,
    rrule,
    exdates,
    updatedAt: Date.now(),
  };
  if (input.calendarId !== undefined) {
    patch.calendarId = input.calendarId;
  }
  if (input.title !== undefined) {
    patch.title = input.title.trim();
  }
  if (input.description !== undefined) {
    patch.description = input.description ?? null;
  }
  if (input.location !== undefined) {
    patch.location = input.location ?? null;
  }

  db.update(event).set(patch).where(eq(event.id, id)).run();

  if (row.rrule) {
    // Non-time field edits are inherited by exceptions; their times stay put.
    // A child in a calendar this viewer cannot write is left untouched.
    const inherited: Partial<EventRow> = {};
    if (patch.title !== undefined) {
      inherited.title = patch.title;
    }
    if (patch.description !== undefined) {
      inherited.description = patch.description;
    }
    if (patch.location !== undefined) {
      inherited.location = patch.location;
    }
    if (patch.calendarId !== undefined) {
      inherited.calendarId = patch.calendarId;
    }
    if (Object.keys(inherited).length > 0) {
      const children = db.select().from(event).where(eq(event.recurrenceParentId, id)).all();
      for (const child of children) {
        if (!canWriteCalendar(ctx, getCalendarAccess(db, ctx, child.calendarId).effective)) {
          continue;
        }
        db.update(event)
          .set({ ...inherited, updatedAt: Date.now() })
          .where(eq(event.id, child.id))
          .run();
      }
    }
  }

  return toView(db, getEvent(db, ctx, id));
}

/**
 * “This event”: the occurrence is skipped (EXDATE) and a linked, ordinary event
 * row carrying the new values is inserted. Both writes share one transaction.
 */
export function createException(
  db: Database,
  ctx: ViewerContext,
  seriesId: string,
  occurrenceStart: string,
  input: EventPatch,
): EventView {
  const series = writableEvent(db, ctx, seriesId);
  assertSeries(series);
  const zone = seriesZone(db, ctx, series);
  assertOccurrenceOf(series, occurrenceStart, zone);

  if (input.calendarId !== undefined && input.calendarId !== series.calendarId) {
    assertCalendarWritable(ctx, getCalendarAccess(db, ctx, input.calendarId));
  }

  const allDay = input.allDay ?? series.allDay === 1;
  const candidate = {
    allDay,
    startAt: input.startAt === undefined ? series.startAt : input.startAt,
    endAt: input.endAt === undefined ? series.endAt : input.endAt,
    startDate: input.startDate === undefined ? series.startDate : input.startDate,
    endDate: input.endDate === undefined ? series.endDate : input.endDate,
  };
  assertEventShape(candidate);

  const now = Date.now();
  const exception: EventRow = {
    id: crypto.randomUUID(),
    householdId: series.householdId,
    calendarId: input.calendarId ?? series.calendarId,
    title: (input.title ?? series.title).trim(),
    description: input.description === undefined ? series.description : (input.description ?? null),
    location: input.location === undefined ? series.location : (input.location ?? null),
    allDay: allDay ? 1 : 0,
    startAt: allDay ? null : (candidate.startAt ?? null),
    endAt: allDay ? null : (candidate.endAt ?? null),
    startDate: allDay ? (candidate.startDate ?? null) : null,
    endDate: allDay ? (candidate.endDate ?? null) : null,
    rrule: null,
    exdates: null,
    recurrenceParentId: series.id,
    recurrenceId: occurrenceStart,
    tzid: series.tzid,
    externalSource: null,
    externalUid: null,
    externalRecurrenceId: null,
    externalKey: null,
    externalContentHash: null,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  const exdates = parseStoredExdates(series.exdates);
  if (!exdates.includes(occurrenceStart)) {
    exdates.push(occurrenceStart);
  }

  db.transaction((tx) => {
    tx.insert(event).values(exception).run();
    tx.update(event)
      .set({ exdates: serializeExdates(exdates), updatedAt: Date.now() })
      .where(eq(event.id, series.id))
      .run();
  });

  return toView(db, exception);
}

/**
 * “All events”: shift the series, its rule, EXDATEs and linked exceptions by the
 * drag delta, then apply the edited text/calendar fields and repeat rule. The
 * form's timing is the clicked occurrence's edited timing, so a text-only edit
 * has a zero delta and leaves the series start where it was.
 */
export function moveSeries(
  db: Database,
  ctx: ViewerContext,
  id: string,
  occurrenceStart: string,
  move: {
    allDay: boolean;
    startAt: number | null;
    endAt: number | null;
    startDate: string | null;
    endDate: string | null;
  },
  input: EventPatch = {},
): SeriesMoveResult {
  const row = writableEvent(db, ctx, id);
  assertSeries(row);
  const zone = seriesZone(db, ctx, row);
  assertOccurrenceOf(row, occurrenceStart, zone);
  if (input.calendarId !== undefined && input.calendarId !== row.calendarId) {
    assertCalendarWritable(ctx, getCalendarAccess(db, ctx, input.calendarId));
  }

  const { patch, delta } = shiftSeriesTiming(row, occurrenceStart, move, zone);
  const seriesPatch: Partial<EventRow> = { ...patch };
  if (input.calendarId !== undefined) {
    seriesPatch.calendarId = input.calendarId;
  }
  if (input.title !== undefined) {
    seriesPatch.title = input.title.trim();
  }
  if (input.description !== undefined) {
    seriesPatch.description = input.description ?? null;
  }
  if (input.location !== undefined) {
    seriesPatch.location = input.location ?? null;
  }
  if (input.rrule !== undefined) {
    seriesPatch.rrule = input.rrule ?? null;
  }

  const children = db.select().from(event).where(eq(event.recurrenceParentId, id)).all();
  const relinkedPrevious = children.map((child) => toView(db, child));
  const childChanges = children.map((child) => {
    const childPatch: Partial<EventRow> = {
      ...shiftEventTiming(child, delta, zone),
      recurrenceId: child.recurrenceId
        ? shiftOccurrenceKey(child.recurrenceId, delta, zone)
        : null,
    };
    if (seriesPatch.title !== undefined) {
      childPatch.title = seriesPatch.title;
    }
    if (seriesPatch.description !== undefined) {
      childPatch.description = seriesPatch.description;
    }
    if (seriesPatch.location !== undefined) {
      childPatch.location = seriesPatch.location;
    }
    if (seriesPatch.calendarId !== undefined) {
      childPatch.calendarId = seriesPatch.calendarId;
    }
    return { id: child.id, patch: childPatch };
  });

  db.transaction((tx) => {
    tx.update(event).set(seriesPatch).where(eq(event.id, id)).run();
    for (const change of childChanges) {
      tx.update(event).set(change.patch).where(eq(event.id, change.id)).run();
    }
  });

  const relinked = childChanges
    .map((change) => db.select().from(event).where(eq(event.id, change.id)).get())
    .filter((child): child is EventRow => child !== undefined)
    .map((child) => toView(db, child));

  return {
    event: toView(db, getEvent(db, ctx, id)),
    relinked,
    relinkedPrevious,
  };
}

/**
 * The later segment of a split. A drag/resize (`input.rrule === undefined`)
 * moves and shifts the pattern; a defined `rrule` (string or null) means the
 * event dialog applied an edit and carries the rebuilt rule.
 */
function buildLaterSegment(
  db: Database,
  ctx: ViewerContext,
  row: EventRow,
  occurrenceStart: string,
  input: EventPatch,
  moveMode: boolean,
  beforeCount: number,
): { row: EventRow; delta: ShiftDelta } {
  const zone = seriesZone(db, ctx, row);
  const allDay = input.allDay ?? row.allDay === 1;
  if (allDay !== (row.allDay === 1)) {
    throw new AppError(
      "VALIDATION",
      "A repeating event can't switch between all-day and timed in one move. Edit the series instead.",
      400,
      { allDay: "Keep the series all-day or timed." },
    );
  }
  const durationDays = daysInclusive(row.startDate, row.endDate);
  const durationMs = durationMsOf(row);
  const fallbackStartAt = Date.parse(occurrenceStart);
  const timing = allDay
    ? {
        allDay: true,
        startAt: null,
        endAt: null,
        startDate: input.startDate ?? occurrenceStart.slice(0, 10),
        endDate:
          input.endDate ??
          addDaysToDate(input.startDate ?? occurrenceStart.slice(0, 10), durationDays - 1),
      }
    : {
        allDay: false,
        startAt: input.startAt ?? fallbackStartAt,
        endAt: input.endAt ?? (input.startAt ?? fallbackStartAt) + durationMs,
        startDate: null,
        endDate: null,
      };
  assertEventShape(timing);

  const split = splitExdates(row, occurrenceStart);
  let delta: ShiftDelta = { deltaDays: 0, deltaMs: 0, deltaMinutes: 0 };
  let rrule: string | null;

  if (moveMode) {
    const shift = shiftSeriesTiming(
      row,
      occurrenceStart,
      {
        allDay: timing.allDay,
        startAt: timing.startAt,
        endAt: timing.endAt,
        startDate: timing.startDate,
        endDate: timing.endDate,
      },
      zone,
    );
    delta = shift.delta;
    if (!shift.patch.rrule || !row.rrule) {
      throw new AppError("VALIDATION", "That series does not repeat.", 400);
    }
    rrule = continueRule(shift.patch.rrule, beforeCount);
  } else if (input.rrule === null) {
    rrule = null;
  } else if (input.rrule === row.rrule) {
    rrule = continueRule(row.rrule!, beforeCount);
  } else if (input.rrule !== undefined) {
    rrule = input.rrule;
  } else {
    throw new AppError("VALIDATION", "A repeat rule is required to split a series.", 400);
  }

  const shiftExdateValues = timing.allDay ? delta.deltaDays !== 0 : delta.deltaMs !== 0;
  const nextExdates =
    moveMode && shiftExdateValues
      ? shiftExdates(serializeExdates(split.moved), timing.allDay, delta, zone)
      : serializeExdates(split.moved);

  const now = Date.now();
  return {
    delta,
    row: {
      id: crypto.randomUUID(),
      householdId: row.householdId,
      calendarId: input.calendarId ?? row.calendarId,
      title: (input.title ?? row.title).trim(),
      description: input.description === undefined ? row.description : (input.description ?? null),
      location: input.location === undefined ? row.location : (input.location ?? null),
      allDay: timing.allDay ? 1 : 0,
      startAt: timing.allDay ? null : (timing.startAt ?? null),
      endAt: timing.allDay ? null : (timing.endAt ?? null),
      startDate: timing.allDay ? (timing.startDate ?? null) : null,
      endDate: timing.allDay ? (timing.endDate ?? null) : null,
      rrule,
      exdates: nextExdates,
      recurrenceParentId: null,
      recurrenceId: null,
      tzid: row.tzid,
      externalSource: null,
      externalUid: null,
      externalRecurrenceId: null,
      externalKey: null,
      externalContentHash: null,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * “This and following events”: truncate the old row before the occurrence and
 * create a later row from it. Exceptions from the split onward are re-linked to
 * the later segment (and shifted by the drag delta for a move).
 */
export function splitSeries(
  db: Database,
  ctx: ViewerContext,
  id: string,
  occurrenceStart: string,
  input: EventPatch,
): SeriesSplitResult {
  const row = writableEvent(db, ctx, id);
  assertSeries(row);
  const zone = seriesZone(db, ctx, row);
  // COUNT/UNTIL truncation counts RRULE sequence positions, not rendered rows:
  // an EXDATE before the split must not shrink the kept segment.
  const beforeCount = rulePositionBefore(row, occurrenceStart, zone);
  if (input.calendarId !== undefined && input.calendarId !== row.calendarId) {
    assertCalendarWritable(ctx, getCalendarAccess(db, ctx, input.calendarId));
  }

  const moveMode = input.rrule === undefined;
  const later = buildLaterSegment(db, ctx, row, occurrenceStart, input, moveMode, beforeCount);
  const timed = row.allDay !== 1;
  const split = splitExdates(row, occurrenceStart);
  const truncationRule = truncateRuleBefore(
    row.rrule!,
    occurrenceStart,
    beforeCount,
    zone,
    timed,
  );

  const children = db.select().from(event).where(eq(event.recurrenceParentId, id)).all();
  const affected = children.filter((child) => (child.recurrenceId ?? "") >= occurrenceStart);
  const relinkedPrevious = affected.map((child) => toView(db, child));

  const truncated: EventView | null =
    beforeCount === 0
      ? null
      : {
          ...toView(db, row),
          rrule: truncationRule,
          exdates: serializeExdates(split.kept),
        };

  db.transaction((tx) => {
    // The later segment must exist before the exceptions can point at it.
    tx.insert(event).values(later.row).run();

    for (const child of affected) {
      const patch: Partial<EventRow> = { recurrenceParentId: later.row.id };
      if (moveMode) {
        patch.recurrenceId = child.recurrenceId
          ? shiftOccurrenceKey(child.recurrenceId, later.delta, zone)
          : null;
        Object.assign(patch, shiftEventTiming(child, later.delta, zone));
      }
      tx.update(event).set(patch).where(eq(event.id, child.id)).run();
    }

    if (truncated) {
      tx.update(event)
        .set({
          rrule: truncationRule,
          exdates: serializeExdates(split.kept),
          updatedAt: Date.now(),
        })
        .where(eq(event.id, row.id))
        .run();
    } else {
      tx.delete(event).where(eq(event.id, row.id)).run();
    }
  });

  const relinked = affected
    .map((child) => db.select().from(event).where(eq(event.id, child.id)).get())
    .filter((child): child is EventRow => child !== undefined)
    .map((child) => toView(db, child));

  return {
    event: toView(db, later.row),
    truncated,
    relinked,
    relinkedPrevious,
  };
}

/** “This and following events” delete: split, then delete the later segment. */
export function deleteFollowing(
  db: Database,
  ctx: ViewerContext,
  id: string,
  occurrenceStart: string,
): { deleted: EventView[]; truncated: EventView | null; segmentId: string } {
  const row = writableEvent(db, ctx, id);
  assertSeries(row);
  const original = toView(db, row);
  const result = splitSeries(db, ctx, id, occurrenceStart, { rrule: row.rrule });

  db.delete(event).where(eq(event.id, result.event.id)).run();

  const deleted = [result.event, ...result.relinked];
  if (result.truncated === null) {
    deleted.push(original);
  }
  return { deleted, truncated: result.truncated, segmentId: result.event.id };
}

/**
 * Deletes a whole event, or for a recurring series appends one occurrence to
 * `exdates` when `scope` is "this" (idempotent). A whole-series delete also
 * removes linked exceptions via the FK cascade and returns every deleted row so
 * the client can undo it.
 */
export function deleteEvent(
  db: Database,
  ctx: ViewerContext,
  id: string,
  options: { scope: "all" } | { scope: "this"; occurrenceStart: string },
): EventView[] {
  const row = writableEvent(db, ctx, id);

  if (options.scope === "all" || !row.rrule) {
    const children = db
      .select()
      .from(event)
      .where(eq(event.recurrenceParentId, id))
      .all();
    const deleted = [toView(db, row), ...children.map((child) => toView(db, child))];
    db.delete(event).where(eq(event.id, id)).run();
    return deleted;
  }

  const occurrenceStart = options.occurrenceStart;
  if (!occurrenceStart) {
    throw new AppError("VALIDATION", "Choose which occurrence to skip.", 400, {
      occurrenceStart: "A start time is required to skip one occurrence.",
    });
  }

  const existing = parseStoredExdates(row.exdates);
  if (!existing.includes(occurrenceStart)) {
    existing.push(occurrenceStart);
  }

  db.update(event)
    .set({ exdates: JSON.stringify(existing), updatedAt: Date.now() })
    .where(eq(event.id, id))
    .run();
  return [];
}

// Re-exported for callers that only import the service module.
export { dateDiffDays, localDateOfEvent } from "@/lib/recurrence/scopes";
