import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { task, taskChecklistItem } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { createCollection, ensureInbox } from "@/lib/services/collections";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  reorderTasks,
  updateTask,
  type TaskView,
} from "@/lib/services/tasks";
import {
  checklistInputSchema,
  createTaskSchema,
  dateOnlySchema,
  reorderTasksSchema,
  updateTaskSchema,
} from "@/lib/validation/tasks";
import { makeSeededDb, type SeededDb } from "../helpers/fixtures";

/**
 * Task service (spec D5/D6). `vi` pins the clock to Wednesday 2026-10-21 noon in
 * Taipei, so the bucket boundaries are the same real dates as
 * `tests/unit/tasks-buckets.test.ts`: a Sunday-started week ends Saturday
 * 2026-10-24, a Monday-started week ends Sunday 2026-10-25. Only `Date` is
 * faked — better-sqlite3 stays synchronous and untouched.
 */
const TODAY = "2026-10-21";
const SUNDAY_WEEK_END = "2026-10-24";
const MONDAY_WEEK_END = "2026-10-25";
const NOW = Date.parse("2026-10-21T04:00:00Z");
const TIMEZONE = "Asia/Taipei";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function expectAppError(fn: () => unknown, code: string, status: number, message?: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    expect((error as AppError).status).toBe(status);
    if (message !== undefined) {
      expect((error as AppError).message).toBe(message);
    }
    return;
  }
  throw new Error(`expected AppError ${code}, but call succeeded`);
}

/** A shared list, the caller's private list, a view-only list and a shared calendar. */
function makeLists(seeded: SeededDb) {
  const shared = createCollection(seeded.db, seeded.ctxA, {
    name: "House",
    kind: "list",
    hueFamily: "teal",
  });
  const privateList = createCollection(seeded.db, seeded.ctxA, {
    name: "Journal",
    kind: "list",
    hueFamily: "rose",
    ownerId: "user-a",
    visibility: "private",
  });
  const viewOnly = createCollection(seeded.db, seeded.ctxA, {
    name: "Plan",
    kind: "list",
    hueFamily: "amber",
    ownerId: "user-a",
    visibility: "view_only",
  });
  const calendar = createCollection(seeded.db, seeded.ctxA, {
    name: "Shared calendar",
    kind: "calendar",
    hueFamily: "sky",
  });
  return { shared, privateList, viewOnly, calendar };
}

function ids(tasks: TaskView[]): string[] {
  return tasks.map((row) => row.id);
}

function checklistRows(seeded: SeededDb, taskId: string) {
  return seeded.db
    .select()
    .from(taskChecklistItem)
    .where(eq(taskChecklistItem.taskId, taskId))
    .all()
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function filterInput(overrides: Partial<Parameters<typeof listTasks>[2]> = {}) {
  return { timezone: TIMEZONE, weekStartsOn: 0 as const, ...overrides };
}

describe("createTask", () => {
  it("defaults to the caller's Inbox, trims the title and appends in insert order", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    try {
      const inbox = ensureInbox(db, ctxA);
      const first = createTask(db, ctxA, { title: "  Buy milk  " });
      const second = createTask(db, ctxA, { title: "Call the plumber" });

      expect(first).toMatchObject({
        title: "Buy milk",
        notes: null,
        status: "open",
        scheduledOn: null,
        dueOn: null,
        completedAt: null,
        droppedAt: null,
        sortOrder: 0,
        collectionId: inbox.id,
        householdId: "h1",
        createdBy: "user-a",
        createdAt: NOW,
      });
      expect(first.checklist).toEqual([]);
      expect(first.collection).toEqual({
        id: inbox.id,
        name: "Inbox",
        kind: "list",
        hueFamily: inbox.hueFamily,
        shadeIndex: inbox.shadeIndex,
      });
      expect(second.sortOrder).toBe(1);
      expect(second.collection.id).toBe(inbox.id);
    } finally {
      close();
    }
  });

  it("stores explicit dates, notes and the target list summary", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, {
        title: "File taxes",
        notes: "W-2 is in the drawer.",
        collectionId: shared.id,
        scheduledOn: TODAY,
        dueOn: "2026-10-30",
      });

      expect(created).toMatchObject({
        collectionId: shared.id,
        scheduledOn: TODAY,
        dueOn: "2026-10-30",
        notes: "W-2 is in the drawer.",
        sortOrder: 0,
      });
      expect(created.collection).toEqual({
        id: shared.id,
        name: "House",
        kind: "list",
        hueFamily: "teal",
        shadeIndex: shared.shadeIndex,
      });
    } finally {
      close();
    }
  });

  it("hides a private list (404) and refuses a partner's view-only list (403)", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxB, ctxOther } = seeded;
    const { shared, privateList, viewOnly } = makeLists(seeded);
    try {
      expectAppError(
        () => createTask(db, ctxB, { title: "Snoop", collectionId: privateList.id }),
        "NOT_FOUND",
        404,
      );
      expectAppError(
        () => createTask(db, ctxB, { title: "Hijack", collectionId: viewOnly.id }),
        "FORBIDDEN",
        403,
      );
      expectAppError(
        () => createTask(db, ctxOther, { title: "Foreign", collectionId: shared.id }),
        "NOT_FOUND",
        404,
      );
      expectAppError(
        () => createTask(db, ctxB, { title: "Nowhere", collectionId: "missing-list" }),
        "NOT_FOUND",
        404,
      );
    } finally {
      close();
    }
  });

  it("refuses a calendar as a task home", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { calendar } = makeLists(seeded);
    try {
      expectAppError(
        () => createTask(db, ctxA, { title: "Not an event", collectionId: calendar.id }),
        "VALIDATION",
        400,
        "Tasks live in lists.",
      );
      expect(db.select().from(task).all()).toEqual([]);
    } finally {
      close();
    }
  });
});

