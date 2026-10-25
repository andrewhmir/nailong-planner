import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { HUE_FAMILIES, MAX_CHILDREN, isHueFamily, type HueFamily } from "@/lib/color/palette";
import type { Database } from "@/lib/db/client";
import {
  calendar,
  event,
  household,
  importBatch,
  importChange,
  type CalendarRow,
  type EventRow,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  parseIcs,
  type IcsCalendarSummary,
  type IcsDropped,
  type IcsEvent,
  type IcsWarning,
} from "@/lib/import/ics";
import { assertCalendarWritable, createCalendar, getCalendarAccess } from "./calendars";
import type { ViewerContext } from "./permissions";

/**
 * Google Calendar import: preview (no writes) and a transactional commit that
 * creates the target calendars, upserts events idempotently by `external_key`,
 * and records an undo ledger (`import_batch` + `import_change`). No OAuth, no
 * network: the caller supplies the exported `.ics` text (spec D7/D14).
 */
export const IMPORT_ROOT_NAME = "From Google";

const MAX_FILES = 20;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 50_000;
/** SQLite caps bound parameters per statement; chunk the key lookups. */
const KEY_CHUNK = 400;

export interface ImportFile {
  name: string;
  text: string;
}

export type ImportCalendarMode = { mode: "new" } | { mode: "existing"; calendarId: string };
export type ImportMapping = Record<string, ImportCalendarMode>;

export interface ImportPreviewCalendar {
  name: string;
  events: number;
  recurring: number;
  overrides: number;
  earliest: string | null;
  latest: string | null;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
}

export interface ImportPreview {
  calendars: ImportPreviewCalendar[];
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  /** Source timezones that differ from the household zone (spec R13 dry-run note). */
  nonHouseholdTimezones: string[];
  warnings: IcsWarning[];
  dropped: IcsDropped;
}

export interface ImportReport {
  batchId: string;
  created: number;
  updated: number;
  unchanged: number;
  calendarsCreated: string[];
  warnings: IcsWarning[];
  dropped: IcsDropped;
}

export interface ImportBatchView {
  id: string;
  sourceName: string;
  createdAt: number;
  status: "committed" | "rolled_back";
  rolledBackAt: number | null;
  created: number;
  updated: number;
}

export interface RollbackReport {
  batchId: string;
  deleted: number;
  restored: number;
  skipped: number;
  calendarsDeleted: string[];
}

interface StoredReport {
  created: number;
  updated: number;
  unchanged: number;
  calendarsCreated: string[];
  createdCalendarIds: string[];
}

function emptyDropped(): IcsDropped {
  return { alarms: 0, attendees: 0, attachments: 0 };
}

function householdTimezone(db: Database, householdId: string): string {
  const row = db.select().from(household).where(eq(household.id, householdId)).get();
  return row?.timezone ?? "Asia/Taipei";
}

function validateFiles(files: ImportFile[]): void {
  if (files.length === 0) {
    throw new AppError("VALIDATION", "Choose at least one .ics file.", 400);
  }
  if (files.length > MAX_FILES) {
    throw new AppError("VALIDATION", `At most ${MAX_FILES} files can be imported at once.`, 400);
  }
  let total = 0;
  for (const file of files) {
    if (file.text.trim().length === 0) {
      throw new AppError("VALIDATION", `“${file.name}” is empty.`, 400);
    }
    total += file.text.length;
  }
  if (total > MAX_TEXT_BYTES) {
    throw new AppError("VALIDATION", "That export is too large (5 MB max).", 400);
  }
}

interface ParsedFiles {
  events: IcsEvent[];
  warnings: IcsWarning[];
  dropped: IcsDropped;
  calendars: IcsCalendarSummary[];
}

function mergeSummary(existing: IcsCalendarSummary, next: IcsCalendarSummary): IcsCalendarSummary {
  return {
    name: existing.name,
    events: existing.events + next.events,
    recurring: existing.recurring + next.recurring,
    overrides: existing.overrides + next.overrides,
    earliest:
      existing.earliest === null
        ? next.earliest
        : next.earliest === null
          ? existing.earliest
          : existing.earliest < next.earliest
            ? existing.earliest
            : next.earliest,
    latest:
      existing.latest === null
        ? next.latest
        : next.latest === null
          ? existing.latest
          : existing.latest > next.latest
            ? existing.latest
            : next.latest,
  };
}

