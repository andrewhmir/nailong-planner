import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "@/lib/env";
import { createDb, resolveDatabasePath } from "./client";
import { migrate } from "./migrate";

let cached: ReturnType<typeof createDb> | undefined;

/**
 * Lazily opens the app database and applies pending migrations on first use, so
 * the container needs no separate migration step. `next build` never calls this.
 */
export function getDb(): ReturnType<typeof createDb>["db"] {
  if (!cached) {
    const path = resolveDatabasePath(env.DATABASE_URL);
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    cached = createDb(env.DATABASE_URL);
    migrate(cached.db);
  }
  return cached.db;
}

export function getSqlite(): ReturnType<typeof createDb>["sqlite"] {
  if (!cached) {
    getDb();
  }
  return cached!.sqlite;
}
