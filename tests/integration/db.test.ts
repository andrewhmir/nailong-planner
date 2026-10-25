import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { migrate } from "@/lib/db/migrate";
import { makeTestDb } from "../helpers/db";
import { calendar, event, household } from "@/lib/db/schema";

function query<T>(sqlite: Database.Database, sql: string): T[] {
  return sqlite.prepare(sql).all() as T[];
}

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
    const { sqlite, close } = await makeTestDb({ upTo: "0003_salty_stranger" });
    try {
      sqlite.exec(`
        INSERT INTO household (id, created_at) VALUES ('h1', 1);
        INSERT INTO calendar
          (id, household_id, parent_id, name, hue_family, shade_index, owner_id,
           is_view_only_for_partner, sort_order, created_at, updated_at)
        VALUES
          ('root-owned', 'h1', NULL, 'From Google', 'teal', 3, 'user-a', 0, 0, 1, 1),
          ('child-stale', 'h1', 'root-owned', 'Family', NULL, 4, NULL, 0, 0, 1, 1),
          ('root-shared', 'h1', NULL, 'Household', 'slate', 3, NULL, 0, 1, 1, 1),
          ('child-stray', 'h1', 'root-shared', 'Chores', NULL, 4, 'user-b', 0, 0, 1, 1);
      `);

      const migration = readFileSync(
        resolve("drizzle/0004_normalise_subcalendar_owners.sql"),
        "utf8",
      );
      sqlite.exec(migration);

      const owners = new Map(
        query<{ id: string; owner_id: string | null }>(sqlite, "SELECT id, owner_id FROM calendar").map(
          (row) => [row.id, row.owner_id],
        ),
      );
      expect(owners.get("child-stale")).toBe("user-a");
      expect(owners.get("child-stray")).toBeNull();
      expect(owners.get("root-owned")).toBe("user-a");
      expect(owners.get("root-shared")).toBeNull();
    } finally {
      close();
    }
  });
});

describe("migration 0005", () => {
  it("renames calendar to collection, backfills visibility, and adds task tables", async () => {
    const { db, sqlite, close } = await makeTestDb({ upTo: "0004_normalise_subcalendar_owners" });
    try {
      db.insert(household).values({ id: "h" }).run();
      sqlite.exec(`
        INSERT INTO calendar
          (id, household_id, parent_id, name, hue_family, shade_index, owner_id,
           is_view_only_for_partner, sort_order, created_at, updated_at)
        VALUES
          ('root', 'h', NULL, 'School', 'indigo', 3, NULL, 0, 0, 1, 1),
          ('child', 'h', 'root', 'Math', NULL, 4, NULL, 1, 0, 1, 1);
        INSERT INTO event
          (id, household_id, calendar_id, title, all_day, start_at, end_at,
           start_date, end_date, created_by, created_at, updated_at)
        VALUES
          ('e-timed', 'h', 'root', 'Quiz', 0, 1700000000000, 1700003600000,
           NULL, NULL, 'u1', 1, 1),
          ('e-allday', 'h', 'child', 'Trip', 1, NULL, NULL,
           '2026-10-20', '2026-10-22', 'u1', 1, 1);
      `);

      migrate(db);

      const collections = new Map(
        query<{ id: string; kind: string; visibility: string; name: string; parent_id: string | null }>(
          sqlite,
          "SELECT id, kind, visibility, name, parent_id FROM collection",
        ).map((row) => [row.id, row]),
      );
      expect(collections.get("root")).toMatchObject({
        kind: "calendar",
        visibility: "shared",
        name: "School",
        parent_id: null,
      });
      expect(collections.get("child")).toMatchObject({
        kind: "calendar",
        visibility: "view_only",
        name: "Math",
        parent_id: "root",
      });

      const events = new Map(
        query<{ id: string; title: string; collection_id: string }>(
          sqlite,
          "SELECT id, title, collection_id FROM event",
        ).map((row) => [row.id, row]),
      );
      expect(events.get("e-timed")).toMatchObject({ title: "Quiz", collection_id: "root" });
      expect(events.get("e-allday")).toMatchObject({ title: "Trip", collection_id: "child" });

      expect(query<{ table: string; from: string; to: string }>(sqlite, "PRAGMA foreign_key_list(event)")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: "collection", from: "collection_id", to: "id" }),
        ]),
      );

      const collectionIndexes = query<{ name: string }>(sqlite, "PRAGMA index_list(collection)").map(
        (row) => row.name,
      );
      expect(collectionIndexes).toEqual(
        expect.arrayContaining(["collection_household_idx", "collection_parent_idx"]),
      );
      const eventIndexes = query<{ name: string }>(sqlite, "PRAGMA index_list(event)").map(
        (row) => row.name,
      );
      expect(eventIndexes).toEqual(expect.arrayContaining(["event_collection_idx"]));

      const tables = query<{ name: string }>(
        sqlite,
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(["task", "task_checklist_item"]));

      sqlite.exec(`
        INSERT INTO task
          (id, household_id, collection_id, title, created_by, created_at, updated_at)
        VALUES ('t1', 'h', 'root', 'Homework', 'u1', 1, 1);
        INSERT INTO task_checklist_item (id, task_id, title) VALUES ('i1', 't1', 'Read chapter 2');
        DELETE FROM collection WHERE id = 'root';
      `);
      expect(query(sqlite, "SELECT id FROM task")).toHaveLength(0);
      expect(query(sqlite, "SELECT id FROM task_checklist_item")).toHaveLength(0);
      expect(query(sqlite, "SELECT id FROM event")).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("maps is_view_only_for_partner = 1 on a root to visibility='view_only' (0005)", async () => {
    const { db, sqlite, close } = await makeTestDb({ upTo: "0004_normalise_subcalendar_owners" });
    try {
      db.insert(household).values({ id: "h" }).run();
      sqlite.exec(`
        INSERT INTO calendar
          (id, household_id, parent_id, name, hue_family, shade_index, owner_id,
           is_view_only_for_partner, sort_order, created_at, updated_at)
        VALUES ('locked-root', 'h', NULL, 'Work', 'teal', 3, 'user-a', 1, 0, 1, 1);
      `);

      migrate(db);

      const [row] = query<{ visibility: string }>(
        sqlite,
        "SELECT visibility FROM collection WHERE id = 'locked-root'",
      );
      expect(row?.visibility).toBe("view_only");
    } finally {
      close();
    }
  });
});
