import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  collection,
  household,
  task,
  taskChecklistItem,
  type CollectionRow,
  type TaskRow,
  type TaskStatus,
} from "@/lib/db/schema";
import {
  TASK_ACTIVE_STATUSES,
  bucketOf,
  bucketOfIncludingClosed,
  endOfWeek,
  isActiveStatus,
  isOverdue,
  localTimeOfDay,
  localToday,
  type BucketContext,
  type TaskScope,
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
} from "./collections";
import type { ViewerContext } from "./permissions";

/**
 * Task reads, writes and derived views. A task is only visible while the
 * collection that holds it is visible: every entry point resolves permissions
 * through `lib/services/collections.ts` (`resolveVisibleCollections` for the
 * tree, `getCollectionAccess` for one id) and never re-implements the private
 * predicate. A task may live in a calendar or a list; views are derived in
 * JavaScript with `lib/domain/tasks.ts`, so the bucket rules live in exactly
 * one place.
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
  /**
   * Server-computed deadline state (`isOverdue`) against the household clock, so
   * the red chip never depends on the device clock or a stale client "today".
   */
  overdue: boolean;
}

/** The household-local date and wall-clock time a task view's deadline is judged against. */
export interface TaskDueContext {
  today: string;
  nowTime: string;
}

export interface TaskCounts {
  /** Every visible active task, including the ones dated beyond this week. */
  all: number;
  today: number;
  week: number;
  someday: number;
  overdue: number;
}

/** The rail counts plus the active-task total of every collection that has one. */
export interface TaskCountSummary {
  counts: TaskCounts;
  byCollection: Record<string, number>;
}

export interface ListTasksInput {
  /** A scope: one time bucket, or `"all"` (the default) — omitted means all too. */
  view?: TaskScope;
  collectionId?: string;
  /**
   * Opt in to `done`/`dropped` rows as well as the active pair. Closed rows are
   * then bucketed by their dates with `bucketOfIncludingClosed`; `counts` stay
   * active-only either way.
   */
  includeClosed?: boolean;
  timezone: string;
  weekStartsOn: 0 | 1;
}

/** The household's local date and wall-clock time now, for server-computed overdue. */
function dueContext(db: Database, ctx: ViewerContext): TaskDueContext {
  const row = db
    .select({ timezone: household.timezone })
    .from(household)
    .where(eq(household.id, ctx.householdId))
    .get();
  const timezone = row?.timezone ?? "UTC";
  const now = Date.now();
  return { today: localToday(timezone, now), nowTime: localTimeOfDay(timezone, now) };
}

/**
 * Builds the client-facing task row. This attaches storage data only: it does
 * not check visibility, so callers must pass a row whose collection the viewer
 * may read — every exported reader and writer below does.
 */
export function toTaskView(db: Database, row: TaskRow, due: TaskDueContext): TaskView {
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
    overdue: isOverdue(row, due.today, due.nowTime),
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
  return toTaskView(db, row, dueContext(db, ctx));
}

function writableTask(db: Database, ctx: ViewerContext, id: string) {
  const row = loadTask(db, ctx, id);
  const access = taskAccess(db, ctx, row);
  assertCollectionWritable(ctx, access);
  return row;
}

/** The statuses a readable task set covers; closed rows are opt-in. */
function readStatuses(includeClosed: boolean): readonly TaskStatus[] {
  return includeClosed ? [...TASK_ACTIVE_STATUSES, "done", "dropped"] : TASK_ACTIVE_STATUSES;
}

/**
 * Every task in one of `statuses` across `visibleIds`. Callers only pass ids the
 * viewer already resolved through `resolveVisibleCollections`, so this is the
 * one read both `listTasks` and `getTaskCountSummary` build on.
 */
function readTasks(
  db: Database,
  ctx: ViewerContext,
  statuses: readonly TaskStatus[],
  visibleIds: string[],
): TaskRow[] {
  return db
    .select()
    .from(task)
    .where(
      and(
        eq(task.householdId, ctx.householdId),
        inArray(task.status, statuses),
        inArray(task.collectionId, visibleIds),
      ),
    )
    .all();
}

