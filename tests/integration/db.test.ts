import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { calendar, event, household } from "@/lib/db/schema";

describe("database schema", () => {
  it("applies migrations and cascades calendar deletes to events", async () => {
    const { db, close } = await makeTestDb();
    try {
      const [h] = db
        .insert(household)
        .values({ id: "h1", name: "Our Nest" })
        .returning()
        .all();
      expect(h?.timezone).toBe("Asia/Taipei");
      expect(h?.weekStartsOn).toBe(0);

      db.insert(calendar)
        .values({ id: "c1", householdId: "h1", name: "School", hueFamily: "indigo" })
        .run();
      db.insert(calendar)
        .values({ id: "c2", householdId: "h1", parentId: "c1", name: "Math", shadeIndex: 4 })
        .run();
      db.insert(event)
        .values({
          id: "e1",
          householdId: "h1",
          calendarId: "c2",
          title: "Quiz",
          startAt: 1_700_000_000_000,
          endAt: 1_700_000_360_000,
          createdBy: "u1",
        })
        .run();

      db.delete(calendar).where(eq(calendar.id, "c1")).run();

      expect(db.select().from(event).all()).toHaveLength(0);
      expect(db.select().from(calendar).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("enforces foreign keys for calendar and event references", async () => {
    const { db, close } = await makeTestDb();
    try {
      db.insert(household).values({ id: "h1" }).run();
      expect(() =>
        db
          .insert(event)
          .values({
            id: "e1",
            householdId: "h1",
            calendarId: "missing",
            title: "Orphan",
            startAt: 1,
            endAt: 2,
            createdBy: "u1",
          })
          .run(),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      close();
    }
  });

  it("stores all-day and timed events in separate columns", async () => {
    const { db, close } = await makeTestDb();
    try {
      db.insert(household).values({ id: "h1" }).run();
      db.insert(calendar)
        .values({ id: "c1", householdId: "h1", name: "Household", hueFamily: "teal" })
        .run();
      db.insert(event)
        .values({
          id: "e-all-day",
          householdId: "h1",
          calendarId: "c1",
          title: "Trip",
          allDay: 1,
          startDate: "2026-10-20",
          endDate: "2026-10-22",
          createdBy: "u1",
        })
        .run();
      const [row] = db.select().from(event).all();
      expect(row?.allDay).toBe(1);
      expect(row?.startDate).toBe("2026-10-20");
      expect(row?.startAt).toBeNull();
    } finally {
      close();
    }
  });

  it("backfills sub-calendar owners from their root (0004)", async () => {
    const { db, sqlite, close } = await makeTestDb();
    try {
      db.insert(household).values({ id: "h1" }).run();
      db.insert(calendar)
        .values({ id: "root-owned", householdId: "h1", name: "From Google", hueFamily: "teal", ownerId: "user-a" })
        .run();
      db.insert(calendar)
        .values({ id: "child-stale", householdId: "h1", parentId: "root-owned", name: "Family", shadeIndex: 4 })
        .run();
      db.insert(calendar)
        .values({ id: "root-shared", householdId: "h1", name: "Household", hueFamily: "slate" })
        .run();
      db.insert(calendar)
        .values({ id: "child-stray", householdId: "h1", parentId: "root-shared", name: "Chores", shadeIndex: 4, ownerId: "user-b" })
        .run();

      const migration = readFileSync(
        resolve("drizzle/0004_normalise_subcalendar_owners.sql"),
        "utf8",
      );
      sqlite.exec(migration);

      const byId = new Map(db.select().from(calendar).all().map((row) => [row.id, row]));
      expect(byId.get("child-stale")?.ownerId).toBe("user-a");
      expect(byId.get("child-stray")?.ownerId).toBeNull();
      expect(byId.get("root-owned")?.ownerId).toBe("user-a");
      expect(byId.get("root-shared")?.ownerId).toBeNull();
    } finally {
      close();
    }
  });
});
