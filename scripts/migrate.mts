import { loadEnv } from "./load-env.mts";

loadEnv();

const { env } = await import("../lib/env");
const { createDb } = await import("../lib/db/client");
const { migrate } = await import("../lib/db/migrate");

const { db, sqlite } = createDb(env.DATABASE_URL);
migrate(db);
console.log(`Migrations applied to ${env.DATABASE_URL}`);
sqlite.close();
