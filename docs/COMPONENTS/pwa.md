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

**State & side effects** — `install` precaches `/offline.html` plus the three manifest icons; `activate` deletes every cache whose name does not carry the current version and claims clients; `fetch` caches successful navigation documents, clears the pages cache and skips caching on a `/login` navigation, falls back to the cached document then `/offline.html`, and runtime-fills static assets. `SKIP_WAITING` is only honoured when the update prompt posts it. No authenticated data ever enters a shared cache, and `/api/*` is never intercepted.

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

**Public API** — `UPDATE_EVENT = "nailong:sw-update-ready"`; `applyUpdate(registration: ServiceWorkerRegistration): void` (posts `SKIP_WAITING`, reloads exactly once on the next `controllerchange`); `notifyIfUpdateReady(registration): void` (dispatches the event when a waiting worker exists and a controller is already active).

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
| Sign-out | `CLEAR_OFFLINE` deletes the pages cache (Task 5 pairs it with the snapshot purge) |