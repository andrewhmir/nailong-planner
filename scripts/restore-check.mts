import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Opens the newest (or named) backup and prints row counts; exits non-zero on mismatch. */
async function main(): Promise<void> {
  const Database = (await import("better-sqlite3")).default;

  const explicit = process.argv.indexOf("--backup");
  const dir = ".dev/backups";
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".db.gz"))
    .sort()
    .reverse();
  const chosen = explicit >= 0 ? process.argv[explicit + 1]! : join(dir, files[0] ?? "");
  if (!chosen || !chosen.endsWith(".db.gz")) {
    console.error("No backup found. Run `npm run backup` first.");
    process.exitCode = 1;
    return;
  }

  // better-sqlite3 opens a file path, so decompress into a scratch directory.
  const scratch = mkdtempSync(join(tmpdir(), "nailong-restore-"));
  const restoredPath = join(scratch, "planner.db");
  writeFileSync(restoredPath, gunzipSync(readFileSync(chosen)));

  const sqlite = new Database(restoredPath);
  const counts: Record<string, number> = {};
  for (const table of ["household", "calendar", "event", "user"]) {
    try {
      counts[table] = (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    } catch {
      counts[table] = -1;
    }
  }
  sqlite.close();
  rmSync(scratch, { recursive: true, force: true });

  console.log(`Restored ${chosen}`);
  console.log(counts);
  const healthy = (counts.household ?? 0) > 0 && (counts.user ?? 0) > 0;
  if (!healthy) {
    console.error("Backup looks empty — investigate before trusting it.");
    process.exitCode = 1;
  }
}

await main();
