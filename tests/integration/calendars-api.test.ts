import { describe, expect, it } from "vitest";
import { withViewer } from "@/lib/api/route";
import {
  createCalendarHandler,
  deleteCalendarHandler,
  listCalendars,
  updateCalendarHandler,
} from "@/lib/api/handlers/calendars";
import { createCalendar } from "@/lib/services/calendars";
import { makeSeededDb } from "../helpers/fixtures";

function jsonRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost:3000/api/calendars", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("calendar API", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const handler = withViewer(async () => new Response(null, { status: 204 }));
    const response = await handler(new Request("http://localhost:3000/api/calendars"));
    expect(response.status).toBe(401);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the caller's calendar tree only", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      createCalendar(db, ctxOther, { name: "Theirs", hueFamily: "rose" });

      const response = await listCalendars(db, ctxA);
      expect(response.status).toBe(200);
      const payload = await body<{ calendars: Array<{ name: string; children: unknown[] }> }>(
        response,
      );
      expect(payload.calendars.map((calendar) => calendar.name)).toEqual(["School"]);
      expect(payload.calendars[0]?.children).toEqual([]);
    } finally {
      close();
    }
  });

  it("creates a calendar and returns 201 with the row", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const response = await createCalendarHandler(
        db,
        ctxA,
        jsonRequest("POST", { name: "Work", hueFamily: "amber", ownerId: "user-a" }),
      );
      expect(response.status).toBe(201);
      const payload = await body<{ calendar: { id: string; hueFamily: string; ownerId: string } }>(
        response,
      );
      expect(payload.calendar.hueFamily).toBe("amber");
      expect(payload.calendar.ownerId).toBe("user-a");
    } finally {
      close();
    }
  });

  it("maps validation errors to 400 with field errors", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const response = await createCalendarHandler(db, ctxA, jsonRequest("POST", { name: "" }));
      expect(response.status).toBe(400);
      const payload = await body<{ error: { code: string; fields?: Record<string, string> } }>(
        response,
      );
      expect(payload.error.code).toBe("VALIDATION");
      expect(payload.error.fields?.name).toBeTruthy();
    } finally {
      close();
    }
  });

  it("returns 409 for an eighth sub-calendar and 403 for a view-only write", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      for (let index = 0; index < 7; index += 1) {
        createCalendar(db, ctxA, { name: `Subject ${index}`, parentId: root.id });
      }
      const eighth = await createCalendarHandler(
        db,
        ctxA,
        jsonRequest("POST", { name: "Eighth", parentId: root.id }),
      );
      expect(eighth.status).toBe(409);

      const work = createCalendar(db, ctxA, {
        name: "Work",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      await updateCalendarHandler(
        db,
        ctxA,
        work.id,
        jsonRequest("PATCH", { isViewOnlyForPartner: true }),
      );
      const blocked = await updateCalendarHandler(
        db,
        ctxB,
        work.id,
        jsonRequest("PATCH", { name: "Hacked" }),
      );
      expect(blocked.status).toBe(403);
    } finally {
      close();
    }
  });

  it("returns 404 for another household's calendar id", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      const foreign = createCalendar(db, ctxOther, { name: "Theirs", hueFamily: "rose" });
      const response = await updateCalendarHandler(
        db,
        ctxA,
        foreign.id,
        jsonRequest("PATCH", { name: "Mine now" }),
      );
      expect(response.status).toBe(404);

      const deletion = await deleteCalendarHandler(db, ctxA, foreign.id);
      expect(deletion.status).toBe(404);
    } finally {
      close();
    }
  });

  it("deletes a calendar with 204", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      const response = await deleteCalendarHandler(db, ctxA, root.id);
      expect(response.status).toBe(204);
      const after = await listCalendars(db, ctxA);
      expect(after.status).toBe(200);
    } finally {
      close();
    }
  });
});
