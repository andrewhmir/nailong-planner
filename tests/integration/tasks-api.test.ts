import { describe, expect, it } from "vitest";
import { GET as listTasksRoute } from "@/app/api/tasks/route";
import {
  createTaskHandler,
  deleteTaskHandler,
  getTaskHandler,
  listTasksHandler,
  reorderTasksHandler,
  updateTaskHandler,
} from "@/lib/api/handlers/tasks";
import { createCollection } from "@/lib/services/collections";
import { createTask, type TaskCounts, type TaskView } from "@/lib/services/tasks";
import { makeSeededDb } from "../helpers/fixtures";

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

  it("rejects an unauthenticated request with 401 through the real route", async () => {
    const response = await listTasksRoute(new Request("http://localhost:3000/api/tasks"));
    expect(response.status).toBe(401);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe("UNAUTHENTICATED");
  });
});
