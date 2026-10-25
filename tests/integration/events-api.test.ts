import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createEventHandler,
  deleteEventHandler,
  listEventsHandler,
  updateEventHandler,
} from "@/lib/api/handlers/events";
import { event } from "@/lib/db/schema";
import { createCalendar, updateCalendar } from "@/lib/services/calendars";
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
  const school = createCalendar(seeded.db, seeded.ctxA, {
    name: "School",
    hueFamily: "indigo",
    ownerId: "user-a",
  });
  const math = createCalendar(seeded.db, seeded.ctxA, { name: "Math", parentId: school.id });
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
        calendarId: math.id,
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
      const work = createCalendar(db, ctxA, {
        name: "Work",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      expect(updateCalendar(db, ctxA, work.id, { isViewOnlyForPartner: true }).isViewOnlyForPartner).toBe(1);

      const existing = createEvent(db, ctxA, {
        calendarId: work.id,
        title: "On-call",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });

      const created = await createEventHandler(
        db,
        ctxB,
        jsonRequest("/api/events", "POST", {
          calendarId: work.id,
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
        calendarId: math.id,
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
      const foreignCalendar = createCalendar(db, ctxOther, { name: "Theirs", hueFamily: "rose" });
      const foreign = createEvent(db, ctxOther, {
        calendarId: foreignCalendar.id,
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
          calendarId: math.id,
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

describe("recurring edit scopes API", () => {
  const iso = (wall: string) => new Date(at(wall)).toISOString();

  it("PATCH scope=this creates a linked exception", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Standup",
        allDay: true,
        startDate: "2026-01-03",
        endDate: "2026-01-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });

      const response = await updateEventHandler(
        db,
        ctxA,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "PATCH", {
          scope: "this",
          occurrenceStart: "2026-01-03",
          allDay: true,
          startDate: "2026-01-04",
          endDate: "2026-01-04",
        }),
      );

      expect(response.status).toBe(200);
      const payload = await body<{
        event: { id: string; rrule: string | null; recurrenceParentId: string; recurrenceId: string };
      }>(response);
      expect(payload.event.recurrenceParentId).toBe(series.id);
      expect(payload.event.recurrenceId).toBe("2026-01-03");
      expect(payload.event.rrule).toBeNull();

      const stored = db.select().from(event).where(eq(event.id, series.id)).get();
      expect(JSON.parse(stored?.exdates ?? "[]")).toEqual(["2026-01-03"]);
    } finally {
      close();
    }
  });

  it("PATCH scope=following returns the split result", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-01-03",
        endDate: "2026-01-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      const response = await updateEventHandler(
        db,
        ctxA,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "PATCH", {
          scope: "following",
          occurrenceStart: "2026-01-17",
          title: "Piano (later)",
          rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
        }),
      );

      expect(response.status).toBe(200);
      const payload = await body<{
        event: { title: string; startDate: string; rrule: string | null };
        truncated: { id: string } | null;
        relinked: unknown[];
        relinkedPrevious: unknown[];
      }>(response);
      expect(payload.event.title).toBe("Piano (later)");
      expect(payload.event.startDate).toBe("2026-01-17");
      expect(payload.truncated?.id).toBe(series.id);
      expect(payload.relinked).toEqual([]);
      expect(payload.relinkedPrevious).toEqual([]);
    } finally {
      close();
    }
  });

  it("PATCH scope=all with occurrenceStart shifts the series", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Swim",
        allDay: false,
        startAt: at("2026-10-05T09:00"),
        endAt: at("2026-10-05T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });

      const response = await updateEventHandler(
        db,
        ctxA,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "PATCH", {
          scope: "all",
          occurrenceStart: iso("2026-10-05T09:00"),
          allDay: false,
          startAt: at("2026-10-06T10:00"),
          endAt: at("2026-10-06T11:00"),
          startDate: null,
          endDate: null,
        }),
      );

      expect(response.status).toBe(200);
      const payload = await body<{ event: { startAt: number; rrule: string | null } }>(response);
      expect(payload.event.startAt).toBe(at("2026-10-06T10:00"));
      expect(payload.event.rrule).toContain("BYDAY=TU");
    } finally {
      close();
    }
  });

  it("rejects scope=this without occurrenceStart and following with an unknown occurrence", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-01-03",
        endDate: "2026-01-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });

      const missing = await updateEventHandler(
        db,
        ctxA,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "PATCH", { scope: "this", title: "Nope" }),
      );
      expect(missing.status).toBe(400);

      const unknown = await updateEventHandler(
        db,
        ctxA,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "PATCH", {
          scope: "following",
          occurrenceStart: "2026-01-04",
          rrule: "FREQ=WEEKLY;BYDAY=SA",
        }),
      );
      expect(unknown.status).toBe(400);
    } finally {
      close();
    }
  });

  it("DELETE scope=all returns the deleted rows with 200", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-01-03",
        endDate: "2026-01-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      const exception = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-01-04",
        endDate: "2026-01-04",
        recurrenceParentId: series.id,
        recurrenceId: "2026-01-03",
      });

      const response = await deleteEventHandler(
        db,
        ctxA,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "DELETE", { scope: "all" }),
      );

      expect(response.status).toBe(200);
      const payload = await body<{ deleted: Array<{ id: string }> }>(response);
      expect(payload.deleted.map((row) => row.id).sort()).toEqual([series.id, exception.id].sort());
      expect(db.select().from(event).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("DELETE scope=following returns deleted rows and the truncated row", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-01-03",
        endDate: "2026-01-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      const response = await deleteEventHandler(
        db,
        ctxA,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "DELETE", {
          scope: "following",
          occurrenceStart: "2026-01-17",
        }),
      );

      expect(response.status).toBe(200);
      const payload = await body<{
        deleted: Array<{ id: string }>;
        truncated: { id: string } | null;
      }>(response);
      expect(payload.truncated?.id).toBe(series.id);
      expect(payload.deleted).toHaveLength(1);
      expect(payload.deleted[0]?.id).not.toBe(series.id);
    } finally {
      close();
    }
  });

  it("blocks the new scopes on a view-only partner calendar", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      const work = createCalendar(db, ctxA, { name: "Work", hueFamily: "amber", ownerId: "user-a" });
      updateCalendar(db, ctxA, work.id, { isViewOnlyForPartner: true });
      const series = createEvent(db, ctxA, {
        calendarId: work.id,
        title: "On-call",
        allDay: false,
        startAt: at("2026-10-05T09:00"),
        endAt: at("2026-10-05T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });

      const patched = await updateEventHandler(
        db,
        ctxB,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "PATCH", {
          scope: "this",
          occurrenceStart: iso("2026-10-05T09:00"),
          startAt: at("2026-10-06T10:00"),
          endAt: at("2026-10-06T11:00"),
        }),
      );
      expect(patched.status).toBe(403);

      const removed = await deleteEventHandler(
        db,
        ctxB,
        series.id,
        jsonRequest(`/api/events/${series.id}`, "DELETE", {
          scope: "following",
          occurrenceStart: iso("2026-10-12T09:00"),
        }),
      );
      expect(removed.status).toBe(403);
    } finally {
      close();
    }
  });

  it("POST accepts a recurrence parent and rejects an unknown one", async () => {
    const { db, close, ctxA, math } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: math.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-01-03",
        endDate: "2026-01-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });

      const created = await createEventHandler(
        db,
        ctxA,
        jsonRequest("/api/events", "POST", {
          calendarId: math.id,
          title: "Piano",
          allDay: true,
          startDate: "2026-01-04",
          endDate: "2026-01-04",
          recurrenceParentId: series.id,
          recurrenceId: "2026-01-03",
        }),
      );
      expect(created.status).toBe(201);
      const payload = await body<{ event: { recurrenceParentId: string; recurrenceId: string } }>(
        created,
      );
      expect(payload.event.recurrenceParentId).toBe(series.id);
      expect(payload.event.recurrenceId).toBe("2026-01-03");

      const missing = await createEventHandler(
        db,
        ctxA,
        jsonRequest("/api/events", "POST", {
          calendarId: math.id,
          title: "Lost",
          allDay: true,
          startDate: "2026-01-04",
          endDate: "2026-01-04",
          recurrenceParentId: "missing-series",
          recurrenceId: "2026-01-03",
        }),
      );
      expect(missing.status).toBe(404);
    } finally {
      close();
    }
  });
});