/**
 * The rail badges over active rows only. `all` counts every visible active row,
 * including the ones dated beyond this week that no time bucket holds. Closed
 * rows are skipped, so widening a read with `includeClosed` can never move a
 * count.
 */
function countActive(rows: TaskRow[], bucketContext: BucketContext, due: TaskDueContext): TaskCounts {
  const counts: TaskCounts = { all: 0, today: 0, week: 0, someday: 0, overdue: 0 };
  for (const row of rows) {
    if (!isActiveStatus(row.status)) {
      continue;
    }
    counts.all += 1;
    const bucket = bucketOf(row, bucketContext);
    if (bucket) {
      counts[bucket] += 1;
    }
    if (isOverdue(row, due.today, due.nowTime)) {
      counts.overdue += 1;
    }
  }
  return counts;
}

/**
 * Every task in a visible collection, bucketed with `bucketOf`. The
 * `collectionId` and `view` filters only narrow `tasks`: `counts` always covers
 * all visible active tasks (`all` included), because the rail badges must not
 * change when the user narrows a list. Done and dropped rows are absent by
 * default; with `includeClosed` they join the read set and the `view` filter
 * buckets them with `bucketOfIncludingClosed`, so a finished task dated today
 * still lands in Today. A task dated beyond this week has no bucket, so only
 * `"all"` shows it. Reading tasks never creates the caller's Inbox: the Inbox is
 * an ordinary list as far as the views are concerned.
 */
export function listTasks(
  db: Database,
  ctx: ViewerContext,
  input: ListTasksInput,
): { tasks: TaskView[]; counts: TaskCounts } {
  const visibleIds = resolveVisibleCollections(db, ctx).map((row) => row.id);
  const now = Date.now();
  const today = localToday(input.timezone, now);
  const due: TaskDueContext = { today, nowTime: localTimeOfDay(input.timezone, now) };
  const bucketContext: BucketContext = {
    today,
    endOfWeek: endOfWeek(today, input.weekStartsOn),
  };

  const includeClosed = input.includeClosed === true;
  const candidates =
    visibleIds.length === 0 ? [] : readTasks(db, ctx, readStatuses(includeClosed), visibleIds);
  const counts = countActive(candidates, bucketContext, due);

  const view = input.view ?? "all";
  const bucketOfRow = includeClosed ? bucketOfIncludingClosed : bucketOf;
  const rows = candidates
    .filter((row) => input.collectionId === undefined || row.collectionId === input.collectionId)
    .filter((row) => view === "all" || bucketOfRow(row, bucketContext) === view)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );

  return { tasks: rows.map((row) => toTaskView(db, row, due)), counts };
}

/**
 * The counts payload behind the per-list badges: active tasks in
 * `resolveVisibleCollections` only, with `counts` carrying the same meaning as
 * `listTasks`'s counts. `byCollection` is keyed by collection id and contains
 * only collections that hold at least one active task, so neither an empty list
 * nor a private list the viewer cannot read can produce a key.
 */
export function getTaskCountSummary(
  db: Database,
  ctx: ViewerContext,
  input: { timezone: string; weekStartsOn: 0 | 1 },
): TaskCountSummary {
  const visibleIds = resolveVisibleCollections(db, ctx).map((row) => row.id);
  const now = Date.now();
  const today = localToday(input.timezone, now);
  const due: TaskDueContext = { today, nowTime: localTimeOfDay(input.timezone, now) };
  const bucketContext: BucketContext = {
    today,
    endOfWeek: endOfWeek(today, input.weekStartsOn),
  };

  const active = visibleIds.length === 0 ? [] : readTasks(db, ctx, TASK_ACTIVE_STATUSES, visibleIds);
  const byCollection: Record<string, number> = {};
  for (const row of active) {
    byCollection[row.collectionId] = (byCollection[row.collectionId] ?? 0) + 1;
  }
  return { counts: countActive(active, bucketContext, due), byCollection };
}

