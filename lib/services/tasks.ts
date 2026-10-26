import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  collection,
  task,
  taskChecklistItem,
  type CollectionRow,
  type TaskRow,
} from "@/lib/db/schema";
import {
  bucketOf,
  endOfWeek,
  isOverdue,
  localToday,
  type BucketContext,
  type TaskBucket,
} from "@/lib/domain/tasks";
import { AppError } from "@/lib/errors";
import type {
  CreateTaskInput,
  ReorderTasksInput,
  UpdateTaskInput,
} from "@/lib/validation/tasks";
import {
  assertCollectionWritable,
  ensureInbox,
  getCollectionAccess,
  resolveVisibleCollections,
  type CollectionAccess,
} from "./collections";
import type { ViewerContext } from "./permissions";

/**
 * Task reads, writes and derived views. A task is only visible while the
 * collection that holds it is visible: every entry point resolves permissions
 * through `lib/services/collections.ts` (`resolveVisibleCollections` for lists,
 * `getCollectionAccess` for one id) and never re-implements the private
 * predicate. Views are derived in JavaScript with `lib/domain/tasks.ts`, so the
 * bucket rules live in exactly one place.
 */

export interface ChecklistItemView {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskView extends TaskRow {
  checklist: ChecklistItemView[];
  /** Just enough of the owning list to render the task's colour dot. */
  collection: Pick<CollectionRow, "id" | "name" | "kind" | "hueFamily" | "shadeIndex">;
}

export interface TaskCounts {
  inbox: number;
  today: number;
  week: number;
  someday: number;
  overdue: number;
}

export interface ListTasksInput {
  /** A triage bucket, or `"all"` (the calendar grid) — omitted means all too. */
  view?: TaskBucket | "all";
  collectionId?: string;
  timezone: string;
  weekStartsOn: 0 | 1;
}

/**
 * Builds the client-facing task row. This attaches storage data only: it does
 * not check visibility, so callers must pass a row whose collection the viewer
 * may read — every exported reader and writer below does.
 */
export function toTaskView(db: Database, row: TaskRow): TaskView {
  const owner = db.select().from(collection).where(eq(collection.id, row.collectionId)).get();
  if (!owner) {
    // The FK cascades with its collection, so this is a corrupt row rather than
    // a normal state; fail closed instead of leaking a partial view.
    throw new AppError("NOT_FOUND", "Task not found.", 404);
  }
  const items = db
    .select()
    .from(taskChecklistItem)
    .where(eq(taskChecklistItem.taskId, row.id))
    .orderBy(asc(taskChecklistItem.sortOrder))
    .all();

  return {
    ...row,
    checklist: items.map((item) => ({
      id: item.id,
      title: item.title,
      done: item.done === 1,
    })),
    collection: {
      id: owner.id,
      name: owner.name,
      kind: owner.kind,
      hueFamily: owner.hueFamily,
      shadeIndex: owner.shadeIndex,
    },
  };
}

function loadTask(db: Database, ctx: ViewerContext, id: string): TaskRow {
  const row = db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.householdId, ctx.householdId)))
    .get();
  if (!row) {
    throw new AppError("NOT_FOUND", "Task not found.", 404);
  }
  return row;
}

/**
 * Resolves the row's collection with the one access helper and keeps the task's
 * own `NOT_FOUND` message, so a private list the viewer does not own answers
 * exactly like a missing task id.
 */
function taskAccess(db: Database, ctx: ViewerContext, row: TaskRow) {
  try {
    return getCollectionAccess(db, ctx, row.collectionId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      throw new AppError("NOT_FOUND", "Task not found.", 404);
    }
    throw error;
  }
}

export function getTask(db: Database, ctx: ViewerContext, id: string): TaskView {
  const row = loadTask(db, ctx, id);
  taskAccess(db, ctx, row);
  return toTaskView(db, row);
}

function writableTask(db: Database, ctx: ViewerContext, id: string) {
  const row = loadTask(db, ctx, id);
  const access = taskAccess(db, ctx, row);
  assertCollectionWritable(ctx, access);
  return row;
}

/**
 * Every open task in a visible collection, bucketed with `bucketOf`. The
 * `collectionId` and `view` filters only narrow `tasks`: `counts` always covers
 * all visible open tasks, because the rail badges must not change when the user
 * narrows a list. Done and dropped tasks are deliberately absent from every
 * list view; a task dated beyond this week has no bucket, so only `"all"` shows
 * it. `ensureInbox` may create the caller's Inbox on the first call.
 */
