import { count, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { user } from "@/lib/db/schema";

export const MAX_USERS = 2;

export function countUsers(db: Database): number {
  const [row] = db.select({ value: count() }).from(user).all();
  return row?.value ?? 0;
}

export function findUserByEmail(db: Database, email: string) {
  return db
    .select()
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .get();
}

export function listUsers(db: Database) {
  return db.select().from(user).all();
}