describe("listTasks", () => {
  it("filters the four D6 buckets and reports global counts for both week starts", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const someday = createTask(db, ctxA, { title: "Undated shared", collectionId: shared.id });
      const today = createTask(db, ctxA, {
        title: "Scheduled today",
        collectionId: shared.id,
        scheduledOn: TODAY,
      });
      const week = createTask(db, ctxA, {
        title: "Due Thursday",
        collectionId: shared.id,
        dueOn: "2026-10-22",
      });
      const sunday = createTask(db, ctxA, {
        title: "Due Sunday",
        collectionId: shared.id,
        dueOn: MONDAY_WEEK_END,
      });
      const overdue = createTask(db, ctxA, {
        title: "Due yesterday",
        collectionId: shared.id,
        dueOn: "2026-10-20",
      });
      const nextWeek = createTask(db, ctxA, {
        title: "Next Monday",
        collectionId: shared.id,
        scheduledOn: "2026-10-26",
      });
      const inboxTask = createTask(db, ctxA, { title: "Undated inbox" });

      const monday = listTasks(db, ctxA, filterInput({ timezone: TIMEZONE, weekStartsOn: 1 }));
      expect(ids(monday.tasks)).toHaveLength(7);
      expect(monday.counts).toEqual({ inbox: 1, today: 2, week: 2, someday: 1, overdue: 1 });

      const sundayWeek = listTasks(db, ctxA, filterInput({ timezone: TIMEZONE, weekStartsOn: 0 }));
      // Sunday 2026-10-25 is beyond a Sunday-started week, so it belongs to no
      // bucket and only `view: "all"` shows it.
      expect(sundayWeek.counts).toEqual({ inbox: 1, today: 2, week: 1, someday: 1, overdue: 1 });

      const buckets = {
        inbox: filterInput({ weekStartsOn: 1 as const, view: "inbox" as const }),
        today: filterInput({ weekStartsOn: 1 as const, view: "today" as const }),
        week: filterInput({ weekStartsOn: 1 as const, view: "week" as const }),
        someday: filterInput({ weekStartsOn: 1 as const, view: "someday" as const }),
      };
      expect(ids(listTasks(db, ctxA, buckets.inbox).tasks)).toEqual([inboxTask.id]);
      expect(ids(listTasks(db, ctxA, buckets.today).tasks)).toEqual([today.id, overdue.id]);
      expect(ids(listTasks(db, ctxA, buckets.week).tasks)).toEqual([week.id, sunday.id]);
      expect(ids(listTasks(db, ctxA, buckets.someday).tasks)).toEqual([someday.id]);

      const mondayWeek = listTasks(db, ctxA, filterInput({ weekStartsOn: 1, view: "week" }));
      expect(ids(mondayWeek.tasks)).toEqual([week.id, sunday.id]);
      const sundayWeekView = listTasks(db, ctxA, filterInput({ weekStartsOn: 0, view: "week" }));
      expect(ids(sundayWeekView.tasks)).toEqual([week.id]);

      const all = listTasks(
        db,
        ctxA,
        filterInput({ weekStartsOn: 1, view: "all", collectionId: shared.id }),
      );
      expect(ids(all.tasks)).toEqual([
        someday.id,
        today.id,
        week.id,
        sunday.id,
        overdue.id,
        nextWeek.id,
      ]);
      expect(all.counts).toEqual(monday.counts);
      expect(ids(listTasks(db, ctxA, filterInput({ view: "all" })).tasks)).toHaveLength(7);

      // Counts are global: a view or collection filter never narrows them.
      const filtered = listTasks(
        db,
        ctxA,
        filterInput({ weekStartsOn: 1, view: "week", collectionId: shared.id }),
      );
      expect(ids(filtered.tasks)).toEqual([week.id, sunday.id]);
      expect(filtered.counts).toEqual(monday.counts);
    } finally {
      close();
    }
  });

  it("counts overdue open tasks on every view, never done or due-today ones", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const pastDue = createTask(db, ctxA, {
        title: "Past due",
        collectionId: shared.id,
        dueOn: "2026-10-20",
      });
      createTask(db, ctxA, {
        title: "Due today",
        collectionId: shared.id,
        dueOn: TODAY,
      });
      const done = createTask(db, ctxA, {
        title: "Done already",
        collectionId: shared.id,
        dueOn: "2026-10-19",
      });
      updateTask(db, ctxA, done.id, { status: "done" });

      for (const view of ["inbox", "today", "week", "someday", "all"] as const) {
        const result = listTasks(db, ctxA, filterInput({ view, weekStartsOn: 1 }));
        expect(result.counts.overdue).toBe(1);
        expect(ids(result.tasks)).not.toContain(done.id);
        if (view === "today") {
          expect(ids(result.tasks)).toContain(pastDue.id);
        }
      }
    } finally {
      close();
    }
  });

  it("keeps a private list's tasks out of the partner's list and counts", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA, ctxB, ctxOther } = seeded;
    const { privateList } = makeLists(seeded);
    try {
      const hidden = createTask(db, ctxA, { title: "Secret", collectionId: privateList.id });

      const partner = listTasks(db, ctxB, filterInput({ view: "all" }));
      expect(partner.tasks).toEqual([]);
      expect(partner.counts).toEqual({ inbox: 0, today: 0, week: 0, someday: 0, overdue: 0 });
      expect(listTasks(db, ctxOther, filterInput({ view: "all" })).tasks).toEqual([]);

      // The owner still sees it.
      expect(ids(listTasks(db, ctxA, filterInput({ view: "all" })).tasks)).toEqual([hidden.id]);
    } finally {
      close();
    }
  });

  it("lets the partner read a view-only list's tasks but never write them", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA, ctxB } = seeded;
    const { viewOnly } = makeLists(seeded);
    try {
      const task = createTask(db, ctxA, { title: "Plan item", collectionId: viewOnly.id });

      expect(getTask(db, ctxB, task.id).title).toBe("Plan item");
      expect(ids(listTasks(db, ctxB, filterInput({ view: "all" })).tasks)).toEqual([task.id]);
      expectAppError(() => updateTask(db, ctxB, task.id, { title: "Mine" }), "FORBIDDEN", 403);
      expectAppError(() => deleteTask(db, ctxB, task.id), "FORBIDDEN", 403);
    } finally {
      close();
    }
  });
});

