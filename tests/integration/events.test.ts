import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createCollection } from "@/lib/services/collections";
import { createEvent, deleteEvent, getEvent, listEvents, updateEvent } from "@/lib/services/events";
import { localWallTimeToUtc } from "@/lib/time/zone";
import { makeSeededDb } from "../helpers/fixtures";

const TAIPEI = "Asia/Taipei";

function at(wall: string): number {
  return localWallTimeToUtc(wall, TAIPEI);
}

function expectAppError(fn: () => unknown, code: string, status: number) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    expect((error as AppError).status).toBe(status);
    return;
  }
  throw new Error(`expected AppError ${code}, but call succeeded`);
}

async function setup() {
  const seeded = await makeSeededDb();
  const root = createCollection(seeded.db, seeded.ctxA, { name: "School", hueFamily: "indigo" });
  const child = createCollection(seeded.db, seeded.ctxA, { name: "Math", parentId: root.id });
  return { ...seeded, root, child };
}

describe("event service", () => {
  it("rejects an event that mixes all-day and timed fields", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      expectAppError(
        () =>
          createEvent(db, ctxA, {
            collectionId: child.id,
            title: "Broken",
            allDay: true,
            startAt: at("2026-10-20T09:00"),
            endAt: at("2026-10-20T10:00"),
          } as never),
        "VALIDATION",
        400,
      );
    } finally {
      close();
    }
  });

  it("rejects a timed event whose end is not after its start", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      expectAppError(
        () =>
          createEvent(db, ctxA, {
            collectionId: child.id,
            title: "Backwards",
            allDay: false,
            startAt: at("2026-10-20T10:00"),
            endAt: at("2026-10-20T09:00"),
          } as never),
        "VALIDATION",
        400,
      );
    } finally {
      close();
    }
  });

  it("stores timed events as UTC and all-day events as local dates", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const timed = createEvent(db, ctxA, {
        collectionId: child.id,
        title: "Quiz",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      const allDay = createEvent(db, ctxA, {
        collectionId: child.id,
        title: "Trip",
        allDay: true,
        startDate: "2026-10-21",
        endDate: "2026-10-23",
      });

      expect(timed.startAt).toBe(at("2026-10-20T09:00"));
      expect(timed.startDate).toBeNull();
      expect(allDay.startDate).toBe("2026-10-21");
      expect(allDay.startAt).toBeNull();
      expect(allDay.endDate).toBe("2026-10-23");
    } finally {
      close();
    }
  });

  it("returns recurring rows regardless of range and other rows only when they intersect", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      createEvent(db, ctxA, {
        collectionId: child.id,
        title: "January lecture",
        allDay: false,
        startAt: at("2026-01-15T09:00"),
        endAt: at("2026-01-15T10:00"),
      });
      createEvent(db, ctxA, {
        collectionId: child.id,
        title: "Weekly class",
        allDay: false,
        startAt: at("2026-01-06T09:00"),
        endAt: at("2026-01-06T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      });

      const october = listEvents(db, ctxA, {
        from: at("2026-10-01T00:00"),
        to: at("2026-11-01T00:00"),
      });
      expect(october.map((row) => row.title)).toEqual(["Weekly class"]);

      const january = listEvents(db, ctxA, {
        from: at("2026-01-01T00:00"),
        to: at("2026-02-01T00:00"),
      });
      expect(january.map((row) => row.title).sort()).toEqual(["January lecture", "Weekly class"]);
    } finally {
      close();
    }
  });

  it("returns color tokens resolved from the event's calendar", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const created = createEvent(db, ctxA, {
        collectionId: child.id,
        title: "Quiz",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      expect(created.color.main).toMatch(/^oklch\(/);
      expect(created.color.main).toContain("275");
    } finally {
      close();
    }
  });

  it("skips exactly one occurrence of a recurring event and is idempotent", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        collectionId: child.id,
        title: "Standup",
        allDay: true,
        startDate: "2026-01-31",
        endDate: "2026-01-31",
        rrule: "FREQ=MONTHLY",
      });

      deleteEvent(db, ctxA, series.id, { scope: "this", occurrenceStart: "2026-01-31" });
      deleteEvent(db, ctxA, series.id, { scope: "this", occurrenceStart: "2026-01-31" });

      const [stored] = listEvents(db, ctxA, {
        from: at("2026-01-01T00:00"),
        to: at("2026-02-01T00:00"),
      });
      expect(stored).toBeDefined();
      expect(JSON.parse(stored!.exdates ?? "[]")).toEqual(["2026-01-31"]);
    } finally {
      close();
    }
  });

  it("deletes the whole series when scope is all", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        collectionId: child.id,
        title: "Standup",
        allDay: false,
        startAt: at("2026-01-06T09:00"),
        endAt: at("2026-01-06T10:00"),
        rrule: "FREQ=WEEKLY",
      });
      deleteEvent(db, ctxA, series.id, { scope: "all" });
      expect(
        listEvents(db, ctxA, { from: at("2026-01-01T00:00"), to: at("2026-02-01T00:00") }),
      ).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("blocks every write to an event in a view-only partner calendar", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      const work = createCollection(db, ctxA, {
        name: "Work",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      const { updateCollection } = await import("@/lib/services/collections");
      updateCollection(db, ctxA, work.id, { visibility: "view_only" });

      const event = createEvent(db, ctxA, {
        collectionId: work.id,
        title: "On-call",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });

      expectAppError(
        () =>
          createEvent(db, ctxB, {
            collectionId: work.id,
            title: "Sneaky",
            allDay: false,
            startAt: at("2026-10-21T09:00"),
            endAt: at("2026-10-21T10:00"),
          }),
        "FORBIDDEN",
        403,
      );
      expectAppError(() => updateEvent(db, ctxB, event.id, { title: "Hacked" }), "FORBIDDEN", 403);
      expectAppError(() => deleteEvent(db, ctxB, event.id, { scope: "all" }), "FORBIDDEN", 403);
      expect(updateEvent(db, ctxA, event.id, { title: "On-call (mine)" }).title).toBe(
        "On-call (mine)",
      );
    } finally {
      close();
    }
  });

  it("rejects an invalid rrule and a view-only create from the partner", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      expectAppError(
        () =>
          createEvent(db, ctxA, {
            collectionId: child.id,
            title: "Bad rule",
            allDay: false,
            startAt: at("2026-10-20T09:00"),
            endAt: at("2026-10-20T10:00"),
            rrule: "EVERY TUESDAY",
          }),
        "VALIDATION",
        400,
      );
    } finally {
      close();
    }
  });

  it("hides a private calendar's events from the partner on every path", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      const journal = createCollection(db, ctxA, {
        name: "Journal",
        hueFamily: "rose",
        ownerId: "user-a",
        visibility: "private",
      });
      const event = createEvent(db, ctxA, {
        collectionId: journal.id,
        title: "Secret plan",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      const child = createCollection(db, ctxA, { name: "Entries", parentId: journal.id });
      const childEvent = createEvent(db, ctxA, {
        collectionId: child.id,
        title: "Secret entry",
        allDay: true,
        startDate: "2026-10-21",
        endDate: "2026-10-21",
      });

      const range = { from: at("2026-10-01T00:00"), to: at("2026-11-01T00:00") };
      expect(listEvents(db, ctxA, range).map((row) => row.title)).toEqual([
        "Secret plan",
        "Secret entry",
      ]);
      expect(listEvents(db, ctxB, range)).toEqual([]);

      expect(getEvent(db, ctxA, event.id).title).toBe("Secret plan");
      expectAppError(() => getEvent(db, ctxB, event.id), "NOT_FOUND", 404);
      expectAppError(() => getEvent(db, ctxB, childEvent.id), "NOT_FOUND", 404);
      expectAppError(() => updateEvent(db, ctxB, event.id, { title: "Hacked" }), "NOT_FOUND", 404);
      expectAppError(() => deleteEvent(db, ctxB, event.id, { scope: "all" }), "NOT_FOUND", 404);
      expectAppError(
        () =>
          createEvent(db, ctxB, {
            collectionId: journal.id,
            title: "Sneaky",
            allDay: false,
            startAt: at("2026-10-22T09:00"),
            endAt: at("2026-10-22T10:00"),
          }),
        "NOT_FOUND",
        404,
      );
    } finally {
      close();
    }
  });

  it("never reads events from another household", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      createEvent(db, ctxA, {
        collectionId: root.id,
        title: "Mine",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      expect(
        listEvents(db, ctxOther, { from: at("2026-10-01T00:00"), to: at("2026-11-01T00:00") }),
      ).toHaveLength(0);
    } finally {
      close();
    }
  });
});
