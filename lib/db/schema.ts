import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Domain schema.
 *
 * `household` is the tenancy boundary: every query in `lib/services` filters on
 * `household_id`. User references (`member.user_id`, `calendar.owner_id`,
 * `event.created_by`) are logical references to Better Auth's `user` table,
 * which is generated separately and cannot be FK-constrained without a costly
 * table rebuild in SQLite — they are validated in the service layer instead.
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

export const calendar = sqliteTable(
  "calendar",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => calendar.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    /** Set on top-level calendars only; children inherit their parent's family. */
    hueFamily: text("hue_family"),
    /** Meaningful on children only; roots render at PARENT_SHADE_INDEX. */
    shadeIndex: integer("shade_index").notNull().default(0),
    /** Null means a shared "Ours" calendar. */
    ownerId: text("owner_id"),
    isViewOnlyForPartner: integer("is_view_only_for_partner").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("calendar_household_idx").on(table.householdId),
    index("calendar_parent_idx").on(table.parentId),
  ],
);

export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendar.id, { onDelete: "cascade" }),
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
    index("event_calendar_idx").on(table.calendarId),
  ],
);

export type HouseholdRow = typeof household.$inferSelect;
export type MemberRow = typeof member.$inferSelect;
export type CalendarRow = typeof calendar.$inferSelect;
export type EventRow = typeof event.$inferSelect;

// Better Auth's tables (user, session, account, verification, twoFactor), generated
// by `npx @better-auth/cli generate` and re-exported so one schema map serves both.
export * from "./auth-schema";