function parseFiles(files: ImportFile[], timezone: string): ParsedFiles {
  const events: IcsEvent[] = [];
  const warnings: IcsWarning[] = [];
  const dropped = emptyDropped();
  const calendars = new Map<string, IcsCalendarSummary>();
  const seenKeys = new Set<string>();

  for (const file of files) {
    const fallback = file.name.replace(/\.ics$/i, "") || "Imported calendar";
    const parsed = parseIcs(file.text, timezone, fallback);
    for (const item of parsed.events) {
      if (seenKeys.has(item.externalKey)) {
        warnings.push({
          uid: item.uid,
          title: item.title,
          reason: "This event appears more than once in the upload; the first copy is used.",
        });
        continue;
      }
      seenKeys.add(item.externalKey);
      events.push(item);
    }
    warnings.push(...parsed.warnings);
    dropped.alarms += parsed.dropped.alarms;
    dropped.attendees += parsed.dropped.attendees;
    dropped.attachments += parsed.dropped.attachments;
    for (const summary of parsed.calendars) {
      const existing = calendars.get(summary.name);
      calendars.set(summary.name, existing ? mergeSummary(existing, summary) : summary);
    }
  }

  if (events.length > MAX_EVENTS) {
    throw new AppError("VALIDATION", "That export has too many events (50 000 max).", 400);
  }

  return { events, warnings, dropped, calendars: [...calendars.values()] };
}

function existingByKey(
  db: Database,
  householdId: string,
  keys: string[],
): Map<string, EventRow> {
  const found = new Map<string, EventRow>();
  for (let index = 0; index < keys.length; index += KEY_CHUNK) {
    const chunk = keys.slice(index, index + KEY_CHUNK);
    if (chunk.length === 0) {
      continue;
    }
    const rows = db
      .select()
      .from(event)
      .where(and(eq(event.householdId, householdId), inArray(event.externalKey, chunk)))
      .all();
    for (const row of rows) {
      if (row.externalKey) {
        found.set(row.externalKey, row);
      }
    }
  }
  return found;
}

function isImportRoot(row: CalendarRow): boolean {
  return row.name === IMPORT_ROOT_NAME || row.name.startsWith(`${IMPORT_ROOT_NAME} `);
}

function importRoots(db: Database, householdId: string): CalendarRow[] {
  return db
    .select()
    .from(calendar)
    .where(and(eq(calendar.householdId, householdId), isNull(calendar.parentId)))
    .all();
}

/**
 * The import trees this viewer owns. Imports are personal by default: a
 * partner's `From Google` tree is never reused, so imported events stay in the
 * importer's person group and hiding "Ours" does not hide them.
 */
function ownedImportRoots(db: Database, ctx: ViewerContext): CalendarRow[] {
  return importRoots(db, ctx.householdId).filter(
    (row) => isImportRoot(row) && row.ownerId === ctx.userId,
  );
}

function findImportChild(db: Database, ctx: ViewerContext, name: string): CalendarRow | null {
  for (const root of ownedImportRoots(db, ctx)) {
    const child = db
      .select()
      .from(calendar)
      .where(and(eq(calendar.parentId, root.id), eq(calendar.name, name)))
      .get();
    if (child) {
      return child;
    }
  }
  return null;
}

function nextHueFamily(db: Database, householdId: string): HueFamily {
  const used = new Set(
    importRoots(db, householdId)
      .map((row) => row.hueFamily)
      .filter((family): family is string => family !== null && isHueFamily(family)),
  );
  return HUE_FAMILIES.find((family) => !used.has(family)) ?? "slate";
}

function ensureImportRoot(
  db: Database,
  ctx: ViewerContext,
  createdNames: string[],
  createdIds: string[],
): CalendarRow {
  // Only this viewer's own import trees are candidates: creating or reusing a
  // partner's tree would put the imported events in their person group.
  const roots = ownedImportRoots(db, ctx);
  for (const root of roots) {
    const children = db.select().from(calendar).where(eq(calendar.parentId, root.id)).all();
    if (children.length < MAX_CHILDREN) {
      return root;
    }
  }

  const suffix = roots.length === 0 ? "" : ` ${roots.length + 1}`;
  const root = createCalendar(db, ctx, {
    name: `${IMPORT_ROOT_NAME}${suffix}`,
    hueFamily: nextHueFamily(db, ctx.householdId),
    ownerId: ctx.userId,
  });
  createdNames.push(root.name);
  createdIds.push(root.id);
  return root;
}

