import { NextResponse } from "next/server";
import type { Database } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { getHousehold } from "@/lib/services/household";
import {
  createEvent,
  createException,
  deleteEvent,
  deleteFollowing,
  listEvents,
  moveSeries,
  splitSeries,
  updateEvent,
  type EventRange,
} from "@/lib/services/events";
import type { ViewerContext } from "@/lib/services/permissions";
import { localWallTimeToUtc, utcToLocalDate } from "@/lib/time/zone";
import { createEventSchema, updateEventSchema } from "@/lib/validation/events";
import { searchEvents } from "@/lib/services/search";
import { fieldErrors, guarded, readJson } from "./support";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The household's current month, used when the client sends no range. */
function currentMonthRange(db: Database, ctx: ViewerContext): EventRange {
  const timezone = getHousehold(db, ctx.householdId).timezone;
  const today = utcToLocalDate(Date.now(), timezone);
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    from: localWallTimeToUtc(`${year}-${pad2(month)}-01T00:00`, timezone),
    to: localWallTimeToUtc(`${nextYear}-${pad2(nextMonth)}-01T00:00`, timezone),
  };
}

function parseRange(db: Database, ctx: ViewerContext, request: Request): EventRange {
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (fromParam === null && toParam === null) {
    return currentMonthRange(db, ctx);
  }
  if (fromParam === null || toParam === null) {
    throw new AppError("VALIDATION", "Provide both from and to.", 400, {
      from: "Both bounds are required together.",
    });
  }

  const from = Number(fromParam);
  const to = Number(toParam);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new AppError("VALIDATION", "from and to must be epoch milliseconds.", 400, {
      from: "Use epoch milliseconds.",
    });
  }
  if (from >= to) {
    throw new AppError("VALIDATION", "from must be before to.", 400, {
      from: "Choose an earlier start.",
    });
  }
  return { from, to };
}

export const listEventsHandler = guarded(
  (db: Database, ctx: ViewerContext, request: Request): Response =>
    NextResponse.json({ events: listEvents(db, ctx, parseRange(db, ctx, request)) }),
);

export const searchEventsHandler = guarded(
  (db: Database, ctx: ViewerContext, request: Request): Response => {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    if (query === null) {
      throw new AppError("VALIDATION", "Type something to search for.", 400, {
        q: "Type something to search for.",
      });
    }
    const limitParam = searchParams.get("limit");
    const limit = limitParam === null ? undefined : Number(limitParam);
    return NextResponse.json({
      events: searchEvents(
        db,
        ctx,
        query,
        limit !== undefined && Number.isFinite(limit) ? limit : undefined,
      ),
    });
  },
);

export const createEventHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = createEventSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const created = createEvent(db, ctx, parsed.data);
    return NextResponse.json({ event: created }, { status: 201 });
  },
);

export const updateEventHandler = guarded(
  async (
    db: Database,
    ctx: ViewerContext,
    id: string,
    request: Request,
  ): Promise<Response> => {
    const parsed = updateEventSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const { scope, occurrenceStart, ...fields } = parsed.data;

    if (scope === "this" || scope === "following") {
      if (!occurrenceStart) {
        throw new AppError("VALIDATION", "occurrenceStart is required for this scope.", 400, {
          occurrenceStart: "Choose which occurrence to change.",
        });
      }
      if (scope === "this") {
        return NextResponse.json({ event: createException(db, ctx, id, occurrenceStart, fields) });
      }
      return NextResponse.json(splitSeries(db, ctx, id, occurrenceStart, fields));
    }

    if (scope === "all" && occurrenceStart) {
      if (fields.allDay === undefined) {
        throw new AppError("VALIDATION", "allDay is required when moving a series.", 400, {
          allDay: "Send the moved occurrence's all-day flag.",
        });
      }
      return NextResponse.json({
        event: moveSeries(db, ctx, id, occurrenceStart, {
          allDay: fields.allDay,
          startAt: fields.startAt ?? null,
          endAt: fields.endAt ?? null,
          startDate: fields.startDate ?? null,
          endDate: fields.endDate ?? null,
        }),
      });
    }

    return NextResponse.json({ event: updateEvent(db, ctx, id, fields) });
  },
);

export const deleteEventHandler = guarded(
  async (
    db: Database,
    ctx: ViewerContext,
    id: string,
    request: Request,
  ): Promise<Response> => {
    const raw: unknown = await request.json().catch(() => null);
    const requested = raw && typeof raw === "object" ? (raw as { scope?: unknown }).scope : undefined;
    const scope = requested === "this" ? "this" : requested === "following" ? "following" : "all";

    if (scope === "this") {
      const occurrenceStart = (raw as { occurrenceStart?: unknown }).occurrenceStart;
      if (typeof occurrenceStart !== "string" || occurrenceStart.length === 0) {
        throw new AppError("VALIDATION", "occurrenceStart is required when scope is 'this'.", 400, {
          occurrenceStart: "Choose which occurrence to skip.",
        });
      }
      deleteEvent(db, ctx, id, { scope: "this", occurrenceStart });
      return new Response(null, { status: 204 });
    }

    if (scope === "following") {
      const occurrenceStart = (raw as { occurrenceStart?: unknown }).occurrenceStart;
      if (typeof occurrenceStart !== "string" || occurrenceStart.length === 0) {
        throw new AppError(
          "VALIDATION",
          "occurrenceStart is required when scope is 'following'.",
          400,
          { occurrenceStart: "Choose which occurrence to delete from." },
        );
      }
      const result = deleteFollowing(db, ctx, id, occurrenceStart);
      return NextResponse.json({ deleted: result.deleted, truncated: result.truncated });
    }

    const deleted = deleteEvent(db, ctx, id, { scope: "all" });
    return NextResponse.json({ deleted, truncated: null });
  },
);
