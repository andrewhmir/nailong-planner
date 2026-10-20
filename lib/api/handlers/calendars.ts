import { NextResponse } from "next/server";
import type { Database } from "@/lib/db/client";
import {
  createCalendar,
  deleteCalendar,
  listCalendarTree,
  updateCalendar,
} from "@/lib/services/calendars";
import type { ViewerContext } from "@/lib/services/permissions";
import { createCalendarSchema, updateCalendarSchema } from "@/lib/validation/calendars";
import { fieldErrors, guarded, readJson } from "./support";

export const listCalendars = guarded((db: Database, ctx: ViewerContext): Response =>
  NextResponse.json({ calendars: listCalendarTree(db, ctx) }),
);

export const createCalendarHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = createCalendarSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const calendar = createCalendar(db, ctx, parsed.data);
    return NextResponse.json({ calendar }, { status: 201 });
  },
);

export const updateCalendarHandler = guarded(
  async (
    db: Database,
    ctx: ViewerContext,
    id: string,
    request: Request,
  ): Promise<Response> => {
    const parsed = updateCalendarSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const calendar = updateCalendar(db, ctx, id, parsed.data);
    return NextResponse.json({ calendar });
  },
);

export const deleteCalendarHandler = guarded(
  (db: Database, ctx: ViewerContext, id: string): Response => {
    deleteCalendar(db, ctx, id);
    return new Response(null, { status: 204 });
  },
);