export function listTasks(
  db: Database,
  ctx: ViewerContext,
  input: ListTasksInput,
): { tasks: TaskView[]; counts: TaskCounts } {
  const inbox = ensureInbox(db, ctx);
  const visibleIds = resolveVisibleCollections(db, ctx).map((row) => row.id);
  const counts: TaskCounts = { inbox: 0, today: 0, week: 0, someday: 0, overdue: 0 };
  if (visibleIds.length === 0) {
    return { tasks: [], counts };
  }

  const today = localToday(input.timezone);
  const bucketContext: BucketContext = {
    today,
    endOfWeek: endOfWeek(today, input.weekStartsOn),
    inboxId: inbox.id,
  };

  const open = db
    .select()
    .from(task)
    .where(
      and(
        eq(task.householdId, ctx.householdId),
        eq(task.status, "open"),
        inArray(task.collectionId, visibleIds),
      ),
    )
    .all();

  for (const row of open) {
    const bucket = bucketOf(row, bucketContext);
    if (bucket) {
      counts[bucket] += 1;
    }
    if (isOverdue(row, today)) {
      counts.overdue += 1;
    }
  }

  const view = input.view ?? "all";
  const rows = open
    .filter((row) => input.collectionId === undefined || row.collectionId === input.collectionId)
    .filter((row) => view === "all" || bucketOf(row, bucketContext) === view)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );

  return { tasks: rows.map((row) => toTaskView(db, row)), counts };
}

function nextSortOrder(db: Database, collectionId: string): number {
  const rows = db.select().from(task).where(eq(task.collectionId, collectionId)).all();
  return rows.reduce((highest, row) => Math.max(highest, row.sortOrder), -1) + 1;
}

/**
 * A task lives only in a `kind: "list"` collection; a calendar holds events.
 * Runs after the write check, so a private or view-only calendar keeps
 * answering 404/403 instead of revealing its kind.
 */
function assertTaskList(access: CollectionAccess): void {
  if (access.collection.kind !== "list") {
    throw new AppError("VALIDATION", "Tasks live in lists.", 400);
  }
}

/**
 * Captures into the caller's Inbox unless an explicit collection is given. The
 * target must be a list, so a calendar is a `VALIDATION` 400.
 */
