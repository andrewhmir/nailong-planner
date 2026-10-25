import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { event } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { expandOccurrences } from "@/lib/recurrence/expand";
import { createCalendar } from "@/lib/services/calendars";
import {
  createEvent,
  createException,
  deleteEvent,
  deleteFollowing,
  listEvents,
  moveSeries,
  splitSeries,
  updateEvent,
} from "@/lib/services/events";
import { localWallTimeToUtc, utcToLocalWallTime } from "@/lib/time/zone";
import { makeSeededDb } from "../helpers/fixtures";

const TAIPEI = "Asia/Taipei";
const LONDON = "Europe/London";

function at(wall: string): number {
  return localWallTimeToUtc(wall, TAIPEI);
}

function atLondon(wall: string): number {
  return localWallTimeToUtc(wall, LONDON);
}

function iso(wall: string, zone = TAIPEI): string {
  return new Date(localWallTimeToUtc(wall, zone)).toISOString();
}

function storedRow(db: Database, id: string) {
  return db.select().from(event).where(eq(event.id, id)).get();
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
  const root = createCalendar(seeded.db, seeded.ctxA, { name: "School", hueFamily: "indigo" });
  const child = createCalendar(seeded.db, seeded.ctxA, { name: "Math", parentId: root.id });
  return { ...seeded, root, child };
}

