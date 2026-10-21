# Scripts and operations configuration

This area covers everything that is not a click path: the `.mts` scripts under `scripts/`, the Drizzle SQL migrations and their journal, the Docker/Railway/Next runtime config, the TypeScript, ESLint, Vitest and Playwright tooling, and the GitHub workflows that run them. Read it before changing how the database is created, migrated, provisioned or backed up, how an image is built and deployed, or which checks gate a pull request.

**How to update this doc:** one `### <repo-relative path>` section per file; update it and run `npm run docs:check` when you add/move/delete one.

| File | Role |
|---|---|
| `scripts/load-env.mts` | Loads `.env.local` (or `.env`) into `process.env` before a script imports `lib/env` |
| `scripts/migrate.mts` | Applies every committed SQL migration to `DATABASE_URL` |
| `scripts/provision.mts` | Creates the two household accounts from `SEED_USER_*` env vars |
| `scripts/reset-password.mts` | Sets a new password for one account and revokes its sessions |
| `scripts/backup.mts` | Online SQLite backup, gzipped, with 14-file retention |
| `scripts/restore-check.mts` | Opens a backup and prints row counts; non-zero exit if it looks empty |
| `scripts/seed-test-db.mts` | Truncates and reseeds `.playwright/test.db` plus `.playwright/fixtures.json` for E2E |
| `drizzle/0000_even_morg.sql` | Domain schema: `household`, `member`, `calendar`, `event` |
| `drizzle/0001_tiny_falcon.sql` | Better Auth core tables: `user`, `session`, `account`, `verification`, `two_factor` |
| `drizzle/0002_user_preference.sql` | Per-user preference table |
| `drizzle/meta/_journal.json` | Ordered list of migrations the migrator replays |
| `drizzle.config.ts` | drizzle-kit config used by `npm run db:generate` |
| `package.json` | Every npm script, the Node engine floor, and the exact dependency pins |
| `tsconfig.json` | Strict TypeScript settings and the `@/*` path alias |
| `eslint.config.mjs` | Flat ESLint config (Next core-web-vitals) and its ignore list |
| `vitest.config.mts` | Unit/integration test targets, the `@` alias, and in-memory SQLite env |
| `playwright.config.ts` | E2E server on `:3100`, seeded DB, one worker |
| `next.config.ts` | Standalone output, `NEXT_DIST_DIR`, and the security headers |
| `Dockerfile` | Three-stage Node 22 image running the standalone server as a non-root user |
| `.dockerignore` | Keeps the build context small and secrets/database files out |
| `railway.json` | Railway build (Dockerfile) and health-check/restart policy |
| `.env.example` | The full environment contract, with comments |
| `.github/workflows/ci.yml` | `verify`, `build` and `e2e` jobs |
| `.github/workflows/codeql.yml` | CodeQL security-and-quality analysis |
| `.github/dependabot.yml` | Weekly npm updates, monthly Actions and Docker updates |
| `.github/CODEOWNERS` | Default and per-path review ownership |
| `.github/PULL_REQUEST_TEMPLATE.md` | The PR checklist, including the commands to run |

## Database scripts and migrations

Migrations are plain Drizzle SQL in `drizzle/`. `lib/db/migrate.ts` wraps `drizzle-orm/better-sqlite3/migrator` with a folder of `resolve(process.cwd(), "drizzle")`, so every entry point (`npm run db:migrate`, the scripts below, and the app itself through `lib/db/index.ts`) applies the same ordered set. The order comes from `drizzle/meta/_journal.json`, never from the filenames.

### drizzle/0000_even_morg.sql

**Purpose** — The domain half of the schema: the household tenancy boundary and the two-level calendar tree that events hang off.

**Invocation / wiring** — Applied by `npm run db:migrate` (`scripts/migrate.mts`), by the app on first `getDb()` through `lib/db/index.ts`, and by every integration test via `tests/helpers/db.ts`.

**Behaviour & side effects** — Creates `household` (`name` default `Our Nest`, `timezone` default `Asia/Taipei`, `week_starts_on` default `0`), `member` (`user_id` primary key, `role` default `member`, cascade to `household`), `calendar` (nullable `parent_id` self-reference with `ON DELETE cascade`, nullable `hue_family`, `shade_index` default `0`, `owner_id`, `is_view_only_for_partner` default `0`, `sort_order`), and `event` (both `start_at`/`end_at` integers and `start_date`/`end_date` text, `rrule`, `exdates`, `created_by`). Indexes: `calendar_household_idx`, `calendar_parent_idx`, `event_household_start_idx`, `event_household_start_date_idx`, `event_calendar_idx`.

**Gotchas** —
- Deleting a root calendar cascades twice: to its children, then from those children to their events. Deleting a root is a data-loss operation, not a hide.
- `member.user_id`, `calendar.owner_id` and `event.created_by` deliberately carry no foreign key: Better Auth's `user` table is generated separately and the service layer validates those references (see the header comment in `lib/db/schema.ts`).
- `hue_family` is nullable on purpose — a sub-calendar inherits the root's family and only stores `shade_index`.

