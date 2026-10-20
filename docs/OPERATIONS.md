# Operations

Everything needed to run, back up, restore, and recover Nailong Planner.

## Environment variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | `file:/data/planner.db` | SQLite file. In Docker the volume is mounted at `/data`. |
| `BETTER_AUTH_SECRET` | yes | 32+ random chars | `openssl rand -base64 32`. Rotating it invalidates all sessions. |
| `BETTER_AUTH_URL` | yes | `https://planner.example.com` | Public origin; used for cookies and origin checks. |
| `AUTH_RATE_LIMIT` | no | `on` | Only set to `off` for E2E runs. |
| `TZ` | no | `Asia/Taipei` | Container timezone; the household timezone lives in the database. |
| `SEED_USER_1_NAME/EMAIL/PASSWORD` | provisioning only | | Used once by `npm run provision`; remove afterwards. |
| `SEED_USER_2_*` | provisioning only | | Same for the second account. |

## First deploy (Railway)

1. Create a Railway project from this repository. The `railway.json` picks the Dockerfile and health check automatically.
2. Add a **volume mounted at `/data`** (one instance only — SQLite cannot be shared between replicas).
3. Set the environment variables above. `DATABASE_URL=file:/data/planner.db`.
4. Deploy. The app applies migrations automatically on first request; `/api/health` returns `{"ok":true}`.
5. Create the two accounts once:

   ```bash
   railway run npm run provision
   ```

   Remove the `SEED_USER_*` variables afterwards.
6. Sign in, change both passwords in **Settings**, and enable two-factor authentication (the panel shows the authenticator key plus ten one-time backup codes; confirm with a code to finish enrolment).
7. Set a Railway spend cap in the dashboard (expected cost ~$5–6/month).

## Deploys

`git push` to the connected branch, or `railway up`. A redeploy with a volume attached has a few seconds of downtime — fine for two users.

## Backups

- Nightly: run `npm run backup` (better-sqlite3 online backup → gzip → keeps the 14 newest) from a Railway cron service or a host cron job, writing to the volume or an object store.
- Railway volume backups are the second layer.
- Weekly: copy the newest archive off the host.

### Restore drill (run before trusting a backup)

```bash
npm run backup -- --out .dev/backups
npx tsx scripts/restore-check.mts --backup .dev/backups/<newest>.db.gz
```

`restore-check` prints row counts for `household`, `calendar`, `event`, `user` and exits non-zero if the archive looks empty. To restore for real: stop the app, replace `/data/planner.db` with the decompressed archive, start the app.

## Account recovery

- **Forgot password:** there is no email reset by design. On the host run:

  ```bash
  npm run reset-password -- --email you@example.com --password 'a-long-new-password'
  ```

- **Lost authenticator:** use one of the printed backup codes at the login prompt. If those are gone too, an admin on the host can clear the user's two-factor row in the database and sign in again.

## Things deliberately absent

- Reminders/notifications, Google Calendar sync, ICS import/export, dark mode, PWA, multi-household — all v0.2+.
- Public sign-up, email delivery, password reset by email — by design; this app has exactly two accounts.

## Moving to another host

The app is plain Docker + SQLite:

- **Another container host** (Fly.io, a VPS): same image, volume at `/data`, env vars, a TLS-terminating proxy/tunnel in front.
- **Vercel + Neon ($0 option):** requires swapping SQLite for Postgres (Drizzle dialect, driver, schema types) and moving the nightly backup to a scheduled job. Postgres + Drizzle keeps the rest of the code unchanged, which is why SQL access is isolated behind `lib/services/*`.