describe("getTask", () => {
  it("answers 404 for a missing, foreign or private-not-owned task", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA, ctxB, ctxOther } = seeded;
    const { privateList } = makeLists(seeded);
    try {
      const secret = createTask(db, ctxA, { title: "Secret", collectionId: privateList.id });

      expectAppError(() => getTask(db, ctxA, "missing-task"), "NOT_FOUND", 404, "Task not found.");
      expectAppError(() => getTask(db, ctxB, secret.id), "NOT_FOUND", 404, "Task not found.");
      expectAppError(() => getTask(db, ctxOther, secret.id), "NOT_FOUND", 404, "Task not found.");

      expect(getTask(db, ctxA, secret.id).id).toBe(secret.id);
    } finally {
      close();
    }
  });
});

describe("updateTask", () => {
  it("writes the status audit timestamps and clears them again", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, { title: "Water plants", collectionId: shared.id });

      const done = updateTask(db, ctxA, created.id, { status: "done" });
      expect(done.status).toBe("done");
      expect(done.completedAt).toBe(NOW);
      expect(done.droppedAt).toBeNull();
      expect(ids(listTasks(db, ctxA, filterInput({ view: "all" })).tasks)).toEqual([]);

      const reopened = updateTask(db, ctxA, created.id, { status: "open" });
      expect(reopened.completedAt).toBeNull();
      expect(reopened.droppedAt).toBeNull();
      expect(ids(listTasks(db, ctxA, filterInput({ view: "all" })).tasks)).toEqual([created.id]);

      const dropped = updateTask(db, ctxA, created.id, { status: "dropped" });
      expect(dropped.droppedAt).toBe(NOW);
      expect(dropped.completedAt).toBeNull();

      // done -> dropped also clears the misleading completion stamp.
      updateTask(db, ctxA, created.id, { status: "done" });
      const redropped = updateTask(db, ctxA, created.id, { status: "dropped" });
      expect(redropped.droppedAt).toBe(NOW);
      expect(redropped.completedAt).toBeNull();
    } finally {
      close();
    }
  });

  it("moves the audit stamps only on a real status transition", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, { title: "Ship it", collectionId: shared.id });
      const done = updateTask(db, ctxA, created.id, { status: "done" });
      expect(done.completedAt).toBe(NOW);

      // A later PATCH that echoes the stored status must not rewrite history.
      vi.setSystemTime(new Date(NOW + 60_000));
      const echoed = updateTask(db, ctxA, created.id, { status: "done" });
      expect(echoed.completedAt).toBe(done.completedAt);
      expect(echoed.completedAt).toBe(NOW);
      expect(echoed.updatedAt).toBe(done.updatedAt);

      // done -> open is a real transition and clears both audit stamps.
      vi.setSystemTime(new Date(NOW + 120_000));
      const reopened = updateTask(db, ctxA, created.id, { status: "open" });
      expect(reopened.status).toBe("open");
      expect(reopened.completedAt).toBeNull();
      expect(reopened.droppedAt).toBeNull();
    } finally {
      close();
    }
  });

  it("patches whitelisted fields and returning the merged view", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, { title: "Draft", collectionId: shared.id });

      const updated = updateTask(db, ctxA, created.id, {
        title: "  Final  ",
        notes: "Bring the keys.",
        scheduledOn: TODAY,
        dueOn: SUNDAY_WEEK_END,
        sortOrder: 7,
      });

      expect(updated).toMatchObject({
        title: "Final",
        notes: "Bring the keys.",
        scheduledOn: TODAY,
        dueOn: SUNDAY_WEEK_END,
        sortOrder: 7,
        status: "open",
      });
      expect(getTask(db, ctxA, created.id)).toMatchObject({ title: "Final", notes: "Bring the keys." });

      // An empty patch is a read, not a write.
      expect(updateTask(db, ctxA, created.id, {})).toEqual(getTask(db, ctxA, created.id));
    } finally {
      close();
    }
  });

  it("requires write access on both the current and the target list when moving", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA, ctxB } = seeded;
    const { shared, privateList, viewOnly } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, { title: "Move me", collectionId: shared.id });

      // The partner may not move a shared task into a view-only or private list.
      expectAppError(
        () => updateTask(db, ctxB, created.id, { collectionId: viewOnly.id }),
        "FORBIDDEN",
        403,
      );
      expectAppError(
        () => updateTask(db, ctxB, created.id, { collectionId: privateList.id }),
        "NOT_FOUND",
        404,
      );
      // Nor may the owner move a task out of a list they cannot write.
      const pinned = createTask(db, ctxA, { title: "Pinned", collectionId: viewOnly.id });
      expectAppError(
        () => updateTask(db, ctxB, pinned.id, { collectionId: shared.id }),
        "FORBIDDEN",
        403,
      );

      const moved = updateTask(db, ctxA, created.id, { collectionId: privateList.id });
      expect(moved.collectionId).toBe(privateList.id);
      expect(moved.collection.id).toBe(privateList.id);
      expect(
        ids(listTasks(db, ctxA, filterInput({ view: "all", collectionId: privateList.id })).tasks),
      ).toEqual([moved.id]);
    } finally {
      close();
    }
  });

  it("refuses a move into a calendar", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared, calendar } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, { title: "Stay put", collectionId: shared.id });

      expectAppError(
        () => updateTask(db, ctxA, created.id, { collectionId: calendar.id }),
        "VALIDATION",
        400,
        "Tasks live in lists.",
      );
      expect(getTask(db, ctxA, created.id).collectionId).toBe(shared.id);
    } finally {
      close();
    }
  });

  it("appends a moved task to the end of the target list", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared, privateList } = makeLists(seeded);
    try {
      // List A holds orders 0 and 1; list B already has order 5.
      const first = createTask(db, ctxA, { title: "First", collectionId: shared.id });
      const second = createTask(db, ctxA, { title: "Second", collectionId: shared.id });
      const target = createTask(db, ctxA, { title: "Target", collectionId: privateList.id });
      const positioned = updateTask(db, ctxA, target.id, { sortOrder: 5 });
      expect([first.sortOrder, second.sortOrder, positioned.sortOrder]).toEqual([0, 1, 5]);

      const moved = updateTask(db, ctxA, first.id, { collectionId: privateList.id });
      expect(moved.collectionId).toBe(privateList.id);
      expect(moved.sortOrder).toBe(6);

      const targetTasks = listTasks(
        db,
        ctxA,
        filterInput({ view: "all", collectionId: privateList.id }),
      );
      expect(ids(targetTasks.tasks)).toEqual([target.id, moved.id]);

      // The source list keeps its remaining order.
      const sourceTasks = listTasks(db, ctxA, filterInput({ view: "all", collectionId: shared.id }));
      expect(ids(sourceTasks.tasks)).toEqual([second.id]);
    } finally {
      close();
    }
  });

  it("replaces the checklist wholesale, regenerating ids and sort order", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, { title: "Packing", collectionId: shared.id });

      const two = updateTask(db, ctxA, created.id, {
        checklist: [
          { title: "Passport", done: false },
          { title: "Charger", done: true },
        ],
      });
      expect(two.checklist).toHaveLength(2);
      expect(two.checklist.map((item) => item.title)).toEqual(["Passport", "Charger"]);
      expect(two.checklist.map((item) => item.done)).toEqual([false, true]);
      const firstIds = two.checklist.map((item) => item.id);
      expect(new Set(firstIds).size).toBe(2);
      expect(checklistRows(seeded, created.id)).toEqual([
        expect.objectContaining({ id: firstIds[0], title: "Passport", done: 0, sortOrder: 0 }),
        expect.objectContaining({ id: firstIds[1], title: "Charger", done: 1, sortOrder: 1 }),
      ]);

      const one = updateTask(db, ctxA, created.id, {
        checklist: [{ title: "Passport", done: true }],
      });
      expect(one.checklist).toHaveLength(1);
      expect(one.checklist[0]).toMatchObject({ title: "Passport", done: true });
      expect(one.checklist[0]?.id).not.toBe(firstIds[0]);
      expect(checklistRows(seeded, created.id)).toEqual([
        expect.objectContaining({ title: "Passport", done: 1, sortOrder: 0 }),
      ]);

      const cleared = updateTask(db, ctxA, created.id, { checklist: [] });
      expect(cleared.checklist).toEqual([]);
      expect(checklistRows(seeded, created.id)).toEqual([]);

      // The list survives a task read.
      updateTask(db, ctxA, created.id, { checklist: [{ title: "Keys", done: false }] });
      expect(getTask(db, ctxA, created.id).checklist.map((item) => item.title)).toEqual(["Keys"]);
    } finally {
      close();
    }
  });

  it("hides a private task (404) and refuses a view-only task (403)", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA, ctxB } = seeded;
    const { privateList, viewOnly } = makeLists(seeded);
    try {
      const secret = createTask(db, ctxA, { title: "Secret", collectionId: privateList.id });
      const pinned = createTask(db, ctxA, { title: "Pinned", collectionId: viewOnly.id });

      expectAppError(() => updateTask(db, ctxB, secret.id, { title: "Leak" }), "NOT_FOUND", 404);
      expectAppError(() => updateTask(db, ctxB, pinned.id, { title: "Leak" }), "FORBIDDEN", 403);
    } finally {
      close();
    }
  });
});

