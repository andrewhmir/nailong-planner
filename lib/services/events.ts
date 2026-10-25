import { and, eq, gt, gte, isNotNull, lt, lte, or } from "drizzle-orm";
import { RRule } from "rrule";
import { shadeTokens, type ShadeTokens } from "@/lib/color/palette";
import type { Database } from "@/lib/db/client";
import { calendar, event, household, type EventRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { utcToLocalDate } from "@/lib/time/zone";
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
    recurrenceParentId: null,
    recurrenceId: null,
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
  return toView(db, getEvent(db, ctx, id));
}

/**
 * Reads the stored `exdates` JSON defensively. The read path already ignores a
 * corrupt column; the write path used to `JSON.parse` it strictly, so a single
 * corrupt row turned "delete this occurrence" into a 500 with no repair path.
 */
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

/**
 * Deletes a whole event, or for a recurring series appends one occurrence to
 * `exdates` when `scope` is "this" (idempotent).
 */
export function deleteEvent(
  db: Database,
  ctx: ViewerContext,
  id: string,
  options: { scope: "all" } | { scope: "this"; occurrenceStart: string },
): void {
  const row = writableEvent(db, ctx, id);

  if (options.scope === "all" || !row.rrule) {
    db.delete(event).where(eq(event.id, id)).run();
    return;
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
}