function validateMapping(
  mapping: ImportMapping,
  names: string[],
): void {
  for (const name of names) {
    const entry = mapping[name];
    if (!entry) {
      throw new AppError("VALIDATION", `Choose a target calendar for “${name}”.`, 400, {
        [`mapping.${name}`]: "Pick a calendar.",
      });
    }
    if (entry.mode === "existing" && entry.calendarId.trim().length === 0) {
      throw new AppError("VALIDATION", `Choose a target calendar for “${name}”.`, 400, {
        [`mapping.${name}`]: "Pick a calendar.",
      });
    }
    if (entry.mode !== "existing" && entry.mode !== "new") {
      throw new AppError("VALIDATION", `Choose a target calendar for “${name}”.`, 400, {
        [`mapping.${name}`]: "Pick a calendar.",
      });
    }
  }
}

function resolveTargets(
  db: Database,
  ctx: ViewerContext,
  mapping: ImportMapping,
  names: string[],
): { byName: Map<string, string>; createdNames: string[]; createdIds: string[] } {
  const byName = new Map<string, string>();
  const createdNames: string[] = [];
  const createdIds: string[] = [];

  for (const name of names) {
    const entry = mapping[name]!;
    if (entry.mode === "existing") {
      const access = getCalendarAccess(db, ctx, entry.calendarId);
      assertCalendarWritable(ctx, access);
      byName.set(name, access.calendar.id);
      continue;
    }

    const existingChild = findImportChild(db, ctx, name);
    if (existingChild) {
      // Reuse is limited to the viewer's own tree, but still runs the permission
      // pair used for an explicit mapping: a tree can be re-owned or turned
      // view-only, and a refusal must write nothing.
      const access = getCalendarAccess(db, ctx, existingChild.id);
      assertCalendarWritable(ctx, access);
      byName.set(name, access.calendar.id);
      continue;
    }

    const root = ensureImportRoot(db, ctx, createdNames, createdIds);
    const child = createCalendar(db, ctx, { name, parentId: root.id });
    byName.set(name, child.id);
    createdNames.push(child.name);
    createdIds.push(child.id);
  }

  return { byName, createdNames, createdIds };
}

function titleForImport(title: string): string {
  return title.trim().slice(0, 200) || "Untitled event";
}

function eventRowFromIcs(
  item: IcsEvent,
  ctx: ViewerContext,
  calendarId: string,
  now: number,
): EventRow {
  return {
    id: crypto.randomUUID(),
    householdId: ctx.householdId,
    calendarId,
    title: titleForImport(item.title),
    description: item.description,
    location: item.location,
    allDay: item.allDay ? 1 : 0,
    startAt: item.allDay ? null : item.startAt,
    endAt: item.allDay ? null : item.endAt,
    startDate: item.allDay ? item.startDate : null,
    endDate: item.allDay ? item.endDate : null,
    rrule: item.rrule,
    exdates: item.exdates.length > 0 ? JSON.stringify(item.exdates) : null,
    recurrenceParentId: null,
    recurrenceId: null,
    tzid: item.tzid,
    externalSource: "ics",
    externalUid: item.uid,
    externalRecurrenceId: item.recurrenceId,
    externalKey: item.externalKey,
    externalContentHash: item.contentHash,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };
}

function eventPatchFromIcs(
  item: IcsEvent,
  calendarId: string,
  now: number,
): Partial<EventRow> {
  return {
    calendarId,
    title: titleForImport(item.title),
    description: item.description,
    location: item.location,
    allDay: item.allDay ? 1 : 0,
    startAt: item.allDay ? null : item.startAt,
    endAt: item.allDay ? null : item.endAt,
    startDate: item.allDay ? item.startDate : null,
    endDate: item.allDay ? item.endDate : null,
    rrule: item.rrule,
    exdates: item.exdates.length > 0 ? JSON.stringify(item.exdates) : null,
    tzid: item.tzid,
    externalSource: "ics",
    externalUid: item.uid,
    externalRecurrenceId: item.recurrenceId,
    externalContentHash: item.contentHash,
    updatedAt: now,
  };
}

function sourceNameOf(files: ImportFile[]): string {
  return files
    .map((file) => file.name)
    .join(", ")
    .slice(0, 200);
}

function parseStoredReport(raw: string | null): StoredReport {
  const empty: StoredReport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    calendarsCreated: [],
    createdCalendarIds: [],
  };
  if (!raw) {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredReport>;
    return {
      created: Number(parsed.created ?? 0),
      updated: Number(parsed.updated ?? 0),
      unchanged: Number(parsed.unchanged ?? 0),
      calendarsCreated: Array.isArray(parsed.calendarsCreated) ? parsed.calendarsCreated : [],
      createdCalendarIds: Array.isArray(parsed.createdCalendarIds)
        ? parsed.createdCalendarIds
        : [],
    };
  } catch {
    return empty;
  }
}

