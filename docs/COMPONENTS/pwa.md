# PWA, service worker and offline reading

Installable-shell and offline documentation: the web app manifest, the service
worker, the offline snapshot, and the install/update affordances. The viewport
contract the installed app inherits is documented in
[`app-routes.md`](app-routes.md). Files under `public/` are not gated by
`npm run docs:check`, but they are documented here so the feature stays legible.

### app/manifest.ts

**Purpose** — Next App Router metadata route: serves `/manifest.webmanifest`
(Next injects the `<link rel="manifest">` tag). Delegates to the pure builder so
the install-critical fields are unit-testable.

**Public API** — `export default function manifest(): MetadataRoute.Manifest`,
returning `buildManifest()`.

**State & side effects** — None; fully static, no request-time API, no database.
Next caches the route at build time.

**Depends on / Used by** — `lib/pwa/manifest.ts`. Read by the browser and used by
the iPhone Share → Add to Home Screen flow and the Settings install card.

**Debugging** — Chrome/Edge never offer install, or offer it with a blank icon ->
`display`, `start_url`, `scope` or an icon size (192 + 512, one `maskable`)
regressed -> check `lib/pwa/manifest.ts` and request `/manifest.webmanifest`.
iOS 26 launches every Home Screen add standalone even with no manifest, so a
manifest defect shows up as a bad icon or missing shortcut, not as a browser tab.

**Tests** — `tests/unit/pwa-manifest.test.ts`, `tests/e2e/pwa.spec.ts`.

### lib/pwa/manifest.ts

**Purpose** — Pure manifest builder plus the theme/background colour constants
shared with `app/layout.tsx`.

**Public API** — `PWA_THEME_COLOR` (`#334451`, the rail token),
`PWA_BACKGROUND_COLOR` (`#ffffff`), `buildManifest(): MetadataRoute.Manifest` —
name/short_name, `id`/`start_url`/`scope` `/`, `display: "standalone"`, icons
192/512/maskable, Calendar and Tasks shortcuts, `lang`/`dir`/`categories`.

**State & side effects** — None; pure object construction.

**Depends on / Used by** — `app/manifest.ts`, `app/layout.tsx` (theme colour).
Tests import it directly, so the route never needs to boot Next.

**Debugging** — An install criterion broke -> compare the object against the
design spec §5.1; changing `theme_color`/`background_color` should also update
the status-bar expectation in `tests/e2e/pwa.spec.ts`.

**Tests** — `tests/unit/pwa-manifest.test.ts`, `tests/e2e/pwa.spec.ts`.

## Public files (not gated)

### public/icons/icon-192.png, public/icons/icon-512.png, public/icons/maskable-512.png

Generated once from `app/icon.png` (the 256 px mascot) with the PowerShell
`System.Drawing` snippet documented in `docs/OPERATIONS.md`: 192 downscale, 512
high-quality upscale, maskable = white 512 canvas with the mascot drawn at
410 px centred (inside the 80% safe zone). Committed binaries; no build step and
no image dependency.

## Safe-area layout (v0.3.0)

`viewportFit: "cover"` in `app/layout.tsx` makes `env(safe-area-inset-*)` non-zero in the
installed app; every painted edge consumes the utilities defined in `app/globals.css`. All
values are 0 in a normal browser tab, so the frozen viewport contract cannot shift.

| Surface | Class / rule |
|---|---|
| Phone top bar | `safe-pt` wrapper around the 56px row; the rail paints behind the status bar |
| Desktop rail (also landscape phones at `md`) | `w-[calc(54px+var(--safe-left))]` + `pl-[var(--safe-left)]` |
| Breadcrumb bar, `main` | `safe-x` (plus bottom `calc(padding + var(--safe-bottom))` on `main`) |
| Collections sheet | `safe-x-4`, `safe-pb-4`, `75dvh` |
| Centred dialog / sheet dialog | `safe-x-6`, `safe-pb-6`, max-height minus the top/bottom insets |
| Toaster | offset `calc(12px + env(safe-area-inset-top))` |
| Login page | `min-h-dvh`, `safe-x-4`, top/bottom `calc(3rem + inset)` |