**Tests / verified by** — `tests/integration/db.test.ts` (cascade to events, foreign-key rejection, all-day vs timed columns); every other integration test runs this migration.

### drizzle/0001_tiny_falcon.sql

**Purpose** — The Better Auth tables, generated by the Better Auth CLI, added second so the domain schema stays readable on its own.

**Invocation / wiring** — Same migrator path as `0000`. `lib/db/schema.ts` re-exports `./auth-schema`, so app code and tests import these tables from `@/lib/db/schema`.

**Behaviour & side effects** — Creates `account` (credential/password row plus OAuth token columns, unique by user via index `account_userId_idx`), `session` (unique `token`, `expires_at`, `ip_address`, `user_agent`, `impersonated_by`), `two_factor` (`secret`, `backup_codes`, `verified`, `failed_verification_count`, `locked_until`), `user` (unique `email`, `email_verified`, `role`, `banned`, `two_factor_enabled`), and `verification`. Timestamps default to `cast(unixepoch('subsecond') * 1000 as integer)`, i.e. milliseconds. All tables cascade to `user`.

**Gotchas** —
- This file is generated output. Regenerating it by hand or with a different Better Auth version rewrites defaults such as the `unixepoch` expression.
- `user.email` is unique at the database level, but the two-account cap is enforced in `lib/auth/server.ts`, not here.
- `scripts/reset-password.mts` depends on the `provider_id = "credential"` convention that this table encodes.

**Tests / verified by** — `tests/integration/auth.test.ts` (sign-up cap, hashed password storage, session cookie).

### drizzle/0002_user_preference.sql

**Purpose** — Stores one preference row per user: default view, time format, week numbers, shortcut toggle and the last-used event calendar.

**Invocation / wiring** — Same migrator path; read by `lib/services/preferences.ts`.

**Behaviour & side effects** — Creates `user_preference` keyed by `user_id` (no foreign key), with `default_view` default `auto`, `time_format` default `24h`, `show_week_numbers` default `0`, `shortcuts_enabled` default `1`, nullable `last_event_calendar_id`, and `updated_at`.

**Gotchas** —
- There is no row until the first PATCH; `getPreferences` returns the defaults without writing. That is why `tests/integration/preferences-api.test.ts` can assert defaults on an empty database.
- The defaults here and the defaults in the Zod schema must stay in sync, or the first read and the first write disagree.

**Tests / verified by** — `tests/integration/preferences-api.test.ts`; `tests/e2e/preferences.spec.ts` and `tests/e2e/view-preference.spec.ts` exercise the same fields through the UI.

### drizzle/meta/_journal.json

**Purpose** — The migrator's ordered index: `version`/`dialect` plus one entry per migration with `idx`, `tag`, `when` and `breakpoints`.

**Invocation / wiring** — Read by `drizzle-orm`'s migrator at runtime and by `drizzle-kit` when generating. No application code imports it.

**Behaviour & side effects** — Lists `0000_even_morg`, `0001_tiny_falcon` and `0002_user_preference` with increasing `when` timestamps. The `tag` must equal the SQL filename without `.sql`. Applied migrations are recorded in the database's own `__drizzle_migrations` table, so re-running is a no-op.