function nextSortOrder(db: Database, collectionId: string): number {
  const rows = db.select().from(task).where(eq(task.collectionId, collectionId)).all();
  return rows.reduce((highest, row) => Math.max(highest, row.sortOrder), -1) + 1;
}

/**
 * Captures into the caller's Inbox unless an explicit collection is given. Any
 * writable collection is a valid task home — a calendar and a list are both
 * accepted, so a task can be filed under the same subject the calendar uses.
 *
 * `status` may only arrive as one of the two active states (`createTaskSchema`
 * rejects `done`/`dropped`), so a create never needs audit stamps: both
 * `completedAt` and `droppedAt` stay null, exactly like the `open` default.
 */
export function createTask(
  db: Database,
  ctx: ViewerContext,
  input: CreateTaskInput,
): TaskView {
  const collectionId = input.collectionId ?? ensureInbox(db, ctx).id;
  const access = getCollectionAccess(db, ctx, collectionId);
  assertCollectionWritable(ctx, access);

  const dueOn = input.dueOn ?? null;
  const dueTime = input.dueTime ?? null;
  if (dueTime !== null && dueOn === null) {
    throw new AppError("VALIDATION", "Give the task a due date before a due time.", 400);
  }

  const now = Date.now();
  const row: TaskRow = {
    id: crypto.randomUUID(),
    householdId: ctx.householdId,
    collectionId: access.collection.id,
    title: input.title.trim(),
    notes: input.notes ?? null,
    status: input.status ?? "open",
    priority: input.priority ?? "none",
    dueOn,
    dueTime,
    completedAt: null,
    droppedAt: null,
    sortOrder: nextSortOrder(db, collectionId),
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(task).values(row).run();
  return toTaskView(db, row, dueContext(db, ctx));
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
 * access on both ends, may target any collection (calendar or list), and appends
 * the task at the end of the target's order.
 * `status` owns the audit stamps, and only a real transition moves
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
  }

  const now = Date.now();
  const patch: Partial<TaskRow> = {};
  if (input.title !== undefined) {
    patch.title = input.title.trim();
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes ?? null;
  }
  if (input.priority !== undefined) {
    patch.priority = input.priority;
  }
  const dueOn = input.dueOn !== undefined ? input.dueOn : row.dueOn;
  if (input.dueTime !== undefined && input.dueTime !== null && dueOn === null) {
    throw new AppError("VALIDATION", "Give the task a due date before a due time.", 400);
  }
  if (input.dueOn !== undefined) {
    patch.dueOn = input.dueOn ?? null;
    if (patch.dueOn === null) {
      // Clearing the date clears the time that belonged to it, in one PATCH.
      patch.dueTime = null;
    }
  }
  if (input.dueTime !== undefined) {
    patch.dueTime = input.dueTime ?? null;
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
    return toTaskView(db, row, dueContext(db, ctx));
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
 * Rewrites the manual order of one collection (any writable collection — a
 * calendar can hold tasks too). The payload must be exactly
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

  const active = db
    .select()
    .from(task)
    .where(
      and(
        eq(task.householdId, ctx.householdId),
        eq(task.collectionId, input.collectionId),
        inArray(task.status, TASK_ACTIVE_STATUSES),
      ),
    )
    .all();
  const activeIds = new Set(active.map((row) => row.id));
  const sentIds = new Set(input.orderedIds);
  const exact =
    sentIds.size === input.orderedIds.length &&
    sentIds.size === activeIds.size &&
    input.orderedIds.every((taskId) => activeIds.has(taskId));

  if (!exact) {
    throw new AppError("VALIDATION", "Send exactly the active tasks of this list.", 400);
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
  const due = dueContext(db, ctx);
  return input.orderedIds.map((taskId) => toTaskView(db, fresh.get(taskId)!, due));
}
