import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createCollection, updateCollection } from "@/lib/services/collections";
import { createEvent, listEvents } from "@/lib/services/events";
import { localWallTimeToUtc } from "@/lib/time/zone";
import { makeSeededDb } from "../helpers/fixtures";

const at = (wall: string) => localWallTimeToUtc(wall, "Asia/Taipei");

function expectAppError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError ${code}, but the call succeeded`);
}

describe("calendar permissions (regressions found in review)", () => {
  it("a view-only root protects its sub-calendars from the partner", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const work = createCollection(db, ctxA, { name: "Work", hueFamily: "amber", ownerId: "user-a" });
      const onCall = createCollection(db, ctxA, { name: "On-call", parentId: work.id });
      updateCollection(db, ctxA, work.id, { visibility: "view_only" });

      expectAppError(() => updateCollection(db, ctxB, onCall.id, { name: "Hacked" }), "FORBIDDEN");
      expectAppError(
        () =>
          createEvent(db, ctxB, {
            collectionId: onCall.id,
            title: "Sneaky",
            allDay: false,
            startAt: at("2026-10-20T09:00"),
            endAt: at("2026-10-20T10:00"),
          }),
        "FORBIDDEN",
      );
      expectAppError(
        () => createCollection(db, ctxB, { name: "Deeper", parentId: onCall.id }),
        "VALIDATION",
      );
      // The owner can still work in the child.
      const event = createEvent(db, ctxA, {
        collectionId: onCall.id,
        title: "Shift",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      expect(event.id).toBeTruthy();
    } finally {
      close();
    }
  });

  it("lets a member claim an ownerless calendar but not someone else's", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const shared = createCollection(db, ctxA, { name: "Shared", hueFamily: "teal" });
      expect(updateCollection(db, ctxA, shared.id, { ownerId: "user-a" }).ownerId).toBe("user-a");

      const mine = createCollection(db, ctxA, { name: "Mine", hueFamily: "indigo", ownerId: "user-a" });
      expectAppError(() => updateCollection(db, ctxB, mine.id, { ownerId: "user-b" }), "FORBIDDEN");
      expectAppError(
        () => updateCollection(db, ctxA, mine.id, { ownerId: "user-b" }),
        "FORBIDDEN",
      );

      // Giving a calendar back to the household clears the view-only flag.
      updateCollection(db, ctxA, mine.id, { visibility: "view_only" });
      const sharedAgain = updateCollection(db, ctxA, mine.id, { ownerId: null });
      expect(sharedAgain.ownerId).toBeNull();
      expect(sharedAgain.visibility).toBe("shared");
    } finally {
      close();
    }
  });
});

describe("event patch regressions", () => {
  it("patches only the title of an all-day event without demanding times", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCollection(db, ctxA, { name: "Household", hueFamily: "teal" });
      const event = createEvent(db, ctxA, {
        collectionId: root.id,
        title: "Trip",
        allDay: true,
        startDate: "2026-10-20",
        endDate: "2026-10-22",
      });

      const { updateEvent } = await import("@/lib/services/events");
      const updated = updateEvent(db, ctxA, event.id, { title: "Trip (edited)" });
      expect(updated.title).toBe("Trip (edited)");
      expect(updated.allDay).toBe(1);
      expect(updated.startDate).toBe("2026-10-20");
    } finally {
      close();
    }
  });

  it("moves an event between writable calendars and refuses view-only targets", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const school = createCollection(db, ctxA, { name: "School", hueFamily: "indigo", ownerId: "user-a" });
      const other = createCollection(db, ctxA, { name: "Elsewhere", hueFamily: "rose", ownerId: "user-a" });
      const { createEvent: add, updateEvent } = await import("@/lib/services/events");
      const event = add(db, ctxA, {
        collectionId: school.id,
        title: "Lecture",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });

      expect(updateEvent(db, ctxA, event.id, { collectionId: other.id }).collectionId).toBe(other.id);

      const locked = createCollection(db, ctxB, {
        name: "Locked",
        hueFamily: "amber",
        ownerId: "user-b",
      });
      updateCollection(db, ctxB, locked.id, { visibility: "view_only" });
      expectAppError(() => updateEvent(db, ctxA, event.id, { collectionId: locked.id }), "FORBIDDEN");

      expect(
        listEvents(db, ctxA, { from: at("2026-10-01T00:00"), to: at("2026-11-01T00:00") }).length,
      ).toBeGreaterThan(0);
    } finally {
      close();
    }
  });
});

describe("production-readiness UAT regressions", () => {
  it("deletes one occurrence of a series whose stored exdates JSON is corrupt", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const { event: eventTable } = await import("@/lib/db/schema");
      const { deleteEvent } = await import("@/lib/services/events");
      const school = createCollection(db, ctxA, {
        name: "School",
        hueFamily: "indigo",
        ownerId: "user-a",
      });
      const series = createEvent(db, ctxA, {
        collectionId: school.id,
        title: "Weekly",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      });
      // Corrupt the column the way an older build could leave it.
      db.update(eventTable).set({ exdates: "not-json" }).where(eq(eventTable.id, series.id)).run();

      expect(() =>
        deleteEvent(db, ctxA, series.id, {
          scope: "this",
          occurrenceStart: "2026-10-27T09:00",
        }),
      ).not.toThrow();
      const row = db.select().from(eventTable).where(eq(eventTable.id, series.id)).get();
      expect(JSON.parse(row!.exdates!)).toEqual(["2026-10-27T09:00"]);
    } finally {
      close();
    }
  });

  it("waits out a long import transaction before failing as locked", async () => {
    const { createDb } = await import("@/lib/db/client");
    const { sqlite } = createDb(":memory:");
    try {
      // A 2000-event commit takes ~4.8 s; better-sqlite3's implicit 5 s timeout
      // was too close to that.
      expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(15000);
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
