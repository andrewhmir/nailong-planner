# PWA — installable, standalone and offline read-only (v0.3.0) — design

**Status:** approved 2026-10-28 (approach Option A "Quiet native" via mockup panel; scope:
installable app shell + offline read-only last-saved data; iPhone/Safari first; no navigation
redesign, no push notifications). Implementation is **sequenced after v0.2.1**: the approved
ClickUp-style tasks UI plan ships first, then this release becomes v0.3.0 and Today moves to
v0.4.0.

Mockup of record (local, untracked): `.superpowers/mockups/option-1-quiet-native.html`.

## 1. Problem & intent

On an iPhone the app is a browser tab: an address bar eats vertical space, the page does not
survive losing the network, and the interface is not inset for the Dynamic Island or home
indicator. The owner's words: *"there still is an address bar and it's hard to use like not a
real usable planning app."* The repo explicitly deferred PWA (README "Out of scope for
v0.2.0"; the UX-parity spec lists PWA under v0.3.0), so this release closes that gap.

Success means:

- Add to Home Screen → the app opens **standalone** (no address bar), correctly inset under
  the status bar, the Dynamic Island and the home indicator, in portrait and landscape.
- With no network, relaunching the installed app shows the **last saved calendar/tasks view
  read-only**, labelled "Offline · showing your last saved view (time)", and refuses edits with
  a clear message instead of silently queueing them.
- After a deploy, the running installed app offers an **Update ready** action; tapping it
  reloads once, without mixed-version chunk errors.
- Signing out purges everything cached or saved for that person on that device.
- Every existing contract stays green: the 8-viewport no-scroll shell, calendar shade
  hierarchy, two-person privacy rules, keyboard loops and accessible names.

## 2. Decisions of record

