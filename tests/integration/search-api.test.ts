import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/client";
import { createCollection } from "@/lib/services/collections";
import { createEvent } from "@/lib/services/events";
import type { ViewerContext } from "@/lib/services/permissions";
import { searchEvents } from "@/lib/services/search";
import type { CreateEventInput } from "@/lib/validation/events";
import { localWallTimeToUtc } from "@/lib/time/zone";
import { makeSeededDb } from "../helpers/fixtures";

const TZ = "Asia/Taipei";

function timedEvent(
  db: Database,
  ctx: ViewerContext,
  collectionId: string,
  overrides: Partial<CreateEventInput>,
): void {
  createEvent(db, ctx, {
    collectionId,
    title: "Untitled",
    allDay: false,
    startAt: localWallTimeToUtc("2026-10-21T09:00", TZ),
    endAt: localWallTimeToUtc("2026-10-21T10:00", TZ),
    ...overrides,
  } as CreateEventInput);
}

describe("searchEvents", () => {
  it("matches title, location and description case-insensitively", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const collection = createCollection(db, ctxA, { name: "Home", hueFamily: "teal" });
      timedEvent(db, ctxA, collection.id, {
        title: "Holiday in Kyoto",
        location: "Kyoto Station",
        description: "book the train",
      });

      expect(searchEvents(db, ctxA, "kyoto").length).toBe(1);
      expect(searchEvents(db, ctxA, "HOLIDAY").length).toBe(1);
      expect(searchEvents(db, ctxA, "train").length).toBe(1);
    } finally {
      close();
    }
  });

  it("requires two characters and never crosses households", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      const collection = createCollection(db, ctxA, { name: "Home", hueFamily: "teal" });
      timedEvent(db, ctxA, collection.id, { title: "Holiday in Kyoto" });

      expect(searchEvents(db, ctxA, "k")).toEqual([]);
      expect(searchEvents(db, ctxA, "  k  ")).toEqual([]);
      expect(searchEvents(db, ctxA, "kyoto")).toHaveLength(1);
      expect(searchEvents(db, ctxOther, "kyoto")).toEqual([]);
    } finally {
      close();
    }
  });

  it("returns a recurring series once, not one row per occurrence", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const collection = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      timedEvent(db, ctxA, collection.id, {
        title: "Weekly class",
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      });

      expect(searchEvents(db, ctxA, "weekly class")).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("escapes LIKE wildcards", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const collection = createCollection(db, ctxA, { name: "Home", hueFamily: "teal" });
      timedEvent(db, ctxA, collection.id, { title: "100% sure" });
      timedEvent(db, ctxA, collection.id, { title: "100x sure" });

      expect(searchEvents(db, ctxA, "100%").map((event) => event.title)).toEqual(["100% sure"]);
    } finally {
      close();
    }
  });

  it("never returns an event from a private collection the viewer does not own", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const journal = createCollection(db, ctxA, {
        name: "Journal",
        hueFamily: "rose",
        ownerId: "user-a",
        visibility: "private",
      });
      timedEvent(db, ctxA, journal.id, { title: "Kyoto journal" });

      expect(searchEvents(db, ctxA, "kyoto").map((event) => event.title)).toEqual([
        "Kyoto journal",
      ]);
      expect(searchEvents(db, ctxB, "kyoto")).toEqual([]);
    } finally {
      close();
    }
  });

  it("ranks title matches above description matches and honours the limit", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const collection = createCollection(db, ctxA, { name: "Home", hueFamily: "teal" });
      timedEvent(db, ctxA, collection.id, { title: "Groceries", description: "pick up the milk" });
      timedEvent(db, ctxA, collection.id, { title: "Milk run" });
      timedEvent(db, ctxA, collection.id, { title: "Milk 2" });

      const results = searchEvents(db, ctxA, "milk");
      expect(results.map((event) => event.title)).toEqual(["Milk 2", "Milk run", "Groceries"]);
      expect(searchEvents(db, ctxA, "milk", 2)).toHaveLength(2);
    } finally {
      close();
    }
  });
});
