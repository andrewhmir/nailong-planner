import { describe, expect, it } from "vitest";
import {
  getPreferencesHandler,
  updatePreferencesHandler,
} from "@/lib/api/handlers/preferences";
import { getPreferences } from "@/lib/services/preferences";
import { makeSeededDb } from "../helpers/fixtures";

function request(url: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: body === undefined ? "GET" : "PATCH",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("preferences API", () => {
  it("returns defaults without a stored row", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const response = await getPreferencesHandler(db, ctxA);
      expect(response.status).toBe(200);
      expect(await body(response)).toEqual({
        preferences: {
          defaultView: "auto",
          timeFormat: "24h",
          showWeekNumbers: false,
          shortcutsEnabled: true,
          lastEventCalendarId: null,
        },
      });
    } finally {
      close();
    }
  });

  it("persists a partial patch and leaves other fields alone", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const first = await updatePreferencesHandler(
        db,
        ctxA,
        request("/api/settings/preferences", { timeFormat: "12h" }),
      );
      expect(first.status).toBe(200);
      expect((await body<{ preferences: { timeFormat: string } }>(first)).preferences.timeFormat).toBe(
        "12h",
      );

      const second = await updatePreferencesHandler(
        db,
        ctxA,
        request("/api/settings/preferences", { showWeekNumbers: true }),
      );
      expect(second.status).toBe(200);
      expect(await body(second)).toEqual({
        preferences: {
          defaultView: "auto",
          timeFormat: "12h",
          showWeekNumbers: true,
          shortcutsEnabled: true,
          lastEventCalendarId: null,
        },
      });
    } finally {
      close();
    }
  });

  it("rejects an unknown view and an invalid time format", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const badView = await updatePreferencesHandler(
        db,
        ctxA,
        request("/api/settings/preferences", { defaultView: "year" }),
      );
      expect(badView.status).toBe(400);

      const badFormat = await updatePreferencesHandler(
        db,
        ctxA,
        request("/api/settings/preferences", { timeFormat: "13h" }),
      );
      expect(badFormat.status).toBe(400);
    } finally {
      close();
    }
  });

  it("scopes preferences per user", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const response = await updatePreferencesHandler(
        db,
        ctxB,
        request("/api/settings/preferences", { timeFormat: "12h" }),
      );
      expect(response.status).toBe(200);
      expect(getPreferences(db, ctxA.userId).timeFormat).toBe("24h");
      expect(getPreferences(db, ctxB.userId).timeFormat).toBe("12h");
    } finally {
      close();
    }
  });
});
