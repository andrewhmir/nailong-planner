import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { assertProductionEnv, env } from "@/lib/env";
import { createDb, resolveDatabasePath } from "./client";
import { migrate } from "./migrate";

let cached: ReturnType<typeof createDb> | undefined;

/**
 * Lazily opens the app database and applies pending migrations on first use, so
 * the container needs no separate migration step. `next build` never calls this.
 */
export function getDb(): ReturnType<typeof createDb>["db"] {
  if (!cached) {
    assertProductionEnv();
    const path = resolveDatabasePath(env.DATABASE_URL);
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const opened = createDb(env.DATABASE_URL);
    try {
      migrate(opened.db);
    } catch (error) {
      // A failed migration must not be cached as usable: the next request would
      // skip migrate(), report healthy and serve a half-built schema.
      opened.sqlite.close();
      throw error;
    }
    cached = opened;
  }
  return cached.db;
}

export function getSqlite(): ReturnType<typeof createDb>["sqlite"] {
  if (!cached) {
    getDb();
  }
  return cached!.sqlite;
}
