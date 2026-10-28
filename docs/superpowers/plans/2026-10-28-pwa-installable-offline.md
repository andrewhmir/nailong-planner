# PWA — installable, standalone and offline read-only (v0.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nailong installable to the iPhone Home Screen, launch it standalone with correct safe-area insets, and let it reopen read-only with the last saved view when offline.

**Architecture:** A static manifest + Next metadata make the app installable; safe-area utilities and a production-only hand-written service worker make the installed shell robust; a per-user TanStack Query snapshot in `localStorage` supplies the offline read-only data, with the SW caching only shell assets/pages (never `/api/*`). Install and update affordances are minimal, iPhone-first UI in the existing shell.

**Tech Stack:** Next.js 16.4.2 App Router, React 19.3.1, TypeScript strict, Tailwind CSS 4, TanStack Query 5.104.4, Vitest 5, Playwright 1.64.1. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-10-28-pwa-installable-offline-design.md`

## Execution preconditions

- **Do not start until v0.2.1 is committed/merged on `main`.** At the time this plan was written, `main` was at `23f3305` with uncommitted ClickUp task-UI edits in `app/globals.css`, `components/tasks/*`, `tests/e2e/tasks.spec.ts` and docs. Implementing PWA in the same checkout would collide.
- After v0.2.1 lands: rebase this plan's branch (`docs/v0.3.0-pwa-design`) on the new `main`, then create the feature worktree with `superpowers:using-git-worktrees` (one writer per checkout; the plan and spec commits travel with the feature branch).
- Re-derive every line reference in this plan against the rebased tree before editing (v0.2.1 rewrites `components/tasks/*` and `app/globals.css`). Grep anchors are given in each task; line numbers are hints, not contracts.
- The active DSH sandbox blocks Vitest/Playwright locally with `spawn EPERM` (same as the v0.2.1 plan). Local gates: `npm run lint`, `npm run typecheck`, `npm run docs:check`. Unit/E2E green is a **CI** claim; do not report it from a sandboxed local run. `npm run build` may also need an escalated/full-access run; the CI `build` and `pwa` jobs are authoritative.
- Stop any dev server before `npm run test:pwa` (it binds :3100 with `reuseExistingServer: false`).

## Global Constraints

- **No new npm dependencies.** Manifest, service worker, snapshot persister and update plumbing are hand-written.
- **Service worker registers in production only.** `next dev` and the existing E2E config must never register a SW.
- **Never cache `/api/*` in the SW.** The SW stores shell assets and successful navigation documents only.
- **Authenticated pages cache is per-device and cleared** on sign-out, on any `/login` navigation, and on every SW version bump.
- **Offline data is per person:** key `nailong.offline.<userId>`, TTL 7 days, cleared on sign-out, ignored when the user id or `APP_VERSION` differs.
- **iPhone/Safari first.** Android/desktop must remain installable from the manifest but get no bespoke install UI.
- **Frozen contracts:** `tests/e2e/viewport-fit.spec.ts` (no page scroll at 8 viewports), `tests/e2e/mobile.spec.ts`, `tests/e2e/shell.spec.ts` (54px rail, accessible names), `tests/e2e/view-preference.spec.ts`, calendar shade hierarchy, two-person privacy rules. Do not rename controls these specs query.
- **No `maximumScale`/`user-scalable=no`.** Fix <16px inputs to `text-base` instead.
- **Docs ship with code** (`AGENTS.md` §3): every added file under `app/`, `components/`, `lib/` gets its `### <path>` section in `docs/COMPONENTS/*.md` in the same commit; `npm run docs:check` must exit 0.
- **Version comes last (Task 6):** `package.json` + `lib/roadmap.ts` → `0.3.0`; Today's promised version → `v0.4.0`. Do not bump earlier.
- Conventional commits, code + docs + tests together. Tests use the in-memory DB helpers; never touch `data/planner.db`.
- **Review Focus:** fix the five failure modes below in the owning tasks; each line names the task whose tests pin it.

## Review Focus

1. **A second person (or a signed-out device) must never see the previous user's offline calendar data.** Snapshot key + user check + sign-out purge; pinned by Task 5 unit tests and the production E2E sign-out/purge case.
2. **First-ever offline open has no cached document or snapshot** — it must land on `/offline.html` with a Retry action, never a blank screen or a redirect loop. Pinned by Task 4 production E2E (offline, uncached route) and Task 5's "no saved view" banner case.
3. **A deploy while the installed app is open** must offer an update and reload into the new version without stale-chunk errors. No automated deploy in one Playwright run; pinned by manual checklist item 11 and code review of `lib/pwa/swUpdate.ts` + registrar.
4. **iPhone landscape/notch with a sheet open and the keyboard up** must not clip content or hide Save. `env()` insets cannot be emulated in Playwright; pinned by manual checklist items 4 and 13, with the shell specs guarding against ordinary layout regressions.
5. **The ordinary Safari tab experience must not change** beyond the install hint: no double spacing, dismissal persists, viewport-fit contract intact. Pinned by Task 2's unchanged shell/viewport specs and Task 6's hint E2E (dismiss survives reload, hidden on desktop).

## File Structure

| File | Responsibility |
|---|---|
| `app/manifest.ts` | Thin Next route: default-export `buildManifest()` |
| `lib/pwa/manifest.ts` | Pure manifest builder + colour constants (unit-testable) |
| `app/layout.tsx` | `viewport` export + `appleWebApp` metadata (modified) |
| `public/icons/{icon-192,icon-512,maskable-512}.png` | Install icons generated once from `app/icon.png` |
| `app/globals.css` | Safe-area utilities, overscroll lock (modified) |
| `lib/query/request.ts` | Shared `requestJson` + offline message (new, replaces 5 copies) |
| `lib/pwa/device.ts` | iOS/Safari/standalone detection |
| `lib/pwa/offlineSnapshot.ts` | Snapshot serialize/load/save/clear/TTL/allowlist |
| `lib/pwa/swUpdate.ts` | Update event name + one-shot `applyUpdate` |
| `components/pwa/ServiceWorkerRegistrar.tsx` | Prod-only registration + update detection |
| `components/pwa/UpdatePill.tsx` | "Update ready" pill (phone) / toast (≥md) |
| `components/pwa/OfflineSnapshotWriter.tsx` | Hydrate + persist + purge TanStack cache |
| `components/pwa/OfflineIndicator.tsx` | Amber offline banner |
| `components/pwa/InstallHint.tsx` | One-time iPhone-Safari install strip |
| `components/settings/InstallAppCard.tsx` | Settings install/installed card |
| `public/sw.js` | Hand-written service worker (caches, navigation fallback, messages) |
| `public/offline.html` | Static offline fallback page |
| `playwright.pwa.config.ts` | Production-build PWA test project (:3100) |
| `tests/unit/pwa-manifest.test.ts`, `pwa-device.test.ts`, `pwa-offline-snapshot.test.ts`, `query-request.test.ts` | Unit coverage |
| `tests/e2e/pwa.spec.ts` | Dev-server shell/manifest/hint/banner assertions |
| `tests/e2e/pwa-offline.spec.ts` | Production SW/offline/purge assertions |
| `docs/COMPONENTS/pwa.md` | Area doc for the new app/lib/component/public files |

---

### Task 1: Installable manifest, metadata and icons

**Files:**
- Create: `lib/pwa/manifest.ts`, `app/manifest.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`, `tests/unit/pwa-manifest.test.ts`, `tests/e2e/pwa.spec.ts`
- Modify: `app/layout.tsx`
- Docs: create `docs/COMPONENTS/pwa.md`; modify `docs/COMPONENTS/app-routes.md`, `docs/COMPONENTS/README.md`, `scripts/docs-check.mjs` (`AREA_DOCS`), `docs/COMPONENTS/tests.md`

**Interfaces:**
- Produces:
  - `export const PWA_THEME_COLOR = "#334451";`
  - `export const PWA_BACKGROUND_COLOR = "#ffffff";`
  - `export function buildManifest(): MetadataRoute.Manifest`
  - `app/manifest.ts`: `export default function manifest(): MetadataRoute.Manifest`
  - Icon URLs `"/icons/icon-192.png"`, `"/icons/icon-512.png"`, `"/icons/maskable-512.png"` (Task 4 precaches them)

- [ ] **Step 1: Write the failing unit test**

`tests/unit/pwa-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PWA_BACKGROUND_COLOR, PWA_THEME_COLOR, buildManifest } from "@/lib/pwa/manifest";

describe("pwa manifest", () => {
  it("describes a standalone app rooted at /", () => {
    const manifest = buildManifest();
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("Nailong Planner");
    expect(manifest.short_name).toBe("Nailong");
    expect(manifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(manifest.background_color).toBe(PWA_BACKGROUND_COLOR);
    expect(PWA_THEME_COLOR).toBe("#334451");
  });

  it("carries the install-critical icon sizes and one maskable", () => {
    const icons = buildManifest().icons ?? [];
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });

  it("offers Calendar and Tasks shortcuts", () => {
    expect(buildManifest().shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Calendar", url: "/" }),
        expect.objectContaining({ name: "Tasks", url: "/tasks" }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run it and confirm the module is missing**

Run: `npx vitest run tests/unit/pwa-manifest.test.ts --maxWorkers=8`
Expected: FAIL — cannot resolve `@/lib/pwa/manifest` (or `spawn EPERM` locally; then proceed and treat CI as the first real run).

- [ ] **Step 3: Implement the manifest**

`lib/pwa/manifest.ts` exports the two colour constants and `buildManifest()` returning exactly the object in spec §5.1 (fields, icons, shortcuts). `app/manifest.ts` is a default-export route delegating to it, typed as `MetadataRoute.Manifest`.

- [ ] **Step 4: Add the `viewport` and apple metadata**

In `app/layout.tsx` add the `metadata` fields (`applicationName`, `appleWebApp: { capable: true, title: "Nailong", statusBarStyle: "black-translucent" }`) and `export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: PWA_THEME_COLOR }`. Import `Viewport` from `next`. Do not add `maximumScale`/`userScalable`.

- [ ] **Step 5: Generate the icons once and commit them**

From the repo root (PowerShell, `System.Drawing`; the helper is documented in `docs/OPERATIONS.md` by Task 6):

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
$maskable = New-Object System.Drawing.Bitmap(512, 512)
$g = [System.Drawing.Graphics]::FromImage($maskable)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 51, 51, 410, 410)
$maskable.Save((Join-Path (Get-Location) "public/icons/maskable-512.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $maskable.Dispose(); $src.Dispose()
```

Expected: three committed PNGs (192×192, 512×512, 512×512).

- [ ] **Step 6: Re-run the unit test**

Run: `npx vitest run tests/unit/pwa-manifest.test.ts --maxWorkers=8` → PASS.

- [ ] **Step 7: Write the dev-server E2E head/manifest assertions**

Create `tests/e2e/pwa.spec.ts` following the `tests/e2e/mobile.spec.ts` pattern: the same `test.beforeEach` sign-in, and a `page.goto("/")` before any page-level head assertion. The first tests are:

```ts
test("serves an installable manifest", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  expect(JSON.stringify(manifest.icons)).toContain("maskable");
});

test("emits standalone head metadata", async ({ page }) => {
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("viewport-fit=cover");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#334451");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(
    page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
  ).toHaveAttribute("content", "black-translucent");
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
});
```

Run: `npx tsx scripts/seed-test-db.mts; npx playwright test tests/e2e/pwa.spec.ts`
Expected: PASS (CI if the sandbox blocks Playwright).

- [ ] **Step 8: Docs**

Create `docs/COMPONENTS/pwa.md` with the section template for `### app/manifest.ts` and `### lib/pwa/manifest.ts` (and note that `public/icons/*` is documented in this file even though `public/` is not gated). Update `### app/layout.tsx` in `docs/COMPONENTS/app-routes.md` (viewport contract + metadata; the viewport/breadcrumb paragraph gains the standalone rule). Add `pwa.md` to the area map in `docs/COMPONENTS/README.md`. Add `@/lib/pwa/` and `app/manifest.ts` prefixes to the `AREA_DOCS` suggestion table in `scripts/docs-check.mjs`. Add a `tests.md` row for `tests/unit/pwa-manifest.test.ts` and `tests/e2e/pwa.spec.ts`.

Run: `npm run docs:check` → PASS.

- [ ] **Step 9: Commit**

```bash
git add app/layout.tsx app/manifest.ts lib/pwa/manifest.ts public/icons tests/unit/pwa-manifest.test.ts tests/e2e/pwa.spec.ts docs/COMPONENTS/pwa.md docs/COMPONENTS/app-routes.md docs/COMPONENTS/README.md docs/COMPONENTS/tests.md scripts/docs-check.mjs
git commit -m "feat(pwa): add installable manifest, metadata and icons"
```

---

### Task 2: Standalone safe-area layout and 16px inputs

**Files:**
- Modify: `app/globals.css`, `components/shell/AppShell.tsx`, `components/shell/GlobalNavRail.tsx`, `components/shell/BreadcrumbBar.tsx`, `components/ui/dialog.tsx`, `components/ui/toast.tsx`, `app/login/page.tsx`, `components/calendar/SearchBox.tsx`, `components/calendar/TimeField.tsx`, the task capture input (grep `TaskCapture` after rebase)
- Docs: `docs/COMPONENTS/app-routes.md`, `docs/COMPONENTS/components-shell-and-sidebar.md`, `docs/COMPONENTS/components-calendar.md`, `docs/COMPONENTS/components-settings-ui.md` (dialog/toast), `docs/DEBUGGING.md`

**Interfaces:**
- Produces CSS utilities in `app/globals.css` (Tailwind layers):
  - `.safe-pt` → `padding-top: env(safe-area-inset-top)`
  - `.safe-pb` → `padding-bottom: env(safe-area-inset-bottom)`
  - `.safe-x` → left/right padding with `max(<current padding>, env(...))`; use a `--app-pad-x: 0.75rem` variable with a `@media (min-width: 640px) { --app-pad-x: 1.5rem; }` variant for `main`
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Record the characterisation baseline**

Run the frozen specs before editing (CI if sandbox-blocked):
`npx playwright test tests/e2e/viewport-fit.spec.ts tests/e2e/mobile.spec.ts tests/e2e/shell.spec.ts`
Expected: PASS. Save the output; this is the "no regression" baseline for this task.

- [ ] **Step 2: Add the utilities and overscroll lock**

In `app/globals.css`, add the three utilities under `@layer utilities` (or plain classes after `@theme`; keep them after Tailwind's utilities so they win padding conflicts where used) and set `html, body { overscroll-behavior: none; }` in the base layer (body currently sets `overscroll-behavior-y: none`).

- [ ] **Step 3: Apply insets surface by surface**

Follow spec §6.2 exactly:

- `AppShell.tsx`: wrap the phone top bar in a `bg-rail safe-pt md:hidden` container with the existing `h-14` flex row inside it (keeps every accessible name and the `Open collections` button unchanged); `<main>` gets the safe bottom padding and `safe-x` instead of its bare horizontal `p-3 sm:p-6`; the Collections sheet panel gets `safe-pb` and `max-h-[75dvh]`.
- `GlobalNavRail.tsx`: `w-[calc(54px+env(safe-area-inset-left))] pl-[env(safe-area-inset-left)]`.
- `BreadcrumbBar.tsx`: side insets on the header's horizontal padding.
- `ui/dialog.tsx`: `sheet` variant gets `safe-pb`; centred content gets `max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)]`.
- `ui/toast.tsx`: offset from the top by `calc(12px + env(safe-area-inset-top))` (Sonner accepts a CSS length string); `closeButton` stays.
- `app/login/page.tsx`: `min-h-screen` → `min-h-dvh`, add safe top/bottom padding.
- Keep the two existing bottom insets (`CalendarShell.tsx` FAB, `EventDialog.tsx` footer) as they are.

- [ ] **Step 4: Fix the sub-16px inputs**

Add `text-base` (16px) to the search field (`SearchBox.tsx`), the `TimeField` typed input, and the task capture input (`components/tasks/` — grep `text-sm` + `<input` after rebase). Do not change their height tokens or labels.

- [ ] **Step 5: Re-run the frozen specs**

Run: `npx playwright test tests/e2e/viewport-fit.spec.ts tests/e2e/mobile.spec.ts tests/e2e/shell.spec.ts`
Expected: PASS unchanged (all insets evaluate to 0 in Playwright, so geometry is identical).

- [ ] **Step 6: Docs**

Update the `AppShell.tsx`, `GlobalNavRail.tsx`, `BreadcrumbBar.tsx`, `ui/dialog.tsx`, `ui/toast.tsx`, `app/login/page.tsx` and input-file sections' `State & side effects` / `Debugging` lines with the safe-area rules. Add a `docs/DEBUGGING.md` trap: "installed app content sits under the status bar / home indicator → `viewport-fit=cover` missing or a surface lost its safe-area class → globals utilities + owning component".

- [ ] **Step 7: Commit**

```bash
git add app/globals.css components/shell components/ui/dialog.tsx components/ui/toast.tsx app/login/page.tsx components/calendar/SearchBox.tsx components/calendar/TimeField.tsx components/tasks docs/COMPONENTS docs/DEBUGGING.md
git commit -m "feat(pwa): adopt safe-area insets for the standalone shell"
```

---

### Task 3: Shared request helper with the offline message

**Files:**
- Create: `lib/query/request.ts`, `tests/unit/query-request.test.ts`
- Modify: `lib/query/events.ts`, `lib/query/tasks.ts`, `lib/query/collections.ts`, `lib/query/preferences.ts`, `lib/query/search.ts`
- Docs: `docs/COMPONENTS/lib-data.md` (new section + five sections' `Depends on` lines), `docs/COMPONENTS/tests.md`

**Interfaces:**
- Produces:
  - `export const OFFLINE_MESSAGE = "You're offline — changes can't be saved.";`
  - `export async function requestJson<T>(url: string, init?: RequestInit): Promise<T>`
  - Behaviour: when `typeof navigator !== "undefined" && navigator.onLine === false`, throw `new Error(OFFLINE_MESSAGE)` **before** `fetch`; otherwise run the exact body of today's `events.ts` helper (fetch → `response.json().catch(() => null)` → non-ok throws `payload?.error?.message ?? "Something went wrong."` → return payload as `T`).

- [ ] **Step 1: Write the failing unit test**

`tests/unit/query-request.test.ts` (Vitest runs with `environment: "node"`; stub globals):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE, requestJson } from "@/lib/query/request";

afterEach(() => vi.unstubAllGlobals());

describe("requestJson", () => {
  it("refuses to fetch while offline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestJson("/api/events")).rejects.toThrow(OFFLINE_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 })));
    await expect(requestJson<{ events: unknown[] }>("/api/events")).resolves.toEqual({ events: [] });
  });

  it("surfaces the API error envelope", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "Calendar not found." } }), { status: 404 })),
    );
    await expect(requestJson("/api/events/x")).rejects.toThrow("Calendar not found.");
  });
});
```

- [ ] **Step 2: Run it and confirm the module is missing**

Run: `npx vitest run tests/unit/query-request.test.ts --maxWorkers=8` → FAIL (`@/lib/query/request` unresolved).

- [ ] **Step 3: Implement and migrate**

Create `lib/query/request.ts`; delete each module's local `requestJson`/`ApiErrorBody` pair and import the shared one (keep the local `ApiErrorBody` only if another symbol uses it). `search.ts` uses the shared helper too. This must be behaviour-preserving: existing errors, JSON parsing and non-ok mapping stay byte-identical.

- [ ] **Step 4: Run the new test plus the query/cache unit specs**

Run: `npx vitest run tests/unit/query-request.test.ts tests/unit/event-cache.test.ts tests/unit/task-cache.test.ts --maxWorkers=8` → PASS (CI if EPERM).
Also run `npm run typecheck` → PASS.

- [ ] **Step 5: Docs**

Add `### lib/query/request.ts` to `docs/COMPONENTS/lib-data.md` and update the five modules' `Depends on / Used by` lines to name it; add the `tests.md` row for `query-request.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/query tests/unit/query-request.test.ts docs/COMPONENTS/lib-data.md docs/COMPONENTS/tests.md
git commit -m "refactor(query): centralise requestJson and refuse offline writes"
```

---

### Task 4: Service worker, offline page, update prompt and the production PWA harness

**Files:**
- Create: `public/sw.js`, `public/offline.html`, `lib/pwa/swUpdate.ts`, `components/pwa/ServiceWorkerRegistrar.tsx`, `components/pwa/UpdatePill.tsx`, `playwright.pwa.config.ts`, `tests/e2e/pwa-offline.spec.ts`
- Modify: `components/shell/AppShell.tsx`, `next.config.ts`, `package.json`, `.github/workflows/ci.yml`
- Docs: `docs/COMPONENTS/pwa.md`, `docs/COMPONENTS/app-routes.md` (next.config headers), `docs/COMPONENTS/scripts-and-ops.md`, `docs/COMPONENTS/tests.md`, `docs/DEBUGGING.md`

**Interfaces:**
- Produces:
  - `public/sw.js`: `SW_VERSION = "v0.3.0-1"`; caches `pages-${SW_VERSION}`, `assets-${SW_VERSION}`; messages `{ type: "SKIP_WAITING" }` and `{ type: "CLEAR_OFFLINE" }`.
  - `lib/pwa/swUpdate.ts`: `export const UPDATE_EVENT = "nailong:sw-update-ready";` and `export function applyUpdate(registration: ServiceWorkerRegistration): void` (posts `SKIP_WAITING`, reloads exactly once on the next `controllerchange`).
  - `ServiceWorkerRegistrar`: no props; registers only when `process.env.NODE_ENV === "production"` with `{ scope: "/", updateViaCache: "none" }`, dispatches `UPDATE_EVENT` with `detail: registration` when an installed worker is waiting, calls `registration.update()` on visibility, `navigator.storage.persist()` when standalone.
  - `UpdatePill`: no props; listens for `UPDATE_EVENT`; pill in the phone top bar, one persistent Sonner toast with **Reload** action at ≥md.
  - `playwright.pwa.config.ts`: production project — `testMatch: /pwa-offline\.spec\.ts/`, `baseURL http://localhost:3100`, `webServer: { command: "npm run start -- -p 3100", reuseExistingServer: false }`, env `DATABASE_URL=file:./.playwright/test.db`, `BETTER_AUTH_URL=http://localhost:3100`, `BETTER_AUTH_SECRET=playwright-test-secret-0123456789abcdef`, `AUTH_RATE_LIMIT=off`, `TZ=Asia/Taipei`.
  - `package.json`: `"test:pwa": "tsx scripts/seed-test-db.mts && playwright test --config playwright.pwa.config.ts"` (requires a prior `npm run build`).
- Consumes: Task 1's manifest/icons, Task 3's offline message.

- [ ] **Step 1: Write the failing production harness**

Create `playwright.pwa.config.ts` and `tests/e2e/pwa-offline.spec.ts` (import `ANDREW`, `loadFixtures`, `signIn` from `./helpers` exactly as the other specs do) with the first three tests:

```ts
test("serves the service worker with no-store and root scope", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["service-worker-allowed"]).toBe("/");
});

test("registers and controls the page", async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
});

test("never caches API responses", async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
  await expect(page.getByText("Weekly class").first()).toBeVisible();
  const cachedPaths = await page.evaluate(async () => {
    const names = await caches.keys();
    const lists = await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        return (await cache.keys()).map((request) => new URL(request.url).pathname);
      }),
    );
    return lists.flat();
  });
  expect(cachedPaths.some((path) => path.startsWith("/api/"))).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build; npm run test:pwa`
Expected: FAIL — `/sw.js` 404, no controller. (If `next start` refuses with `output: "standalone"`, use the documented fallback: copy `public/` and `.next/static` into `.next/standalone/` and start `node .next/standalone/server.js` with `PORT=3100`; record the change in `docs/OPERATIONS.md`.)

- [ ] **Step 3: Implement the service worker and offline page**

`public/sw.js` exactly per spec §7.1: install precaches `/offline.html` + the three icons; activate deletes stale cache names and claims clients; fetch is network-first for navigations (clone 200s into the pages cache, clear the pages cache and skip storing on `/login`, fall back to cached document then `/offline.html`), cache-first for hashed static/icons with runtime put, and pass-through (no `respondWith`) for `/api/*`; message handler implements `SKIP_WAITING` and `CLEAR_OFFLINE`. `public/offline.html` is a small static page using the Canvas colours with a Retry button (`location.reload()`) and an `/` link.

- [ ] **Step 4: Implement the registrar and headers**

`components/pwa/ServiceWorkerRegistrar.tsx` + `lib/pwa/swUpdate.ts` per the interfaces; mount the registrar once in `AppShell` (it is already inside `Providers`). Add the `/sw.js` header rule and `worker-src 'self'; manifest-src 'self'` to the Report-Only CSP in `next.config.ts`.

- [ ] **Step 5: Re-run the production harness**

Run: `npm run build; npm run test:pwa` → PASS.

- [ ] **Step 6: Add the offline and update-UI tests**

Extend `tests/e2e/pwa-offline.spec.ts` with (a) cold offline reload shows the cached shell and the offline page for an uncached route, and (b) the phone top bar renders the `Update ready` control when `window.dispatchEvent(new CustomEvent("nailong:sw-update-ready", { detail: registration }))` is dispatched with a stub registration (assert the pill's accessible name; the real waiting-SW path stays manual). Keep the offline reload case tolerant of the snapshot work landing in Task 5: assert the banner text `/Offline/` and the shell chrome; add the last-saved-data assertion in Task 5.

- [ ] **Step 7: Implement the update prompt**

`components/pwa/UpdatePill.tsx` per the interfaces; mount it in `AppShell` next to the phone top bar. Do not auto-reload.

- [ ] **Step 8: Wire CI and the npm script**

Add `test:pwa` to `package.json`; add the `pwa` CI job from spec §11.3 (needs `verify`, installs Chromium, `npm run build`, `npm run test:pwa`, uploads traces on failure). Extend the `pwa` case in the manual checklist (spec §11.4 item 11) into `docs/OPERATIONS.md` in Task 6.

- [ ] **Step 9: Run the harness again, then the frozen dev specs**

Run: `npm run build; npm run test:pwa` → PASS.
Run: `npx playwright test tests/e2e/pwa.spec.ts tests/e2e/mobile.spec.ts` (dev config; SW must NOT appear) → PASS. `tests/e2e/pwa.spec.ts` gains `expect(await page.evaluate(() => navigator.serviceWorker?.getRegistrations?.() ?? [])).toHaveLength(0)` in its dev test.

- [ ] **Step 10: Docs and commit**

Add `### public/sw.js`, `### public/offline.html`, `### components/pwa/ServiceWorkerRegistrar.tsx`, `### components/pwa/UpdatePill.tsx`, `### lib/pwa/swUpdate.ts` to `docs/COMPONENTS/pwa.md`; document the headers in `app-routes.md`, the script/config/CI in `scripts-and-ops.md`, the spec rows in `tests.md`, and a `docs/DEBUGGING.md` trap ("stale UI after deploy in a production build → compare `SW_VERSION`/waiting worker; in dev a SW must never exist — unregister if one appears").

```bash
git add public/sw.js public/offline.html lib/pwa/swUpdate.ts components/pwa components/shell/AppShell.tsx next.config.ts package.json .github/workflows/ci.yml playwright.pwa.config.ts tests/e2e/pwa.spec.ts tests/e2e/pwa-offline.spec.ts docs
git commit -m "feat(pwa): add the shell service worker, offline page and update prompt"
```

---

### Task 5: Offline read-only snapshot, banner and sign-out purge

**Files:**
- Create: `lib/pwa/offlineSnapshot.ts`, `components/pwa/OfflineSnapshotWriter.tsx`, `components/pwa/OfflineIndicator.tsx`, `tests/unit/pwa-offline-snapshot.test.ts`
- Modify: `app/providers.tsx`, `app/(app)/layout.tsx`, `components/shell/AppShell.tsx`, `components/shell/GlobalNavRail.tsx`, `tests/e2e/pwa.spec.ts`, `tests/e2e/pwa-offline.spec.ts`
- Docs: `docs/COMPONENTS/pwa.md`, `docs/COMPONENTS/app-routes.md`, `docs/COMPONENTS/components-shell-and-sidebar.md`, `docs/COMPONENTS/tests.md`, `docs/DEBUGGING.md`

**Interfaces:**
- Produces in `lib/pwa/offlineSnapshot.ts`:
  - `export const OFFLINE_SNAPSHOT_VERSION = 1;`
  - `export const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;`
  - `export const SNAPSHOT_KEY_PREFIX = "nailong.offline.";`
  - `export function shouldPersistQuery(query: { queryKey: readonly unknown[] }): boolean` — first key segment in `events|tasks|collections|preferences` and the key does not contain `"search"`.
  - `export function serializeSnapshot(queryClient: QueryClient, now: number): OfflineSnapshot`
  - `export function loadSnapshot(userId: string, now?: number): OfflineSnapshot | null`
  - `export function readSnapshotMeta(userId: string): { savedAt: number } | null`
  - `export function saveSnapshot(userId: string, snapshot: OfflineSnapshot): boolean`
  - `export function clearSnapshot(userId?: string): void`
  - `export interface OfflineSnapshot { version: number; appVersion: string; savedAt: number; state: DehydratedState }`
- `OfflineSnapshotWriter({ userId }: { userId: string })`; `OfflineIndicator({ userId }: { userId: string })`; `Providers({ children, currentUserId }: { children: React.ReactNode; currentUserId: string })`.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/pwa-offline-snapshot.test.ts` with a small fake storage and a real `QueryClient`:

```ts
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

// vi.stubGlobal("localStorage", new MemoryStorage()) in each test / beforeEach.
```

Cases: allowlist accepts `["events",1,2]`, `["tasks","counts"]`, `["collections"]`, `["preferences"]`; rejects `["events","search","x"]`, `["import-batches"]`, `["other"]`. Round-trip: `serializeSnapshot` → `saveSnapshot` → `loadSnapshot` returns the same state and `savedAt`. TTL: a snapshot older than `SNAPSHOT_TTL_MS` returns `null`. Version: `appVersion: "0.2.9"` returns `null`. User mismatch: a key written for `user-a` returns `null` for `user-b`. Quota: a storage whose `setItem` throws makes `saveSnapshot` return `false` and remove the key. `clearSnapshot("user-a")` removes only that key.

- [ ] **Step 2: Run it and confirm it fails** — `npx vitest run tests/unit/pwa-offline-snapshot.test.ts --maxWorkers=8` → FAIL (module missing).

- [ ] **Step 3: Implement the snapshot module** per the interfaces; guard storage access with `typeof localStorage === "undefined" ? null : localStorage` so the node-environment test can stub it; import `dehydrate`/`DehydratedState` from `@tanstack/react-query`.

- [ ] **Step 4: Run it → PASS**, then wire hydration/persistence/purge:

- `app/(app)/layout.tsx` passes `currentUserId={session.user.id}` to `Providers`.
- `app/providers.tsx`: add `mutations: { networkMode: "always" }` to the client default options; mount `OfflineSnapshotWriter`.
- Writer: one-time `hydrate(queryClient, snapshot.state)` when `loadSnapshot` returns data; subscribe to the query cache with a 1.5s debounce writing `saveSnapshot`; write once on `pagehide`.
- `AppShell`: mount `OfflineIndicator userId={currentUser.id}` directly under `BreadcrumbBar`.
- `GlobalNavRail` sign-out: before the redirect, `queryClient.clear()`, `clearSnapshot(currentUser.id)`, and post `{ type: "CLEAR_OFFLINE" }` to `navigator.serviceWorker.controller`.

- [ ] **Step 5: Extend the dev E2E for the banner**

In `tests/e2e/pwa.spec.ts`: sign in, wait for an event, then `context.setOffline(true)` → banner text `/Offline/` visible; `context.setOffline(false)` → banner gone. Second case: clear the snapshot key first, go offline → `/no saved view/` copy.

- [ ] **Step 6: Extend the production E2E for data and purge**

In `tests/e2e/pwa-offline.spec.ts`: visit `/` online, wait for the snapshot key (`localStorage` key starting `nailong.offline.`), go offline, reload → banner + "Weekly class" visible read-only. Then sign out via the account menu → assert no `nailong.offline.` keys remain and no cache name starts with `pages-`; reload offline → `/offline.html` copy.

- [ ] **Step 7: Run the gates** — `npm run build; npm run test:pwa`; `npx playwright test tests/e2e/pwa.spec.ts` → PASS.

- [ ] **Step 8: Docs and commit**

Sections for the three new files in `pwa.md` (storage keys, TTL, purge rule, banner copy); update `Providers`/AppShell/GlobalNavRail sections; `tests.md`; DEBUGGING trap ("offline shows another person's data → snapshot key/purge regressed; offline shows nothing → writer never hydrated / TTL expired").

```bash
git add lib/pwa/offlineSnapshot.ts components/pwa app/providers.tsx "app/(app)/layout.tsx" components/shell tests/unit/pwa-offline-snapshot.test.ts tests/e2e/pwa.spec.ts tests/e2e/pwa-offline.spec.ts docs
git commit -m "feat(pwa): restore the last saved view when offline, purged on sign-out"
```

---

### Task 6: Install hint and Settings install card

**Files:**
- Create: `lib/pwa/device.ts`, `components/pwa/InstallHint.tsx`, `components/settings/InstallAppCard.tsx`, `tests/unit/pwa-device.test.ts`
- Modify: `components/shell/AppShell.tsx`, `components/settings/SettingsForm.tsx`, `tests/e2e/pwa.spec.ts`
- Docs: `docs/COMPONENTS/pwa.md`, `docs/COMPONENTS/components-shell-and-sidebar.md`, `docs/COMPONENTS/components-settings-ui.md`, `docs/COMPONENTS/tests.md`, `docs/OPERATIONS.md`, `README.md`

**Interfaces:**
- Produces in `lib/pwa/device.ts`:
  - `export const INSTALL_HINT_KEY = "nailong.pwa.installHintDismissed";`
  - `export function isIOS(userAgent: string): boolean` — `/iPhone|iPad|iPod/`
  - `export function isIOSSafari(userAgent: string): boolean` — iOS and none of `/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/`
  - `export function isStandalone(env: StandaloneEnv): boolean` — `env.matchMedia("(display-mode: standalone)").matches || env.navigator?.standalone === true`, with `export interface StandaloneEnv { matchMedia(query: string): { matches: boolean }; navigator?: { standalone?: boolean } }`
  - `export function detectStandalone(): boolean` — wraps `window`
- `InstallHint`: no props; rendered inside `AppShell` immediately after the phone top bar. Dismiss control has `aria-label="Dismiss install hint"` and a ≥44px hit area; copy: "Install Nailong for the full-screen app — tap **Share**, then **Add to Home Screen**."
- `InstallAppCard`: no props; a `CARD` section rendered in `SettingsForm` after the Google Calendar import section with heading "Install app"; shows *Installed* (`detectStandalone()`) or the platform steps (iOS / Chromium / other).

- [ ] **Step 1: Write the failing unit test**

`tests/unit/pwa-device.test.ts`:

```ts
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/128.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";

expect(isIOS(IPHONE_SAFARI)).toBe(true);
expect(isIOSSafari(IPHONE_SAFARI)).toBe(true);
expect(isIOSSafari(IPHONE_CHROME)).toBe(false);
expect(isIOS(ANDROID_CHROME)).toBe(false);
expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
expect(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } })).toBe(true);
expect(isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} })).toBe(false);
```

- [ ] **Step 2: Run it → FAIL** (`@/lib/pwa/device` unresolved), then implement → PASS: `npx vitest run tests/unit/pwa-device.test.ts --maxWorkers=8`.

- [ ] **Step 3: Implement the UI**

`InstallHint`: client component; state initialised from `isIOSSafari(navigator.userAgent) && !detectStandalone() && localStorage.getItem(INSTALL_HINT_KEY) !== "1"` inside an effect (not during SSR); dismiss writes `"1"` and hides. `InstallAppCard`: client component that reads `detectStandalone()` in an effect to avoid a hydration mismatch. Mount the card in `SettingsForm` after the import section.

- [ ] **Step 4: Extend the dev E2E**

In `tests/e2e/pwa.spec.ts`, a `test.describe` with `test.use({ userAgent: IPHONE_SAFARI, viewport: { width: 375, height: 812 } })`: sign in → hint visible → click "Dismiss install hint" → reload → hint absent. A desktop test asserts no hint. A settings test asserts the "Install app" heading and the iOS steps copy.

- [ ] **Step 5: Docs**

Sections for `device.ts`, `InstallHint.tsx`, `InstallAppCard.tsx` in `pwa.md`; SettingsForm/AppShell lines; `tests.md`; `docs/OPERATIONS.md` gains an "Installing on a phone (PWA)" section: HTTPS requirement (`BETTER_AUTH_URL`), iOS Share → Add to Home Screen steps, offline semantics and purge, update prompt, icon-generation snippet from Task 1, and the manual checklist from spec §11.4. `README.md` gains a feature bullet and removes PWA from the v0.2.0 out-of-scope list.

- [ ] **Step 6: Run gates and commit**

Run: `npx playwright test tests/e2e/pwa.spec.ts`, `npm run docs:check`, `npm run lint`, `npm run typecheck` → PASS.

```bash
git add lib/pwa/device.ts components/pwa/InstallHint.tsx components/settings/InstallAppCard.tsx components/shell/AppShell.tsx components/settings/SettingsForm.tsx tests/unit/pwa-device.test.ts tests/e2e/pwa.spec.ts docs README.md
git commit -m "feat(pwa): guide iPhone users through adding the app to the Home Screen"
```

---

### Task 7: Release 0.3.0 and final verification

**Files:**
- Modify: `package.json`, `lib/roadmap.ts`, `tests/unit/roadmap.test.ts`, `CHANGELOG.md`, `README.md`, `docs/OPERATIONS.md`, `docs/DEBUGGING.md`, `docs/COMPONENTS/*` (final sweep)
- Docs: final `docs:check`

**Interfaces:**
- Consumes every earlier task. Produces: `APP_VERSION = "0.3.0"`, `package.json` version `0.3.0`, Today roadmap entry `version: "v0.4.0"`.

- [ ] **Step 1: Write the failing roadmap test change**

Update `tests/unit/roadmap.test.ts`: the promised entry is still exactly one and still `today`, but its version is `"v0.4.0"`; the `gateLabel` map expectation becomes `today: "Coming in v0.4.0"`. Run `npx vitest run tests/unit/roadmap.test.ts --maxWorkers=8` → FAIL against `APP_VERSION 0.2.1` / `v0.3.0`.

- [ ] **Step 2: Bump and release**

`package.json` → `"version": "0.3.0"`; `lib/roadmap.ts` → `APP_VERSION = "0.3.0"` and Today `version: "v0.4.0"`. Add the `## [0.3.0] - 2026-10-28` CHANGELOG section (installable/standalone, safe areas, offline read-only, install/update UX, version note that v0.2.1 shipped first); correct the `[Unreleased]` note; update README features/out-of-scope and the roadmap bullets that mention Today's version.

- [ ] **Step 3: Final docs sweep**

`npm run docs:check` → fix every reported gap. Re-check `docs/DEBUGGING.md` symptom table has rows for: install hint not showing, offline banner wrong, SW stale in production, safe-area clipping, offline shows wrong person's data. `docs/OPERATIONS.md` covers install/offline/update/icon generation.

- [ ] **Step 4: Full local gate**

Run, in order, from a clean tree:
`npm run docs:check` → `npm run lint` → `npm run typecheck` → `npx vitest run --maxWorkers=8` (CI if EPERM) → `npx playwright test tests/e2e/viewport-fit.spec.ts tests/e2e/mobile.spec.ts tests/e2e/shell.spec.ts tests/e2e/pwa.spec.ts` (CI if EPERM) → `npm run build && npm run test:pwa` (full-access or CI).
Expected: all PASS. Record any gate that had to run in CI in the task report; never claim a sandboxed Playwright pass.

- [ ] **Step 5: Commit and hand off the manual checklist**

```bash
git add package.json lib/roadmap.ts tests/unit/roadmap.test.ts CHANGELOG.md README.md docs
git commit -m "chore(release): v0.3.0 — installable app and offline reading"
```

Then run spec §11.4 on the owner's iPhone (install, status bar, notch/home indicator portrait+landscape, install hint, offline cold start, offline write refusal, reconnect, sign-out purge, update prompt, input zoom, keyboard/Save, VoiceOver, 320px). A failure there reopens the owning task; it is the only gate Playwright cannot cover.

---

## Self-review notes (kept with the plan)

- **Spec coverage:** §5→Task 1, §6→Task 2, §7→Task 4, §8→Tasks 3+5, §9→Tasks 4+6, §10→Tasks 4+5, §11→Tasks 1–7, §12→each task's docs step, §13→preconditions + Task 7, §14 risks→manual checklist and review focus, §15→Task 7's gates.
- **Deliberate test gap:** the real waiting-SW/deploy update path has no automated test (no deploy in a single Playwright run). It is covered by manual checklist item 11 and is listed in Review Focus 3.
- **Line references** in Tasks 1–6 are hints from the pre-v0.2.1 tree; the Execution preconditions require re-deriving anchors after the rebase.
