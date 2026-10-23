import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendar, event, importBatch, importChange } from "@/lib/db/schema";
import {
  commitImport,
  listImportBatches,
  previewImport,
  rollbackImportBatch,
  type ImportFile,
} from "@/lib/services/import";
import { createCalendar, updateCalendar } from "@/lib/services/calendars";
import { localWallTimeToUtc } from "@/lib/time/zone";
import { makeSeededDb } from "../helpers/fixtures";

const HH = "Asia/Taipei";
const at = (wall: string, zone = HH) => localWallTimeToUtc(wall, zone);

function vevent(lines: string[]): string[] {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
}

function timedEvent(
  uid: string,
  title: string,
  startWall: string,
  endWall: string,
  zone = HH,
): string[] {
  return vevent([
    "UID:" + uid,
    `SUMMARY:${title}`,
    `DTSTART;TZID=${zone}:${startWall}`,
    `DTEND;TZID=${zone}:${endWall}`,
  ]);
}

function ics(calendarName: string, events: string[][]): ImportFile {
  return {
    name: `${calendarName.toLowerCase()}.ics`,
    text: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
      `X-WR-CALNAME:${calendarName}`,
      ...events.flat(),
      "END:VCALENDAR",
    ].join("\r\n"),
  };
}

function threeEvents(): ImportFile {
  return ics("Family", [
    timedEvent("a1@google.com", "Dentist", "20261103T090000", "20261103T100000"),
    timedEvent("a2@google.com", "Swim", "20261104T170000", "20261104T180000"),
    timedEvent("a3@google.com", "Music", "20261105T090000", "20261105T100000"),
  ]);
}

async function setup() {
  const seeded = await makeSeededDb();
  const home = createCalendar(seeded.db, seeded.ctxA, { name: "Home", hueFamily: "teal" });
  return { ...seeded, home };
}

