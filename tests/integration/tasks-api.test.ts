import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELETE as deleteTaskRoute,
  GET as getTaskRoute,
  PATCH as patchTaskRoute,
} from "@/app/api/tasks/[id]/route";
import { PATCH as reorderTasksRoute } from "@/app/api/tasks/order/route";
import { GET as listTasksRoute } from "@/app/api/tasks/route";
import {
  createTaskHandler,
  deleteTaskHandler,
  getTaskHandler,
  listTasksHandler,
  reorderTasksHandler,
  updateTaskHandler,
} from "@/lib/api/handlers/tasks";
import { household } from "@/lib/db/schema";
import { createCollection } from "@/lib/services/collections";
import { createTask, type TaskCounts, type TaskView } from "@/lib/services/tasks";
import { makeSeededDb } from "../helpers/fixtures";

afterEach(() => {
  vi.useRealTimers();
});

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function setup() {
  const seeded = await makeSeededDb();
  const shared = createCollection(seeded.db, seeded.ctxA, {
    name: "House",
    kind: "list",
    hueFamily: "teal",
  });
  return { ...seeded, shared };
}

describe("task API", () => {
  it("returns the filtered tasks with counts covering every visible open task", async () => {
    const { db, close, ctxA, shared } = await setup();
    try {
      const inboxTask = createTask(db, ctxA, { title: "Buy milk" });
      const somedayTask = createTask(db, ctxA, { collectionId: shared.id, title: "Water plants" });

      const inbox = await listTasksHandler(
        db,
        ctxA,
        jsonRequest("/api/tasks?view=inbox", "GET"),
      );
      expect(inbox.status).toBe(200);
      const inboxPayload = await body<{ tasks: TaskView[]; counts: TaskCounts }>(inbox);
      expect(inboxPayload.tasks.map((task) => task.id)).toEqual([inboxTask.id]);
      expect(inboxPayload.counts).toEqual({
        inbox: 1,
        today: 0,
        week: 0,
        someday: 1,
        overdue: 0,
      });

      // The collection filter narrows `tasks` only; the rail badges stay global.
      const narrowed = await listTasksHandler(
        db,
        ctxA,
        jsonRequest(`/api/tasks?collectionId=${shared.id}`, "GET"),
      );
      const narrowedPayload = await body<{ tasks: TaskView[]; counts: TaskCounts }>(narrowed);
      expect(narrowedPayload.tasks.map((task) => task.id)).toEqual([somedayTask.id]);
      expect(narrowedPayload.counts).toEqual(inboxPayload.counts);
    } finally {
      close();
    }
  });

  it("rejects an unknown view with a field error", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const response = await listTasksHandler(
        db,
        ctxA,
        jsonRequest("/api/tasks?view=later", "GET"),
      );
      expect(response.status).toBe(400);
      const payload = await body<{ error: { code: string; fields?: Record<string, string> } }>(
        response,
      );
      expect(payload.error.code).toBe("VALIDATION");
      expect(payload.error.fields?.view).toBeTruthy();
    } finally {
      close();
    }
  });

  it("creates a task with 201 and reads it back by id", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const created = await createTaskHandler(
        db,
        ctxA,
        jsonRequest("/api/tasks", "POST", { title: "Plan the week" }),
      );
      expect(created.status).toBe(201);
      const { task } = await body<{ task: TaskView }>(created);
      expect(task.title).toBe("Plan the week");
      expect(task.status).toBe("open");
      expect(task.collection.name).toBe("Inbox");

      const read = await getTaskHandler(db, ctxA, task.id);
      expect(read.status).toBe(200);
      const readPayload = await body<{ task: TaskView }>(read);
      expect(readPayload.task.id).toBe(task.id);
      expect(readPayload.task.checklist).toEqual([]);
    } finally {
      close();
    }
  });

  it("patches a task with 200", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const task = createTask(db, ctxA, { title: "Call the plumber" });
      const response = await updateTaskHandler(
        db,
        ctxA,
        task.id,
        jsonRequest(`/api/tasks/${task.id}`, "PATCH", {
          title: "Call the plumber back",
          dueOn: "2026-10-24",
        }),
      );
      expect(response.status).toBe(200);
      const payload = await body<{ task: TaskView }>(response);
      expect(payload.task.title).toBe("Call the plumber back");
      expect(payload.task.dueOn).toBe("2026-10-24");
      expect(payload.task.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
    } finally {
      close();
    }
  });

  it("deletes a task with 204 and hides it afterwards", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const task = createTask(db, ctxA, { title: "Temporary" });
      const response = await deleteTaskHandler(db, ctxA, task.id);
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();

      const after = await getTaskHandler(db, ctxA, task.id);
      expect(after.status).toBe(404);
    } finally {
      close();
    }
  });

  it("reorders a list and rejects a partial set", async () => {
    const { db, close, ctxA, shared } = await setup();
    try {
      const first = createTask(db, ctxA, { collectionId: shared.id, title: "First" });
      const second = createTask(db, ctxA, { collectionId: shared.id, title: "Second" });
      const orderedIds = [second.id, first.id];

      const response = await reorderTasksHandler(
        db,
        ctxA,
        jsonRequest("/api/tasks/order", "PATCH", { collectionId: shared.id, orderedIds }),
      );
      expect(response.status).toBe(200);
      const payload = await body<{ tasks: TaskView[] }>(response);
      expect(payload.tasks.map((task) => task.id)).toEqual(orderedIds);

      const partial = await reorderTasksHandler(
        db,
        ctxA,
        jsonRequest("/api/tasks/order", "PATCH", { collectionId: shared.id, orderedIds: [first.id] }),
      );
      expect(partial.status).toBe(400);
      const partialPayload = await body<{ error: { code: string } }>(partial);
      expect(partialPayload.error.code).toBe("VALIDATION");
    } finally {
      close();
    }
  });

  it("answers 404 on every verb for a partner's private task", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      const journal = createCollection(db, ctxA, {
        name: "Journal",
        kind: "list",
        hueFamily: "rose",
        ownerId: "user-a",
        visibility: "private",
      });
      const secret = createTask(db, ctxA, { collectionId: journal.id, title: "Gift ideas" });

      const read = await getTaskHandler(db, ctxB, secret.id);
      expect(read.status).toBe(404);
      const patched = await updateTaskHandler(
        db,
        ctxB,
        secret.id,
        jsonRequest(`/api/tasks/${secret.id}`, "PATCH", { title: "Seen" }),
      );
      expect(patched.status).toBe(404);
      const removed = await deleteTaskHandler(db, ctxB, secret.id);
      expect(removed.status).toBe(404);

      const partnerList = await listTasksHandler(db, ctxB, jsonRequest("/api/tasks", "GET"));
      const partnerPayload = await body<{ tasks: TaskView[] }>(partnerList);
      expect(partnerPayload.tasks.some((task) => task.id === secret.id)).toBe(false);
    } finally {
      close();
    }
  });

  it("buckets with the household's timezone and week start, not handler defaults", async () => {
    // 2026-10-25T12:00Z is Monday 2026-10-26 02:00 in Kiritimati (UTC+14) but
    // Sunday 2026-10-25 20:00 in the handler's Asia/Taipei fallback. A handler
    // that hardcoded the fallback zone (or `weekStartsOn: 0`) puts neither date
    // in the bucket asserted below.
    vi.useFakeTimers({ now: new Date("2026-10-25T12:00:00Z"), toFake: ["Date"] });
    const { db, close, ctxA } = await setup();
    try {
      db.update(household)
        .set({ timezone: "Pacific/Kiritimati", weekStartsOn: 1 })
        .where(eq(household.id, "h1"))
        .run();
      // Household today is Monday the 26th; its Monday-started week ends on
      // Sunday 2026-11-01, so the 1st is the last day of *this* week.
      const todayTask = createTask(db, ctxA, { title: "Today", scheduledOn: "2026-10-26" });
      const weekTask = createTask(db, ctxA, { title: "Week end", scheduledOn: "2026-11-01" });

      const today = await body<{ tasks: TaskView[]; counts: TaskCounts }>(
        await listTasksHandler(db, ctxA, jsonRequest("/api/tasks?view=today", "GET")),
      );
      expect(today.tasks.map((task) => task.id)).toEqual([todayTask.id]);
      expect(today.counts).toEqual({ inbox: 0, today: 1, week: 1, someday: 0, overdue: 0 });

      const week = await body<{ tasks: TaskView[] }>(
        await listTasksHandler(db, ctxA, jsonRequest("/api/tasks?view=week", "GET")),
      );
      expect(week.tasks.map((task) => task.id)).toEqual([weekTask.id]);
    } finally {
      close();
    }
  });

  it("rejects an unauthenticated request with 401 through the real route", async () => {
    const response = await listTasksRoute(new Request("http://localhost:3000/api/tasks"));
    expect(response.status).toBe(401);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe("UNAUTHENTICATED");
  });

  it("unwraps the dynamic params through the [id] route and delegates the order PATCH", async () => {
    // The route modules await `context.params` before delegating; calling them
    // with a Promise (as Next 16 does) executes that unwrap. Without a session
    // every verb still stops at `withViewer`'s 401, which is enough to prove the
    // wiring, and the order route is called the same way without a param.
    const context = { params: Promise.resolve({ id: "missing-task" }) };
    const url = "http://localhost:3000/api/tasks/missing-task";
    const get = await getTaskRoute(
      new Request(url) as unknown as NextRequest,
      context,
    );
    expect(get.status).toBe(401);
    const patch = await patchTaskRoute(
      new Request(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Nope" }),
      }) as unknown as NextRequest,
      context,
    );
    expect(patch.status).toBe(401);
    const removed = await deleteTaskRoute(
      new Request(url, { method: "DELETE" }) as unknown as NextRequest,
      context,
    );
    expect(removed.status).toBe(401);

    const reorder = await reorderTasksRoute(
      new Request("http://localhost:3000/api/tasks/order", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collectionId: "c1", orderedIds: ["t1"] }),
      }) as unknown as NextRequest,
    );
    expect(reorder.status).toBe(401);
  });
});
