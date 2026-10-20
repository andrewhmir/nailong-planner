import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { loadEnv } from "./load-env.mts";

loadEnv();

const { env } = await import("../lib/env");
const { createDb } = await import("../lib/db/client");
const { migrate } = await import("../lib/db/migrate");

function readArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main(): Promise<void> {
  const outDir = readArg("out", "backups");
  mkdirSync(outDir, { recursive: true });

  const { db, sqlite } = createDb(env.DATABASE_URL);
  migrate(db);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(outDir, `planner-${stamp}.db`);

  // better-sqlite3's online backup API is safe while the app is running.
  await sqlite.backup(target);

  const { readFileSync, writeFileSync, readdirSync, rmSync } = await import("node:fs");
  const compressed = gzipSync(readFileSync(target));
  writeFileSync(`${target}.gz`, compressed);
  rmSync(target, { force: true });
  sqlite.close();

  const keep = 14;
  const backups = readdirSync(outDir)
    .filter((file) => file.startsWith("planner-") && file.endsWith(".db.gz"))
    .sort()
    .reverse();
  for (const stale of backups.slice(keep)) {
    rmSync(join(outDir, stale), { force: true });
  }

  console.log(`Backup written: ${target}.gz (${backups.slice(0, keep).length} kept)`);
}

await main();