The manual iPhone checklist (spec §11.4) is the only coverage for real insets: Playwright
reports `env()` as 0 and cannot emulate the notch or home indicator.
### public/sw.js

**Purpose** — The hand-written classic service worker: precaches the offline page and install icons, serves navigations network-first with a cached-document fallback, serves hashed static assets cache-first, and never touches `/api/*`.

**Public API** — `SW_VERSION = "v0.3.0-1"` (bump on every release); caches `pages-<SW_VERSION>` and `assets-<SW_VERSION>`; message handler for `{ type: "SKIP_WAITING" }` and `{ type: "CLEAR_OFFLINE" }`.

**State & side effects** — `install` precaches `/offline.html` plus the three manifest icons; `activate` deletes every cache whose name does not carry the current version and claims clients; `fetch` caches successful navigation documents, clears the pages cache and skips caching on a `/login` navigation, falls back to the cached document then `/offline.html`, and runtime-fills static assets. `SKIP_WAITING` is only honoured when the update prompt posts it. `/api/*` is never intercepted, and the pages cache is device-local: it is cleared on sign-out and whenever a navigation (request or followed redirect) resolves to `/login`.

**Depends on / Used by** — Registered by `components/pwa/ServiceWorkerRegistrar.tsx`; served with no-store and `Service-Worker-Allowed: /` by `next.config.ts`. Independent of the app bundle, so it survives a deploy until the new worker activates.

**Debugging** — An installed app keeps showing old UI after a deploy -> `SW_VERSION` was not bumped, the update prompt never fired, or `/sw.js` lost its no-store header -> check the header, then the waiting worker in devtools. Offline navigation shows `/offline.html` although the page was visited -> the navigation happened before the worker took control, or the pages cache was cleared by a `/login` visit. `caches.keys()` contains `pages-*` names from older versions -> `activate` cleanup regressed.

**Tests** — `tests/e2e/pwa-offline.spec.ts` (headers, registration/control, no API caching, offline shell, offline fallback); the dev-server spec asserts no worker exists in development.

### public/offline.html

**Purpose** — Static last-resort page served when a navigation has no cached document (for example a route never visited before going offline): Canvas styling, safe-area padding, a Retry button and a link home.

**Public API** — None; plain HTML/CSS with an inline `location.reload()` handler.

**State & side effects** — Read-only page; no storage, no network calls.

**Depends on / Used by** — Pre-cached by `public/sw.js` (`OFFLINE_URL`) and served as the navigation fallback. Referenced by manual checklist item 7.

**Debugging** — A blank screen instead of this page -> the SW install precache failed (check `PRECACHE_URLS`) or the file path is not `/offline.html`. The page shows in a browser tab but not in the installed app -> the worker is not controlling that scope.

**Tests** — `tests/e2e/pwa-offline.spec.ts` (uncached route while offline).

### lib/pwa/swUpdate.ts

**Purpose** — The update protocol between the service worker and the UI: one event name, one one-shot reload helper, one notify helper.

**Public API** — `UPDATE_EVENT = "nailong:sw-update-ready"`; `clearOfflinePagesCache(): void` (safe no-op without a service worker; posts `CLEAR_OFFLINE` through the controller); `applyUpdate(registration: ServiceWorkerRegistration): void` (posts `SKIP_WAITING`, reloads exactly once on the next `controllerchange`, and reloads when nothing is waiting rather than leaving a dead prompt); `notifyIfUpdateReady(registration): void` (dispatches the event when a waiting worker exists and a controller is already active).

**State & side effects** — Module-level `reloading` guard so two tabs/events cannot double-reload; touches `navigator.serviceWorker` and `window.location` only when called. Never reloads automatically.

**Depends on / Used by** — `components/pwa/ServiceWorkerRegistrar.tsx` (notify) and `components/pwa/UpdatePill.tsx` (apply).

**Debugging** — Tapping Reload does nothing -> no `registration.waiting` (the new worker already activated) or the app was loaded before any controller existed -> check `navigator.serviceWorker.getRegistration()`; a reload loop means the `reloading` guard was removed.

