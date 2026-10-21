import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendar, event, importBatch, importChange } from "@/lib/db/schema";
import { makeSeededDb } from "../helpers/fixtures";

/** A minimal valid event row; every new external-identity column stays null. */
function baseEvent(overrides: Partial<typeof event.$inferInsert> = {}): typeof event.$inferInsert {
  return {
    id: crypto.randomUUID(),
    householdId: "h1",
    calendarId: "c1",
    title: "Imported",
    allDay: 0,
    startAt: 1,
    endAt: 2,
    createdBy: "user-a",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

async function setup() {
  const seeded = await makeSeededDb();
  seeded.db
    .insert(calendar)
    .values({ id: "c1", householdId: "h1", name: "Family", hueFamily: "teal" })
    .run();
  return seeded;
}

describe("import schema", () => {
  it("keeps external keys unique per household and allows many null keys", async () => {
    const { db, close } = await setup();
    try {
      db.insert(event).values(baseEvent({ externalKey: "k1" })).run();
      expect(() => db.insert(event).values(baseEvent({ externalKey: "k1" })).run()).toThrow(
        /UNIQUE/,
      );

      // SQLite allows any number of NULLs in a unique index: native events carry no key.
      db.insert(event).values(baseEvent()).run();
      db.insert(event).values(baseEvent()).run();
      expect(db.select().from(event).all()).toHaveLength(3);
    } finally {
      close();
    }
  });

  it("stores source timezone and external identity on an event", async () => {
    const { db, close } = await setup();
    try {
      db.insert(event)
        .values(
          baseEvent({
            externalSource: "ics",
            externalUid: "abc@google.com",
            externalRecurrenceId: "2027-03-30T08:00:00.000Z",
            externalKey: "key-3",
            externalContentHash: "hash-3",
            tzid: "Europe/London",
          }),
        )
        .run();

      const row = db.select().from(event).where(eq(event.externalKey, "key-3")).get();
      expect(row?.tzid).toBe("Europe/London");
      expect(row?.externalSource).toBe("ics");
      expect(row?.externalUid).toBe("abc@google.com");
      expect(row?.externalRecurrenceId).toBe("2027-03-30T08:00:00.000Z");
      expect(row?.externalContentHash).toBe("hash-3");
    } finally {
      close();
    }
  });

  it("cascades import changes when their batch is deleted", async () => {
    const { db, close } = await setup();
    try {
      db.insert(importBatch)
        .values({
          id: "b1",
          householdId: "h1",
          createdBy: "user-a",
          sourceName: "Family.ics",
        })
        .run();
      db.insert(importChange)
        .values({ id: "ch1", batchId: "b1", eventId: "e1", action: "create" })
        .run();

      db.delete(importBatch).where(eq(importBatch.id, "b1")).run();
      expect(db.select().from(importChange).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("defaults a batch to committed", async () => {
    const { db, close } = await setup();
    try {
      db.insert(importBatch)
        .values({ id: "b2", householdId: "h1", createdBy: "user-a", sourceName: "Family.ics" })
        .run();
      const row = db.select().from(importBatch).where(eq(importBatch.id, "b2")).get();
      expect(row?.status).toBe("committed");
      expect(row?.rolledBackAt).toBeNull();
    } finally {
      close();
    }
  });
});