/** Counts what a commit would do, without writing anything. */
export function previewImport(
  db: Database,
  ctx: ViewerContext,
  files: ImportFile[],
): ImportPreview {
  validateFiles(files);
  const timezone = householdTimezone(db, ctx.householdId);
  const parsed = parseFiles(files, timezone);
  const existing = existingByKey(
    db,
    ctx.householdId,
    parsed.events.map((item) => item.externalKey),
  );

  const perCalendar = new Map<string, ImportPreviewCalendar>(
    parsed.calendars.map((summary) => [
      summary.name,
      { ...summary, createCount: 0, updateCount: 0, unchangedCount: 0 },
    ]),
  );
  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;

  for (const item of parsed.events) {
    const entry = perCalendar.get(item.calendarName);
    const row = existing.get(item.externalKey);
    if (!row) {
      createCount += 1;
      if (entry) entry.createCount += 1;
    } else if (row.externalContentHash === item.contentHash) {
      unchangedCount += 1;
      if (entry) entry.unchangedCount += 1;
    } else {
      updateCount += 1;
      if (entry) entry.updateCount += 1;
    }
  }

  const nonHouseholdTimezones = [
    ...new Set(
      parsed.events
        .map((item) => item.tzid)
        .filter((tzid): tzid is string => tzid !== null && tzid !== timezone),
    ),
  ];

  return {
    calendars: [...perCalendar.values()],
    createCount,
    updateCount,
    unchangedCount,
    nonHouseholdTimezones,
    warnings: parsed.warnings,
    dropped: parsed.dropped,
  };
}

/** Applies an import in one transaction and records the undo ledger. */
export function commitImport(
  db: Database,
  ctx: ViewerContext,
  input: { files: ImportFile[]; mapping: ImportMapping },
): ImportReport {
  validateFiles(input.files);
  const parsed = parseFiles(input.files, householdTimezone(db, ctx.householdId));
  const names = parsed.calendars.map((summary) => summary.name);
  validateMapping(input.mapping, names);

  return db.transaction((tx) => {
    const txn = tx as unknown as Database;
    const targets = resolveTargets(txn, ctx, input.mapping, names);
    const existing = existingByKey(
      txn,
      ctx.householdId,
      parsed.events.map((item) => item.externalKey),
    );
    const now = Date.now();
    const batchId = crypto.randomUUID();
    const changes: Array<typeof importChange.$inferInsert> = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of parsed.events) {
      const calendarId = targets.byName.get(item.calendarName)!;
      const row = existing.get(item.externalKey);
      if (!row) {
        const inserted = eventRowFromIcs(item, ctx, calendarId, now);
        txn.insert(event).values(inserted).run();
        changes.push({
          id: crypto.randomUUID(),
          batchId,
          eventId: inserted.id,
          action: "create",
          beforeJson: null,
          createdAt: now,
        });
        created += 1;
        continue;
      }
      // A mapping change is a real update even when the event content is
      // identical: the row has to move to the newly chosen calendar.
      const moved = row.calendarId !== calendarId;
      if (row.externalContentHash === item.contentHash && !moved) {
        unchanged += 1;
        continue;
      }
      txn.update(event).set(eventPatchFromIcs(item, calendarId, now)).where(eq(event.id, row.id)).run();
      changes.push({
        id: crypto.randomUUID(),
        batchId,
        eventId: row.id,
        action: "update",
        beforeJson: JSON.stringify(row),
        createdAt: now,
      });
      updated += 1;
    }

    const storedReport: StoredReport = {
      created,
      updated,
      unchanged,
      calendarsCreated: targets.createdNames,
      createdCalendarIds: targets.createdIds,
    };
    txn
      .insert(importBatch)
      .values({
        id: batchId,
        householdId: ctx.householdId,
        createdBy: ctx.userId,
        sourceName: sourceNameOf(input.files),
        status: "committed",
        mapping: JSON.stringify(input.mapping),
        report: JSON.stringify(storedReport),
        createdAt: now,
        rolledBackAt: null,
      })
      .run();
    for (const change of changes) {
      txn.insert(importChange).values(change).run();
    }

    return {
      batchId,
      created,
      updated,
      unchanged,
      calendarsCreated: targets.createdNames,
      warnings: parsed.warnings,
      dropped: parsed.dropped,
    };
  });
}

