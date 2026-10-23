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
    try {
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
    } catch (error) {
      // The resolved path and the process user are the two things that decide
      // whether a container can open its database; without them a
      // SQLITE_CANTOPEN in the platform log is unactionable.
      console.error(
        `[db] could not open "${path}" (cwd=${process.cwd()}, uid=${typeof process.getuid === "function" ? process.getuid() : "n/a"})`,
        error,
      );
      throw error;
    }
  }
  return cached.db;
}

export function getSqlite(): ReturnType<typeof createDb>["sqlite"] {
  if (!cached) {
    getDb();
  }
  return cached!.sqlite;
}
