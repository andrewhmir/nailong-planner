import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { household, member, user, type HouseholdRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type { ViewerContext } from "./permissions";

export interface HouseholdSettingsInput {
  name?: string;
  timezone?: string;
  weekStartsOn?: 0 | 1;
}

/** Returns the single household, creating it on first run. */
export function ensureHousehold(db: Database, name = "Our Nest"): HouseholdRow {
  const existing = db.select().from(household).get();
  if (existing) {
    return existing;
  }
  const row: HouseholdRow = {
    id: crypto.randomUUID(),
    name,
    timezone: "Asia/Taipei",
    weekStartsOn: 0,
    createdAt: Date.now(),
  };
  db.insert(household).values(row).run();
  return row;
}

export function getHousehold(db: Database, householdId: string): HouseholdRow {
  const row = db.select().from(household).where(eq(household.id, householdId)).get();
  if (!row) {
    throw new AppError("NOT_FOUND", "Household not found.", 404);
  }
  return row;
}

export function addMember(
  db: Database,
  userId: string,
  householdId: string,
  role = "owner",
): void {
  const existing = db.select().from(member).where(eq(member.userId, userId)).get();
  if (existing) {
    return;
  }
  db.insert(member).values({ userId, householdId, role, createdAt: Date.now() }).run();
}

export function listMembers(db: Database, householdId: string) {
  return db.select().from(member).where(eq(member.householdId, householdId)).all();
}

function assertTimeZone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new AppError("VALIDATION", "That timezone is not recognized.", 400, {
      timezone: "Pick a valid IANA timezone, like Asia/Taipei.",
    });
  }
}

export function updateHousehold(
  db: Database,
  ctx: ViewerContext,
  input: HouseholdSettingsInput,
): HouseholdRow {
  getHousehold(db, ctx.householdId);

  const patch: Partial<HouseholdRow> = {};
  if (input.name !== undefined) {
    patch.name = input.name.trim();
  }
  if (input.timezone !== undefined) {
    assertTimeZone(input.timezone);
    patch.timezone = input.timezone;
  }
  if (input.weekStartsOn !== undefined) {
    patch.weekStartsOn = input.weekStartsOn;
  }

  if (Object.keys(patch).length > 0) {
    db.update(household).set(patch).where(eq(household.id, ctx.householdId)).run();
  }
  return getHousehold(db, ctx.householdId);
}

export function updateMemberName(
  db: Database,
  ctx: ViewerContext,
  name: string,
): { id: string; name: string } {
  const existing = db.select().from(user).where(eq(user.id, ctx.userId)).get();
  if (!existing) {
    throw new AppError("NOT_FOUND", "Account not found.", 404);
  }
  const trimmed = name.trim();
  db.update(user)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(user.id, ctx.userId))
    .run();
  return { id: ctx.userId, name: trimmed };
}
