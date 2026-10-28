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

### Troubleshooting the first deploy

| Symptom | Cause | Fix |
|---|---|---|
| Railway page: **"Application failed to respond"** (502) | the server bound the container hostname instead of all interfaces | the image sets `HOSTNAME=0.0.0.0`; the deploy log must show `Network: http://0.0.0.0:8080`. If it shows `http://<hex>:8080`, the old image is running — redeploy. Never set `HOSTNAME` as a service variable. |
| `/api/health` 503, log `[db] could not open "/data/planner.db" (cwd=/app, uid=…)` with `SQLITE_CANTOPEN` | `DATABASE_URL` is wrong, or the volume is not mounted at `/data`, or the process cannot write it | check `DATABASE_URL` is exactly `file:/data/planner.db` (no quotes/trailing slash); Settings → Volumes mount path must be `/data`; if `uid` is not the `app` user, add `RAILWAY_RUN_UID=0` so the entrypoint can chown the volume |
| `/api/health` 503, `Invalid production environment: …` | `BETTER_AUTH_SECRET` missing/too short, or `DATABASE_URL` not set explicitly | add the variable and redeploy |
| `/api/health` 503 but the log has **no** `[db] could not open` line | the running container predates the diagnostic and/or the corrected variables | redeploy — variable changes only reach a *new* container |
| Login fails with "Incorrect email or password", log has `403 INVALID_ORIGIN` | `BETTER_AUTH_URL` is not the exact public origin | set it to `https://<domain>` (trailing slashes are normalised; scheme/host must match) |
| Login fails with "Incorrect email or password", Railway log shows `WARN [Better Auth]: User not found` (or network response for `POST /api/auth/sign-in/email` is **401**) | no accounts exist yet: `SEED_USER_*` are read only by `node ops/provision.mjs`, the app never creates users at startup | set the six `SEED_USER_*` variables, redeploy, then run `node ops/provision.mjs` in the container as the `app` user; afterwards delete the variables and redeploy (see *First deploy* step 5) |
| Login fails although provisioning ran, or the password is unknown | an existing user is left alone by provisioning (`exists:`), so a changed/typo'd password is not reset | `node ops/reset-password.mjs --email you@example.com --password '<new>'` in the container |
| Volume was mounted after the container started | Railway mounts volumes at container start | redeploy after attaching or remounting the volume |

Useful commands in the Railway **Console** (it runs as root, so test the app user explicitly):

```sh
id                                  # console user (root is expected)
ls -la /data                        # is planner.db here?
mount | grep ' /data '              # is the volume really mounted at /data?
gosu app sh -c 'touch /data/x'      # can the app user write it?
printenv DATABASE_URL | od -c       # hidden characters: look for \t or \r
```

A deployment's log line `✓ Ready` followed by `[db]`/`[health]` errors means the container is up but unusable; a deployment showing **Deployment successful** with those errors only means the process started, so always confirm `/api/health` returns 200 on the public URL.


## Deploys

`git push` to the connected branch, or `railway up`. A redeploy with a volume
attached has a few seconds of downtime — fine for two users. Migrations run on
the first request after the restart; a failed migration leaves `/api/health` at
503 rather than caching a half-built schema, so the deploy fails visibly instead
of serving broken pages.

## Installing on a phone (PWA)

v0.3.0 makes Nailong installable. Installing and the service worker require a
**secure context**: the exact HTTPS origin in `BETTER_AUTH_URL`. A LAN
`http://192.168.x.x` address cannot install or run the service worker
(`localhost` is the development exception).

- **iPhone (Safari):** Share -> **Add to Home Screen** -> open "Nailong". iOS has
  no install prompt event. iOS 26 opens every Home Screen add as a web app by
  default; older iOS uses the manifest plus the apple metadata.
- **Android (Chrome):** browser menu -> **Install app** (or **Add to Home screen**).
- **Desktop:** the install icon in the address bar, or the browser menu.

The installed app opens standalone (no address bar), inset under the status bar,
Dynamic Island and home indicator in portrait and landscape. With no network it
reopens the last saved calendar/tasks view read-only and shows an amber
`Offline · ...` bar; writes are refused with "You're offline — changes can't be
saved." and are never queued. Signing out removes the per-user offline snapshot
and the cached pages. After a deploy the running app offers **Update ready**;
tapping it reloads once.

The service worker registers **only in production** (`npm run start`, the Docker
image). `npm run dev` has none; if a production worker ever ran on your local
origin, unregister it in the browser devtools before developing.

### Install icons (generated once, committed)

The three files under `public/icons/` are generated from `app/icon.png` with
PowerShell `System.Drawing` and committed (no build step, no image dependency):

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path "app/icon.png"))
New-Item -ItemType Directory -Force -Path "public/icons" | Out-Null
function Save-Icon([System.Drawing.Image]$source, [int]$target, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap($target, $target)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($source, 0, 0, $target, $target)
  $bmp.Save((Join-Path (Get-Location) $out), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Save-Icon $src 192 "public/icons/icon-192.png"
Save-Icon $src 512 "public/icons/icon-512.png"
# maskable: white 512 canvas, mascot at 410x410 centred (80% safe zone)
$src.Dispose()
```

### Manual acceptance checklist (run once on the real iPhone)

1. Share -> Add to Home Screen -> open from the Home Screen: no address bar.
2. Status bar is white over the rail; nothing sits under the Dynamic Island.
3. Home indicator clears bottom content, sheets, the FAB and toasts.
4. Landscape both ways: notch side padded, rail not clipped, no horizontal scroll.
5. The install hint appears once in Safari, dismisses permanently, and is absent
   once installed.
6. Settings -> Install app says Installed while running standalone.
7. Airplane mode -> relaunch: last saved view within ~3s plus the amber bar.
8. Offline create/edit/delete shows the offline message; nothing applies later.
9. Reconnect: the bar clears and data refreshes.
10. Sign out: no `nailong.offline.*` keys and no `pages-*` cache remain; an
    offline relaunch shows the offline page.
11. Deploy a new build, reopen the installed app: Update ready appears and one
    reload takes the new version.
12. Focus search, task capture and time inputs: no zoom.
13. Event dialog with the keyboard open: Save stays reachable.
14. VoiceOver: the install hint dismiss has a name; shell landmarks unchanged.
15. 320px and long household names still do not overflow.
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

- Reminders/notifications, two-way Google Calendar sync, read-only ICS subscriptions and export feeds, dark mode, multi-household — all v0.2+. One-time Google Calendar import ships today (see below); it is not sync.
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
   **From Google** calendar owned by you; you can also pick any writable
   calendar. Owned calendars are separate per person — hiding Shared ("Ours")
   does not hide them, and a partner's `From Google` tree is never reused. To
   import into the shared group, map to an existing shared calendar instead.
   A `From Google` tree created by an older version is shared (`owner_id` NULL):
   it keeps its events until you re-import (which creates your own tree and
   moves the events idempotently) or change the calendar's owner in the calendar
   dialog.
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