**Tests** — The update prompt event is covered by `tests/e2e/pwa-offline.spec.ts`; the real waiting-worker path needs a deploy and is covered by manual checklist item 11.

### components/pwa/ServiceWorkerRegistrar.tsx

**Purpose** — Registers `/sw.js` in production only, detects a waiting update, re-checks on visibility, and asks for persistent storage in the installed app.

**Public API** — `ServiceWorkerRegistrar()` — no props; renders `null`.

**State & side effects** — `useEffect` registration with `{ scope: "/", updateViaCache: "none" }`; dispatches `UPDATE_EVENT` via `notifyIfUpdateReady`; `visibilitychange` -> `registration.update()`; `navigator.storage.persist()` when `display-mode: standalone`. Cleanup removes the visibility listener and cancels late async work.

**Depends on / Used by** — `lib/pwa/swUpdate.ts`. Mounted once in `components/shell/AppShell.tsx`. The `process.env.NODE_ENV !== "production"` guard is what keeps `next dev` and the existing E2E dev server service-worker-free.

**Debugging** — A SW appears during `npm run dev` and serves stale chunks -> the production guard was removed; unregister it in devtools. The update prompt never appears though a new build shipped -> the new `/sw.js` byte-differs but the browser did not fetch it (registration update or no-store header), or `registration.waiting` was already consumed by a reload.

**Tests** — `tests/e2e/pwa.spec.ts` (no worker in dev) and `tests/e2e/pwa-offline.spec.ts` (worker + control in production). The deploy/update path is manual checklist item 11.

### components/pwa/UpdatePill.tsx

**Purpose** — The user-initiated update surface: a compact "Update ready" pill in the phone top bar and a persistent Sonner toast with a Reload action on wider screens.

**Public API** — `UpdatePill()` — no props.

**State & side effects** — Listens for `UPDATE_EVENT`; stores the registration; on >=48rem raises one toast (`id: "nailong-update"`, `duration: Infinity`) whose Reload action calls `applyUpdate`. Never reloads by itself. Renders nothing until a waiting worker is announced.

**Depends on / Used by** — `lib/pwa/swUpdate.ts`, `sonner`. Mounted inside the phone top bar in `components/shell/AppShell.tsx` (the CSS hides the pill on wider screens, but its effect still runs to raise the toast).

**Debugging** — A deploy happens and nothing appears -> the event never fired (registrar) or the toast was dismissed and the pill is hidden on desktop -> check the console/service worker panel first. A reload happens without the user pressing it -> `applyUpdate` gained an automatic caller, which is a bug.

**Tests** — `tests/e2e/pwa-offline.spec.ts` dispatches the event and asserts the prompt copy; the real flow is manual checklist item 11.

## Caching and update protocol (v0.3.0)

