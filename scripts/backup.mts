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

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  // `BACKUP_DIR` exists so the container can point the default at the mounted
  // volume (`/data/backups`) without every caller repeating `--out`; an archive
  // written to the container filesystem disappears on the next redeploy.
  const outDir = readArg("out", process.env.BACKUP_DIR ?? "backups");
  mkdirSync(outDir, { recursive: true });

  const { db, sqlite } = createDb(env.DATABASE_URL);
  migrate(db);

  // A typo'd or unmounted DATABASE_URL used to produce a brand-new empty database
  // and a "successful" backup, which retention then keeps while the real archives
  // age out. Refuse unless the caller says the database is meant to be empty.
  if (!hasFlag("allow-empty")) {
    const counts = sqlite
      .prepare("SELECT (SELECT COUNT(*) FROM user) AS users, (SELECT COUNT(*) FROM household) AS households")
      .get() as { users: number; households: number };
    if (counts.users === 0 && counts.households === 0) {
      console.error(
        `Refusing to back up an empty database at ${env.DATABASE_URL}. ` +
          "Check DATABASE_URL, or pass --allow-empty if this is a fresh instance.",
      );
      sqlite.close();
      process.exitCode = 1;
      return;
    }
  }

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

  console.log(
    `Backup written: ${target}.gz (${Math.min(backups.length, keep)} kept in ${outDir})`,
  );
}

await main();