describe("deleteTask", () => {
  it("deletes the task and cascades its checklist", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const created = createTask(db, ctxA, { title: "Temporary", collectionId: shared.id });
      updateTask(db, ctxA, created.id, {
        checklist: [
          { title: "One", done: false },
          { title: "Two", done: true },
        ],
      });
      expect(checklistRows(seeded, created.id)).toHaveLength(2);

      deleteTask(db, ctxA, created.id);

      expect(db.select().from(task).where(eq(task.id, created.id)).all()).toEqual([]);
      expect(checklistRows(seeded, created.id)).toEqual([]);
      expectAppError(() => getTask(db, ctxA, created.id), "NOT_FOUND", 404);
    } finally {
      close();
    }
  });

  it("answers 404 for a partner's private task and 403 for a view-only one", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA, ctxB } = seeded;
    const { privateList, viewOnly } = makeLists(seeded);
    try {
      const secret = createTask(db, ctxA, { title: "Secret", collectionId: privateList.id });
      const pinned = createTask(db, ctxA, { title: "Pinned", collectionId: viewOnly.id });

      expectAppError(() => deleteTask(db, ctxB, secret.id), "NOT_FOUND", 404);
      expectAppError(() => deleteTask(db, ctxB, pinned.id), "FORBIDDEN", 403);
      expect(getTask(db, ctxA, secret.id).id).toBe(secret.id);
      expect(getTask(db, ctxA, pinned.id).id).toBe(pinned.id);
    } finally {
      close();
    }
  });
});

