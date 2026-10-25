import { describe, expect, it } from "vitest";
import { withViewer } from "@/lib/api/route";
import {
  createCollectionHandler,
  deleteCollectionHandler,
  listCollections,
  updateCollectionHandler,
} from "@/lib/api/handlers/collections";
import { createCollection } from "@/lib/services/collections";
import { makeSeededDb } from "../helpers/fixtures";

function jsonRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost:3000/api/collections", {
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
    const response = await handler(new Request("http://localhost:3000/api/collections"));
    expect(response.status).toBe(401);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the caller's calendar tree with a private Inbox only for them", async () => {
    const { db, close, ctxA, ctxB, ctxOther } = await makeSeededDb();
    try {
      createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      createCollection(db, ctxOther, { name: "Theirs", hueFamily: "rose" });

      const response = await listCollections(db, ctxA);
      expect(response.status).toBe(200);
      const payload = await body<{
        collections: Array<{ id: string; name: string; visibility: string; children: unknown[] }>;
      }>(response);
      expect(payload.collections.map((calendar) => calendar.name)).toEqual(["School", "Inbox"]);
      expect(payload.collections[0]?.children).toEqual([]);
      const inbox = payload.collections.find((collection) => collection.name === "Inbox");
      expect(inbox?.visibility).toBe("private");

      // The partner gets their own Inbox, never the caller's.
      const partnerResponse = await listCollections(db, ctxB);
      const partnerPayload = await body<{
        collections: Array<{ id: string; name: string }>;
      }>(partnerResponse);
      expect(partnerPayload.collections.map((collection) => collection.name)).toEqual([
        "School",
        "Inbox",
      ]);
      expect(
        partnerPayload.collections.find((collection) => collection.name === "Inbox")?.id,
      ).not.toBe(inbox?.id);
    } finally {
      close();
    }
  });

  it("creates a calendar and returns 201 with the row", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const response = await createCollectionHandler(
        db,
        ctxA,
        jsonRequest("POST", { name: "Work", hueFamily: "amber", ownerId: "user-a" }),
      );
      expect(response.status).toBe(201);
      const payload = await body<{ collection: { id: string; hueFamily: string; ownerId: string } }>(
        response,
      );
      expect(payload.collection.hueFamily).toBe("amber");
      expect(payload.collection.ownerId).toBe("user-a");
    } finally {
      close();
    }
  });

  it("maps validation errors to 400 with field errors", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const response = await createCollectionHandler(db, ctxA, jsonRequest("POST", { name: "" }));
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
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      for (let index = 0; index < 7; index += 1) {
        createCollection(db, ctxA, { name: `Subject ${index}`, parentId: root.id });
      }
      const eighth = await createCollectionHandler(
        db,
        ctxA,
        jsonRequest("POST", { name: "Eighth", parentId: root.id }),
      );
      expect(eighth.status).toBe(409);

      const work = createCollection(db, ctxA, {
        name: "Work",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      await updateCollectionHandler(
        db,
        ctxA,
        work.id,
        jsonRequest("PATCH", { visibility: "view_only" }),
      );
      const blocked = await updateCollectionHandler(
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
      const foreign = createCollection(db, ctxOther, { name: "Theirs", hueFamily: "rose" });
      const response = await updateCollectionHandler(
        db,
        ctxA,
        foreign.id,
        jsonRequest("PATCH", { name: "Mine now" }),
      );
      expect(response.status).toBe(404);

      const deletion = await deleteCollectionHandler(db, ctxA, foreign.id);
      expect(deletion.status).toBe(404);
    } finally {
      close();
    }
  });

  it("deletes a calendar with 204", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      const response = await deleteCollectionHandler(db, ctxA, root.id);
      expect(response.status).toBe(204);
      const after = await listCollections(db, ctxA);
      expect(after.status).toBe(200);
    } finally {
      close();
    }
  });
});
