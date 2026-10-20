import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { calendar, type CalendarRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  CHILD_SHADE_ORDER,
  MAX_CHILDREN,
  PARENT_SHADE_INDEX,
  isHueFamily,
  shadeTokens,
  type ShadeTokens,
} from "@/lib/color/palette";
import type { CreateCalendarInput, UpdateCalendarInput } from "@/lib/validation/calendars";
import { canWriteCalendar, type ViewerContext } from "./permissions";

export interface CalendarNode extends CalendarRow {
  children: CalendarRow[];
}

export interface CalendarAccess {
  calendar: CalendarRow;
  root: CalendarRow | null;
  /** Permission columns with the root's flags folded in. */
  effective: Pick<CalendarRow, "ownerId" | "isViewOnlyForPartner">;
}

function nextSortOrder(db: Database, householdId: string, parentId: string | null): number {
  const rows =
    parentId === null
      ? db
          .select()
          .from(calendar)
          .where(and(eq(calendar.householdId, householdId), isNull(calendar.parentId)))
          .all()
      : db.select().from(calendar).where(eq(calendar.parentId, parentId)).all();
  const max = rows.reduce((highest, row) => Math.max(highest, row.sortOrder), -1);
  return max + 1;
}

export function getCalendar(db: Database, ctx: ViewerContext, id: string): CalendarRow {
  const row = db
    .select()
    .from(calendar)
    .where(and(eq(calendar.id, id), eq(calendar.householdId, ctx.householdId)))
    .get();
  if (!row) {
    throw new AppError("NOT_FOUND", "Calendar not found.", 404);
  }
  return row;
}

/**
 * Loads a calendar together with the permission flags that actually apply to
 * it. A sub-calendar inherits its root's owner and view-only flag, so marking a
 * parent view-only also protects every sub-calendar beneath it.
 */
export function getCalendarAccess(db: Database, ctx: ViewerContext, id: string): CalendarAccess {
  const row = getCalendar(db, ctx, id);
  if (row.parentId === null) {
    return {
      calendar: row,
      root: null,
      effective: { ownerId: row.ownerId, isViewOnlyForPartner: row.isViewOnlyForPartner },
    };
  }

  const root =
    db
      .select()
      .from(calendar)
      .where(and(eq(calendar.id, row.parentId), eq(calendar.householdId, ctx.householdId)))
      .get() ?? null;

  return {
    calendar: row,
    root,
    effective: {
      ownerId: root?.ownerId ?? row.ownerId,
      isViewOnlyForPartner: Math.max(root?.isViewOnlyForPartner ?? 0, row.isViewOnlyForPartner),
    },
  };
}

export function assertCalendarWritable(ctx: ViewerContext, access: CalendarAccess): void {
  if (!canWriteCalendar(ctx, access.effective)) {
    throw new AppError("FORBIDDEN", "This calendar is view-only.", 403);
  }
}

export function listCalendarTree(db: Database, ctx: ViewerContext): CalendarNode[] {
  const rows = db
    .select()
    .from(calendar)
    .where(eq(calendar.householdId, ctx.householdId))
    .orderBy(asc(calendar.sortOrder), asc(calendar.createdAt))
    .all();

  const roots: CalendarNode[] = rows
    .filter((row) => row.parentId === null)
    .map((row) => ({ ...row, children: [] }));
  const byId = new Map(roots.map((root) => [root.id, root]));

  for (const row of rows) {
    if (row.parentId !== null) {
      byId.get(row.parentId)?.children.push(row);
    }
  }

  for (const root of roots) {
    root.children.sort((a, b) => a.shadeIndex - b.shadeIndex);
  }

  return roots;
}

