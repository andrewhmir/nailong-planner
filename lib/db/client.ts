import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/** Strips the `file:` URI prefix used in `DATABASE_URL`. */
export function resolveDatabasePath(databaseUrl: string): string {
  return databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl;
}

export function createDb(databaseUrl: string) {
  const path = resolveDatabasePath(databaseUrl);
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // A large import commits one transaction per batch (~4.8 s for 2000 events with
  // the 50 000-event cap above that); better-sqlite3's implicit 5 s busy timeout
  // would make a concurrent writer fail with "database is locked" just before it
  // succeeded. 15 s covers the realistic worst case without hiding a deadlock.
  sqlite.pragma("busy_timeout = 15000");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export type Database = ReturnType<typeof createDb>["db"];