**Gotchas** —
- A `.sql` file that is not listed here is never applied, even though it sits in `drizzle/`.
- Renaming a tag makes an already-migrated database try to apply the renamed file again.
- `0002` is hand-named (the first two carry drizzle-kit's generated names), so a future `db:generate` will not follow the same pattern; keep the journal entry in sync manually.

**Tests / verified by** — Indirect only: every integration test migrates through this journal.

### drizzle.config.ts

**Purpose** — Configures drizzle-kit: schema at `./lib/db/schema.ts`, migrations out to `./drizzle`, dialect `sqlite`, and a hardcoded `./data/planner.db` credential.

**Invocation / wiring** — Used by `npm run db:generate` (`drizzle-kit generate`). Nothing at runtime imports it; the app applies migrations through `lib/db/migrate.ts`.

**Behaviour & side effects** — Writes new `.sql` files and `drizzle/meta/*_snapshot.json` when generated. Reads the schema files only.

**Gotchas** —
- `dbCredentials.url` ignores `DATABASE_URL`; it is only relevant to the drizzle-kit commands that open a database, so do not treat it as the app's database setting.
- One schema path covers both halves because `lib/db/schema.ts` ends with `export * from "./auth-schema"`. Removing that re-export would make the next generate want to drop the auth tables.
- Generated SQL is committed and is what production runs; do not edit a generated file without editing the schema.

**Tests / verified by** — No test. `npm run docs:check` and code review are the only guards on generated output.

### scripts/migrate.mts

**Purpose** — Applies all pending migrations to the database named by `DATABASE_URL` and prints where it wrote.

**Invocation / wiring** — `npm run db:migrate` (`tsx scripts/migrate.mts`). Manual only: it is not part of CI or the image build, and takes no flags. It calls `loadEnv()` first, then dynamically imports `lib/env`, `lib/db/client` and `lib/db/migrate` so those modules see the loaded variables.

**Behaviour & side effects** — Opens (and creates, including parent directories) the SQLite file, sets `journal_mode = WAL` and `foreign_keys = ON`, applies the journal, logs `Migrations applied to <DATABASE_URL>`, and closes the handle. Idempotent: a second run applies nothing.

**Gotchas** —
- The migrations folder is resolved from `process.cwd()`, so run it from the repository root.
- It prints the raw `DATABASE_URL`, including `file:` paths, to stdout.
- The container has no migration step: the app migrates on first request, and this script exists for local setup and manual recovery.

**Tests / verified by** — Covered indirectly; `tests/helpers/db.ts` calls the same `migrate()` for every integration test.

## Operational scripts

### scripts/load-env.mts

**Purpose** — A two-line helper that loads `.env.local`, falling back to `.env`, into `process.env` before application modules read it.

**Invocation / wiring** — Imported and called by `scripts/migrate.mts`, `provision.mts`, `reset-password.mts`, `backup.mts` and `seed-test-db.mts`. Exports `loadEnv(): void`; no CLI, no flags, no npm script.

**Behaviour & side effects** — Iterates `[".env.local", ".env"]`, calls Node's `process.loadEnvFile` on the first file that exists, and returns. It does not create, rewrite or validate anything, and it does not fail when neither file exists.

**Gotchas** —
- Only the first match is loaded, so a stale `.env.local` silently hides a complete `.env`.
- Paths are relative to `process.cwd()`; a script invoked from another directory loads nothing.
- Order matters: every caller must `loadEnv()` before importing `lib/env`, which is why those imports are dynamic `await import(...)` expressions.
- `scripts/seed-test-db.mts` loads its own file first and then overwrites the four variables it needs, so developer values cannot affect the E2E database.

**Tests / verified by** — No direct test.

### scripts/backup.mts

**Purpose** — Takes a consistent snapshot of the live SQLite database using better-sqlite3's online backup API and stores it gzipped.

**Invocation / wiring** — `npm run backup`, optionally `npm run backup -- --out .dev/backups`. One flag: `--out <dir>`, default `backups`. No npm script wraps it in CI; `docs/OPERATIONS.md` schedules it nightly.

**Behaviour & side effects** — Loads env, opens the database, applies pending migrations (so the archive always has the current schema), writes `planner-<ISO timestamp>.db` via `sqlite.backup`, gzips it to `.db.gz`, deletes the uncompressed copy, closes the handle, then deletes all but the 14 newest `planner-*.db.gz`. Prints `Backup written: <path>.gz (N kept)`.

**Gotchas** —
- The default output directory is `backups/`, but `scripts/restore-check.mts` reads `.dev/backups/`; pass `--out .dev/backups` to make the restore drill work, as `docs/OPERATIONS.md` does.
- Running `migrate` first means a mistyped `DATABASE_URL` produces a valid-looking but empty backup instead of an error, because `createDb` creates the file and its directories.
- Retention is lexicographic over ISO-stamped names; keep the `planner-` prefix and the timestamp format or pruning stops matching.

**Tests / verified by** — Manual only. `docs/OPERATIONS.md` documents the backup-plus-`restore-check` drill.

### scripts/restore-check.mts

**Purpose** — Proves a backup is readable and non-empty by decompressing it into a temporary directory, opening it with better-sqlite3, and printing row counts.

**Invocation / wiring** — Run directly: `npx tsx scripts/restore-check.mts --backup .dev/backups/<file>.db.gz`. There is no `package.json` script for it. It does not call `loadEnv()`.

**Behaviour & side effects** — Lists `.db.gz` files in `.dev/backups` (newest first) unless `--backup <path>` names one, gunzips into `mkdtempSync(tmpdir())`, counts rows in `household`, `calendar`, `event` and `user`, deletes the scratch directory, then logs the counts. Exits non-zero when `household` or `user` is zero, or when no usable archive is found. A missing table is reported as `-1`.

**Gotchas** —
- The default directory is hardcoded to `.dev/backups`, which is not where `npm run backup` writes unless you pass `--out`.
- A missing `.dev/backups` directory throws from `readdirSync` before the friendly "No backup found" message, so create the directory or pass an explicit `--backup` path.
- A backup taken before `0001` has no `user` table, so it reports `-1` and fails the health check even though the domain tables are fine.

**Tests / verified by** — Manual only; it is the restore drill in `docs/OPERATIONS.md`.

### scripts/provision.mts

**Purpose** — Creates the household and exactly two accounts from environment variables, once, on a fresh deployment.

**Invocation / wiring** — `npm run provision` (`tsx scripts/provision.mts`). Requires `SEED_USER_1_NAME/EMAIL/PASSWORD` and `SEED_USER_2_NAME/EMAIL/PASSWORD`; no flags. `docs/OPERATIONS.md` runs it with `railway run npm run provision`, and `.env.example` says to delete the variables afterwards.

**Behaviour & side effects** — Validates that two complete users exist and that the emails differ (case-insensitively), exits `1` otherwise. Opens and migrates the database, builds an auth instance with `allowSignUp: true`, ensures the household row, then for each seed: an existing email gets a membership row and prints `exists:`; otherwise it refuses once `countUsers` reaches `MAX_USERS` (2) and prints `created:` on success. Ends by printing the household id and a reminder to change both passwords.

**Gotchas** —
- Better Auth enforces `minPasswordLength: 12`; a shorter `SEED_USER_*_PASSWORD` throws at sign-up rather than printing a friendly error.
- Re-running is safe for the same emails but adds membership rows only; it never updates an existing password.
- The credentials pass through the environment, so remove the variables after provisioning and rotate both passwords in Settings.
- The `MAX_USERS` check runs after the existing-user check, so provisioning into a database that already holds two different accounts stops at the third.

**Tests / verified by** — `tests/integration/auth.test.ts` covers the same `createAuth` sign-up path and the two-account cap; the script itself has no test.

### scripts/reset-password.mts

**Purpose** — The only password-recovery path: it rewrites one account's credential hash and revokes that user's sessions.

**Invocation / wiring** — `npm run reset-password -- --email you@example.com --password 'new-password'`. Both flags are required; documented in `docs/OPERATIONS.md` for host-side recovery.

**Behaviour & side effects** — Trims and lowercases the email, rejects a password under 12 characters, opens and migrates the database, finds the user, hashes with Better Auth's `hashPassword`, updates the `account` row where `provider_id = "credential"`, and deletes every `session` row for that user. Prints `Password updated for <email>. Existing sessions were revoked.` Sets `process.exitCode = 1` for a missing flag, short password, unknown email, or an account with no credential row.

**Gotchas** —
- The `--` separator is required so npm forwards the flags to the script.
- The plaintext password appears in shell history and in the process list; recover interactively if that matters.
- `provider_id = "credential"` is hardcoded, matching Better Auth's default provider id in `drizzle/0001_tiny_falcon.sql`.
- Its 12-character rule mirrors `minPasswordLength` in `lib/auth/server.ts`; change both together.

**Tests / verified by** — No direct test. `tests/integration/auth.test.ts` asserts that stored passwords are hashes, which is the property this script preserves.

### scripts/seed-test-db.mts

**Purpose** — Builds the deterministic world every E2E spec runs against: two users, ten calendars across both owners, four events in the current month, and a fixtures file the specs read ids from.

**Invocation / wiring** — `npm run test:e2e` runs `tsx scripts/seed-test-db.mts && playwright test`, so a seeding failure stops the run. Re-run it alone with `npx tsx scripts/seed-test-db.mts` before `npx playwright test <spec>`. It forces `DATABASE_URL=file:./.playwright/test.db`, `BETTER_AUTH_URL=http://localhost:3100`, a fixed Better Auth secret and `TZ=Asia/Taipei` after loading `.env.local`.

**Behaviour & side effects** — Creates `.playwright/`, opens and migrates the database, deletes every row from `user_preference`, `event`, `calendar`, `member`, `two_factor`, `session`, `account`, `verification`, `household` and `user` in that order (truncate rather than delete the file, because a dev server may still hold the handle), signs up `andrew@example.test` and `partner@example.test` with password `test-password-1234`, creates the `Our Nest` household, builds the calendar tree (Household/Chores/Trips, School/Math/Biology, Work/On-call with Work view-only, Health/Gym), and creates `Math quiz`, `Kyoto trip`, `Weekly class` (weekly on Tuesday) and `On-call shift` on the 15th and 20th of the current month. Writes `.playwright/fixtures.json` and prints the counts.

**Gotchas** —
- The fixtures are relative to "now", so a spec that hardcodes a month (`tests/e2e/view-preference.spec.ts` expects `October 2026`) only passes while the machine clock agrees.
- The deletion order is load-bearing: foreign keys are on, so truncating `user` before `session`/`account` fails.
- The secret here must equal the one in `playwright.config.ts`, or `signIn` sets a cookie the server rejects.
- Every spec shares this one file with `workers: 1`; a spec that mutates seeded rows (renames, deletes, drags) can break a later one, which is why several specs create and delete their own probe events.

**Tests / verified by** — Consumed by all 22 specs in `tests/e2e/` through `.playwright/fixtures.json` and `tests/e2e/helpers.ts`.

## Build and tooling config

### package.json

**Purpose** — Declares the app's scripts, the Node engine floor (`>=22`), and the exact dependency versions the stack is pinned to.

**Invocation / wiring** — Every command in this doc starts here. `npm ci` in the Dockerfile and in CI installs from `package-lock.json`.

**Behaviour & side effects** — The `scripts` block:

| Script | Command | What it does |
|---|---|---|
| `dev` | `next dev` | Development server on `:3000`, writing `.next/` |
| `build` | `next build` | Production build including the standalone server |
| `start` | `next start` | Serves an existing production build |
| `lint` | `eslint .` | Flat-config lint over the repo |
| `typecheck` | `tsc --noEmit` | Strict type check, no output |
| `test` | `vitest run` | Unit and integration suites, once |
| `test:watch` | `vitest` | The same suites in watch mode |
| `test:e2e` | `tsx scripts/seed-test-db.mts && playwright test` | Seeds the E2E database, then runs Playwright |
| `db:generate` | `drizzle-kit generate` | Emits a new SQL migration from the schema diff |
| `db:migrate` | `tsx scripts/migrate.mts` | Applies pending migrations to `DATABASE_URL` |
| `provision` | `tsx scripts/provision.mts` | Creates the two accounts from `SEED_USER_*` |
| `reset-password` | `tsx scripts/reset-password.mts` | Resets one password and revokes sessions |
| `backup` | `tsx scripts/backup.mts` | Writes a gzipped online backup |
| `docs:check` | `node scripts/docs-check.mjs` | Fails when a gated source file lacks its `### <path>` section |

Pinned choices that must not drift casually: `@fullcalendar/react` and `@fullcalendar/rrule` at exactly `7.1.3` (the CSS overrides and the `datesSet`/`eventDrop` wiring are version-specific), `next` `16.4.2` with `react`/`react-dom` `19.3.1` (App Router, `output: "standalone"`, `devIndicators: false`), `tailwindcss` and `@tailwindcss/postcss` at `4.3.3` (CSS-first config, no `tailwind.config.js`), `better-sqlite3` `13.0.3` (native module, rebuilt in the Docker deps stage), `better-auth` `1.7.11`, `drizzle-orm` `0.45.4` with `drizzle-kit` `0.31.11`, `ical.js` `2.2.1` (Google Calendar import parsing — the only dependency that exists solely for the importer), and `typescript` `6.0.3`. Every dependency is exact-pinned, so even a patch bump is a deliberate edit.

**Gotchas** —
- `test:e2e` reseeds with `&&`, so Playwright never runs against a half-seeded database.
- There is no `restore-check` script; run that file with `npx tsx`.
- Adding a script here does not wire it into CI; `ci.yml` names each step explicitly.

**Tests / verified by** — `npm run docs:check` and CI; the script block itself is not unit-tested.

### tsconfig.json

**Purpose** — The strict TypeScript contract for the whole repository, plus the `@/*` alias to the repository root.

**Invocation / wiring** — Read by `npm run typecheck` (`tsc --noEmit`), by `next build`, and by the Next plugin under `plugins`.

**Behaviour & side effects** — `target: ES2022`, `lib` `dom`/`dom.iterable`/`esnext`, `strict: true` with `noUncheckedIndexedAccess: true`, `noEmit: true`, `module: esnext`, `moduleResolution: bundler`, `isolatedModules`, `jsx: react-jsx`, `incremental`, `allowJs: false`, and `paths` mapping `@/*` to `./*`. `include` covers `next-env.d.ts`, all `**/*.ts`/`**/*.tsx`, and the generated types in both `.next/` and `.next-e2e/`; `exclude` is just `node_modules`.

**Gotchas** —
- `noUncheckedIndexedAccess` is why tests and components use `?.` and non-null assertions on array access; a plain `arr[0].x` does not typecheck.
- Only `.ts`/`.tsx` are checked (`allowJs: false`), so `eslint.config.mjs` and `postcss.config.mjs` are linted but not typechecked.
- Both `.next/` and `.next-e2e/` types are included, so an E2E build with `NEXT_DIST_DIR` does not break typecheck.
- `npm run typecheck` can succeed on a stale `tsconfig.tsbuildinfo`; delete it if results look impossible.

**Tests / verified by** — `npm run typecheck`, run in CI's `verify` job.

### eslint.config.mjs

**Purpose** — The flat ESLint config: Next's `core-web-vitals` rules plus the generated-artifact ignore list.

**Invocation / wiring** — Read by `npm run lint` (`eslint .`), which is a `verify` step in CI.

**Behaviour & side effects** — Spreads `eslint-config-next/core-web-vitals` and adds one config object containing only `ignores`: `.next/**`, `.next-e2e/**`, `node_modules/**`, `out/**`, `coverage/**`, `playwright-report/**`, `test-results/**`, `.playwright/**`, `.superpowers/**`, `next-env.d.ts`. Read-only; writes nothing.

**Gotchas** —
- An object with only `ignores` is a global ignore in flat config; adding any other key to it would silently turn those into per-config ignores.
- `.playwright/` and `test-results/` are ignored, so a trace or a seeded fixture never fails lint.
- The config is `.mjs` and outside `tsconfig.json`'s checked extensions, so a typo there only shows up at runtime.

**Tests / verified by** — `npm run lint`, run in CI's `verify` job.

### vitest.config.mts

**Purpose** — Configures the unit and integration suites: Node environment, the `@` alias, and the environment variables that make the suites hermetic.

**Invocation / wiring** — Read by `npm run test` (`vitest run`) and `npm run test:watch` (`vitest`). CI runs `npm test`.

**Behaviour & side effects** — `environment: node`, `pool: threads`, `include` limited to `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`, 20 s test and hook timeouts, and `env` forcing `NODE_ENV=test`, `DATABASE_URL=file::memory:`, `BETTER_AUTH_URL=http://localhost:3000`, a fixed `BETTER_AUTH_SECRET`, and `TZ=Asia/Taipei`.

**Gotchas** —
- `file::memory:` is load-bearing: `lib/db/client.ts` strips `file:` and passes `:memory:` to better-sqlite3. Writing `file::memory:?cache=shared` here would change the isolation model.
- E2E specs are excluded by the `include` globs, so `npm test` never starts a browser.
- `TZ` is fixed so wall-time assertions do not depend on the developer's machine.
- A native-module rebuild is required after changing Node versions, because `better-sqlite3` runs in worker threads.

**Tests / verified by** — It is the test runner; `npm test` in CI's `verify` job.

### playwright.config.ts

**Purpose** — Runs the browser suites against a dedicated dev server on `:3100` with the seeded `.playwright/test.db`.

**Invocation / wiring** — Read by `npm run test:e2e` and by a bare `npx playwright test tests/e2e/<spec>.spec.ts` (which then expects the database to be seeded already).

**Behaviour & side effects** — `testDir: ./tests/e2e`, `fullyParallel: false`, `workers: 1`, `retries: 1` on CI and `0` locally, `timeout: 60_000`, `expect.timeout: 20_000`, reporter `github` + `html` on CI and `list` locally, `trace: "retain-on-failure"`, Desktop Chrome device, and a `webServer` running `npm run dev -- -p 3100` with `DATABASE_URL=file:./.playwright/test.db`, `NEXT_DIST_DIR=.next-e2e`, `BETTER_AUTH_URL=http://localhost:3100`, a fixed secret, `AUTH_RATE_LIMIT=off`, `NODE_ENV=development` and `TZ=Asia/Taipei`. `reuseExistingServer` is on locally and off on CI; the server start timeout is 180 s.

**Gotchas** —
- Locally an already-running `:3100` server is reused, so stale code or an old database is served until you stop it.
- One worker and no parallelism are deliberate: every spec shares one SQLite file and one dev server.
- `NEXT_DIST_DIR=.next-e2e` keeps the E2E build out of `.next/`; Next 16 takes a per-distDir dev lock, so deleting the variable would collide with your own `npm run dev`.
- Timeouts assume a cold `next dev` compile; a slow machine shows up as a 60 s test timeout, not a product bug.

**Tests / verified by** — CI's `e2e` job, which uploads `test-results/` on failure.

## Runtime and deployment config

### next.config.ts

**Purpose** — Sets the Next build and runtime behaviour that the Docker image and the E2E server both depend on.

**Invocation / wiring** — Read automatically by `next dev`, `next build` and `next start`; no imports elsewhere.

**Behaviour & side effects** — `distDir: process.env.NEXT_DIST_DIR ?? ".next"`, `output: "standalone"`, `reactStrictMode: true`, `devIndicators: false`, and a `headers()` rule applying seven headers to `/:path*`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy`, `X-Robots-Tag: noindex, nofollow`, HSTS for one year with subdomains, and a `Content-Security-Policy-Report-Only`.

**Gotchas** —
- The CSP is report-only, so it never blocks anything; it is a signal, not a control.
- `script-src` allows `'unsafe-inline'` and `'unsafe-eval'`, which the dev overlay needs.
- HSTS is sent in development too, which only matters for a `localhost` browser you reuse.
- `output: "standalone"` is what makes `COPY --from=build /app/.next/standalone` work in `Dockerfile`; removing it breaks the image, not the build.

**Tests / verified by** — `tests/e2e/settings.spec.ts` asserts the four main security headers on a real response.

### Dockerfile

**Purpose** — Builds and runs the app as a three-stage Node 22 image: dependencies, build, then a minimal standalone runtime as a non-root user.

**Invocation / wiring** — Built by Railway through `railway.json`, or manually with `docker build`. The runtime command is `node server.js` on port 3000.

**Behaviour & side effects** — `deps` stage installs `python3 make g++` (needed to compile `better-sqlite3`) then `npm ci`; `build` stage copies `node_modules` and the source and runs `npm run build`; `runner` stage sets `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `PORT=3000`, `TZ=Asia/Taipei`, creates an `app` user, copies `.next/standalone`, `.next/static` and `drizzle/`, creates `/data` owned by `app`, and drops to `USER app`.

**Gotchas** —
- `drizzle/` is copied into the runtime image because `lib/db/migrate.ts` resolves the migrations folder from `process.cwd()`; without it the first request fails.
- `.next/static` is not inside `.next/standalone`, so it must be copied separately.
- `/data` must be a mounted volume, and only the `app` user may write it; otherwise every write after the first restart fails.
- The image does not run migrations at build time; they run on the first request.

**Tests / verified by** — No automated test. `railway.json`'s `/api/health` health check is the deploy-time verification.

### .dockerignore

**Purpose** — Shrinks the build context and keeps secrets, local databases, tests and docs out of the image.

**Invocation / wiring** — Applied by Docker/railway builds before the context is sent; not read by any code.

**Behaviour & side effects** — Excludes `node_modules`, `.next`, `.git`, `.github`, `.playwright`, `.superpowers`, `test-results`, `playwright-report`, `coverage`, `data`, `*.db`, `*.db-shm`, `*.db-wal`, `.env`, `.env.*` (with `!.env.example` re-included), `README.md`, `docs` and `tests`.

**Gotchas** —
- `.env.local` is excluded, but `.env.example` is deliberately re-included; keep that negation last if you add patterns.
- `data` and `*.db*` excluded means a local household database can never leak into an image layer.
- `tests` and `docs` are absent from the image, so anything the runtime imports from them would fail only in production.

**Tests / verified by** — No test; verified by inspecting a built image.

### railway.json

**Purpose** — Tells Railway to build from the Dockerfile and how to health-check and restart the service.

**Invocation / wiring** — Read by Railway on deploy; no local command reads it.

**Behaviour & side effects** — `build.builder: DOCKERFILE`, `build.dockerfilePath: Dockerfile`, `deploy.healthcheckPath: /api/health`, `healthcheckTimeout: 120`, `restartPolicyType: ON_FAILURE`, `restartPolicyMaxAttempts: 10`.

**Gotchas** —
- The health check path is `app/api/health/route.ts`; moving that route requires editing this file in the same change.
- SQLite on a volume means one replica only; scaling horizontally corrupts the database.
- `restartPolicyMaxAttempts` means a crash loop stops after ten restarts, so a migration failure looks like a stopped service rather than a loop.

**Tests / verified by** — Manual: `docs/OPERATIONS.md` first-deploy steps.

### .env.example

**Purpose** — The canonical list of environment variables, with a comment per variable and the Docker/Railway values called out.

**Invocation / wiring** — Copied to `.env.local` for development and pasted into the Railway environment for deploy; `scripts/load-env.mts` loads `.env.local` or `.env`.

**Behaviour & side effects** — Declares `DATABASE_URL` (`file:./data/planner.db`, `file:/data/planner.db` in Docker), `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` (empty, 32+ random characters), `NODE_ENV`, `TZ`, `AUTH_RATE_LIMIT` (empty, only `off` for E2E), and the six `SEED_USER_*` provisioning variables.

**Gotchas** —
- `AUTH_RATE_LIMIT` left empty means `lib/env.ts` defaults it to `on`; only the Playwright server sets `off`.
- `BETTER_AUTH_SECRET` has no default in production: `lib/auth/server.ts` throws without it unless `NODE_ENV=test`.
- The `SEED_USER_*` block is provisioning-only and should be deleted after `npm run provision`.
- `DATABASE_URL` must keep the `file:` prefix for Docker paths to resolve the way the docs describe.

**Tests / verified by** — `lib/env.ts` validates at import time; a bad value throws `Invalid environment configuration` before any request is served.

## CI and GitHub configuration

### .github/workflows/ci.yml

**Purpose** — The required checks: a `verify` job (lint, typecheck, docs, unit/integration), then `build` and a full Playwright `e2e` run.

**Invocation / wiring** — Runs on push to `main` and `feat/**`, and on every pull request. `permissions: contents: read`; concurrency group `ci-<ref>` with `cancel-in-progress`.

**Behaviour & side effects** — `verify` runs `npm ci`, `npm run lint`, `npm run typecheck`, `npm run docs:check`, `npm test`. `build` (`needs: verify`) runs `npm ci` and `npm run build`. `e2e` (`needs: verify`) runs `npm ci`, `npx playwright install --with-deps chromium`, `npm run test:e2e`, and uploads `test-results/` as `playwright-traces` on failure with 7-day retention. All three jobs use Node 22 with npm caching.

**Gotchas** —
- A docs-drift failure in `verify` blocks both `build` and `e2e`, so an undocumented file costs a full CI cycle.
- Only Chromium is installed, so a spec that assumes another engine is not covered here.
- The E2E job reuses the same `test:e2e` script developers run, including the reseed step, so a seed failure fails CI before any browser starts.
- There is no Playwright browser cache step, so the install runs on every build.

**Tests / verified by** — It is the CI gate; `test-results/` is the artifact to read when `e2e` fails.

### .github/workflows/codeql.yml

**Purpose** — Static security analysis of the TypeScript/JavaScript code with the security-and-quality query pack.

**Invocation / wiring** — Runs on push to `main`, on pull requests targeting `main`, and weekly via `cron: "23 4 * * 1"`.

**Behaviour & side effects** — One job with a `javascript-typescript` matrix (`fail-fast: false`), `github/codeql-action/init@v4` with `queries: security-and-quality`, then `analyze@v4` with category `/language:javascript-typescript`. Job permissions add `security-events: write`; workflow-level permissions are `contents: read`.

**Gotchas** —
- `security-and-quality` is broader than the default suite, so findings include maintainability queries, not only exploitable bugs.
- It does not gate the `CI` workflow; a CodeQL alert appears in the Security tab rather than failing a PR check.
- The weekly schedule is what catches newly published query patterns in unchanged code.

**Tests / verified by** — Its own run; results land in GitHub code scanning.

### .github/dependabot.yml

**Purpose** — Keeps npm packages, GitHub Actions and the Docker base image current on a fixed schedule.

**Invocation / wiring** — Read by GitHub; no local command.

**Behaviour & side effects** — npm: weekly on Monday (UTC), `open-pull-requests-limit: 5`, a `minor-and-patch` group matching `*` for `minor` and `patch` updates. GitHub Actions: monthly, limit 3. Docker: monthly, limit 3.

**Gotchas** —
- Only minor and patch npm updates are grouped, so every major arrives as its own PR — relevant because the stack is exact-pinned (FullCalendar, Next, Tailwind).
- Nothing here pins or excludes the riskier packages; a major bump has to be rejected by a reviewer, not by config.
- The group covers every dependency, so one grouped PR can touch the whole tree at once; run `npm test` and the owning specs before merging.

**Tests / verified by** — CI runs on the resulting PRs; no extra job.

### .github/CODEOWNERS

**Purpose** — Assigns review ownership for the repository, with explicit entries for the layout-critical paths.

**Invocation / wiring** — Read by GitHub when a PR requests review; not read by CI.

**Behaviour & side effects** — `* @andrewhmir` as the default, `/.github/ @andrewhmir` for repo plumbing, and `/components/shell/` plus `/tests/e2e/viewport-fit.spec.ts` called out because they carry the layout guarantee.

**Gotchas** —
- Ownership only requests a reviewer; enforcement would need a branch-protection rule, which is not in this repository.
- The last matching pattern wins in CODEOWNERS, so keep specific paths below the `*` line.
- A moved shell file or a renamed viewport spec leaves a stale entry that silently stops matching.

**Tests / verified by** — Manual; GitHub shows the requested reviewer on a PR.

### .github/PULL_REQUEST_TEMPLATE.md

**Purpose** — The PR checklist: what changed, how it was verified, and the privacy/docs confirmations.

**Invocation / wiring** — Prefilled by GitHub when a pull request is opened; no automation reads it.

**Behaviour & side effects** — Sections for *What changed*, *How was it verified* (checkboxes for `npm run lint`, `npm run typecheck`, `npm run docs:check`, `npm test`, `npm run test:e2e` when behaviour or layout changed), *Notes for reviewers*, and a *Checklist* covering a failing test first, no secrets/`.env.local`/database files/real household data, committed screenshots for UI changes (`CAPTURE_SCREENSHOTS=1 npm run test:e2e`), and the docs-update rule with `npm run docs:check`.

**Gotchas** —
- The checkboxes are prose, not status checks; nothing verifies they were ticked.
- The screenshot command only rewrites files because `tests/e2e/screenshot.spec.ts` skips itself unless `CAPTURE_SCREENSHOTS=1`.
- The checkboxes are prose, not status checks; nothing verifies they were ticked — CI is the real gate.

**Tests / verified by** — Not machine-checked; reviewers rely on it.

## Documentation tooling

### scripts/docs-check.mjs

**Purpose** — The `npm run docs:check` drift gate: proves every gated source file has exactly one `### <repo-relative path>` section in `docs/COMPONENTS/*.md` and that no documented path has gone stale.

**Invocation / wiring** — `npm run docs:check` (`node scripts/docs-check.mjs`); run by the `verify` CI job between `typecheck` and `npm test`. No arguments, no env, exit 0 = clean, exit 1 = problems printed on stderr.

**Behaviour & side effects** — Read-only. Walks `app/`, `components/`, `lib/`, `scripts/` (extensions `.ts .tsx .mts .mjs .css`, skipping `node_modules/.next/.next-e2e/.git/test-results/.playwright/data/coverage` and `app/fonts/`), parses `###` headings out of every `docs/COMPONENTS/*.md` except `README.md` while ignoring fenced code blocks, then reports MISSING (gated file with no section — with the heading and owning doc to add), STALE (documented path deleted), DUPLICATE (same path in two docs) and LAYOUT problems (missing `docs/COMPONENTS/` or `docs/DEBUGGING.md`).

**Gotchas** —
- Deliberately plain ESM with no dependencies: `tsx`/esbuild cannot spawn under agent sandboxes on Windows (`EPERM`), and this gate must run everywhere Node runs. Do not convert it to TypeScript or add imports.
- `AREA_DOCS` is the prefix → doc map used in the "add" suggestions; add a row when you create a new area doc, or suggestions will point at `docs/COMPONENTS/README.md`.
- `tests/` is intentionally not gated (documented as tables in `tests.md`), and `app/fonts/` is skipped (binary woff2 files).
- The heading must be the bare path on its own `###` line — backticks or trailing prose make the section invisible to the gate.

**Tests / verified by** — No unit test; the gate runs in CI on every push and PR and is exercised by the docs themselves.

## Focused verification

```bash
npm run lint && npm run typecheck
npm test
```
