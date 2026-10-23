import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

/**
 * Opens the newest (or named) backup and prints row counts; exits non-zero on a
 * missing, corrupt or empty archive.
 *
 * `npm run backup` defaults to `backups/`, so both locations are searched unless
 * `--backup`/`--dir` says otherwise — the old version read `.dev/backups`
 * unconditionally and crashed when that directory did not exist.
 */
async function main(): Promise<void> {
  const Database = (await import("better-sqlite3")).default;

  const explicit = readArg("backup");
  const dir = readArg("dir") ?? ".dev/backups";
  let chosen = explicit;

  if (!chosen) {
    if (!existsSync(dir)) {
      console.error(
        `No backups in ${dir}. Pass --backup <file.db.gz> or --dir <directory>, or create one with \`npm run backup -- --out ${dir}\`.`,
      );
      process.exitCode = 1;
      return;
    }
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".db.gz"))
      .sort()
      .reverse();
    chosen = files[0] ? join(dir, files[0]) : undefined;
  }

  if (!chosen || !chosen.endsWith(".db.gz")) {
    console.error("No backup found. Run `npm run backup` first.");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(chosen)) {
    console.error(`Backup not found: ${chosen}`);
    process.exitCode = 1;
    return;
  }

  // better-sqlite3 opens a file path, so decompress into a scratch directory.
  const scratch = mkdtempSync(join(tmpdir(), "nailong-restore-"));
  const restoredPath = join(scratch, "planner.db");
  let sqlite: InstanceType<typeof Database>;
  try {
    writeFileSync(restoredPath, gunzipSync(readFileSync(chosen)));
    sqlite = new Database(restoredPath, { readonly: true });
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    console.error(`Backup is not a readable gzip SQLite archive: ${chosen}`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  const counts: Record<string, number> = {};
  let integrity = "unknown";
  try {
    integrity = String(sqlite.pragma("integrity_check", { simple: true }));
    for (const table of ["household", "calendar", "event", "user"]) {
      try {
        counts[table] = (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      } catch {
        counts[table] = -1;
      }
    }
  } finally {
    sqlite.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`Restored ${chosen} (${statSync(chosen).size} bytes)`);
  console.log({ integrity, ...counts });
  if (integrity !== "ok") {
    console.error("SQLite integrity check failed — do not trust this backup.");
    process.exitCode = 1;
    return;
  }
  const healthy = (counts.household ?? 0) > 0 && (counts.user ?? 0) > 0;
  if (!healthy) {
    console.error("Backup looks empty — investigate before trusting it.");
    process.exitCode = 1;
  }
}

await main();
