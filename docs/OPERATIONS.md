# Operations

Everything needed to run, back up, restore, and recover Nailong Planner.

## Environment variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes in production | `file:/data/planner.db` | SQLite file. In Docker the volume is mounted at `/data`. Production refuses to start without an explicit value — the `file:./data/planner.db` default is container-local and vanishes on redeploy. |
| `BETTER_AUTH_SECRET` | yes in production | 32+ random chars | `openssl rand -base64 32`. Rotating it invalidates all sessions. Missing or shorter than 32 characters makes the first request fail, so `/api/health` returns 503 and Railway rejects the deploy. |
| `BETTER_AUTH_URL` | yes in production | `https://planner.example.com` | Exact public origin, including scheme, no trailing slash. It is both the cookie origin and the trusted CSRF origin: if it differs from the URL you browse, sign-in fails with `403 INVALID_ORIGIN`. `https://` also decides the `Secure` / `__Secure-` cookie flags. |
| `AUTH_RATE_LIMIT` | no | `on` | Only set to `off` for E2E runs. The limiter is in-memory, single-instance, keyed on `X-Forwarded-For`, and allows 5 sign-ins per minute per IP. |
| `TZ` | no | `Asia/Taipei` | Container timezone; the household timezone lives in the database. |
| `SEED_USER_1_NAME/EMAIL/PASSWORD` | provisioning only | | Used once by the provisioning command; remove afterwards. |
| `SEED_USER_2_*` | provisioning only | | Same for the second account. |

`HOSTNAME` is set to `0.0.0.0` in the image on purpose: the Next standalone server
binds `process.env.HOSTNAME` verbatim, and Docker already sets it to the
container id. Do not override it on Railway.

## First deploy (Railway)

1. Create a Railway project from this repository. `railway.json` picks the
   Dockerfile, the `/api/health` health check, a single replica, and requires a
   volume at `/data`.
2. Add a **volume mounted at `/data`** (one instance only — SQLite cannot be
   shared between replicas). The image's entrypoint re-owns the mount at start,
   because Railway mounts volumes as `root` while the app runs as `app`.
3. Set the environment variables above. `DATABASE_URL=file:/data/planner.db`.
4. Deploy. Migrations are applied by the first request, and `/api/health`
   returns `{"ok":true}` only when the database opens, migrates and validates the
   production environment. A 503 here means the deploy is genuinely unusable —
   read the `[health] database check failed` line.
5. Create the two accounts once. Railway's `railway run` executes *locally* with
   the service's variables, so `railway run npm run provision` would write a
   database on your laptop, not the volume. Instead run the bundled operator CLI
   inside the running container:

   ```bash
   # 1. Add the six SEED_USER_* variables to the service, redeploy, then:
   railway ssh -- node ops/provision.mjs
   # 2. Delete the six variables and redeploy.
   ```

   `ops/provision.mjs` is built from `scripts/provision.mts` during the image
   build, so the runtime image needs no TypeScript toolchain.
6. Sign in, change both passwords in **Settings**, and enable two-factor
   authentication (the panel shows the authenticator key plus ten one-time backup
   codes; confirm with a code to finish enrolment).
7. Set a Railway spend cap in the dashboard (expected cost ~$5–6/month).

## Deploys

`git push` to the connected branch, or `railway up`. A redeploy with a volume
attached has a few seconds of downtime — fine for two users. Migrations run on
the first request after the restart; a failed migration leaves `/api/health` at
503 rather than caching a half-built schema, so the deploy fails visibly instead
of serving broken pages.

## Operator commands

The image ships plain-Node versions of the three operational scripts, so every
recovery action works against the live volume:

```bash
railway ssh -- node ops/provision.mjs                          # first-run account creation
railway ssh -- node ops/backup.mjs --out /data/backups         # manual backup on the volume
railway ssh -- node ops/reset-password.mjs --email you@example.com --password 'a-long-new-password'
```

Run them with no `--` before the arguments: `railway ssh -- <command>` forwards
the rest verbatim.

## Backups

- **Railway volume backups** are the first layer: enable the service's scheduled
  volume backups in the dashboard (daily, kept automatically).