| # | Decision | Choice |
|---|---|---|
| D1 | Release | v0.3.0, after the in-progress **v0.2.1** ClickUp tasks UI; Today moves from v0.3.0 to **v0.4.0** in `lib/roadmap.ts` |
| D2 | Platform target | iPhone Safari (Home Screen) first; manifest still satisfies Android/desktop install, but no Android-specific UI |
| D3 | Install affordance | One-time dismissible strip on iPhone Safari + always-available "Install on iPhone" card in Settings. **No `beforeinstallprompt`** (Next 16's own PWA guide advises against it; iOS never fires it) |
| D4 | Manifest location | `app/manifest.ts` returning `MetadataRoute.Manifest` (Next serves `/manifest.webmanifest` and injects `<link rel="manifest">`) |
| D5 | Status bar | `black-translucent` full-bleed: the rail paints behind the clock, white status text. Fallback if device testing clips: `default` + a reserved rail-coloured strip (one-line change) |
| D6 | Service worker | Hand-written `public/sw.js`, **zero new dependencies**. No Serwist/next-pwa (webpack-era or Turbopack-specific, and the app needs ~120 lines of policy) |
| D7 | SW registration | **Production only.** Dev server and the existing E2E suite never register a SW |
| D8 | Offline data | Per-user TanStack Query snapshot in `localStorage`, read-only, TTL 7 days, **no SW caching of `/api/*`** and no shared authenticated cache |
| D9 | Offline writes | Refused with "You're offline — changes can't be saved."; never queued (mutations run with `networkMode: "always"`) |
| D10 | Install hint surface | Phone app shell only (`md:hidden`), iOS Safari only, never in standalone; dismissal stored under `nailong.pwa.installHintDismissed` |
| D11 | Update UX | Waiting SW → "Update ready" pill in the phone top bar / persistent toast on ≥md → `SKIP_WAITING` → one reload on `controllerchange` |
| D12 | Extras deliberately skipped | iOS splash images, manifest screenshots, shortcuts beyond Calendar/Tasks, badging, share target, push |

## 3. Platform facts of record (verified 2026-10-27)

- **iOS 26**: every site added to the Home Screen opens as a web app by default ("Open as Web
  App" toggle in the share sheet); a manifest is honoured but not required. Safe-area handling
  is therefore mandatory, not polish. ([WebKit — Safari 26.0 features](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/))
- **iOS has no install prompt event.** The only install path is Share → Add to Home Screen.
- **`theme-color`/`color-scheme`/`viewport`** belong in the `viewport` export; `metadata.themeColor`
  is deprecated since Next 14. ([Next — generateViewport](https://nextjs.org/docs/app/api-reference/functions/generate-viewport))
- **`app/manifest.ts`** is the supported App Router convention; static `app/manifest.json` would
  also work. ([Next — manifest.json](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest))
- **`metadata.appleWebApp`** emits `mobile-web-app-capable`, `apple-mobile-web-app-title`,
  `apple-mobile-web-app-status-bar-style` and `apple-touch-startup-image` tags;
  `app/apple-icon.png` (180×180, opaque) is wired automatically. ([Next — PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [app-icons](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons))
- **Next 16 has no built-in SW generation**; `experimental.useOffline` is explicitly not for
  production. The guide's minimal path is `public/sw.js` + a client registration effect +
  `Cache-Control: no-store` on `/sw.js`. ([Next — PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps))
- **iOS storage**: script-writable storage is evictable under ITP, but home-screen web apps are
  granted persistent storage far more readily. ([WebKit — storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/))
- **`env(safe-area-inset-*)` is 0 unless `viewport-fit=cover`** is set. Inset areas must be
  filled by the surface that paints there (rail, top bar, sheets). ([WebKit — iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/))
- **`worker-src`** (falling back to `script-src`/`default-src`) governs the SW script. The
  current CSP is Report-Only; it must gain `worker-src 'self'` and `manifest-src 'self'` before
  it is ever enforced. ([MDN — worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src))
- **iOS zooms any focused input below 16px**; `maximumScale=1` is an accessibility regression
  and is not used.

## 4. Scope

**In scope**

1. Manifest, icons (192 / 512 / maskable-512), viewport + apple metadata, standalone display.
2. Safe-area/standalone layout: status bar, notch, home indicator, landscape insets, overscroll,
   16px inputs.
3. Hand-written SW: shell/static caching, navigation fallback, `/offline` page, update protocol,
   production-only registration, headers.
4. Offline read-only snapshot: per-user persistence, hydration, offline banner, offline write
   refusal, purge on sign-out.
5. Install guidance (one-time strip + Settings card) and the update prompt.
6. Unit + dev-E2E + production-E2E tests, CI job, manual iPhone acceptance checklist.
7. Docs shipped with the code per `AGENTS.md`, version bump to 0.3.0, Today → v0.4.0,
   CHANGELOG/README/OPERATIONS updates.

**Out of scope (explicit)**

- Web Push, reminders, notification permission (v0.3.0 roadmap item in the historical UX spec,
  deferred).
- Offline **editing**, background sync, conflict resolution.
- Mobile navigation redesign (bottom tabs, phone sign-out gap, tap-target overhaul) — the user
  chose installable + offline only. The missing phone sign-out is recorded as a follow-up.
- Dark mode, iOS splash screens, manifest screenshots, share target, badging, shortcuts beyond
  Calendar/Tasks.
- Any database/service/API change. No migration.
- Android/iPad-specific verification beyond manifest validity.

## 5. Installable shell

### 5.1 `app/manifest.ts`

Returns `MetadataRoute.Manifest`:

```ts
{
  id: "/",
  name: "Nailong Planner",
  short_name: "Nailong",
  description: "A private planner for two.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#334451",
  lang: "en",
  dir: "ltr",
  categories: ["productivity"],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "Calendar", short_name: "Calendar", url: "/" },
    { name: "Tasks", short_name: "Tasks", url: "/tasks" },
  ],
}
```

`theme_color` is the rail token (`--color-rail` = `#334451`, `app/globals.css`); `background_color`
is the paper token (`#ffffff`). No `orientation` lock (landscape must keep working). No
`screenshots` (iPhone-first; adds binary weight for a rich Android dialog nobody in the household
uses).

The object is produced by a pure builder in `lib/pwa/manifest.ts` so a Vitest spec can assert the
install-critical fields without importing the Next route.

### 5.2 `app/layout.tsx`

```ts
export const metadata: Metadata = {
  title: "Nailong Planner",
  description: "A private planner for two.",
  applicationName: "Nailong",
  appleWebApp: {
    capable: true,
    title: "Nailong",
    statusBarStyle: "black-translucent", // see D5 fallback
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#334451",
};
```

No `maximumScale`/`userScalable` (a11y). `app/icon.png` and `app/apple-icon.png` stay (Next
emits `<link rel="icon">` and `<link rel="apple-touch-icon">`). The existing
`tests/unit`/E2E expectations for the tab title are unchanged.

### 5.3 Icons (`public/icons/`)

Generated once from `app/icon.png` (256×256 mascot; no larger source exists) and committed:

| File | Derivation |
|---|---|
| `icon-192.png` | downscale to 192×192 |
| `icon-512.png` | high-quality bicubic upscale to 512×512 |
| `maskable-512.png` | 512×512 white canvas, mascot drawn at 409×409 centred (≈80% safe-zone diameter) |

Generation snippet (PowerShell + `System.Drawing`, documented in `docs/OPERATIONS.md`; run once,
binaries are committed — no build-time image dependency):

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("app/icon.png")
# draw $src into a $size canvas with HighQualityBicubic; maskable = 512 white + 409 centred
```

`public/` is new to this repo; Next serves it from the origin root, which is what gives `/sw.js`
the `/` scope without a `Service-Worker-Allowed` header.

## 6. Standalone & safe-area layout

`viewportFit: "cover"` makes `env(safe-area-inset-*)` non-zero; every surface that paints an edge
must handle it. Current usage is only two bottom insets (`CalendarShell.tsx:1472`,
`EventDialog.tsx:541`), so the bulk of this work is new.

### 6.1 Tokens and utilities (`app/globals.css`)

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}
.safe-top { padding-top: var(--safe-top); }
.safe-x { padding-left: var(--safe-left); padding-right: var(--safe-right); }
```

Plus `html, body { overscroll-behavior: none; }` (the body already sets `-y`; add the html-level
and horizontal guards so standalone never rubber-bands or pull-to-refreshes). All values are 0
under Playwright, so the locked viewport contract cannot shift.

### 6.2 Surface-by-surface

| Surface | Change |
|---|---|
| Phone top bar (`AppShell.tsx:115`) | Keep rail background; add `padding-top: var(--safe-top)` and side insets. Height stays 56px of *content*; the painted rail extends under the clock (D5) |
| Phone top bar contents | 44px target for "Open collections"; the install strip and update pill join this bar (see §8) |
| Desktop rail (`GlobalNavRail.tsx:155`) | `width: calc(54px + var(--safe-left))` and `padding-left: var(--safe-left)` so the notch never covers icons (landscape phones use the rail at `md`) |
| Breadcrumb bar (`BreadcrumbBar.tsx`) | Side insets on its horizontal padding; height unchanged |
| `main` (`AppShell.tsx:162`) | Side insets; bottom padding `calc(padding + var(--safe-bottom))` so the last agenda row clears the home indicator |
| Sheet dialogs (`ui/dialog.tsx` `sheet` variant) | `padding-bottom: calc(p-6 + var(--safe-bottom))`; content still capped at `92dvh` |
| Other dialogs in standalone | `max-height: calc(100dvh - var(--safe-top) - var(--safe-bottom) - 2rem)` so a centred dialog never sits under the status bar |
| Collections sheet (`AppShell.tsx:179`) | Bottom + side insets; replace `max-h-[75vh]` with `max-h-[75dvh]` (same visual intent, correct unit in standalone) |
| Toaster (`ui/toast.tsx`) | Offset from the top by `calc(12px + var(--safe-top))` (Sonner accepts a CSS length string) |
| FAB (`CalendarShell.tsx:1470`) | Already correct; verified by the manual checklist |
| Event dialog footer (`EventDialog.tsx:539`) | Already correct; verified |
| Login page (`app/login/page.tsx`) | `min-h-screen` → `min-h-dvh` + safe-area padding (it is reachable in a tab before install and must not overflow) |
| `html`/`body` | Overscroll lock (§6.1) |

### 6.3 iOS input zoom

Three inputs render below 16px today and must become `text-base` (16px) so focus does not zoom
the installed app: the search field, the task capture input, and the `TimeField` typed input.
The exact current locations (re-derive after rebasing on v0.2.1, which rewrites `components/tasks/`):
`components/calendar/SearchBox.tsx:147`, `components/tasks/TaskCaptureRow.tsx:117`,
`components/calendar/TimeField.tsx:344`. A grep for other `text-sm` inputs is part of the plan's
first task.

### 6.4 Keyboard note

`interactiveWidget: "resizes-content"` is Chromium-only; iOS standalone does not resize the layout
viewport when the keyboard opens. The sticky Save footer already keeps Save reachable; the manual
checklist item "Event dialog Save visible with keyboard open" is the acceptance gate. If it fails,
the follow-up is a `visualViewport`-driven max-height in the dialog, recorded then.

## 7. Service worker

### 7.1 `public/sw.js` (classic worker, no modules)

Constants: `SW_VERSION = "v0.3.0-1"`; caches `pages-${SW_VERSION}` and `assets-${SW_VERSION}`.

- **install** — precache the small stable set only: `/offline.html` plus the three manifest icons
  (hashed `/_next/static/*` assets cannot be precached without a build integration; they are
  cached at runtime on first use). `skipWaiting()` is **not** called here.
- **activate** — delete every cache whose name does not end with `SW_VERSION`; `clients.claim()`.
- **fetch**
  - `request.mode === "navigate"` (same-origin GET): network-first. On `response.ok` clone the
    response into `pages-${SW_VERSION}` keyed by `request`; when the pathname is `/login`, clear
    the pages cache first and do not store the sign-in page (a `/login` navigation means the session is gone). On network failure serve the
    cached document for that URL, else `/offline.html`.
  - Same-origin GET under `/_next/static/` and `/icons/`, or with `destination` in
    `font | image | style | script`: cache-first, then network + runtime `put` (only 200,
    same-origin; never `no-store` responses).
  - `/api/*`: **not intercepted** — pass through, never cached by the SW.
  - Everything else: network.
- **message**
  - `{ type: "SKIP_WAITING" }` → `skipWaiting()`.
  - `{ type: "CLEAR_OFFLINE" }` → delete `pages-${SW_VERSION}` (used on sign-out).
- **Privacy invariant:** the pages cache holds authenticated HTML on *this device only*; it is
  cleared on sign-out, on any `/login` navigation, and on every SW version bump.

### 7.2 Registration (`components/pwa/ServiceWorkerRegistrar.tsx`)

Client component mounted once inside `Providers`:

- Runs only when `process.env.NODE_ENV === "production"` and `"serviceWorker" in navigator`
  (D7). Dev/E2E therefore never register, so stale-chunk debugging cannot happen.
- `register("/sw.js", { scope: "/", updateViaCache: "none" })`.
- On `updatefound` → new worker → `installed` with an existing controller: dispatch
  `window.dispatchEvent(new CustomEvent("nailong:sw-update-ready", { detail: registration }))`.
- Expose `applyUpdate(registration)`: post `SKIP_WAITING` to the waiting worker; on the next
  `controllerchange`, `location.reload()` exactly once (guard with a module flag).
- On `visibilitychange` to visible, call `registration.update()` (cheap, detects deploys).
- If standalone, call `navigator.storage.persist()` and ignore the result (best effort).

### 7.3 Headers (`next.config.ts`)

Add a header rule for `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate`,
`Content-Type: application/javascript; charset=utf-8`, `Service-Worker-Allowed: /`. Extend the
Report-Only CSP with `worker-src 'self'; manifest-src 'self';` (no enforcement change).

## 8. Offline read-only data

### 8.1 Snapshot module (`lib/pwa/offlineSnapshot.ts`)

Pure, unit-tested functions around `localStorage`:

- Key: `nailong.offline.<userId>`. Value: `{ version: 1, appVersion, savedAt, state }`.
- `shouldPersistQuery(query)` allowlist on `query.queryKey[0]`: `events`, `tasks`, `collections`,
  `preferences`. Explicitly excluded: `events/search` (the key contains `"search"`), import
  batches, anything else.
- `serializeSnapshot(queryClient, savedAt)`: TanStack `dehydrate` with the allowlist.
- `loadSnapshot(userId, now)`: null when missing, malformed, `version` mismatch, `appVersion`
  mismatch, or older than **7 days** (`SNAPSHOT_TTL_MS`).
- `saveSnapshot(userId, state, savedAt)`: `try/catch`; on quota/serialization failure clear the
  key and return `false` (the app must keep working with a full disk).
- `clearSnapshot(userId?)`: used on sign-out.
- `readSnapshotMeta(userId)`: `{ savedAt } | null` for the banner (never throws).
- `savedAt` is also the source of the banner's "last saved" time.

### 8.2 Hydration and persistence (`components/pwa/OfflineSnapshotWriter.tsx`, `app/providers.tsx`)

- `Providers` gains `currentUserId` (passed from `app/(app)/layout.tsx`, which already has the
  session) and renders the writer.
- **Hydrate** once in a layout effect when `loadSnapshot` returns data:
  `hydrate(queryClient, snapshot.state, { defaultOptions: { queries: { staleTime: 0 } } })`.
  Hydration never blocks first paint; network refetches continue normally, so online behaviour is
  unchanged apart from an instant cached paint.
- **Persist** by subscribing to `queryClient.getQueryCache()`, debounced 1.5s: dehydrate →
  `saveSnapshot`. Also write once on `pagehide` (iOS often kills backgrounded web apps without
  another event).
- **Purge** in the sign-out handler (`GlobalNavRail.tsx signOut`): `queryClient.clear()`,
  `clearSnapshot(currentUserId)`, and `navigator.serviceWorker.controller?.postMessage({ type:
  "CLEAR_OFFLINE" })` before the redirect. A different user id never hydrates another person's
  snapshot (key + user check).

### 8.3 Offline banner (`components/pwa/OfflineIndicator.tsx`)

Mounted in `AppShell` directly under `BreadcrumbBar` (phone and desktop). `useSyncExternalStore`
over `online`/`offline` events plus `navigator.onLine`:

- Offline + snapshot: amber bar `Offline · showing your last saved view (14:02)`, with the time
  from `readSnapshotMeta(userId)` (the snapshot's `savedAt`).
- Offline + no snapshot: amber bar `Offline · no saved view yet`.
- Online: nothing.

### 8.4 Offline writes

- `QueryClient` default options gain `mutations: { networkMode: "always" }` — an offline mutation
  fails immediately instead of pausing and replaying later (D9).
- The five duplicated `requestJson` helpers (`lib/query/events.ts`, `tasks.ts`, `collections.ts`,
  `preferences.ts`, `search.ts`) are consolidated into `lib/query/request.ts`, which throws
  `new Error("You're offline — changes can't be saved.")` when
  `typeof navigator !== "undefined" && navigator.onLine === false` before attempting `fetch`.
  Existing `onError` toasts therefore show a human message instead of "Failed to fetch". This is
  a behaviour-preserving refactor; `search.ts` re-exports it too.

## 9. Install and update UX (Option A "Quiet native")

### 9.1 Detection (`lib/pwa/device.ts`, pure and unit-tested)

- `isIOS(ua)`: iPhone/iPad/iPod (and iPadOS desktop-UA touch detection via `maxTouchPoints > 1`
  is *not* needed for the hint; keep the simple UA rule).
- `isIOSSafari(ua)`: iOS and not `CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo` (in-app browsers cannot
  add to Home Screen, so no hint there).
- `isStandalone(win)`: `matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true`.

### 9.2 `components/pwa/InstallHint.tsx` + `components/settings/InstallAppCard.tsx`

- **Hint**: rendered in `AppShell` immediately below the phone top bar (thus under the safe-area
  inset). Shows only when `isIOSSafari` and not standalone and
  `localStorage["nailong.pwa.installHintDismissed"] !== "1"`. Copy: "Install Nailong for the
  full-screen app — tap **Share**, then **Add to Home Screen**." Dismiss `×` (44px target) sets
  the flag permanently. Never shown on Android/desktop/Playwright's Chrome.
- **Settings card**: a `CARD` section rendered by `SettingsForm` immediately after the Google
  Calendar import section (same pattern, no new sub-nav entry). States: *Installed* (standalone) / *Not installed* with platform steps:
  iOS = Share → Add to Home Screen; Chromium = browser menu → Install app / Add to Home screen;
  other = "open in Safari on iPhone". Note that installing requires the HTTPS origin
  (`BETTER_AUTH_URL`).
- No `beforeinstallprompt` handling anywhere (D3).

### 9.3 `components/pwa/UpdatePill.tsx`

Listens for `nailong:sw-update-ready`. On phone (`md:hidden` scope) renders a compact
"Update ready" pill in the top bar; on ≥md it raises one persistent Sonner toast with a
**Reload** action. Both call `applyUpdate` from §7.2. No auto-reload while the user is editing.

## 10. Error handling & edge cases

| Case | Behaviour |
|---|---|
| Offline, installed app relaunched from Home Screen | SW serves last cached page + hydrated snapshot; banner shows saved time |
| Offline, route never cached | `/offline.html` ("You're offline · Nailong will be here when you reconnect" + Retry) |
| Offline, no snapshot (fresh install) | Shell renders, banner says no saved view; queries stay paused rather than error-spamming |
| Offline write | Immediate "You're offline — changes can't be saved." toast; optimistic row rolls back through the existing `onError` machinery |
| Session expired while online | Next redirects to `/login`; the SW clears the pages cache on that navigation; the snapshot is ignored next sign-in if the user id differs |
| Sign-out | Cache + snapshot purged before redirect (§8.2) |
| localStorage full/blocked (private mode) | `saveSnapshot` swallows and clears; app continues online |
| New deploy while a tab is open | Waiting SW → update pill/toast; reload is user-initiated |
| Second tab | `skipWaiting` only on explicit update; each tab reloads through `controllerchange` |
| SW disabled/blocked (private browsing, old iOS) | App works exactly as today; install hint still valid on iOS ≥16.4; no errors surfaced |
| Self-hosted HTTP origin | SW/install simply unavailable (secure context); README/OPERATIONS state HTTPS is required |

## 11. Testing & verification

### 11.1 Unit (Vitest)

| Spec | Covers |
|---|---|
| `tests/unit/pwa-manifest.test.ts` | builder returns required install fields; 192+512+maskable present; `start_url`/`scope` `/`; `display: standalone`; colors match tokens |
| `tests/unit/pwa-device.test.ts` | iOS UA variants (iPhone/iPad, CriOS/FxiOS excluded), Android/desktop false, standalone detection via fake `matchMedia`/`navigator.standalone` |
| `tests/unit/pwa-offline-snapshot.test.ts` | round-trip; allowlist includes the four keys and excludes search/import; TTL expiry; version/appVersion mismatch; different user id ignored; quota failure clears; purge removes the key |

### 11.2 Dev-server E2E (`tests/e2e/pwa.spec.ts`, existing config)

- `GET /manifest.webmanifest` → 200 JSON; name/short_name/start_url/scope/display/icons/theme_color/shortcuts asserted.
- Page head: `link[rel="manifest"]`, `meta[name="viewport"]` containing `viewport-fit=cover`,
  `meta[name="theme-color"][content="#334451"]`, `link[rel="apple-touch-icon"]`,
  `meta[name="apple-mobile-web-app-status-bar-style"][content="black-translucent"]`,
  `mobile-web-app-capable`.
- **No SW registration in dev**: `navigator.serviceWorker.getRegistrations()` → `[]`.
- Offline banner: `context.setOffline(true)` → banner appears with saved-or-none copy;
  back online → gone.
- iPhone-UA Safari context (Playwright `userAgent` + mobile viewport): install hint visible,
  dismiss hides it and survives reload; desktop Chrome sees no hint.
- Settings install card text/states present.
- Existing `viewport-fit.spec.ts`, `mobile.spec.ts`, `shell.spec.ts` (54px rail, accessible
  names), `view-preference.spec.ts` run unchanged and must stay green.

### 11.3 Production E2E (`playwright.pwa.config.ts` + `tests/e2e/pwa-offline.spec.ts`)

New script `test:pwa` = `tsx scripts/seed-test-db.mts && playwright test --config playwright.pwa.config.ts`,
run after `npm run build`. The config starts `npm run start -p 3100` (same port/seed
origin/secret as the seed script), `reuseExistingServer: false`, `NODE_ENV=production`.

Specs:

1. `/sw.js` → 200 with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`.
2. Registration: `await navigator.serviceWorker.ready`; after a reload the page is controlled.
3. Cache shape: after visiting `/` and `/tasks`, `caches.keys()` contains pages/assets caches;
   `/api/*` responses are **not** in any cache.
4. Cold offline: reload `/` with `context.setOffline(true)` → shell render, offline banner, last
   saved events visible (snapshot written during the online visit).
5. Uncached route offline → `/offline.html` content.
6. Sign-out → `caches.keys()` pages cache gone and the snapshot key removed; offline → offline page.
7. Update path is covered by the manual checklist (a full deploy cannot be simulated reliably in
   one Playwright run); the message/`SKIP_WAITING` plumbing is unit-level simple and reviewed.

CI: new `pwa` job (needs `verify`) — checkout, node 22, `npm ci`,
`npx playwright install --with-deps chromium`, `npm run build`, `npm run test:pwa`; upload
`test-results/` on failure. The existing `build`/`e2e` jobs are unchanged.

### 11.4 Manual iPhone acceptance checklist (owner runs once on the real device)

1. Safari → Share → Add to Home Screen → open from Home Screen: **no address bar**, app launches.
2. Status bar: white clock/battery over the rail; no content under the Dynamic Island.
3. Home indicator clears bottom content, sheets, FAB and toasts.
4. Landscape both ways: notch side padded, rail not clipped, no horizontal scroll.
5. Install hint appears once in Safari, dismisses permanently, absent in the installed app.
6. Settings → Install app says Installed once on the Home Screen.
7. Airplane mode + relaunch: last saved view within ~3 s + amber banner with saved time.
8. Offline create/edit/delete: clear "You're offline" message; nothing applied later.
9. Reconnect: banner clears, data refreshes.
10. Sign out: Web Inspector shows no snapshot/pages cache; offline relaunch shows the offline page.
11. Deploy a new build, reopen the installed app: "Update ready" appears; tapping reloads once.
12. Focus search, task capture and time inputs: **no zoom**.
13. Event dialog with the keyboard open: Save stays reachable.
14. VoiceOver: install hint dismiss has an accessible name; shell landmarks unchanged.
15. 320px-wide and long-household-name cases still do not overflow (regression pass).

## 12. Files & documentation impact

**New**

| Path | Purpose |
|---|---|
| `app/manifest.ts` | Manifest route |
| `lib/pwa/manifest.ts` | Pure manifest builder (unit-testable) |
| `lib/pwa/device.ts` | iOS/Safari/standalone detection |
| `lib/pwa/offlineSnapshot.ts` | Snapshot persistence + banner metadata |
| `lib/query/request.ts` | Shared fetch helper incl. offline message |
| `components/pwa/ServiceWorkerRegistrar.tsx` | Prod-only registration + update plumbing |
| `components/pwa/OfflineSnapshotWriter.tsx` | Hydrate/persist/purge snapshot |
| `components/pwa/OfflineIndicator.tsx` | Amber offline banner |
| `components/pwa/InstallHint.tsx` | One-time iPhone-Safari strip |
| `components/pwa/UpdatePill.tsx` | Update-ready pill/toast |
| `components/settings/InstallAppCard.tsx` | Settings install card |
| `public/sw.js`, `public/offline.html`, `public/icons/*.png` | SW, fallback page, install icons |
| `playwright.pwa.config.ts`, `tests/e2e/pwa.spec.ts`, `tests/e2e/pwa-offline.spec.ts`, 3 unit specs | Verification |
| `docs/COMPONENTS/pwa.md` | Area doc for the files above (public files documented here too) |

**Modified:** `app/layout.tsx`, `app/globals.css`, `app/(app)/layout.tsx`, `app/providers.tsx`,
`components/settings/SettingsForm.tsx` (Install card), `components/shell/AppShell.tsx`,
`components/shell/GlobalNavRail.tsx`, `components/shell/BreadcrumbBar.tsx`,
`components/ui/dialog.tsx`, `components/ui/toast.tsx`, `components/calendar/SearchBox.tsx`,
`components/calendar/TimeField.tsx`, the tasks capture input (re-derived post-rebase),
`lib/query/{events,tasks,collections,preferences,search}.ts`, `next.config.ts`, `package.json`,
`lib/roadmap.ts`, `tests/unit/roadmap.test.ts`, `.github/workflows/ci.yml`, plus docs:
`docs/COMPONENTS/README.md`, `docs/COMPONENTS/app-routes.md`,
`docs/COMPONENTS/components-shell-and-sidebar.md`, `docs/COMPONENTS/components-settings-ui.md`,
`docs/COMPONENTS/components-calendar.md`, `docs/COMPONENTS/lib-ui.md`,
`docs/COMPONENTS/scripts-and-ops.md`, `docs/COMPONENTS/tests.md`, `docs/DEBUGGING.md`,
`docs/OPERATIONS.md`, `README.md`, `CHANGELOG.md`, `scripts/docs-check.mjs` (`AREA_DOCS` entry
for `app/manifest.ts`, `components/pwa/`, `lib/pwa/`).

## 13. Release & sequencing

- **v0.2.1 first** (already in progress on main: due date/time, All tasks scope, ClickUp UI).
  This spec must not be implemented in the same checkout while that work is uncommitted.
- After v0.2.1 lands, create `feat/v0.3.0-pwa` from updated `main`; rebase this spec branch and
  re-derive the tasks-input line references (§6.3) and any `components/tasks/*` paths.
- Version: `package.json` `0.3.0`, `lib/roadmap.ts APP_VERSION "0.3.0"`.
- Roadmap: Today's promised version changes `v0.3.0` → **`v0.4.0`**; `tests/unit/roadmap.test.ts`
  and the "promises only the next version" assertions are updated in the same commit.
- CHANGELOG: new `## [0.3.0]` "Installable app and offline reading" section; the `[Unreleased]`
  line is corrected.
- No database migration, no API change, no new runtime dependency.
- Branch/PR contains code + docs + tests in conventional commits; `npm run docs:check`,
  `npm run lint`, `npm run typecheck`, `npm test` green; CI `pwa` and `e2e` jobs green.

## 14. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | `black-translucent` status bar clips content on a real device | Medium | Medium | Manual checklist item 2; fallback D5 (`default` + reserved strip) is a one-line flip |
| R2 | SW serves a stale cached document after a deploy | Medium | Medium | Network-first navigations, versioned caches, `updateViaCache: "none"`, update prompt, `/sw.js` no-store, production-only registration |
| R3 | Cached authenticated HTML/data visible on a device after sign-out or user switch | Low | High | Per-user snapshot key + user check; purge on sign-out; pages cache cleared on `/login` navigation and version bump; no `/api` SW cache; manual checklist item 10 |
| R4 | iOS evicts the offline cache | Medium | Low | `storage.persist()` when installed; TTL 7 days means UI honestly says "no saved view" instead of stale garbage |
| R5 | Playwright cannot validate `env()` insets or the install sheet (no display-mode emulation) | High | Medium | Meta/manifest/SW behaviour is tested; insets and install flow are covered by the manual checklist; detection helpers are unit-tested |
| R6 | v0.2.1 work changes files/line references in §6.3 and settings composition | High | Low | Plan's first task re-greps inputs/paths after rebase; no functional dependency on v0.2.1 |
| R7 | Snapshot exceeds localStorage quota (large history) | Low | Medium | Allowlist is small; try/catch clears and disables silently; snapshot observation is debounced |
| R8 | `next start` incompatible with `output: "standalone"` on this Next version | Low | Medium | Production PWA config uses `next start`; fallback is running `.next/standalone/server.js` with `public/` and `.next/static` copied (the Dockerfile already documents that layout) |
| R9 | New offline message refactor changes an existing 4xx error path | Low | Medium | `lib/query/request.ts` keeps the exact envelope/parse behaviour of the five copies; unit/E2E error-path tests stay untouched |
| R10 | Today's v0.3.0 promise silently changes | Low | Low | Roadmap test pins the promised version; README/CHANGELOG updated in the same release commit |

## 15. Acceptance criteria (definition of done)

1. Installed on the owner's iPhone: opens standalone, no address bar, correct status bar, notch and
   home-indicator insets in portrait and landscape (manual checklist 1–4, 15).
2. Manifest + icons + metadata are served with the exact install-critical fields; Android/Chrome
   offers install from its menu (unit + E2E assertions).
3. Offline relaunch shows the last saved read-only view with an honest timestamp; uncached routes
   show `/offline.html` (production E2E 4–5).
4. Offline writes fail with the offline message and never replay (unit request helper + manual 8).
5. Sign-out purges snapshot and cached pages (production E2E 6, manual 10).
6. Update prompt appears after a deploy and reloads cleanly (manual 11).
7. No page-scroll or accessible-name regression across the pinned 8 viewports and the existing
   mobile/shell/view specs.
8. `npm run docs:check`, `npm run lint`, `npm run typecheck`, `npm test` pass; CI `verify`,
   `build`, `e2e` and the new `pwa` job pass.
9. Every added/moved file has its `docs/COMPONENTS` section and behaviour docs are updated
   (`AGENTS.md` §3); `docs/OPERATIONS.md` documents HTTPS, install steps, offline semantics and
   cache purging; CHANGELOG/README/roadmap updated; version is 0.3.0.

## 16. Open questions

None blocking. Deliberate deferrals: iOS splash screens, manifest screenshots, phone navigation
redesign/phone sign-out, Web Push, offline editing.
