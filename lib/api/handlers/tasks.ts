import { NextResponse } from "next/server";
import type { Database } from "@/lib/db/client";
import { getHousehold } from "@/lib/services/household";
import type { ViewerContext } from "@/lib/services/permissions";
import {
  createTask,
  deleteTask,
  getTask,
  getTaskCountSummary,
  listTasks,
  reorderTasks,
  updateTask,
} from "@/lib/services/tasks";
import {
  createTaskSchema,
  listTasksQuerySchema,
  reorderTasksSchema,
  updateTaskSchema,
  type ListTasksQuery,
} from "@/lib/validation/tasks";
import { fieldErrors, guarded, readJson } from "./support";

/**
 * `GET /api/tasks` reads three query params, so absent ones become
 * `undefined` for the schema. Zod failures travel through `fieldErrors` as a
 * `VALIDATION` 400 `fields.view` / `fields.collectionId` / `fields.includeClosed`.
 */
function parseListQuery(request: Request): ListTasksQuery {
  const { searchParams } = new URL(request.url);
  const parsed = listTasksQuerySchema.safeParse({
    view: searchParams.get("view") ?? undefined,
    collectionId: searchParams.get("collectionId") ?? undefined,
    includeClosed: searchParams.get("includeClosed") ?? undefined,
  });
  if (!parsed.success) {
    throw fieldErrors(parsed.error);
  }
  return parsed.data;
}

export const listTasksHandler = guarded(
  (db: Database, ctx: ViewerContext, request: Request): Response => {
    const query = parseListQuery(request);
    const household = getHousehold(db, ctx.householdId);
    return NextResponse.json(
      listTasks(db, ctx, {
        ...query,
        timezone: household.timezone,
        // The column is a plain integer; the bucket maths only knows 0 or 1.
        weekStartsOn: household.weekStartsOn === 1 ? 1 : 0,
      }),
    );
  },
);

export const getTaskHandler = guarded(
  (db: Database, ctx: ViewerContext, id: string): Response =>
    NextResponse.json({ task: getTask(db, ctx, id) }),
);

export const createTaskHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = createTaskSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    return NextResponse.json({ task: createTask(db, ctx, parsed.data) }, { status: 201 });
  },
);

export const updateTaskHandler = guarded(
  async (
    db: Database,
    ctx: ViewerContext,
    id: string,
    request: Request,
  ): Promise<Response> => {
    const parsed = updateTaskSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    return NextResponse.json({ task: updateTask(db, ctx, id, parsed.data) });
  },
);

export const deleteTaskHandler = guarded(
  (db: Database, ctx: ViewerContext, id: string): Response => {
    deleteTask(db, ctx, id);
    return new Response(null, { status: 204 });
  },
);

export const reorderTasksHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = reorderTasksSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    return NextResponse.json({ tasks: reorderTasks(db, ctx, parsed.data) });
  },
);

/**
 * `GET /api/tasks/counts` — the per-list badge payload. It resolves the
 * household exactly like the list handler so `today`/`endOfWeek` match the
 * buckets; the service keeps private lists the viewer cannot read out of
 * `byCollection`, so a partner's Inbox never appears.
 */
export const taskCountsHandler = guarded(
  (db: Database, ctx: ViewerContext): Response => {
    const household = getHousehold(db, ctx.householdId);
    return NextResponse.json(
      getTaskCountSummary(db, ctx, {
        timezone: household.timezone,
        // The column is a plain integer; the bucket maths only knows 0 or 1.
        weekStartsOn: household.weekStartsOn === 1 ? 1 : 0,
      }),
    );
  },
);
