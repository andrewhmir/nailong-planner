import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createEventHandler,
  deleteEventHandler,
  listEventsHandler,
  updateEventHandler,
} from "@/lib/api/handlers/events";
import { event } from "@/lib/db/schema";
import { createCollection, updateCollection } from "@/lib/services/collections";
import { createEvent } from "@/lib/services/events";
import { localWallTimeToUtc } from "@/lib/time/zone";
import { makeSeededDb } from "../helpers/fixtures";

const TAIPEI = "Asia/Taipei";
const at = (wall: string) => localWallTimeToUtc(wall, TAIPEI);

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
  const school = createCollection(seeded.db, seeded.ctxA, {
    name: "School",
    hueFamily: "indigo",
    ownerId: "user-a",
  });
  const math = createCollection(seeded.db, seeded.ctxA, { name: "Math", parentId: school.id });
  return { ...seeded, school, math };
}

describe("event API", () => {
  it("rejects a missing or malformed range with 400", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const onlyFrom = await listEventsHandler(
        db,
        ctxA,
        jsonRequest("/api/events?from=1000", "GET"),
      );
      expect(onlyFrom.status).toBe(400);

      const backwards = await listEventsHandler(
        db,
        ctxA,
        jsonRequest("/api/events?from=2000&to=1000", "GET"),
      );
      expect(backwards.status).toBe(400);
    } finally {
      close();
    }
  });

  it("returns events with resolved color tokens", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      createEvent(db, ctxA, {
        collectionId: math.id,
        title: "Quiz",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      const response = await listEventsHandler(
        db,
        ctxA,
        jsonRequest(
          `/api/events?from=${at("2026-10-01T00:00")}&to=${at("2026-11-01T00:00")}`,
          "GET",
        ),
      );
      expect(response.status).toBe(200);
      const payload = await body<{ events: Array<{ title: string; color: { container: string } }> }>(
        response,
      );
      expect(payload.events).toHaveLength(1);
      expect(payload.events[0]?.color.container).toMatch(/^oklch\(/);
    } finally {
      close();
    }
  });

  it("blocks every verb on a view-only partner calendar with 403", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      const work = createCollection(db, ctxA, {
        name: "Work",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      expect(updateCollection(db, ctxA, work.id, { visibility: "view_only" }).visibility).toBe("view_only");

      const existing = createEvent(db, ctxA, {
        collectionId: work.id,
        title: "On-call",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });

      const created = await createEventHandler(
        db,
        ctxB,
        jsonRequest("/api/events", "POST", {
          collectionId: work.id,
          title: "Sneaky",
          allDay: false,
          startAt: at("2026-10-21T09:00"),
          endAt: at("2026-10-21T10:00"),
        }),
      );
      expect(created.status).toBe(403);

      const patched = await updateEventHandler(
        db,
        ctxB,
        existing.id,
        jsonRequest(`/api/events/${existing.id}`, "PATCH", { title: "Hacked" }),
      );
      expect(patched.status).toBe(403);

      const removed = await deleteEventHandler(
        db,
        ctxB,
        existing.id,
        jsonRequest(`/api/events/${existing.id}`, "DELETE", { scope: "all" }),
      );
      expect(removed.status).toBe(403);
    } finally {
      close();
    }
  });

  it("supports scope=this delete and is idempotent", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        collectionId: math.id,
        title: "Standup",
        allDay: true,
        startDate: "2026-01-31",
        endDate: "2026-01-31",
        rrule: "FREQ=MONTHLY",
      });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await deleteEventHandler(
          db,
          ctxA,
          series.id,
          jsonRequest(`/api/events/${series.id}`, "DELETE", {
            scope: "this",
            occurrenceStart: "2026-01-31",
          }),
        );
        expect(response.status).toBe(204);
      }

      const stored = db.select().from(event).where(eq(event.id, series.id)).get();
      expect(JSON.parse(stored?.exdates ?? "[]")).toEqual(["2026-01-31"]);
    } finally {
      close();
    }
  });

  it("returns 404 for another household's event", async () => {
    const { db, close, ctxA, ctxOther } = await setup();
    try {
      const foreignCollection = createCollection(db, ctxOther, { name: "Theirs", hueFamily: "rose" });
      const foreign = createEvent(db, ctxOther, {
        collectionId: foreignCollection.id,
        title: "Private",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      const response = await updateEventHandler(
        db,
        ctxA,
        foreign.id,
        jsonRequest(`/api/events/${foreign.id}`, "PATCH", { title: "Mine" }),
      );
      expect(response.status).toBe(404);
    } finally {
      close();
    }
  });

  it("refuses a list as an event target on create and on move", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const errands = createCollection(db, ctxA, {
        name: "Errands",
        kind: "list",
        hueFamily: "rose",
      });

      const created = await createEventHandler(
        db,
        ctxA,
        jsonRequest("/api/events", "POST", {
          collectionId: errands.id,
          title: "Not an event",
          allDay: false,
          startAt: at("2026-10-20T09:00"),
          endAt: at("2026-10-20T10:00"),
        }),
      );
      expect(created.status).toBe(400);
      const createdPayload = await body<{ error: { code: string; message: string } }>(created);
      expect(createdPayload.error).toEqual({
        code: "VALIDATION",
        message: "Events live in calendars.",
      });
      expect(db.select().from(event).all()).toEqual([]);

      const existing = createEvent(db, ctxA, {
        collectionId: math.id,
        title: "Quiz",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      const moved = await updateEventHandler(
        db,
        ctxA,
        existing.id,
        jsonRequest(`/api/events/${existing.id}`, "PATCH", { collectionId: errands.id }),
      );
      expect(moved.status).toBe(400);
      const movedPayload = await body<{ error: { code: string; message: string } }>(moved);
      expect(movedPayload.error.message).toBe("Events live in calendars.");
      // A rejected move must leave the stored row exactly where it was.
      const stored = db.select().from(event).where(eq(event.id, existing.id)).get();
      expect(stored?.collectionId).toBe(math.id);
      expect(stored?.title).toBe("Quiz");
    } finally {
      close();
    }
  });

  it("creates an event with 201 and validates the body", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const invalid = await createEventHandler(
        db,
        ctxA,
        jsonRequest("/api/events", "POST", { title: "" }),
      );
      expect(invalid.status).toBe(400);

      const response = await createEventHandler(
        db,
        ctxA,
        jsonRequest("/api/events", "POST", {
          collectionId: math.id,
          title: "Lecture",
          allDay: false,
          startAt: at("2026-10-20T09:00"),
          endAt: at("2026-10-20T10:00"),
        }),
      );
      expect(response.status).toBe(201);
      const payload = await body<{ event: { title: string } }>(response);
      expect(payload.event.title).toBe("Lecture");
    } finally {
      close();
    }
  });
});