- **Application backups** are the second layer and the only ones you can open
  without Railway: `railway ssh -- node ops/backup.mjs --out /data/backups`
  writes a gzipped online backup (safe while the app runs, WAL included) and
  keeps the 14 newest. Download the newest with the volume file browser.
- A separate Railway cron service **cannot** mount the web service's volume (a
  volume belongs to one service), and the runtime image has no cron. If you want
  unattended archives off the host, run the command from an external scheduler
  (GitHub Actions, a VPS cron) that calls `railway ssh`, or use Railway's native
  volume backups. Locally/VPS: `npm run backup` writes to `backups/` by default.
- Weekly: copy the newest archive off the host.

### Restore drill (run before trusting a backup)

```bash
npm run backup -- --out .dev/backups
npm run restore-check -- --dir .dev/backups
# or name one archive explicitly:
npm run restore-check -- --backup .dev/backups/<newest>.db.gz
```

`restore-check` gunzips the archive, runs `PRAGMA integrity_check`, prints row
counts for `household`, `calendar`, `event` and `user`, and exits non-zero if the
archive is corrupt or looks empty. In the container the equivalent is
`railway ssh -- node ops/backup.mjs --out /data/backups`, then download and run
`npm run restore-check` locally on the downloaded file.

To restore for real: stop the app, replace `/data/planner.db` with the
decompressed archive, **and delete any stale `planner.db-wal` / `planner.db-shm`
beside it**, then start the app. The sidecar files belong to the database that
wrote them: leaving an old `-wal` next to a restored file lets SQLite replay
foreign pages over it and silently empties the restored tables. This was
reproduced during the production-readiness UAT, so delete both sidecars rather
than trusting SQLite to ignore them.

## Account recovery

- **Forgot password:** there is no email reset by design. Run the bundled CLI
  against the live database:

  ```bash
  railway ssh -- node ops/reset-password.mjs --email you@example.com --password 'a-long-new-password'
  ```

  Locally/VPS: `npm run reset-password -- --email you@example.com --password 'a-long-new-password'`.
  Both revoke that account's existing sessions.

- **Lost authenticator:** use one of the printed backup codes at the login prompt. If those are gone too, an admin with database access can clear the user's two-factor row and sign in again.

## Things deliberately absent

- Reminders/notifications, two-way Google Calendar sync, read-only ICS subscriptions and export feeds, dark mode, PWA, multi-household — all v0.2+. One-time Google Calendar import ships today (see below); it is not sync.
- Public sign-up, email delivery, password reset by email — by design; this app has exactly two accounts.

## Importing from Google Calendar

Settings → **Google Calendar import** → *Open the importer* (`/settings/import`).

1. In Google Calendar: Settings → *Import & export* → **Export**, or take a
   [Google Takeout](https://takeout.google.com) archive and download it.
2. Unzip the download and choose the `.ics` files in the importer. One file is
   one calendar (`X-WR-CALNAME` names it).
3. Review the preview: per-calendar event counts, date range, repeating count,
   and a warning list (an unknown `TZID` is skipped rather than guessed). Nothing
   has been written yet.
4. Map each source calendar: by default it becomes a sub-calendar of a new
   **From Google** calendar; you can also pick any writable calendar.
5. Press **Import** — the whole batch is one SQLite transaction, so a failure
   writes nothing.
6. Undo from the report or from **Past imports** at any time; events you edited
   in Nailong after the import are left alone and reported as skipped.

Run `npm run backup` before importing real data. Re-running the same export is
safe: events are matched by their Google UID (plus `RECURRENCE-ID` for moved
occurrences), so the import updates in place instead of duplicating. Colors can
be changed after the import; each `From Google` root takes the next free hue
family.

## Moving to another host

The app is plain Docker + SQLite:

- **Another container host** (Fly.io, a VPS): same image, volume at `/data`, env vars, a TLS-terminating proxy/tunnel in front. The entrypoint handles root-owned volumes; if you run the container with `--user`, make sure `/data` is writable by that uid.
- **Vercel + Neon ($0 option):** requires swapping SQLite for Postgres (Drizzle dialect, driver, schema types) and moving the nightly backup to a scheduled job. Postgres + Drizzle keeps the rest of the code unchanged, which is why SQL access is isolated behind `lib/services/*`.