describe("reorderTasks", () => {
  it("writes sortOrder by the sent order and returns the reordered views", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const first = createTask(db, ctxA, { title: "First", collectionId: shared.id });
      const second = createTask(db, ctxA, { title: "Second", collectionId: shared.id });
      const third = createTask(db, ctxA, { title: "Third", collectionId: shared.id });

      const reordered = reorderTasks(db, ctxA, {
        collectionId: shared.id,
        orderedIds: [third.id, first.id, second.id],
      });
      expect(ids(reordered)).toEqual([third.id, first.id, second.id]);
      expect(reordered.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
      expect(ids(listTasks(db, ctxA, filterInput({ view: "all", collectionId: shared.id })).tasks)).toEqual([
        third.id,
        first.id,
        second.id,
      ]);
    } finally {
      close();
    }
  });

  it("refuses to reorder a calendar", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { calendar } = makeLists(seeded);
    try {
      expectAppError(
        () => reorderTasks(db, ctxA, { collectionId: calendar.id, orderedIds: ["not-a-task"] }),
        "VALIDATION",
        400,
        "Tasks live in lists.",
      );
    } finally {
      close();
    }
  });

  it("rejects a partial set, a duplicate id and an id from another list", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared, privateList } = makeLists(seeded);
    const message = "Send exactly the open tasks of this list.";
    try {
      const first = createTask(db, ctxA, { title: "First", collectionId: shared.id });
      const second = createTask(db, ctxA, { title: "Second", collectionId: shared.id });
      createTask(db, ctxA, { title: "Third", collectionId: shared.id });
      const foreign = createTask(db, ctxA, { title: "Elsewhere", collectionId: privateList.id });

      expectAppError(
        () => reorderTasks(db, ctxA, { collectionId: shared.id, orderedIds: [first.id, second.id] }),
        "VALIDATION",
        400,
        message,
      );
      expectAppError(
        () =>
          reorderTasks(db, ctxA, {
            collectionId: shared.id,
            orderedIds: [first.id, first.id, second.id],
          }),
        "VALIDATION",
        400,
        message,
      );
      expectAppError(
        () =>
          reorderTasks(db, ctxA, {
            collectionId: shared.id,
            orderedIds: [first.id, second.id, foreign.id],
          }),
        "VALIDATION",
        400,
        message,
      );
      expectAppError(
        () =>
          reorderTasks(db, ctxA, {
            collectionId: shared.id,
            orderedIds: [first.id, second.id, "missing-task"],
          }),
        "VALIDATION",
        400,
        message,
      );
    } finally {
      close();
    }
  });

  it("only accepts the open tasks: a done task must be left out and cannot be reordered", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA } = seeded;
    const { shared } = makeLists(seeded);
    try {
      const open = createTask(db, ctxA, { title: "Open", collectionId: shared.id });
      const done = createTask(db, ctxA, { title: "Done", collectionId: shared.id });
      updateTask(db, ctxA, done.id, { status: "done" });

      expectAppError(
        () =>
          reorderTasks(db, ctxA, {
            collectionId: shared.id,
            orderedIds: [open.id, done.id],
          }),
        "VALIDATION",
        400,
        "Send exactly the open tasks of this list.",
      );

      const reordered = reorderTasks(db, ctxA, {
        collectionId: shared.id,
        orderedIds: [open.id],
      });
      expect(ids(reordered)).toEqual([open.id]);
      expect(reordered[0]?.sortOrder).toBe(0);
    } finally {
      close();
    }
  });

  it("hides a private list (404) and refuses a view-only list (403)", async () => {
    const seeded = await makeSeededDb();
    const { db, close, ctxA, ctxB } = seeded;
    const { privateList, viewOnly } = makeLists(seeded);
    try {
      const secret = createTask(db, ctxA, { title: "Secret", collectionId: privateList.id });
      const pinned = createTask(db, ctxA, { title: "Pinned", collectionId: viewOnly.id });

      expectAppError(
        () => reorderTasks(db, ctxB, { collectionId: privateList.id, orderedIds: [secret.id] }),
        "NOT_FOUND",
        404,
      );
      expectAppError(
        () => reorderTasks(db, ctxB, { collectionId: viewOnly.id, orderedIds: [pinned.id] }),
        "FORBIDDEN",
        403,
      );
    } finally {
      close();
    }
  });
});

