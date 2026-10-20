import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { migrate } from "@/lib/db/migrate";

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  close: () => void;
}

/** An isolated, migrated, in-memory database for a single test. */
export async function makeTestDb(): Promise<TestDb> {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return { db, sqlite, close: () => sqlite.close() };
}
