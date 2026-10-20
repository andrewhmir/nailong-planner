import { resolve } from "node:path";
import { migrate as runMigrations } from "drizzle-orm/better-sqlite3/migrator";
import type { Database } from "./client";

/** Applies every committed SQL migration in `drizzle/`. */
export function migrate(db: Database, migrationsFolder = resolve(process.cwd(), "drizzle")): void {
  runMigrations(db, { migrationsFolder });
}
