import { describe, expect, it } from "vitest";
import {
  updateHouseholdHandler,
  updateProfileHandler,
} from "@/lib/api/handlers/settings";
import { getHousehold, ensureHousehold } from "@/lib/services/household";
import { user } from "@/lib/db/schema";
import { makeSeededDb } from "../helpers/fixtures";

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("settings API", () => {
  it("updates the household name and timezone", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      ensureHousehold(db);
      const response = await updateHouseholdHandler(
        db,
        ctxA,
        jsonRequest("/api/settings/household", "PATCH", {
          name: "Nest Two",
          timezone: "America/New_York",
          weekStartsOn: 1,
        }),
      );
      expect(response.status).toBe(200);
      const payload = await body<{ household: { name: string; timezone: string } }>(response);
      expect(payload.household.name).toBe("Nest Two");
      expect(getHousehold(db, ctxA.householdId).timezone).toBe("America/New_York");
    } finally {
      close();
    }
  });

  it("rejects an invalid timezone and an empty name", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      ensureHousehold(db);
      const badZone = await updateHouseholdHandler(
        db,
        ctxA,
        jsonRequest("/api/settings/household", "PATCH", { timezone: "Mars/Olympus" }),
      );
      expect(badZone.status).toBe(400);

      const emptyName = await updateHouseholdHandler(
        db,
        ctxA,
        jsonRequest("/api/settings/household", "PATCH", { name: "  " }),
      );
      expect(emptyName.status).toBe(400);
    } finally {
      close();
    }
  });

  it("updates the member display name", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      // The seed creates membership rows but not Better Auth users; insert one.
      db.insert(user)
        .values({
          id: ctxA.userId,
          name: "Andrew",
          email: "andrew@example.test",
          emailVerified: false,
        })
        .run();

      const response = await updateProfileHandler(
        db,
        ctxA,
        jsonRequest("/api/settings/profile", "PATCH", { name: "Andrew C" }),
      );
      expect(response.status).toBe(200);
      const payload = await body<{ user: { name: string } }>(response);
      expect(payload.user.name).toBe("Andrew C");
    } finally {
      close();
    }
  });
});
