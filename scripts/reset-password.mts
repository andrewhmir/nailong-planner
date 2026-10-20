import { loadEnv } from "./load-env.mts";

loadEnv();

const { env } = await import("../lib/env");
const { createDb } = await import("../lib/db/client");
const { migrate } = await import("../lib/db/migrate");
const { hashPassword } = await import("better-auth/crypto");
const { and, eq } = await import("drizzle-orm");
const schema = await import("../lib/db/schema");

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const email = readArg("email")?.trim().toLowerCase();
  const password = readArg("password");

  if (!email || !password) {
    console.error("Usage: npm run reset-password -- --email you@example.com --password 'new-password'");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exitCode = 1;
    return;
  }

  const { db, sqlite } = createDb(env.DATABASE_URL);
  migrate(db);

  const user = db.select().from(schema.user).where(eq(schema.user.email, email)).get();
  if (!user) {
    console.error(`No account with email ${email}.`);
    process.exitCode = 1;
    return;
  }

  const hashed = await hashPassword(password);
  const result = db
    .update(schema.account)
    .set({ password: hashed, updatedAt: new Date() })
    .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")))
    .run();

  if (result.changes === 0) {
    console.error("That account has no password credential to reset.");
    process.exitCode = 1;
    return;
  }

  // A password reset must invalidate existing sessions.
  db.delete(schema.session).where(eq(schema.session.userId, user.id)).run();

  console.log(`Password updated for ${email}. Existing sessions were revoked.`);
  sqlite.close();
}

await main();