describe("task validation schemas", () => {
  it("accepts only date-only shapes for scheduled and due dates", () => {
    expect(dateOnlySchema.parse("2026-10-21")).toBe("2026-10-21");
    expect(dateOnlySchema.safeParse("2026-1-1").success).toBe(false);
    expect(dateOnlySchema.safeParse("2026-10-21T00:00").success).toBe(false);
  });

  it("parses create input with trimmed titles, optional fields and bounded notes", () => {
    const parsed = createTaskSchema.parse({
      title: "  Buy milk  ",
      notes: "  2 litres  ",
      scheduledOn: TODAY,
      dueOn: null,
    });
    expect(parsed).toMatchObject({ title: "Buy milk", scheduledOn: TODAY, dueOn: null });
    expect(createTaskSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", notes: "a".repeat(2001) }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", dueOn: "10/21/2026" }).success).toBe(false);
  });

  it("parses a partial update with status, checklist and sortOrder", () => {
    expect(updateTaskSchema.parse({ title: "  Renamed  " }).title).toBe("Renamed");
    expect(updateTaskSchema.parse({ status: "done" }).status).toBe("done");
    expect(updateTaskSchema.safeParse({ status: "archived" }).success).toBe(false);
    expect(updateTaskSchema.parse({ scheduledOn: null })).toEqual({ scheduledOn: null });
    expect(updateTaskSchema.parse({ sortOrder: 3 }).sortOrder).toBe(3);
    expect(updateTaskSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
    expect(
      updateTaskSchema.parse({ checklist: [{ title: "  Passport  ", done: true }] }).checklist,
    ).toEqual([{ title: "Passport", done: true }]);
    expect(updateTaskSchema.safeParse({ checklist: [{ title: "", done: false }] }).success).toBe(
      false,
    );
    expect(
      checklistInputSchema.safeParse(
        Array.from({ length: 51 }, (_, index) => ({ title: `Item ${index}`, done: false })),
      ).success,
    ).toBe(false);
  });

  it("requires at least one ordered id to reorder a list", () => {
    expect(reorderTasksSchema.safeParse({ collectionId: "list-1", orderedIds: [] }).success).toBe(
      false,
    );
    expect(
      reorderTasksSchema.safeParse({ collectionId: "list-1", orderedIds: ["task-1"] }).success,
    ).toBe(true);
  });
});
