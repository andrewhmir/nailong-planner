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