| Request class | Strategy |
|---|---|
| Navigations | network-first; successful documents cached in `pages-<version>`; `/login` clears that cache and is not stored; failure falls back to the cached document, then `/offline.html` |
| `/_next/static/*`, `/icons/*`, fonts, images, styles, scripts | cache-first; runtime fill in `assets-<version>` |
| `/api/*` | never intercepted, never cached |
| Update | waiting worker -> `nailong:sw-update-ready` -> pill/toast -> user taps -> `SKIP_WAITING` -> one reload on `controllerchange` |
| Sign-out | `CLEAR_OFFLINE` deletes the pages cache, paired with the snapshot purge in `GlobalNavRail.signOut` |
| Session expiry | a navigation whose request **or followed response** resolves to `/login` clears the pages cache and is not stored (Next's auth guard redirects) |
### lib/pwa/offlineSnapshot.ts

**Purpose** — The per-user read-only snapshot: a small, allowlisted TanStack Query dehydration kept in `localStorage` so the installed app can show the last saved calendar/tasks view without a network.

**Public API** — `OFFLINE_SNAPSHOT_VERSION` (1), `SNAPSHOT_TTL_MS` (7 days), `SNAPSHOT_KEY_PREFIX` (`nailong.offline.`), `OfflineSnapshot`, `shouldPersistQuery({ queryKey })`, `serializeSnapshot(queryClient, now?)`, `saveSnapshot(userId, snapshot): boolean`, `loadSnapshot(userId, now?): OfflineSnapshot | null`, `readSnapshotMeta(userId): { savedAt } | null`, `clearSnapshot(userId?)`.

**State & side effects** — Reads/writes the single storage key `nailong.offline.<userId>`. The allowlist is the four data roots `events`, `tasks`, `collections`, `preferences`, with any key containing `search` excluded; import batches and everything else are never stored. A snapshot carries `version`, `appVersion` (the `APP_VERSION` buster) and `savedAt`; it is ignored when malformed, from a different shape/app version, or older than the TTL. All storage access is `try/catch` (private mode, quota, blocked storage) and never throws.

**Depends on / Used by** — `@tanstack/react-query` (`dehydrate`, `DehydratedState`), `APP_VERSION` from `lib/roadmap`. Used by `components/pwa/OfflineSnapshotWriter.tsx` (serialize/save/hydrate), `components/pwa/OfflineIndicator.tsx` (banner time) and `components/shell/GlobalNavRail.tsx` (purge on sign-out).

**Debugging** — Offline launch shows the previous person's data -> the user id in the key or the sign-out purge regressed -> check `clearSnapshot` in `GlobalNavRail.signOut` and the `currentUserId` passed to `Providers`. Offline shows nothing although the app was used online -> the TTL/app-version/shape check rejected it, or the writer never ran -> inspect `nailong.offline.<userId>` in devtools. A quota error silently empties the snapshot by design -> online use is unaffected.

**Tests** — `tests/unit/pwa-offline-snapshot.test.ts` (allowlist, round-trip, TTL, version/user mismatch, quota, purge); the offline production flow in `tests/e2e/pwa-offline.spec.ts`.

### components/pwa/OfflineSnapshotWriter.tsx

**Purpose** — Hydrates the snapshot on mount and keeps it fresh: one write ~1.5s after any query-cache change, plus a `pagehide` flush for iOS.

**Public API** — `OfflineSnapshotWriter({ userId })` — renders `null`.

**State & side effects** — One effect: `loadSnapshot(userId)` then `hydrate(queryClient, state)`; subscribes to `queryClient.getQueryCache()`; debounced `serializeSnapshot` -> `saveSnapshot`; `pagehide` listener writes synchronously. Cleanup clears the timer, unsubscribes and removes the listener. Hydration happens in the effect, never during render, so SSR/first paint are unchanged and the normal refetch still runs.

**Depends on / Used by** — `lib/pwa/offlineSnapshot.ts`, `@tanstack/react-query` (`hydrate`, `useQueryClient`). Mounted once in `app/providers.tsx`.

**Debugging** — The snapshot key never appears -> the writer is unmounted or no query ever succeeded; cached values are reverted -> something calls `queryClient.clear()` or a second writer hydrates a stale snapshot; a write storm -> the debounce was removed.

**Tests** — Covered indirectly by `tests/e2e/pwa-offline.spec.ts` (waits for the key, then goes offline) and by the unit spec above.

### components/pwa/OfflineIndicator.tsx

**Purpose** — The amber offline bar under the breadcrumb bar: "Offline · showing your last saved view (14:02)" or "Offline · no saved view yet".

**Public API** — `OfflineIndicator({ userId })`.

**State & side effects** — `useSyncExternalStore` over the window `online`/`offline` events (`getServerSnapshot` reports online, so hydration cannot mismatch); reads `readSnapshotMeta(userId)` at render to label the saved time. Renders nothing while online. No timers, no storage writes.

**Depends on / Used by** — `lib/pwa/offlineSnapshot.ts`. Mounted in `components/shell/AppShell.tsx` directly under `BreadcrumbBar`, on every viewport.

**Debugging** — The bar does not appear when the network drops -> the `online`/`offline` listeners were dropped or the component is unmounted; the bar claims a saved view that is not on screen -> `readSnapshotMeta` and the hydrated state disagree (check the user id passed to both).

**Tests** — `tests/e2e/pwa.spec.ts` (banner with and without a snapshot, dev server) and `tests/e2e/pwa-offline.spec.ts` (production, last-saved view visible offline).

## Offline data protocol (v0.3.0)

| Concern | Rule |
|---|---|
| What is stored | Dehydrated `events`, `tasks`, `collections`, `preferences` queries (successful ones only); never search results or import batches |
| Where | `localStorage["nailong.offline.<userId>"]`, versioned and stamped with `APP_VERSION` and `savedAt` |
| Lifetime | 7 days (`SNAPSHOT_TTL_MS`), then ignored |
| Who can read it | Only the same user id on the same device; sign-out clears it, and the service worker pages cache is cleared too |
| Offline writes | Refused: mutations use `networkMode: "always"` and `lib/query/request.ts` throws `OFFLINE_MESSAGE` before `fetch`, so optimistic rows roll back instead of queueing |
| Back online | The query cache refetches normally and the banner disappears |
### lib/pwa/device.ts

**Purpose** — Dependency-free platform detection for the install UX: iOS/Safari user agents and standalone display mode.

**Public API** — `INSTALL_HINT_KEY` (`nailong.pwa.installHintDismissed`), `isIOS(userAgent)`, `isIOSSafari(userAgent)` (excludes CriOS/FxiOS/EdgiOS/OPiOS/DuckDuckGo, which cannot add to the Home Screen), `StandaloneEnv`, `isStandalone(env)`, `detectStandalone()`.

**State & side effects** — Pure string/`matchMedia`/`navigator.standalone` reads; `detectStandalone` returns false during SSR and calls `window.matchMedia` only in the browser. No storage writes.

**Depends on / Used by** — `components/pwa/InstallHint.tsx`, `components/settings/InstallAppCard.tsx`. Tests pass plain objects, so no DOM is needed.

**Debugging** — The hint never appears on a real iPhone -> the browser is an in-app shell (not Safari) or Safari already added it; check the UA with the helpers. The Settings card says "Not installed" inside the installed app -> `display-mode`/`navigator.standalone` detection regressed; check `isStandalone`.

**Tests** — `tests/unit/pwa-device.test.ts`; the hint flow in `tests/e2e/pwa.spec.ts`.

### components/pwa/InstallHint.tsx

**Purpose** — The one-time install strip under the phone top bar, shown only in iPhone/iPad Safari before install.

**Public API** — `InstallHint()` — no props; renders `null` when not applicable.

**State & side effects** — `useSyncExternalStore` computes the client-only condition (`isIOSSafari`, not standalone, not dismissed) with a server snapshot of `false`, so hydration cannot mismatch and no effect-setState is needed. Dismiss writes `INSTALL_HINT_KEY` to `localStorage` and hides it permanently. The dismiss control is a 44px target with `aria-label="Dismiss install hint"`.

**Depends on / Used by** — `lib/pwa/device.ts`. Mounted in `components/shell/AppShell.tsx` under the phone top bar.

**Debugging** — The strip appears on desktop -> the UA gate was removed; it reappears after a dismiss -> the storage key changed or storage is blocked (the code then deliberately shows it again); it is missing when installed -> correct behaviour.

**Tests** — `tests/e2e/pwa.spec.ts` (iPhone UA shows/dismisses/remembers; desktop shows none).

## Install guidance (v0.3.0)

| Platform | Path | Notes |
|---|---|---|
| iPhone/iPad Safari | Share -> Add to Home Screen | No prompt event exists on iOS; the one-time strip plus this Settings card are the whole UX |
| Android Chrome | Menu -> Install app / Add to Home screen | Manifest criteria (192/512/maskable, standalone) are what make this available |
| Desktop Chrome/Edge | Install icon in the address bar, or the menu | Same manifest; the app opens its own window |
| Any HTTP/LAN origin | Not installable | A secure context (HTTPS, or localhost for development) is required |