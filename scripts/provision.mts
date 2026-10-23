import { loadEnv } from "./load-env.mts";

loadEnv();

const { env } = await import("../lib/env");
const { createDb } = await import("../lib/db/client");
const { migrate } = await import("../lib/db/migrate");
const { createAuth } = await import("../lib/auth/server");
const { ensureHousehold, addMember } = await import("../lib/services/household");
const { MAX_USERS, countUsers, findUserByEmail } = await import("../lib/auth/users");

interface SeedUser {
  name: string;
  email: string;
  password: string;
}

function readSeedUsers(): SeedUser[] {
  const users: SeedUser[] = [];
  for (const index of [1, 2]) {
    const name = process.env[`SEED_USER_${index}_NAME`]?.trim();
    const email = process.env[`SEED_USER_${index}_EMAIL`]?.trim();
    const password = process.env[`SEED_USER_${index}_PASSWORD`];
    if (name && email && password) {
      users.push({ name, email, password });
    }
  }
  return users;
}

async function main(): Promise<void> {
  const seeds = readSeedUsers();
  if (seeds.length !== 2) {
    console.error(
      "Set SEED_USER_1_NAME/EMAIL/PASSWORD and SEED_USER_2_NAME/EMAIL/PASSWORD (see .env.example).",
    );
    process.exitCode = 1;
    return;
  }

  const uniqueEmails = new Set(seeds.map((user) => user.email.toLowerCase()));
  if (uniqueEmails.size !== seeds.length) {
    console.error("The two seed emails must differ.");
    process.exitCode = 1;
    return;
  }

  // Validate everything before touching the database: a weak password used to
  // fail at sign-up time, after the household and the first account existed,
  // leaving a half-provisioned instance behind.
  const problems: string[] = [];
  for (const [index, seed] of seeds.entries()) {
    const label = `SEED_USER_${index + 1}`;
    if (!seed.email.includes("@")) {
      problems.push(`${label}_EMAIL is not an email address: ${seed.email}`);
    }
    if (seed.password.length < 12) {
      problems.push(`${label}_PASSWORD must be at least 12 characters (Better Auth's minimum).`);
    }
  }
  if (problems.length > 0) {
    console.error(`Refusing to provision:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  const { db, sqlite } = createDb(env.DATABASE_URL);
  migrate(db);

  const auth = createAuth(db, { allowSignUp: true });
  const household = ensureHousehold(db);

  for (const seed of seeds) {
    const existing = findUserByEmail(db, seed.email);
    if (existing) {
      addMember(db, existing.id, household.id);
      console.log(`exists:   ${seed.email}`);
      continue;
    }
    if (countUsers(db) >= MAX_USERS) {
      console.error("Refusing to create a third account.");
      process.exitCode = 1;
      break;
    }
    const result = await auth.api.signUpEmail({
      body: { name: seed.name, email: seed.email, password: seed.password },
    });
    addMember(db, result.user.id, household.id);
    console.log(`created:  ${seed.email}`);
  }

  console.log(`\nHousehold ${household.id} ready in ${env.DATABASE_URL}`);
  console.log("Sign in at the app URL, then change both passwords in Settings.");
  sqlite.close();
}

await main();
