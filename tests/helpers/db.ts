import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as schema from "@/lib/db/schema";
import { migrate } from "@/lib/db/migrate";

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  close: () => void;
}

export interface MakeTestDbOptions {
  /** Apply the committed migrations up to and including this journal tag. */
  upTo?: string;
}

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const DRIZZLE_DIR = resolve(process.cwd(), "drizzle");

/**
 * Copies the committed migrations into a throwaway folder whose journal stops at
 * `upTo`, so a test can build the pre-migration schema and then apply the next
 * migration itself. The real `drizzle/` folder is never modified.
 */
function migrationsUpTo(upTo: string): string {
  const journalPath = join(DRIZZLE_DIR, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const cutoff = journal.entries.find((entry) => entry.tag === upTo);
  if (!cutoff) {
    throw new Error(`Unknown migration tag "${upTo}" in ${journalPath}`);
  }
  const entries = journal.entries.filter((entry) => entry.idx <= cutoff.idx);

  const folder = mkdtempSync(join(tmpdir(), "nailong-migrations-"));
  mkdirSync(join(folder, "meta"), { recursive: true });
  for (const entry of entries) {
    copyFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
  );
  return folder;
}

/**
 * An isolated, migrated, in-memory database for a single test. Without options it
 * applies every committed migration; `upTo` stops at a journal tag so a test can
 * exercise the next migration against the older schema.
 */
export async function makeTestDb(options: MakeTestDbOptions = {}): Promise<TestDb> {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  const folder = options.upTo ? migrationsUpTo(options.upTo) : null;
  try {
    migrate(db, folder ?? undefined);
  } finally {
    if (folder) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return { db, sqlite, close: () => sqlite.close() };
}
