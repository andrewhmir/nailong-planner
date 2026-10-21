import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  commitImportHandler,
  listImportBatchesHandler,
  previewImportHandler,
  rollbackImportBatchHandler,
} from "@/lib/api/handlers/import";
import { calendar, event } from "@/lib/db/schema";
import type { ImportFile } from "@/lib/services/import";
import { createCalendar } from "@/lib/services/calendars";
import { localWallTimeToUtc } from "@/lib/time/zone";
import { makeSeededDb } from "../helpers/fixtures";

const HH = "Asia/Taipei";

function ics(calendarName: string, uid: string, title: string): ImportFile {
  return {
    name: `${calendarName.toLowerCase()}.ics`,
    text: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      `X-WR-CALNAME:${calendarName}`,
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `SUMMARY:${title}`,
      `DTSTART;TZID=${HH}:20261103T090000`,
      `DTEND;TZID=${HH}:20261103T100000`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
  };
}

function multipart(files: ImportFile[], mapping?: unknown): Request {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new File([file.text], file.name, { type: "text/calendar" }));
  }
  if (mapping !== undefined) {
    form.append("mapping", typeof mapping === "string" ? mapping : JSON.stringify(mapping));
  }
  return new Request("http://localhost:3000/api/import/preview", {
    method: "POST",
    body: form,
  });
}

async function setup() {
  const seeded = await makeSeededDb();
  const home = createCalendar(seeded.db, seeded.ctxA, { name: "Home", hueFamily: "teal" });
  return { ...seeded, home };
}

describe("import API", () => {
  it("previews a multipart upload without writing", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const response = await previewImportHandler(
        db,
        ctxA,
        multipart([ics("Family", "a1@google.com", "Dentist")]),
      );
      const payload = (await response.json()) as {
        preview: { createCount: number; calendars: Array<{ name: string }> };
      };

      expect(response.status).toBe(200);
      expect(payload.preview.createCount).toBe(1);
      expect(payload.preview.calendars[0]?.name).toBe("Family");
      expect(db.select().from(event).all()).toHaveLength(0);
      expect(db.select().from(calendar).all().filter((row) => row.name === "Family")).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("commits and returns the batch report", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const response = await commitImportHandler(
        db,
        ctxA,
        multipart([ics("Family", "a1@google.com", "Dentist")], { Family: { mode: "new" } }),
      );
      const payload = (await response.json()) as {
        report: { batchId: string; created: number };
      };

      expect(response.status).toBe(201);
      expect(payload.report.created).toBe(1);
      const row = db.select().from(event).all().find((candidate) => candidate.title === "Dentist");
      expect(row?.startAt).toBe(localWallTimeToUtc("2026-11-03T09:00", HH));
    } finally {
      close();
    }
  });

  it("returns 400 for a missing or malformed mapping", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const missing = await commitImportHandler(
        db,
        ctxA,
        multipart([ics("Family", "a1@google.com", "Dentist")]),
      );
      expect(missing.status).toBe(400);

      const malformed = await commitImportHandler(
        db,
        ctxA,
        multipart([ics("Family", "a1@google.com", "Dentist")], "{not json"),
      );
      expect(malformed.status).toBe(400);

      const empty = await previewImportHandler(db, ctxA, multipart([]));
      expect(empty.status).toBe(400);
      expect(db.select().from(event).all()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("lists batches and rolls one back", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const commit = await commitImportHandler(
        db,
        ctxA,
        multipart([ics("Family", "a1@google.com", "Dentist")], { Family: { mode: "new" } }),
      );
      const { report } = (await commit.json()) as { report: { batchId: string } };

      const list = await listImportBatchesHandler(db, ctxA);
      const listPayload = (await list.json()) as { batches: Array<{ id: string }> };
      expect(list.status).toBe(200);
      expect(listPayload.batches).toHaveLength(1);
      expect(listPayload.batches[0]?.id).toBe(report.batchId);

      const rollback = await rollbackImportBatchHandler(db, ctxA, report.batchId);
      expect(rollback.status).toBe(200);
      expect(db.select().from(event).all()).toHaveLength(0);

      const again = await rollbackImportBatchHandler(db, ctxA, report.batchId);
      expect(again.status).toBe(409);
    } finally {
      close();
    }
  });

  it("returns 404 for an unknown batch", async () => {
    const { db, close, ctxA } = await setup();
    try {
      const response = await rollbackImportBatchHandler(db, ctxA, "missing");
      expect(response.status).toBe(404);
    } finally {
      close();
    }
  });

  it("exports every route through the authenticated viewer wrapper", () => {
    const routes = [
      "app/api/import/preview/route.ts",
      "app/api/import/commit/route.ts",
      "app/api/import/batches/route.ts",
      "app/api/import/batches/[id]/rollback/route.ts",
    ];
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(source).toContain('export const dynamic = "force-dynamic"');
      expect(source).toContain("withViewer");
    }
  });
});
