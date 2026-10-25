import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Domain schema.
 *
 * `household` is the tenancy boundary: every query in `lib/services` filters on
 * `household_id`. User references (`member.user_id`, `collection.owner_id`,
 * `event.created_by`, `task.created_by`) are logical references to Better Auth's
 * `user` table, which is generated separately and cannot be FK-constrained
 * without a costly table rebuild in SQLite — they are validated in the service
 * layer instead.
 */

export const household = sqliteTable("household", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("Our Nest"),
  timezone: text("timezone").notNull().default("Asia/Taipei"),
  weekStartsOn: integer("week_starts_on").notNull().default(0),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const member = sqliteTable("member", {
  userId: text("user_id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => household.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
});

/**
 * One lazy row per user. Absent means "all defaults" — see
 * `lib/services/preferences.ts`, which never inserts on read.
 */
export const userPreference = sqliteTable("user_preference", {
  userId: text("user_id").primaryKey(),
  defaultView: text("default_view").notNull().default("auto"),
  timeFormat: text("time_format").notNull().default("24h"),
  showWeekNumbers: integer("show_week_numbers").notNull().default(0),
  shortcutsEnabled: integer("shortcuts_enabled").notNull().default(1),
  lastEventCalendarId: text("last_event_calendar_id"),
  updatedAt: integer("updated_at")
    .notNull()
    .$defaultFn(() => Date.now()),
});

/**
 * One node of the household's two-level tree. `kind` distinguishes a calendar
 * (holds events) from a task list; `visibility` replaces the old
 * `is_view_only_for_partner` flag and adds `private` for v0.2.
 */
export const collection = sqliteTable(
  "collection",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => collection.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", { enum: ["calendar", "list"] }).notNull().default("calendar"),
    name: text("name").notNull(),
    /** Set on top-level collections only; children inherit their parent's family. */
    hueFamily: text("hue_family"),
    /** Meaningful on children only; roots render at PARENT_SHADE_INDEX. */
    shadeIndex: integer("shade_index").notNull().default(0),
    /** Null means a shared "Ours" collection. */
    ownerId: text("owner_id"),
    /** Root-level: a protected parent protects its children (folded in code). */
    visibility: text("visibility", { enum: ["shared", "view_only", "private"] })
      .notNull()
      .default("shared"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdate(() => Date.now()),
  },
  (table) => [
    index("collection_household_idx").on(table.householdId),
    index("collection_parent_idx").on(table.parentId),
  ],
);

export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    allDay: integer("all_day").notNull().default(0),
    /** UTC epoch milliseconds; set when allDay = 0. */
    startAt: integer("start_at"),
    endAt: integer("end_at"),
    /** Household-local YYYY-MM-DD; set when allDay = 1. endDate is inclusive. */
    startDate: text("start_date"),
    endDate: text("end_date"),
    rrule: text("rrule"),
    exdates: text("exdates"),
    /**
     * IANA zone a recurring timed series keeps its wall-clock time in. Null means
     * the household zone (every event created in Nailong). Imported series store
     * their source TZID so expansion survives a DST transition.
     */
    tzid: text("tzid"),
    /** Import provenance. Null on events created in Nailong. */
    externalSource: text("external_source"),
    externalUid: text("external_uid"),
    externalRecurrenceId: text("external_recurrence_id"),
    /** sha256("ics|<uid>|<recurrence-id or empty>") — the import idempotency key. */
    externalKey: text("external_key"),
    externalContentHash: text("external_content_hash"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("event_household_start_idx").on(table.householdId, table.startAt),
    index("event_household_start_date_idx").on(table.householdId, table.startDate),
    index("event_collection_idx").on(table.collectionId),
    // SQLite permits any number of NULL keys, so native events stay unique-free.
    uniqueIndex("event_household_external_key_idx").on(table.householdId, table.externalKey),
  ],
);

/**
 * A task lives in a `collection` of kind `list`. `scheduledOn` and `dueOn` are
 * household-local date-only `YYYY-MM-DD` strings (a task is a day commitment,
 * not an instant); `completedAt`/`droppedAt` are epoch-ms audit timestamps.
 */
export const task = sqliteTable(
  "task",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status", { enum: ["open", "done", "dropped"] }).notNull().default("open"),
    /** "I'll work on this day" — drives Today and the Week view. */
    scheduledOn: text("scheduled_on"),
    /** Deadline; drives the overdue badge. */
    dueOn: text("due_on"),
    completedAt: integer("completed_at"),
    droppedAt: integer("dropped_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdate(() => Date.now()),
  },
  (table) => [
    index("task_household_status_idx").on(table.householdId, table.status),
    index("task_collection_idx").on(table.collectionId),
    index("task_scheduled_idx").on(table.scheduledOn),
    index("task_due_idx").on(table.dueOn),
  ],
);

/** A task's flat checklist. No nesting; order is `sortOrder`. */
export const taskChecklistItem = sqliteTable(
  "task_checklist_item",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: integer("done").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("task_checklist_task_idx").on(table.taskId)],
);

/**
 * One row per committed Google Calendar import. `mapping` and `report` are JSON
 * snapshots kept for audit (the report also carries the collection ids the
 * rollback deletes); `status` flips to `rolled_back` when the batch is undone.
 */
export const importBatch = sqliteTable(
  "import_batch",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    sourceName: text("source_name").notNull(),
    status: text("status").notNull().default("committed"),
    mapping: text("mapping"),
    report: text("report"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    rolledBackAt: integer("rolled_back_at"),
  },
  (table) => [index("import_batch_household_idx").on(table.householdId)],
);

/**
 * The undo ledger: one row per inserted or updated event, holding the previous
 * row (for updates) so a rollback can restore exactly what the import replaced.
 * No FK on `eventId` — the rollback deletes those rows itself.
 */
export const importChange = sqliteTable(
  "import_change",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatch.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    action: text("action").notNull(),
    beforeJson: text("before_json"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("import_change_batch_idx").on(table.batchId)],
);

export type HouseholdRow = typeof household.$inferSelect;
export type MemberRow = typeof member.$inferSelect;
export type UserPreferenceRow = typeof userPreference.$inferSelect;
export type CollectionRow = typeof collection.$inferSelect;
export type CollectionKind = "calendar" | "list";
export type CollectionVisibility = "shared" | "view_only" | "private";
export type EventRow = typeof event.$inferSelect;
export type TaskRow = typeof task.$inferSelect;
export type TaskStatus = "open" | "done" | "dropped";
export type TaskChecklistItemRow = typeof taskChecklistItem.$inferSelect;
export type ImportBatchRow = typeof importBatch.$inferSelect;
export type ImportChangeRow = typeof importChange.$inferSelect;

// Better Auth's tables (user, session, account, verification, twoFactor), generated
// by `npx @better-auth/cli generate` and re-exported so one schema map serves both.
export * from "./auth-schema";