/** Undoes a committed batch, skipping events edited after the import. */
export function rollbackImportBatch(
  db: Database,
  ctx: ViewerContext,
  batchId: string,
): RollbackReport {
  const batch = db
    .select()
    .from(importBatch)
    .where(and(eq(importBatch.id, batchId), eq(importBatch.householdId, ctx.householdId)))
    .get();
  if (!batch) {
    throw new AppError("NOT_FOUND", "Import batch not found.", 404);
  }
  if (batch.status !== "committed") {
    throw new AppError("VALIDATION", "This import has already been undone.", 409);
  }

  const stored = parseStoredReport(batch.report);
  const changes = db
    .select()
    .from(importChange)
    .where(eq(importChange.batchId, batchId))
    .orderBy(desc(importChange.createdAt))
    .all();

  return db.transaction((tx) => {
    const txn = tx as unknown as Database;

    // Undoing an import writes events — it deletes them, or restores the previous
    // row (possibly into a different calendar). Every affected calendar must
    // still be writable by this viewer; without this check the partner could roll
    // back an import into the owner's view-only calendar.
    const affectedCalendars = new Set<string>();
    for (const change of changes) {
      const row = txn.select().from(event).where(eq(event.id, change.eventId)).get();
      if (row) {
        affectedCalendars.add(row.calendarId);
      }
      try {
        const before = JSON.parse(change.beforeJson ?? "{}") as Partial<EventRow>;
        if (before.calendarId) {
          affectedCalendars.add(before.calendarId);
        }
      } catch {
        // A corrupt snapshot is handled by the restore path below; it cannot name
        // a calendar, so it adds nothing to the permission check.
      }
    }
    for (const calendarId of affectedCalendars) {
      const exists = txn.select().from(calendar).where(eq(calendar.id, calendarId)).get();
      if (!exists) {
        continue; // an earlier rollback (or a manual delete) removed it
      }
      assertCalendarWritable(ctx, getCalendarAccess(txn, ctx, calendarId));
    }

    let deleted = 0;
    let restored = 0;
    let skipped = 0;

    for (const change of changes) {
      const row = txn.select().from(event).where(eq(event.id, change.eventId)).get();
      if (!row || row.updatedAt > batch.createdAt) {
        skipped += 1;
        continue;
      }
      if (change.action === "create") {
        txn.delete(event).where(eq(event.id, change.eventId)).run();
        deleted += 1;
        continue;
      }

      const before = JSON.parse(change.beforeJson ?? "{}") as Partial<EventRow>;
      txn
        .update(event)
        .set({
          title: before.title,
          description: before.description ?? null,
          location: before.location ?? null,
          allDay: before.allDay,
          startAt: before.startAt ?? null,
          endAt: before.endAt ?? null,
          startDate: before.startDate ?? null,
          endDate: before.endDate ?? null,
          rrule: before.rrule ?? null,
          exdates: before.exdates ?? null,
          tzid: before.tzid ?? null,
          calendarId: before.calendarId,
          externalSource: before.externalSource ?? null,
          externalUid: before.externalUid ?? null,
          externalRecurrenceId: before.externalRecurrenceId ?? null,
          externalKey: before.externalKey ?? null,
          externalContentHash: before.externalContentHash ?? null,
          // Restoring `Date.now()` would make an earlier batch treat this row as
          // "edited by the user" and refuse to undo it.
          updatedAt: before.updatedAt ?? batch.createdAt,
        })
        .where(eq(event.id, change.eventId))
        .run();
      restored += 1;
    }

    const calendarsDeleted: string[] = [];
    for (const calendarId of [...stored.createdCalendarIds].reverse()) {
      const row = txn.select().from(calendar).where(eq(calendar.id, calendarId)).get();
      if (!row) {
        continue;
      }
      const remainingEvents = txn.select().from(event).where(eq(event.calendarId, calendarId)).all();
      const children = txn.select().from(calendar).where(eq(calendar.parentId, calendarId)).all();
      if (remainingEvents.length === 0 && children.length === 0) {
        txn.delete(calendar).where(eq(calendar.id, calendarId)).run();
        calendarsDeleted.push(row.name);
      }
    }

    txn
      .update(importBatch)
      .set({ status: "rolled_back", rolledBackAt: Date.now() })
      .where(eq(importBatch.id, batchId))
      .run();

    return { batchId, deleted, restored, skipped, calendarsDeleted };
  });
}

/** Import history for Settings, newest first. */
export function listImportBatches(db: Database, ctx: ViewerContext): ImportBatchView[] {
  const rows = db
    .select()
    .from(importBatch)
    .where(eq(importBatch.householdId, ctx.householdId))
    .orderBy(desc(importBatch.createdAt))
    .all();

  return rows.map((row) => {
    const report = parseStoredReport(row.report);
    return {
      id: row.id,
      sourceName: row.sourceName,
      createdAt: row.createdAt,
      status: row.status === "rolled_back" ? "rolled_back" : "committed",
      rolledBackAt: row.rolledBackAt,
      created: report.created,
      updated: report.updated,
    };
  });
}