describe("import service", () => {
  it("previews counts without writing anything", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const preview = previewImport(db, ctxA, [threeEvents()]);

      expect(preview.createCount).toBe(3);
      expect(preview.updateCount).toBe(0);
      expect(preview.unchangedCount).toBe(0);
      expect(preview.calendars).toEqual([
        expect.objectContaining({ name: "Family", events: 3, recurring: 0, overrides: 0 }),
      ]);
      expect(db.select().from(event).all()).toHaveLength(0);
      expect(db.select().from(calendar).all().filter((row) => row.name === "Family")).toHaveLength(0);
      expect(db.select().from(importBatch).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("commits calendars and events in one batch", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const report = commitImport(db, ctxA, {
        files: [threeEvents()],
        mapping: { Family: { mode: "new" } },
      });

      expect(report.created).toBe(3);
      expect(report.updated).toBe(0);
      expect(report.calendarsCreated).toEqual(["From Google", "Family"]);

      const root = db.select().from(calendar).where(eq(calendar.name, "From Google")).get();
      expect(root?.parentId).toBeNull();
      const child = db.select().from(calendar).where(eq(calendar.name, "Family")).get();
      expect(child?.parentId).toBe(root?.id);

      const rows = db.select().from(event).all().filter((row) => row.householdId === "h1");
      expect(rows).toHaveLength(3);
      const dentist = rows.find((row) => row.title === "Dentist")!;
      expect(dentist.startAt).toBe(at("2026-11-03T09:00"));
      expect(dentist.tzid).toBe(HH);
      expect(dentist.calendarId).toBe(child?.id);
      expect(dentist.externalUid).toBe("a1@google.com");
      expect(dentist.externalKey).toMatch(/^[a-f0-9]{64}$/);
      expect(dentist.externalContentHash).toMatch(/^[a-f0-9]{64}$/);

      const batch = db.select().from(importBatch).all();
      expect(batch).toHaveLength(1);
      expect(batch[0]?.status).toBe("committed");
      expect(db.select().from(importChange).all()).toHaveLength(3);
    } finally {
      close();
    }
  });

  it("re-importing an unchanged file creates nothing", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const file = threeEvents();
      const mapping = { Family: { mode: "new" as const } };
      const first = commitImport(db, ctxA, { files: [file], mapping });
      expect(first.created).toBe(3);

      const second = commitImport(db, ctxA, { files: [file], mapping });
      expect(second.created).toBe(0);
      expect(second.updated).toBe(0);
      expect(second.unchanged).toBe(3);
      expect(db.select().from(event).all().filter((row) => row.householdId === "h1")).toHaveLength(3);
      // The second run reuses the same calendars instead of creating new ones.
      expect(second.calendarsCreated).toEqual([]);
    } finally {
      close();
    }
  });

  it("updates a changed event in place and records the previous row", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const mapping = { Family: { mode: "new" as const } };
      commitImport(db, ctxA, { files: [threeEvents()], mapping });
      const before = db.select().from(event).where(eq(event.title, "Dentist")).get()!;

      const changed = ics("Family", [
        timedEvent("a1@google.com", "Dentist (moved)", "20261103T110000", "20261103T120000"),
        timedEvent("a2@google.com", "Swim", "20261104T170000", "20261104T180000"),
        timedEvent("a3@google.com", "Music", "20261105T090000", "20261105T100000"),
      ]);
      const report = commitImport(db, ctxA, { files: [changed], mapping });

      expect(report.created).toBe(0);
      expect(report.updated).toBe(1);
      expect(report.unchanged).toBe(2);
      const after = db.select().from(event).where(eq(event.id, before.id)).get()!;
      expect(after.title).toBe("Dentist (moved)");
      expect(after.startAt).toBe(at("2026-11-03T11:00"));
      expect(after.externalContentHash).not.toBe(before.externalContentHash);

      const change = db
        .select()
        .from(importChange)
        .where(and(eq(importChange.batchId, report.batchId), eq(importChange.eventId, before.id)))
        .get()!;
      expect(change.action).toBe("update");
      expect(JSON.parse(change.beforeJson ?? "{}").title).toBe("Dentist");
    } finally {
      close();
    }
  });

  it("refuses a view-only target calendar and writes nothing", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      const partnerOnly = createCalendar(db, ctxB, {
        name: "Partner notes",
        hueFamily: "rose",
        ownerId: "user-b",
        isViewOnlyForPartner: true,
      });

      expect(() =>
        commitImport(db, ctxA, {
          files: [threeEvents()],
          mapping: { Family: { mode: "existing", calendarId: partnerOnly.id } },
        }),
      ).toThrow(/view-only/i);

      expect(db.select().from(event).all()).toHaveLength(0);
      expect(db.select().from(importBatch).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("reports unknown timezones and imports the rest", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const file = ics("Family", [
        vevent([
          "UID:mars@google.com",
          "SUMMARY:Mars rover",
          "DTSTART;TZID=Mars/Olympus:20261201T090000",
          "DTEND;TZID=Mars/Olympus:20261201T100000",
        ]),
        timedEvent("a2@google.com", "Swim", "20261104T170000", "20261104T180000"),
      ]);
      const preview = previewImport(db, ctxA, [file]);
      expect(preview.createCount).toBe(1);
      expect(preview.warnings).toHaveLength(1);
      expect(preview.warnings[0]?.reason).toMatch(/Mars\/Olympus/);

      const report = commitImport(db, ctxA, {
        files: [file],
        mapping: { Family: { mode: "new" } },
      });
      expect(report.created).toBe(1);
      expect(report.warnings).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("rejects an oversized upload", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const huge: ImportFile = { name: "huge.ics", text: "x".repeat(5 * 1024 * 1024 + 1) };
      expect(() => previewImport(db, ctxA, [huge])).toThrow(/too large/i);
    } finally {
      close();
    }
  });

  it("rolls a batch back to the pre-import state", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const report = commitImport(db, ctxA, {
        files: [threeEvents()],
        mapping: { Family: { mode: "new" } },
      });

      const rollback = rollbackImportBatch(db, ctxA, report.batchId);
      expect(rollback.deleted).toBe(3);
      expect(rollback.skipped).toBe(0);
      expect(rollback.calendarsDeleted).toEqual(["Family", "From Google"]);

      expect(db.select().from(event).all().filter((row) => row.householdId === "h1")).toHaveLength(0);
      expect(db.select().from(calendar).all().filter((row) => row.name === "Family")).toHaveLength(0);
      expect(db.select().from(calendar).all().filter((row) => row.name === "From Google")).toHaveLength(0);

      const batch = db.select().from(importBatch).where(eq(importBatch.id, report.batchId)).get()!;
      expect(batch.status).toBe("rolled_back");
      expect(batch.rolledBackAt).not.toBeNull();
    } finally {
      close();
    }
  });

  it("restores updated events on rollback and skips events edited afterwards", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const mapping = { Family: { mode: "new" as const } };
      commitImport(db, ctxA, { files: [threeEvents()], mapping });
      const original = db.select().from(event).where(eq(event.title, "Dentist")).get()!;
      const second = commitImport(db, ctxA, {
        files: [
          ics("Family", [
            timedEvent("a1@google.com", "Dentist (moved)", "20261103T110000", "20261103T120000"),
            timedEvent("a2@google.com", "Swim", "20261104T180000", "20261104T190000"),
            timedEvent("a3@google.com", "Music", "20261105T090000", "20261105T100000"),
          ]),
        ],
        mapping,
      });
      expect(second.updated).toBe(2);

      // The user edits one imported event after the second import.
      db.update(event)
        .set({ title: "Swim (my note)", updatedAt: Date.now() + 10_000 })
        .where(eq(event.title, "Swim"))
        .run();

      const rollback = rollbackImportBatch(db, ctxA, second.batchId);
      expect(rollback.restored).toBe(1);
      expect(rollback.skipped).toBe(1);
      const restored = db.select().from(event).where(eq(event.id, original.id)).get()!;
      expect(restored.title).toBe("Dentist");
      expect(db.select().from(event).where(eq(event.title, "Swim (my note)")).get()).toBeTruthy();
    } finally {
      close();
    }
  });

  it("refuses to roll back twice and hides other households' batches", async () => {
    const { db, close, ctxA, ctxOther } = await setup();
    try {
      const report = commitImport(db, ctxA, {
        files: [threeEvents()],
        mapping: { Family: { mode: "new" } },
      });
      rollbackImportBatch(db, ctxA, report.batchId);
      expect(() => rollbackImportBatch(db, ctxA, report.batchId)).toThrow(/already/i);
      expect(() => rollbackImportBatch(db, ctxOther, report.batchId)).toThrow(/not found/i);
    } finally {
      close();
    }
  });

  it("lists batches newest first with their counts", async () => {
    const { db, close, ctxA, home } = await setup();
    try {
      const first = commitImport(db, ctxA, {
        files: [threeEvents()],
        mapping: { Family: { mode: "new" } },
      });
      const second = commitImport(db, ctxA, {
        files: [ics("Home", [timedEvent("h1@google.com", "Dinner", "20261106T190000", "20261106T200000")])],
        mapping: { Home: { mode: "existing", calendarId: home.id } },
      });

      const batches = listImportBatches(db, ctxA);
      expect(batches).toHaveLength(2);
      expect(batches[0]?.id).not.toBe(first.batchId);
      expect(batches[1]?.id).toBe(first.batchId);
      expect(batches[1]?.created).toBe(3);
      expect(batches[0]?.created).toBe(1);
      expect(second.created).toBe(1);
    } finally {
      close();
    }
  });

  it("moves events when a re-import changes the mapped calendar", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const first = commitImport(db, ctxA, {
        files: [threeEvents()],
        mapping: { Family: { mode: "new" } },
      });
      expect(first.created).toBe(3);
      const imported = db.select().from(event).where(eq(event.title, "Dentist")).get()!;

      const home = createCalendar(db, ctxA, { name: "Home", hueFamily: "sky" });
      const second = commitImport(db, ctxA, {
        files: [threeEvents()],
        mapping: { Family: { mode: "existing", calendarId: home.id } },
      });

      expect(second.created).toBe(0);
      expect(second.updated).toBe(3);
      expect(db.select().from(event).where(eq(event.id, imported.id)).get()?.calendarId).toBe(
        home.id,
      );
    } finally {
      close();
    }
  });

  it("imports a UID that appears in two files once and warns", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const file = threeEvents();
      const preview = previewImport(db, ctxA, [file, file]);
      expect(preview.createCount).toBe(3);
      expect(preview.warnings.length).toBeGreaterThanOrEqual(1);

      const report = commitImport(db, ctxA, {
        files: [file, file],
        mapping: { Family: { mode: "new" } },
      });
      expect(report.created).toBe(3);
      expect(db.select().from(event).all().filter((row) => row.householdId === "h1")).toHaveLength(3);
    } finally {
      close();
    }
  });

  it("refuses to reuse a view-only From Google calendar", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      const root = createCalendar(db, ctxB, {
        name: "From Google",
        hueFamily: "teal",
        ownerId: "user-b",
        isViewOnlyForPartner: true,
      });
      createCalendar(db, ctxB, { name: "Family", parentId: root.id });

      expect(() =>
        commitImport(db, ctxA, {
          files: [threeEvents()],
          mapping: { Family: { mode: "new" } },
        }),
      ).toThrow(/view-only/i);
      expect(db.select().from(event).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("reports series that keep a non-household timezone", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const file = ics("Family", [
        timedEvent("london@google.com", "Swim", "20270302T090000", "20270302T100000", "Europe/London"),
      ]);
      const preview = previewImport(db, ctxA, [file]);
      expect(preview.nonHouseholdTimezones).toEqual(["Europe/London"]);
    } finally {
      close();
    }
  });

  it("refuses to roll back a batch into a calendar the viewer cannot write", async () => {
    const { db, close, ctxA, ctxB } = await setup();
    try {
      // A imports into their own view-only calendar; B must not be able to undo
      // it, and the failed attempt must leave the batch committed.
      const private_ = createCalendar(db, ctxA, {
        name: "Private",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      updateCalendar(db, ctxA, private_.id, { isViewOnlyForPartner: true });
      const report = commitImport(db, ctxA, {
        files: [threeEvents()],
        mapping: { Family: { mode: "existing", calendarId: private_.id } },
      });

      expect(() => rollbackImportBatch(db, ctxB, report.batchId)).toThrow(/view-only/i);
      expect(listImportBatches(db, ctxA)[0]?.status).toBe("committed");

      // The owner can still undo their own import afterwards.
      expect(rollbackImportBatch(db, ctxA, report.batchId).deleted).toBe(3);
    } finally {
      close();
    }
  });

  it("rolls back two batches in order without leaving events behind", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const mapping = { Family: { mode: "new" as const } };
      const first = commitImport(db, ctxA, { files: [threeEvents()], mapping });
      const second = commitImport(db, ctxA, {
        files: [
          ics("Family", [
            timedEvent("a1@google.com", "Dentist (moved)", "20261103T110000", "20261103T120000"),
            timedEvent("a2@google.com", "Swim", "20261104T170000", "20261104T180000"),
            timedEvent("a3@google.com", "Music", "20261105T090000", "20261105T100000"),
          ]),
        ],
        mapping,
      });
      expect(second.updated).toBe(1);

      const rollbackSecond = rollbackImportBatch(db, ctxA, second.batchId);
      expect(rollbackSecond.restored).toBe(1);
      expect(rollbackSecond.skipped).toBe(0);

      const rollbackFirst = rollbackImportBatch(db, ctxA, first.batchId);
      expect(rollbackFirst.deleted).toBe(3);
      expect(rollbackFirst.skipped).toBe(0);
      expect(db.select().from(event).all().filter((row) => row.householdId === "h1")).toHaveLength(0);
    } finally {
      close();
    }
  });
});