export function createTask(
  db: Database,
  ctx: ViewerContext,
  input: CreateTaskInput,
): TaskView {
  const collectionId = input.collectionId ?? ensureInbox(db, ctx).id;
  const access = getCollectionAccess(db, ctx, collectionId);
  assertCollectionWritable(ctx, access);
  assertTaskList(access);

  const now = Date.now();
  const row: TaskRow = {
    id: crypto.randomUUID(),
    householdId: ctx.householdId,
    collectionId: access.collection.id,
    title: input.title.trim(),
    notes: input.notes ?? null,
    status: "open",
    priority: input.priority ?? "none",
    scheduledOn: input.scheduledOn ?? null,
    dueOn: input.dueOn ?? null,
    completedAt: null,
    droppedAt: null,
    sortOrder: nextSortOrder(db, collectionId),
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(task).values(row).run();
  return toTaskView(db, row);
}

function replaceChecklist(
  db: Database,
  taskId: string,
  items: NonNullable<UpdateTaskInput["checklist"]>,
): void {
  db.delete(taskChecklistItem).where(eq(taskChecklistItem.taskId, taskId)).run();
  items.forEach((item, index) => {
    db.insert(taskChecklistItem)
      .values({
        // Ids are always server-generated: a replacement list never reuses the
        // ids the client sent.
        id: crypto.randomUUID(),
        taskId,
        title: item.title.trim(),
        done: item.done ? 1 : 0,
        sortOrder: index,
      })
      .run();
  });
}

/**
 * Patches only the whitelisted columns. A `collectionId` move needs write
 * access on both ends, must target a list, and appends the task at the end of
 * that list. `status` owns the audit stamps, and only a real transition moves
 * them: done sets `completedAt`, dropped sets `droppedAt`, open clears both,
 * switching between done and dropped clears the other stamp, and a PATCH that
 * echoes the stored status leaves the row (and its history) untouched. A
 * present `checklist` replaces the whole list in the same transaction as the
 * row patch.
 */
export function updateTask(
  db: Database,
  ctx: ViewerContext,
  id: string,
  input: UpdateTaskInput,
): TaskView {
  const row = writableTask(db, ctx, id);

  if (input.collectionId !== undefined && input.collectionId !== row.collectionId) {
    const targetAccess = getCollectionAccess(db, ctx, input.collectionId);
    assertCollectionWritable(ctx, targetAccess);
    assertTaskList(targetAccess);
  }

  const now = Date.now();
  const patch: Partial<TaskRow> = {};
  if (input.title !== undefined) {
    patch.title = input.title.trim();
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes ?? null;
  }
  if (input.scheduledOn !== undefined) {
    patch.scheduledOn = input.scheduledOn ?? null;
  }
  if (input.dueOn !== undefined) {
    patch.dueOn = input.dueOn ?? null;
  }
  if (input.sortOrder !== undefined) {
    patch.sortOrder = input.sortOrder;
  }
  if (input.collectionId !== undefined && input.collectionId !== row.collectionId) {
    patch.collectionId = input.collectionId;
    // A move appends, using the same calculation as a create: it must not carry
    // the source list's position into the target.
    patch.sortOrder = nextSortOrder(db, input.collectionId);
  }
  if (input.status !== undefined && input.status !== row.status) {
    patch.status = input.status;
    if (input.status === "done") {
      patch.completedAt = now;
      patch.droppedAt = null;
    } else if (input.status === "dropped") {
      patch.completedAt = null;
      patch.droppedAt = now;
    } else {
      patch.completedAt = null;
      patch.droppedAt = null;
    }
  }

  const hasChecklist = input.checklist !== undefined;
  if (Object.keys(patch).length === 0 && !hasChecklist) {
    return toTaskView(db, row);
  }
  patch.updatedAt = now;

  const write = (target: Database) => {
    target.update(task).set(patch).where(eq(task.id, id)).run();
    if (hasChecklist) {
      replaceChecklist(target, id, input.checklist ?? []);
    }
  };

  if (hasChecklist) {
    db.transaction((tx) => write(tx as unknown as Database));
  } else {
    write(db);
  }

  return getTask(db, ctx, id);
}

/** Hard delete; there is no trash. The checklist rows cascade with the task. */
export function deleteTask(db: Database, ctx: ViewerContext, id: string): void {
  writableTask(db, ctx, id);
  db.delete(task).where(eq(task.id, id)).run();
}

/**
 * Rewrites the manual order of a list (a calendar is not a task home and
 * answers `VALIDATION` 400 "Tasks live in lists."). The payload must be exactly
 * the collection's open tasks — same set, no duplicates — so a stale client
 * cannot silently drop a task that another session created; the caller then
 * re-fetches instead of guessing. Returns the reordered views.
 */
export function reorderTasks(
  db: Database,
  ctx: ViewerContext,
  input: ReorderTasksInput,
): TaskView[] {
  const access = getCollectionAccess(db, ctx, input.collectionId);
  assertCollectionWritable(ctx, access);
  assertTaskList(access);

  const open = db
    .select()
    .from(task)
    .where(
      and(
        eq(task.householdId, ctx.householdId),
        eq(task.collectionId, input.collectionId),
        eq(task.status, "open"),
      ),
    )
    .all();
  const openIds = new Set(open.map((row) => row.id));
  const sentIds = new Set(input.orderedIds);
  const exact =
    sentIds.size === input.orderedIds.length &&
    sentIds.size === openIds.size &&
    input.orderedIds.every((taskId) => openIds.has(taskId));

  if (!exact) {
    throw new AppError("VALIDATION", "Send exactly the open tasks of this list.", 400);
  }

  const now = Date.now();
  db.transaction((tx) => {
    const target = tx as unknown as Database;
    input.orderedIds.forEach((taskId, index) => {
      target
        .update(task)
        .set({ sortOrder: index, updatedAt: now })
        .where(eq(task.id, taskId))
        .run();
    });
  });

  const fresh = new Map(
    db
      .select()
      .from(task)
      .where(eq(task.collectionId, input.collectionId))
      .all()
      .map((row) => [row.id, row]),
  );
  return input.orderedIds.map((taskId) => toTaskView(db, fresh.get(taskId)!));
}