describe("event service", () => {
  it("rejects an event that mixes all-day and timed fields", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      expectAppError(
        () =>
          createEvent(db, ctxA, {
            calendarId: child.id,
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
            calendarId: child.id,
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
        calendarId: child.id,
        title: "Quiz",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });
      const allDay = createEvent(db, ctxA, {
        calendarId: child.id,
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
        calendarId: child.id,
        title: "January lecture",
        allDay: false,
        startAt: at("2026-01-15T09:00"),
        endAt: at("2026-01-15T10:00"),
      });
      createEvent(db, ctxA, {
        calendarId: child.id,
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
        calendarId: child.id,
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
        calendarId: child.id,
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
        calendarId: child.id,
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
      const work = createCalendar(db, ctxA, {
        name: "Work",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      const { updateCalendar } = await import("@/lib/services/calendars");
      updateCalendar(db, ctxA, work.id, { isViewOnlyForPartner: true });

      const event = createEvent(db, ctxA, {
        calendarId: work.id,
        title: "On-call",
        allDay: false,
        startAt: at("2026-10-20T09:00"),
        endAt: at("2026-10-20T10:00"),
      });

      expectAppError(
        () =>
          createEvent(db, ctxB, {
            calendarId: work.id,
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
            calendarId: child.id,
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

  it("never reads events from another household", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      createEvent(db, ctxA, {
        calendarId: root.id,
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

describe("recurring edit scopes", () => {
  it("moves one occurrence into a linked exception and excludes the slot", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      const exception = createException(db, ctxA, series.id, "2026-10-03", {
        allDay: true,
        startDate: "2026-10-04",
        endDate: "2026-10-04",
      });

      expect(exception.rrule).toBeNull();
      expect(exception.recurrenceParentId).toBe(series.id);
      expect(exception.recurrenceId).toBe("2026-10-03");
      expect(exception.calendarId).toBe(child.id);
      expect(exception.title).toBe("Piano");

      const seriesRow = storedRow(db, series.id)!;
      expect(JSON.parse(seriesRow.exdates ?? "[]")).toEqual(["2026-10-03"]);

      const october = { from: at("2026-10-01T00:00"), to: at("2026-11-01T00:00") };
      const seriesKeys = expandOccurrences(seriesRow, october, TAIPEI).map((o) => o.startKey);
      expect(seriesKeys).not.toContain("2026-10-03");
      expect(seriesKeys).toContain("2026-10-10");
      expect(
        expandOccurrences(storedRow(db, exception.id)!, october, TAIPEI).map((o) => o.startKey),
      ).toEqual(["2026-10-04"]);
    } finally {
      close();
    }
  });

  it("rejects moving an occurrence that the rule does not generate", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      expectAppError(
        () =>
          createException(db, ctxA, series.id, "2026-10-04", {
            allDay: true,
            startDate: "2026-10-05",
            endDate: "2026-10-05",
          }),
        "VALIDATION",
        400,
      );
    } finally {
      close();
    }
  });

  it("moves the whole series by the drag delta", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Swim",
        allDay: false,
        startAt: at("2026-10-05T09:00"),
        endAt: at("2026-10-05T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        exdates: [iso("2026-10-19T09:00")],
      });

      const { event: moved } = moveSeries(db, ctxA, series.id, iso("2026-10-05T09:00"), {
        allDay: false,
        startAt: at("2026-10-06T10:00"),
        endAt: at("2026-10-06T11:00"),
        startDate: null,
        endDate: null,
      });

      expect(moved.startAt).toBe(at("2026-10-06T10:00"));
      expect(moved.endAt).toBe(at("2026-10-06T11:00"));
      expect(moved.rrule).toContain("BYDAY=TU");
      expect(JSON.parse(moved.exdates ?? "[]")).toEqual([iso("2026-10-20T10:00")]);
    } finally {
      close();
    }
  });

  it("refuses an all-events move for a custom rule", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Custom",
        allDay: false,
        startAt: at("2026-10-05T09:00"),
        endAt: at("2026-10-05T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
      });
      expectAppError(
        () =>
          moveSeries(db, ctxA, series.id, iso("2026-10-05T09:00"), {
            allDay: false,
            startAt: at("2026-10-06T10:00"),
            endAt: at("2026-10-06T11:00"),
            startDate: null,
            endDate: null,
          }),
        "VALIDATION",
        400,
      );
    } finally {
      close();
    }
  });

  it("splits a COUNT series and applies the edit to the later segment", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      const result = splitSeries(db, ctxA, series.id, "2026-10-17", {
        title: "Second half",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      expect(result.event.title).toBe("Second half");
      expect(result.event.startDate).toBe("2026-10-17");
      expect(result.event.rrule).toBe("FREQ=WEEKLY;BYDAY=SA;COUNT=6");
      expect(result.event.recurrenceParentId ?? null).toBeNull();
      expect(result.relinked).toEqual([]);
      expect(result.truncated?.id).toBe(series.id);
      expect(storedRow(db, series.id)?.rrule).toBe("FREQ=WEEKLY;BYDAY=SA;COUNT=2");
      expect(
        listEvents(db, ctxA, { from: at("2026-10-01T00:00"), to: at("2026-12-01T00:00") }),
      ).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("removes the old row when the split starts at its first occurrence", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      const result = splitSeries(db, ctxA, series.id, "2026-10-03", {
        title: "All of it",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      expect(result.truncated).toBeNull();
      expect(storedRow(db, series.id)).toBeUndefined();
      expect(storedRow(db, result.event.id)).toBeDefined();
    } finally {
      close();
    }
  });

  it("re-links later exceptions to the new segment", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });
      const exception = createException(db, ctxA, series.id, "2026-10-24", {
        allDay: true,
        startDate: "2026-10-25",
        endDate: "2026-10-25",
      });

      const result = splitSeries(db, ctxA, series.id, "2026-10-17", {
        title: "Second half",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      expect(result.relinked).toHaveLength(1);
      expect(result.relinked[0]?.id).toBe(exception.id);
      expect(result.relinkedPrevious[0]?.recurrenceParentId).toBe(series.id);
      expect(storedRow(db, exception.id)?.recurrenceParentId).toBe(result.event.id);
      expect(storedRow(db, exception.id)?.startDate).toBe("2026-10-25");
    } finally {
      close();
    }
  });

  it("shifts re-linked exceptions when following events move", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Swim",
        allDay: false,
        startAt: at("2026-10-05T09:00"),
        endAt: at("2026-10-05T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });
      const exception = createException(db, ctxA, series.id, iso("2026-10-19T09:00"), {
        allDay: false,
        startAt: at("2026-10-20T10:00"),
        endAt: at("2026-10-20T11:00"),
      });

      splitSeries(db, ctxA, series.id, iso("2026-10-12T09:00"), {
        allDay: false,
        startAt: at("2026-10-13T10:00"),
        endAt: at("2026-10-13T11:00"),
        startDate: null,
        endDate: null,
      });

      const shifted = storedRow(db, exception.id)!;
      expect(shifted.startAt).toBe(at("2026-10-21T11:00"));
      expect(shifted.endAt).toBe(at("2026-10-21T12:00"));
      expect(shifted.recurrenceId).toBe(iso("2026-10-20T10:00"));
    } finally {
      close();
    }
  });

  it("deletes a series with its linked exceptions and returns them", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      const exception = createException(db, ctxA, series.id, "2026-10-03", {
        allDay: true,
        startDate: "2026-10-04",
        endDate: "2026-10-04",
      });

      const deleted = deleteEvent(db, ctxA, series.id, { scope: "all" });

      expect(deleted.map((row) => row.id).sort()).toEqual([series.id, exception.id].sort());
      expect(storedRow(db, series.id)).toBeUndefined();
      expect(storedRow(db, exception.id)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("deletes the following occurrences and keeps the earlier segment", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=8",
      });

      const result = deleteFollowing(db, ctxA, series.id, "2026-10-17");

      expect(result.truncated?.id).toBe(series.id);
      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]?.id).not.toBe(series.id);
      expect(storedRow(db, series.id)?.rrule).toBe("FREQ=WEEKLY;BYDAY=SA;COUNT=2");
      expect(
        listEvents(db, ctxA, { from: at("2026-10-01T00:00"), to: at("2026-12-01T00:00") }),
      ).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("propagates series text edits to exceptions but keeps their times", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      const exception = createException(db, ctxA, series.id, "2026-10-10", {
        allDay: true,
        startDate: "2026-10-11",
        endDate: "2026-10-11",
      });

      updateEvent(db, ctxA, series.id, { title: "Piano (renamed)" });

      const after = storedRow(db, exception.id)!;
      expect(after.title).toBe("Piano (renamed)");
      expect(after.startDate).toBe("2026-10-11");
    } finally {
      close();
    }
  });

  it("keeps exceptions linked when the repeat is removed so undo can restore them", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      const exception = createException(db, ctxA, series.id, "2026-10-10", {
        allDay: true,
        startDate: "2026-10-11",
        endDate: "2026-10-11",
      });

      updateEvent(db, ctxA, series.id, { rrule: null });

      // The link survives: undoing the edit restores the rule, and the exception
      // becomes part of the series again without a re-link step.
      expect(storedRow(db, exception.id)?.recurrenceParentId).toBe(series.id);
      expect(storedRow(db, exception.id)?.recurrenceId).toBe("2026-10-10");

      updateEvent(db, ctxA, series.id, { rrule: "FREQ=WEEKLY;BYDAY=SA" });
      expect(storedRow(db, exception.id)?.recurrenceParentId).toBe(series.id);
    } finally {
      close();
    }
  });

  it("keeps a DST series' wall clock across a split", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "London class",
        allDay: false,
        startAt: atLondon("2027-03-02T09:00"),
        endAt: atLondon("2027-03-02T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      });
      db.update(event).set({ tzid: LONDON }).where(eq(event.id, series.id)).run();

      const result = splitSeries(db, ctxA, series.id, new Date(atLondon("2027-03-30T09:00")).toISOString(), {
        title: "London class",
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      });

      expect(result.event.startAt).toBe(atLondon("2027-03-30T09:00"));
      expect(result.event.tzid).toBe(LONDON);
      const occurrences = expandOccurrences(
        storedRow(db, result.event.id)!,
        { from: atLondon("2027-03-30T00:00"), to: atLondon("2027-05-15T00:00") },
        TAIPEI,
      );
      expect(
        occurrences.map((occurrence) => utcToLocalWallTime(occurrence.startAt ?? 0, LONDON).slice(11)),
      ).toEqual(Array(7).fill("09:00"));
    } finally {
      close();
    }
  });

  it("keeps a DST series' wall clock across an all-events move", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "London class",
        allDay: false,
        startAt: atLondon("2027-03-02T09:00"),
        endAt: atLondon("2027-03-02T10:00"),
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      });
      db.update(event).set({ tzid: LONDON }).where(eq(event.id, series.id)).run();

      // Drag the 2027-03-30 (BST) occurrence one week back to 2027-03-23 09:00.
      const { event: moved } = moveSeries(
        db,
        ctxA,
        series.id,
        new Date(atLondon("2027-03-30T09:00")).toISOString(),
        {
          allDay: false,
          startAt: atLondon("2027-03-23T09:00"),
          endAt: atLondon("2027-03-23T10:00"),
          startDate: null,
          endDate: null,
        },
      );

      expect(utcToLocalWallTime(moved.startAt ?? 0, LONDON).slice(11)).toBe("09:00");
      expect(moved.startAt).toBe(atLondon("2027-02-23T09:00"));
      const occurrences = expandOccurrences(
        storedRow(db, series.id)!,
        { from: atLondon("2027-02-20T00:00"), to: atLondon("2027-04-30T00:00") },
        TAIPEI,
      );
      expect(
        occurrences.map((occurrence) => utcToLocalWallTime(occurrence.startAt ?? 0, LONDON).slice(11)),
      ).toEqual(Array(10).fill("09:00"));
    } finally {
      close();
    }
  });

  it("applies an all-events edit from a later occurrence without moving the series start", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });

      // The dialog sends the clicked occurrence's unchanged timing plus the edit;
      // the service must apply a zero delta, not move DTSTART to 24 Oct.
      const { event: updated } = moveSeries(
        db,
        ctxA,
        series.id,
        "2026-10-24",
        {
          allDay: true,
          startAt: null,
          endAt: null,
          startDate: "2026-10-24",
          endDate: "2026-10-24",
        },
        { title: "Piano renamed" },
      );

      expect(updated.startDate).toBe("2026-10-03");
      expect(updated.title).toBe("Piano renamed");
      const occurrences = expandOccurrences(
        storedRow(db, series.id)!,
        { from: at("2026-10-01T00:00"), to: at("2026-11-01T00:00") },
        TAIPEI,
      );
      expect(occurrences[0]?.startKey).toBe("2026-10-03");
    } finally {
      close();
    }
  });

  it("truncates a COUNT series by RRULE position, not by rendered occurrences", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Daily",
        allDay: true,
        startDate: "2026-10-01",
        endDate: "2026-10-01",
        rrule: "FREQ=DAILY;COUNT=10",
        exdates: ["2026-10-02"],
      });

      const result = splitSeries(db, ctxA, series.id, "2026-10-05", {
        title: "Daily later",
        rrule: "FREQ=DAILY;COUNT=10",
      });

      expect(result.truncated?.rrule).toBe("FREQ=DAILY;COUNT=4");
      expect(result.event.rrule).toBe("FREQ=DAILY;COUNT=6");
      const kept = expandOccurrences(
        storedRow(db, series.id)!,
        { from: at("2026-10-01T00:00"), to: at("2026-10-31T00:00") },
        TAIPEI,
      );
      expect(kept.map((occurrence) => occurrence.startKey)).toEqual([
        "2026-10-01",
        "2026-10-03",
        "2026-10-04",
      ]);
    } finally {
      close();
    }
  });

  it("shifts linked exceptions with an all-events move", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      const exception = createException(db, ctxA, series.id, "2026-10-10", {
        allDay: true,
        startDate: "2026-10-11",
        endDate: "2026-10-11",
      });

      const result = moveSeries(
        db,
        ctxA,
        series.id,
        "2026-10-03",
        {
          allDay: true,
          startAt: null,
          endAt: null,
          startDate: "2026-10-04",
          endDate: "2026-10-04",
        },
      );

      expect(result.relinked.map((row) => row.id)).toEqual([exception.id]);
      const shifted = storedRow(db, exception.id)!;
      expect(shifted.startDate).toBe("2026-10-12");
      expect(shifted.recurrenceId).toBe("2026-10-11");
    } finally {
      close();
    }
  });

  it("does not propagate a series edit into an exception's view-only calendar", async () => {
    const { db, close, ctxA, ctxB, root } = await setup();
    try {
      const shared = createEvent(db, ctxA, {
        calendarId: root.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });
      const privateCalendar = createCalendar(db, ctxA, {
        name: "Private",
        hueFamily: "amber",
        ownerId: "user-a",
      });
      const { updateCalendar } = await import("@/lib/services/calendars");
      updateCalendar(db, ctxA, privateCalendar.id, { isViewOnlyForPartner: true });
      const exception = createException(db, ctxA, shared.id, "2026-10-10", {
        allDay: true,
        startDate: "2026-10-11",
        endDate: "2026-10-11",
        calendarId: privateCalendar.id,
      });

      // ctxB can edit the shared series but not the private calendar's exception.
      expect(updateEvent(db, ctxB, shared.id, { title: "Renamed by B" }).title).toBe("Renamed by B");
      expect(storedRow(db, exception.id)?.title).toBe("Piano");
    } finally {
      close();
    }
  });

  it("creates an exception under its series through the create path", async () => {
    const { db, close, ctxA, child } = await setup();
    try {
      const series = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-03",
        endDate: "2026-10-03",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
      });

      const restored = createEvent(db, ctxA, {
        calendarId: child.id,
        title: "Piano",
        allDay: true,
        startDate: "2026-10-04",
        endDate: "2026-10-04",
        recurrenceParentId: series.id,
        recurrenceId: "2026-10-03",
      });

      expect(restored.recurrenceParentId).toBe(series.id);
      expect(restored.recurrenceId).toBe("2026-10-03");

      expectAppError(
        () =>
          createEvent(db, ctxA, {
            calendarId: child.id,
            title: "Lost",
            allDay: true,
            startDate: "2026-10-04",
            endDate: "2026-10-04",
            recurrenceParentId: "missing-parent",
            recurrenceId: "2026-10-03",
          }),
        "NOT_FOUND",
        404,
      );
    } finally {
      close();
    }
  });
});