export function createCalendar(
  db: Database,
  ctx: ViewerContext,
  input: CreateCalendarInput,
): CalendarRow {
  const name = input.name.trim();
  const now = Date.now();

  if (input.parentId) {
    const parentAccess = getCalendarAccess(db, ctx, input.parentId);
    if (parentAccess.calendar.parentId !== null) {
      throw new AppError(
        "VALIDATION",
        "Sub-calendars cannot be nested deeper than two levels.",
        400,
        { parentId: "Pick a top-level calendar as the parent." },
      );
    }
    assertCalendarWritable(ctx, parentAccess);
    const parent = parentAccess.calendar;

    const existing = db.select().from(calendar).where(eq(calendar.parentId, parent.id)).all();
    if (existing.length >= MAX_CHILDREN) {
      throw new AppError(
        "CONFLICT",
        `This calendar already has the maximum of ${MAX_CHILDREN} sub-calendars.`,
        409,
      );
    }
    const usedShades = new Set(existing.map((row) => row.shadeIndex));
    const shadeIndex = CHILD_SHADE_ORDER.find((candidate) => !usedShades.has(candidate));
    if (shadeIndex === undefined) {
      throw new AppError(
        "CONFLICT",
        `This calendar already has the maximum of ${MAX_CHILDREN} sub-calendars.`,
        409,
      );
    }

    const row: CalendarRow = {
      id: crypto.randomUUID(),
      householdId: ctx.householdId,
      parentId: parent.id,
      name,
      hueFamily: null,
      shadeIndex,
      ownerId: parent.ownerId,
      isViewOnlyForPartner: 0,
      sortOrder: nextSortOrder(db, ctx.householdId, parent.id),
      createdAt: now,
      updatedAt: now,
    };
    db.insert(calendar).values(row).run();
    return row;
  }

  if (!input.hueFamily) {
    throw new AppError("VALIDATION", "Top-level calendars need a color family.", 400, {
      hueFamily: "Choose a color family.",
    });
  }

  const ownerId = input.ownerId ?? null;
  if (ownerId !== null && ownerId !== ctx.userId) {
    throw new AppError(
      "FORBIDDEN",
      "You can only create calendars for yourself or shared ones.",
      403,
    );
  }

  const isViewOnlyForPartner = input.isViewOnlyForPartner ? 1 : 0;
  if (isViewOnlyForPartner === 1 && ownerId === null) {
    throw new AppError("VALIDATION", "Shared calendars cannot be view-only.", 400, {
      isViewOnlyForPartner: "Assign the calendar to yourself first.",
    });
  }

  const row: CalendarRow = {
    id: crypto.randomUUID(),
    householdId: ctx.householdId,
    parentId: null,
    name,
    hueFamily: input.hueFamily,
    shadeIndex: PARENT_SHADE_INDEX,
    ownerId,
    isViewOnlyForPartner,
    sortOrder: nextSortOrder(db, ctx.householdId, null),
    createdAt: now,
    updatedAt: now,
  };
  db.insert(calendar).values(row).run();
  return row;
}

export function updateCalendar(
  db: Database,
  ctx: ViewerContext,
  id: string,
  input: UpdateCalendarInput,
): CalendarRow {
  const access = getCalendarAccess(db, ctx, id);
  assertCalendarWritable(ctx, access);
  const existing = access.calendar;

  const patch: Partial<CalendarRow> = {};

  if (input.name !== undefined) {
    patch.name = input.name.trim();
  }
  if (input.sortOrder !== undefined) {
    patch.sortOrder = input.sortOrder;
  }
  if (input.hueFamily !== undefined) {
    if (existing.parentId !== null) {
      throw new AppError(
        "VALIDATION",
        "Only top-level calendars have a color family; sub-calendars inherit theirs.",
        400,
        { hueFamily: "Change the parent calendar's color instead." },
      );
    }
    patch.hueFamily = input.hueFamily;
  }
  if (input.ownerId !== undefined) {
    if (existing.ownerId !== null && existing.ownerId !== ctx.userId) {
      throw new AppError("FORBIDDEN", "Only the owner can change who owns this calendar.", 403);
    }
    if (input.ownerId !== null && input.ownerId !== ctx.userId) {
      throw new AppError(
        "FORBIDDEN",
        "You can only assign a calendar to yourself or leave it shared.",
        403,
      );
    }
    patch.ownerId = input.ownerId ?? null;
    if (patch.ownerId === null) {
      patch.isViewOnlyForPartner = 0;
    }
  }
  if (input.isViewOnlyForPartner !== undefined) {
    if (existing.parentId !== null) {
      throw new AppError(
        "VALIDATION",
        "Mark the top-level calendar view-only; sub-calendars inherit it.",
        400,
        { isViewOnlyForPartner: "Change the parent calendar instead." },
      );
    }
    const ownerAfter = patch.ownerId === undefined ? existing.ownerId : patch.ownerId;
    if (ownerAfter !== ctx.userId) {
      throw new AppError("FORBIDDEN", "Only the owner can change view-only access.", 403);
    }
    patch.isViewOnlyForPartner = input.isViewOnlyForPartner ? 1 : 0;
  }

  if (Object.keys(patch).length === 0) {
    return existing;
  }

  db.update(calendar)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(calendar.id, id))
    .run();

  return getCalendar(db, ctx, id);
}

export function deleteCalendar(db: Database, ctx: ViewerContext, id: string): void {
  const access = getCalendarAccess(db, ctx, id);
  assertCalendarWritable(ctx, access);
  db.delete(calendar).where(eq(calendar.id, id)).run();
}

/** Resolves the rendered shade for a calendar, following its root's hue family. */
export function resolveShade(db: Database, target: CalendarRow): ShadeTokens {
  const root =
    target.parentId === null
      ? target
      : db.select().from(calendar).where(eq(calendar.id, target.parentId)).get();

  const family = root?.hueFamily && isHueFamily(root.hueFamily) ? root.hueFamily : "slate";
  const shadeIndex = target.parentId === null ? PARENT_SHADE_INDEX : target.shadeIndex;
  return shadeTokens(family, shadeIndex);
}
