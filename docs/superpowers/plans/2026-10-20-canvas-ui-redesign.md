# Canvas UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin Nailong Planner's entire UI to Canvas LMS's visual language and course-page shell without changing a single behaviour, table, route, or service.

**Architecture:** Two layers. Layer 1 (Tasks 1–4) is foundation with no page markup: Tailwind CSS 4 `@theme` tokens holding Canvas values under the app's existing semantic names, self-hosted Lato via `next/font/local`, an inline SVG icon set, restyled UI primitives, and a contrast-aware solid event fill in the colour model. Layer 2 (Tasks 5–9) rebuilds each surface — shell, course-nav panel, calendar, login, settings — against those tokens and primitives. Tasks 10–11 capture screenshots and gate the branch.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4 (`@theme`, no config file), Radix primitives, FullCalendar 7.1.3, sonner, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-20-canvas-ui-redesign-design.md](../specs/2026-10-20-canvas-ui-redesign-design.md) — read §5 (tokens), §6 (shell), §7 (components), §9 (colour) before starting any task.

## Global Constraints

- Radii are **3px / 4px / 6px / pill only**. No 8px+ radius anywhere except the pill (`--radius-pill`).
- **Two blues, never one**: `#2b7abc` for fills/active state, `#0e68b3` for links and link-hover text. Never use `#0e68b3` as a button fill and never use `#2b7abc` for body-size link text.
- Type: Lato only, base 16px / 1.5 / weight 400. Headings are **weight 400** at 1.8rem (h1, h2), 1.5rem (h3), 1.125rem (h4).
- No uppercase + letter-spacing micro-labels anywhere. Labels are sentence case, 0.75rem, weight 700, `letter-spacing: normal`.
- **`--color-paper` becomes `#ffffff`.** Any existing `bg-paper` that was used to visually separate a panel from the page must become `bg-well` (`#f2f4f4`), or the separation disappears.
- No new runtime dependency except `@fontsource/lato` (devDependency, build-time source of woff2). No `@instructure/*`, no icon package, no additional Radix package.
- No Canvas or Instructure brand assets (no logomark, no wordmark). No emoji in the chrome.
- Preserve every accessible name the e2e suite relies on: labels `Email`, `Password`, `Name`, `Belongs to`, `View only for my partner`, `Account password`, `Verification code`, `Household name`; buttons `Save`, `Cancel`, `Save household`, `New calendar`, `Options for <name>`, `Open calendars`, `Close`, `/sign in/i`; menu items `Add sub-calendar`, `Calendar settings`; roles `checkbox` named after the calendar, `dialog` named `Calendars`; `data-testid` `shade-strip-<slug>` and `backup-codes`.
- Do not modify `app/api/**`, `lib/db/**`, `lib/services/**`, `lib/api/**`, `lib/auth/**`, `lib/validation/**`, `lib/recurrence/**`, `lib/time/**`, `lib/query/**`, `drizzle/**`, or `app/globals.css` outside Task 1.
- Commit after every task with a conventional commit message; do not rewrite history; do not touch `next-env.d.ts`.

## Review Focus

These are the failure modes the spec implies but no existing test exercises. Each line is pinned by a test step in the task named.

1. **Long calendar names** (40+ characters) in the 224px nav must truncate with an ellipsis and must not push the checkbox, swatch, or hover menu out of the row. → Task 6.
2. **A deep, wide calendar tree** (12+ calendars, 7 sub-calendars under one root) must scroll inside the nav panel; the page must never scroll horizontally. → Task 6.
3. **A 320px-wide viewport** (narrower than the 375px the suite tests today) must not overflow: rail-as-topbar, crumb, person pills and toolbar all have to fit. → Task 5.
4. **Shade 0 (lightness 0.86) and shade 7 (0.37) containers**, which are the event fills, must both clear 4.5:1 with the ink text at 13px — the lightness floor is what makes this true. → Task 4.
5. **Keyboard focus on the dark rail** (`#334451`) must be visible via the inset white/gray ring, and tab order must run rail → person pills → calendar nav → toolbar → grid (the pills live in the breadcrumb bar, which precedes the nav in the DOM; ruled during execution — the plan's original "rail → nav" order was wrong). → Task 5.

---

### Task 1: Canvas design tokens, self-hosted Lato, base styles

**Files:**
- Modify: `app/globals.css` (replace the whole `@theme` block and base layer)
- Modify: `app/layout.tsx` (load Lato through `next/font/local`)
- Create: `app/fonts/lato-400.woff2`, `app/fonts/lato-700.woff2`
- Modify: `package.json` (devDependency `@fontsource/lato`)
- Test: `tests/e2e/design-tokens.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: on `:root` — `--color-{paper,surface,card,well,line,line-strong,field,ink,ink-soft,ink-mute,placeholder,accent,accent-hover,accent-press,link,info-soft,info-ink,rail,rail-hover,rail-active-bg,success,success-ink,success-soft,warning,warning-ink,warning-soft,danger,danger-ink,danger-soft,scrim}` with the exact values from spec §5.1; `--font-sans`, `--font-mono`; `--radius-{sm,md,lg,card,pill}` = `3px,4px,6px,4px,9999px`; `--shadow-{menu,dialog,flash}`; `--text-h1..--text-h4`. `app/layout.tsx` sets the `--font-lato` variable that `--font-sans` reads.

- [ ] **Step 1: Write the failing test**

`tests/e2e/design-tokens.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test("Canvas tokens are applied on :root", async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name: string) => s.getPropertyValue(name).trim();
    return {
      ink: read("--color-ink"),
      accent: read("--color-accent"),
      link: read("--color-link"),
      rail: read("--color-rail"),
      field: read("--color-field"),
      radiusMd: read("--radius-md"),
    };
  });
  expect(tokens).toEqual({
    ink: "#273540",
    accent: "#2b7abc",
    link: "#0e68b3",
    rail: "#334451",
    field: "#8d959f",
    radiusMd: "4px",
  });
});

test("Lato is self-hosted and applied", async ({ page }) => {
  const woff2: string[] = [];
  page.on("response", (response) => {
    if (/\.woff2($|\?)/.test(response.url())) woff2.push(response.url());
  });
  await signIn(page, ANDREW, fixtures.password);
  await page.evaluate(() => document.fonts.ready);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).not.toContain("-apple-system");
  expect(woff2.length).toBeGreaterThan(0);
  const first = family.split(",")[0]!.replace(/["']/g, "").trim();
  expect(await page.evaluate((f) => document.fonts.check(`16px "${f}"`), first)).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/seed-test-db.mts; npx playwright test tests/e2e/design-tokens.spec.ts`
Expected: FAIL — `--color-ink` is empty and `fontFamily` contains `-apple-system`.

- [ ] **Step 3: Vendor Lato**

```powershell
npm install --save-dev @fontsource/lato --cache .\.superpowers\npm-cache
New-Item -ItemType Directory -Force app\fonts | Out-Null
Copy-Item node_modules\@fontsource\lato\files\lato-latin-400-normal.woff2 app\fonts\lato-400.woff2
Copy-Item node_modules\@fontsource\lato\files\lato-latin-700-normal.woff2 app\fonts\lato-700.woff2
```

The `--cache` flag is required: the default npm cache is outside the sandbox and fails with `EPERM`.

- [ ] **Step 4: Replace `app/globals.css`**

Keep `@import "tailwindcss";`. Replace the old `@theme` with the token block from spec §5.1–§5.3, using exactly these mappings (semantic name on the left, Canvas value on the right):

```
--color-paper #ffffff        --color-accent #2b7abc        --color-rail #334451
--color-surface #ffffff      --color-accent-hover #0e68b3  --color-rail-hover #273540
--color-card #ffffff         --color-accent-press #0a5a9e --color-rail-active-bg #ffffff
--color-well #f2f4f4         --color-link #0e68b3          --color-scrim #334451bf
--color-line #e8eaec         --color-info-soft #e0ebf5     --color-field #8d959f
--color-line-strong #d7dade  --color-info-ink #334451      --color-placeholder #9ea6ad
--color-ink #273540          --color-success #03893d       --color-success-ink #027634
--color-ink-soft #586874     --color-warning #cf4a00       --color-warning-ink #b34000
--color-ink-mute #6a7883     --color-danger #e62429        --color-danger-ink #c71f23
--color-success-soft #dceee4 --color-warning-soft #fce5d9  --color-danger-soft #fce4e5
```

Plus: `--font-sans: var(--font-lato), "Helvetica Neue", Helvetica, Arial, sans-serif;`, `--font-mono: Menlo, Consolas, Monaco, "Andale Mono", monospace;`, the four `--text-h*` pairs with `--line-height: 1.5`, `--radius-{sm:3px,md:4px,lg:6px,card:4px,pill:9999px}`, `--shadow-{menu,dialog,flash}` from spec §5.3, and `--ease-canvas: cubic-bezier(0,1,.5,1)`.

Base layer: `html { font-size: 100% }`, `body { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-sans); line-height: 1.5 }`, `h1,h2,h3,h4 { font-weight: 400; line-height: 1.5 }`, `h1{font-size:var(--text-h1)}` … `h4{font-size:var(--text-h4)}`, links `color: var(--color-link)`, `*:focus-visible { outline: 2px solid var(--color-link); outline-offset: 2px }`, keep the existing `prefers-reduced-motion` block. Delete the old accent/ink utility values that no longer exist — do not leave orphaned custom properties.

- [ ] **Step 5: Load Lato in `app/layout.tsx`**

```tsx
import localFont from "next/font/local";

const lato = localFont({
  src: [
    { path: "./fonts/lato-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lato-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
});
```

Add `className={`${lato.variable}`}` to `<html>` (keep `lang="en"`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test tests/e2e/design-tokens.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Prove the build still works**

Run: `npm run build`
Expected: exit 0, route table printed, no CSS parse errors.

- [ ] **Step 8: Commit**

```bash
git add app/globals.css app/layout.tsx app/fonts package.json package-lock.json tests/e2e/design-tokens.spec.ts
git commit -m "feat(ui): adopt Canvas design tokens and self-host Lato"
```

---

### Task 2: Inline SVG icon set

**Files:**
- Create: `components/ui/icons.tsx`
- Test: `tests/unit/icons.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface IconProps { size?: number; className?: string; title?: string }` and these named exports, each `(props: IconProps) => JSX.Element`: `CalendarIcon`, `SettingsIcon`, `PlusIcon`, `ChevronLeftIcon`, `ChevronRightIcon`, `ChevronsLeftIcon`, `ChevronsRightIcon`, `CheckIcon`, `XIcon`, `MenuIcon`, `TrashIcon`, `PencilIcon`, `MoreVerticalIcon`, `UserIcon`, `LockIcon`, `EyeIcon`, `EyeOffIcon`, `AlertTriangleIcon`.

- [ ] **Step 1: Write the failing test**

`tests/unit/icons.test.ts` (no JSX — the vitest include pattern is `*.test.ts`):

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarIcon, LockIcon, MoreVerticalIcon, XIcon } from "@/components/ui/icons";

describe("icon set", () => {
  it("renders a 1.5px currentColor stroke icon with no fill", () => {
    const html = renderToStaticMarkup(createElement(CalendarIcon));
    expect(html).toContain("<svg");
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('fill="none"');
  });

  it("defaults to 20px, is decorative, and honours size", () => {
    expect(renderToStaticMarkup(createElement(LockIcon))).toContain('width="20"');
    expect(renderToStaticMarkup(createElement(XIcon))).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(createElement(MoreVerticalIcon, { size: 26 }))).toContain('width="26"');
  });

  it("exposes an accessible name only when a title is given", () => {
    const withTitle = renderToStaticMarkup(createElement(XIcon, { title: "Close" }));
    expect(withTitle).toContain("<title>Close</title>");
    expect(withTitle).not.toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/unit/icons.test.ts`
Expected: FAIL — cannot resolve `@/components/ui/icons`.

- [ ] **Step 3: Implement `components/ui/icons.tsx`**

A shared `Svg` wrapper taking `{ size = 20, className, title, children }` that renders `<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} className={className}>{title ? <title>{title}</title> : null}{children}</svg>`. Then one exported function per glyph, each passing its `d` path(s). No `"use client"` — these are pure.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/icons.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui/icons.tsx tests/unit/icons.test.ts
git commit -m "feat(ui): add Canvas-style inline SVG icon set"
```

---

### Task 3: Restyle UI primitives

**Files:**
- Modify: `components/ui/button.tsx`, `components/ui/checkbox.tsx`, `components/ui/dialog.tsx`, `components/ui/dropdown-menu.tsx`
- Create: `components/ui/toast.tsx`
- Modify: `app/providers.tsx`
- Test: `tests/e2e/primitives.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1 tokens; Task 2 icons for the button/checkbox glyphs if needed.
- Produces: unchanged public API — `Button({ variant?: "primary"|"outline"|"ghost", size?: "sm"|"md" })` keeps its variant names (map `outline` → Canvas secondary, `ghost` → Canvas tertiary), `Checkbox`, `Dialog`/`DialogTrigger`/`DialogClose`/`DialogContent({ title, description?, children })`, the existing `DropdownMenu*` exports, and new `export const TOASTER_PROPS: ToasterProps` consumed by `app/providers.tsx`.

- [ ] **Step 1: Write the failing test**

`tests/e2e/primitives.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();
test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("primary button is 38px tall with a 4px radius and Canvas blue", async ({ page }) => {
  const button = page.getByTestId("new-event-button");
  const style = await button.evaluate((element) => {
    const s = getComputedStyle(element);
    return { height: s.height, radius: s.borderTopLeftRadius, background: s.backgroundColor, shadow: s.boxShadow };
  });
  expect(style).toEqual({ height: "38px", radius: "4px", background: "rgb(43, 122, 188)", shadow: "none" });
});

test("dialogs are square-cornered with the Canvas scrim", async ({ page }) => {
  await page.getByTestId("new-event-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const radius = await dialog.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  expect(radius).toBe("4px");
  const overlay = await page.getByTestId("dialog-overlay").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(overlay.startsWith("rgba(51, 68, 81")).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/primitives.spec.ts`
Expected: FAIL — `[data-testid="new-event-button"]` not found (added in Task 7); height is `auto`; radius is larger than 4px. **If the button testid does not exist yet, add `data-testid="new-event-button"` to the `onNewEvent` button in `components/calendar/Toolbar.tsx` as part of this task and note it in the commit.**

- [ ] **Step 3: Implement the primitives**

- `button.tsx`: primary = `bg-accent text-white border border-[#2468a2] hover:bg-accent-hover active:bg-accent-press`; outline (Canvas secondary) = `bg-well border border-line-strong text-ink hover:bg-line`; ghost = `text-ink hover:bg-well`. Sizes `md` = `h-[38px] px-3 text-base`, `sm` = `h-7 px-2 text-sm`. Shared: `rounded-md font-normal gap-2 transition-colors duration-200 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link`. No shadow.
- `checkbox.tsx`: 16px box, `rounded-[4px]`, `border-line`/border `#8d959f`, checked `bg-accent` with a white `CheckIcon` at 12px, label 16px with 8px gap.
- `dialog.tsx`: overlay `bg-scrim` with `data-testid="dialog-overlay"` and no blur; content `w-[min(28rem,92vw)] rounded-md bg-surface p-6 shadow-dialog outline-none`; title `text-xl font-normal text-ink` (20px); description `mt-1 text-sm text-ink-soft`; body `mt-5`.
- `dropdown-menu.tsx`: content `rounded-md border border-line-strong bg-surface shadow-menu p-1`, items `px-4 py-2.5 text-base text-ink rounded-sm hover:bg-line data-[highlighted]:bg-line`.
- `toast.tsx`: export `TOASTER_PROPS = { position: "top-center", closeButton: true, toastOptions: { classNames: { toast: "rounded-lg border-2 bg-surface shadow-flash text-ink", success: "border-success", error: "border-danger", warning: "border-warning", info: "border-line-strong" } } }` typed as the sonner `ToasterProps`.
- `app/providers.tsx`: replace `<Toaster position="bottom-right" richColors closeButton />` with `<Toaster {...TOASTER_PROPS} />`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test tests/e2e/primitives.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui app/providers.tsx components/calendar/Toolbar.tsx tests/e2e/primitives.spec.ts
git commit -m "feat(ui): restyle primitives to Canvas InstUI metrics"
```

---

### Task 4: Contrast-safe pale event fills with a saturated accent bar

**Files:**
- Modify: `lib/color/palette.ts`
- Modify: `components/calendar/toFcEvent.ts`
- Modify: `tests/unit/palette.test.ts`, `tests/unit/toFcEvent.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DARK_TEXT` becomes `"#273540"`, `LIGHT_TEXT` becomes `"#ffffff"`; `containerLightness` is floored at `0.70` so every `onContainer` is ink and clears 4.5:1 (0.68 was measured and still leaves 30 of 80 pairs below 4.5:1); `PlannerFcEvent["extendedProps"]` gains `accent: string`. `occurrenceToFcEvent` sets `color: event.color.containerHex` and `contrastColor: event.color.onContainer` for **every** event (all-day and timed), and `extendedProps.accent: event.color.mainHex`. The local `hexLuminance` heuristic is deleted. No new `ShadeTokens` field is added — `main`, `mainHex`, `container`, `containerHex` and `onContainer` keep their names.

- [ ] **Step 1: Write the failing tests**

Extend `tests/unit/palette.test.ts` with:

```ts
const linear = (hex: string, offset: number) => {
  const v = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * linear(hex, 1) + 0.7152 * linear(hex, 3) + 0.0722 * linear(hex, 5);
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

it("keeps every container pale enough for ink at 4.5:1", () => {
  for (const family of HUE_FAMILIES) {
    for (let shade = 0; shade < SHADE_COUNT; shade += 1) {
      const tokens = shadeTokens(family, shade);
      expect(tokens.onContainer).toBe("#273540");
      expect(ratio(tokens.containerHex, tokens.onContainer)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("floors container lightness so the darkest shades stay legible", () => {
  expect(shadeTokens("teal", 7).container).toBe("oklch(0.70 0.05 190)");
  expect(shadeTokens("teal", 0).container).toBe("oklch(0.97 0.05 190)");
});
```

Replace the existing `"uses dark ink on light containers and paper on dark ones"` test body with:

```ts
it("uses Canvas ink on every container", () => {
  expect(shadeTokens("rose", 0).onContainer).toBe("#273540");
  expect(shadeTokens("rose", 7).onContainer).toBe("#273540");
});
```

In `tests/unit/toFcEvent.test.ts`, replace the colour assertions with:

```ts
expect(allDayEvent.color).toBe(event.color.containerHex);
expect(allDayEvent.contrastColor).toBe(event.color.onContainer);
expect(allDayEvent.extendedProps.accent).toBe(event.color.mainHex);
expect(timedEvent.color).toBe(event.color.containerHex);
expect(timedEvent.extendedProps.accent).toBe(event.color.mainHex);
```

(Fixture values stay as they are; only the expected colour source changes.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/unit/palette.test.ts tests/unit/toFcEvent.test.ts`
Expected: FAIL — the container floor is missing (shade 7's `onContainer` is still `#ffffff` and its contrast is below 4.5:1) and `extendedProps.accent` is `undefined`.

- [ ] **Step 3: Implement the palette change**

In `lib/color/palette.ts`: change `DARK_TEXT` to `"#273540"` and `LIGHT_TEXT` to `"#ffffff"`; floor `containerLightness` with `Math.max(0.70, …)` inside the existing `Math.min(0.97, …)`. Leave `MAIN_LIGHTNESS`, `PARENT_SHADE_INDEX`, `CHILD_SHADE_ORDER`, `main`, `mainHex`, `container` chroma maths and `onContainer`'s threshold logic untouched.

In `toFcEvent.ts`: delete `hexLuminance`, add `accent: string` to `PlannerFcEvent["extendedProps"]`, and set the three colour fields exactly as the Interfaces block specifies.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -- tests/unit/palette.test.ts tests/unit/toFcEvent.test.ts`
Expected: PASS. If a shade fails the 4.5:1 assertion, raise the container floor above `0.70` — do not lower the assertion and do not change the assertion loop.

- [ ] **Step 5: Commit**

```bash
git add lib/color/palette.ts components/calendar/toFcEvent.ts tests/unit/palette.test.ts tests/unit/toFcEvent.test.ts
git commit -m "feat(calendar): pale Canvas event fills with a saturated accent bar"
```

---

### Task 5: Global nav rail, breadcrumb bar, AppShell

**Files:**
- Create: `components/shell/GlobalNavRail.tsx`, `components/shell/BreadcrumbBar.tsx`
- Modify: `components/shell/AppShell.tsx`, `components/shell/Brand.tsx`
- Delete: `components/shell/TopBar.tsx`
- Test: `tests/e2e/shell.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1 tokens, Task 2 icons, Task 3 `Button`.
- Produces:
  - `export function GlobalNavRail({ householdName, currentUser }: { householdName: string; currentUser: { id: string; name: string } })` — `<nav aria-label="Primary navigation">`, 54px wide, `#334451`, Calendar link (`href="/"`, `aria-current="page"` when on `/`) and Settings link (`href="/settings"`, `aria-label="Settings"`), label tooltips, 30px avatar menu at the bottom.
  - `export function BreadcrumbBar({ crumb, visibility, me, partner, onOpenSidebar }: { crumb: string; visibility: VisibilityApi; me: string; partner: string; onOpenSidebar: () => void })` — 72px, `<header>`, toggle button `aria-label="Open calendars"` below `lg`, crumb text at 18px, `PersonPills` on the right.
  - `AppShell` props unchanged (`currentUser`, `members`, `householdName`, `children`).

- [ ] **Step 1: Write the failing test**

`tests/e2e/shell.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();
test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the shell has a Canvas rail, breadcrumb bar and course nav", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await expect(page.getByRole("banner").getByText("Calendar", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Calendar list" })).toBeVisible();
  const railWidth = await rail.evaluate((el) => getComputedStyle(el).width);
  expect(railWidth).toBe("54px");
});

test("focus is visible on the dark rail", async ({ page }) => {
  // Tab until focus lands on the Settings link: programmatic .focus() does not
  // match :focus-visible, so the ring must be reached the way a keyboard user does.
  let reached = false;
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    const reach = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") === "Settings",
    );
    if (reach) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return { outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow };
  });
  expect(ring.outlineWidth !== "0px" || ring.boxShadow !== "none").toBe(true);
});

test("a 320px viewport does not scroll horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("long household names truncate instead of widening the rail", async ({ page }) => {
  const tile = page.getByTestId("rail-logomark");
  await expect(tile).toBeVisible();
  const railWidth = await page.getByRole("navigation", { name: "Primary navigation" }).evaluate(
    (el) => getComputedStyle(el).width,
  );
  expect(railWidth).toBe("54px");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/shell.spec.ts`
Expected: FAIL — no `Primary navigation` landmark exists yet.

- [ ] **Step 3: Implement the shell**

`GlobalNavRail.tsx`: `aside`-turned-`nav`, `w-[54px] shrink-0 bg-rail text-white`, vertical flex, logo tile (`data-testid="rail-logomark"`, 32px, `rounded-[4px] bg-white`, dragon mark inside at 18px — a small inline SVG dragon or the household initial, no emoji font dependency), nav items `h-12 w-[54px] grid place-items-center` with `hover:bg-rail-hover`, active = `bg-white text-accent` tile, tooltip via `title` attribute plus a CSS tooltip on hover/focus (`group`/`group-hover`), focus ring `focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white`. Avatar 30px `border-2 border-white` at the bottom wrapped in a Radix dropdown menu with the member name and a `Sign out` item that POSTs to the existing sign-out endpoint used by the current `TopBar`.

`BreadcrumbBar.tsx`: `<header>` with `h-[72px] border-b border-line flex items-center gap-3 px-6`, toggle button (`lg:hidden`, `aria-label="Open calendars"`), crumb `<span className="text-[18px] text-ink">{crumb}</span>`, `ml-auto` `PersonPills`. Add `data-testid="breadcrumb-crumb"` if the exact-text assertion is ambiguous.

`AppShell.tsx`: render `<GlobalNavRail/>`, then a column with `<BreadcrumbBar crumb="Calendar"/>` and `<main className="min-w-0 flex-1 overflow-x-hidden bg-surface p-6">{children}</main>`. **Keep the calendar-tree container scrollable**: the wrapping `nav` keeps `aria-label="Calendar list"` and `min-h-0 flex-1 overflow-y-auto` so a deep tree scrolls inside the panel instead of stretching the page. Keep the mobile sheet block with `role="dialog"` label `Calendars`, the `Close` button, and the `Calendar list` nav label. The Settings page must pass `crumb="Settings"` — add an optional `crumb` prop to `AppShell` defaulting to `"Calendar"` and have `app/(app)/settings/page.tsx` pass `"Settings"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/shell.spec.ts tests/e2e/mobile.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/shell app/"(app)"/settings/page.tsx tests/e2e/shell.spec.ts
git commit -m "feat(shell): Canvas global nav rail and breadcrumb bar"
```

---

### Task 6: Course-nav panel

**Files:**
- Modify: `components/sidebar/CalendarTree.tsx`, `components/sidebar/CalendarRow.tsx`, `components/sidebar/PersonPills.tsx`, `components/sidebar/CalendarDialog.tsx`
- Modify: `tests/e2e/sidebar.spec.ts`

**Interfaces:**
- Consumes: Task 1 tokens, Task 2 icons, Task 3 primitives.
- Produces: unchanged component props. New copy for group headings — `Shared`, `Andrew`, `<partner first name>` (sentence case, no uppercase transform). Preserves `data-testid="shade-strip-<slug>"` on the parent row's three-swatch preview.

- [ ] **Step 1: Write the failing tests**

In `tests/e2e/sidebar.spec.ts`, replace lines 10–16 with:

```ts
test("the sidebar shows the household groups", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Calendar list" });
  await expect(nav.getByText("Shared", { exact: true })).toBeVisible();
  await expect(nav.getByText("Andrew", { exact: true })).toBeVisible();
  await expect(nav.getByText("Partner", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "School" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Math" })).toBeVisible();
});
```

Add these two tests to the same file:

```ts
test("long calendar names truncate inside the nav", async ({ page }) => {
  await page.getByRole("button", { name: "New calendar" }).click();
  const long = "Community volunteering and neighbourhood outreach";
  await page.getByLabel("Name").fill(long);
  await page.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("checkbox", { name: long });
  await expect(row).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Calendar list" });
  expect(await nav.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test("the nav panel scrolls instead of pushing the page wide", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Calendar list" });
  const overflow = await nav.evaluate((el) => getComputedStyle(el).overflowY);
  expect(["auto", "scroll"]).toContain(overflow);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx scripts/seed-test-db.mts; npx playwright test tests/e2e/sidebar.spec.ts`
Expected: FAIL — headings are `OURS` / `MINE · ANDREW` / `PARTNER · PARTNER`.

- [ ] **Step 3: Implement the panel**

`CalendarTree.tsx`: drop the `uppercase tracking-[…]` classes; headers `px-3 pt-3 pb-1 text-xs font-bold text-ink`; rows in a `w-[224px]` column with `overflow-y-auto`; the "New" control becomes `text-link text-sm` with a `PlusIcon` at 16px, accessible name stays `New calendar`; keep `aria-label="Calendar list"` on the wrapping `nav` (currently in `AppShell`).

`CalendarRow.tsx`: row `h-8 flex items-center gap-2 px-3 rounded-sm text-sm text-ink`, hover `bg-well`, checked/hover actions revealed with `group-hover` and `focus-within`, active row `bg-info-soft shadow-[inset_2px_0_0_var(--color-accent)]`, `min-w-0` + `truncate` on the name span so long names ellipsis, 10px swatch `rounded-[2px]`, actions button `aria-label="Options for <name>"` (unchanged) using `MoreVerticalIcon` at 16px. View-only rows: `LockIcon` 14px + `text-ink-soft`.

`PersonPills.tsx`: Canvas pills — `h-6 rounded-full border border-line-strong bg-surface px-2 text-sm font-normal`, accessible names unchanged (`Andrew`, partner name, `Ours`).

`CalendarDialog.tsx`: keeps labels and buttons; restyle field stack to spec §7 (label 16px above, 38px control, help 12px `text-ink-mute`) and the footer to right-aligned `Cancel` / `Save`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/sidebar.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add components/sidebar tests/e2e/sidebar.spec.ts
git commit -m "feat(sidebar): Canvas course-nav panel and sentence-case groups"
```

---

### Task 7: Calendar surface

**Files:**
- Modify: `components/calendar/Toolbar.tsx`, `components/calendar/CalendarView.tsx`, `components/calendar/CalendarShell.tsx`, `components/calendar/EventDialog.tsx`, `components/calendar/EventPopover.tsx`
- Create: `components/calendar/fullcalendar-overrides.css`
- Test: `tests/e2e/calendar-style.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1 tokens, Task 2 icons, Task 3 primitives, Task 4 `extendedProps.accent`.
- Produces: `Toolbar` keeps its props (`label`, `view`, `onViewChange`, `onPrev`, `onToday`, `onNext`, `onNewEvent`) and the `data-testid="new-event-button"` created in Task 3. `CalendarView` imports `./fullcalendar-overrides.css` and gains an `eventDidMount` that writes `info.el.style.borderLeftColor = String(info.event.extendedProps.accent ?? "transparent")` — FullCalendar 7 has no `borderColor` event property. No handler in `CalendarShell.tsx` changes.

- [ ] **Step 1: Write the failing test**

`tests/e2e/calendar-style.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();
test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the grid uses Canvas hairlines and a blue today badge", async ({ page }) => {
  await expect(page.getByText("Weekly class").first()).toBeVisible();
  const cellBorder = await page.locator(".fc-daygrid-day").first().evaluate(
    (el) => getComputedStyle(el).borderRightColor,
  );
  expect(cellBorder).toBe("rgb(232, 234, 236)");
  const today = page.locator(".fc-day-today .fc-daygrid-day-number");
  await expect(today).toBeVisible();
  expect(await today.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(43, 122, 188)");
});

test("events carry a saturated left bar over the pale container fill", async ({ page }) => {
  const event = page.locator(".fc-event").filter({ hasText: "Weekly class" }).first();
  await expect(event).toBeVisible();
  const style = await event.evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, barWidth: s.borderLeftWidth, barColor: s.borderLeftColor };
  });
  expect(style.background).toMatch(/^rgb\(/);
  expect(style.barWidth).toBe("3px");
  expect(style.barColor).toMatch(/^rgb\(/);
  expect(style.barColor).not.toBe(style.background);
});

test("the view switch is a segmented control with the active segment marked", async ({ page }) => {
  const month = page.getByRole("button", { name: "Month" });
  await expect(month).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Week" }).click();
  await expect(page.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/calendar-style.spec.ts`
Expected: FAIL — no today badge colour, no `aria-pressed` on the view switch.

- [ ] **Step 3: Implement the calendar surface**

`Toolbar.tsx`: title h2 (`text-[1.8rem] font-normal text-ink`), view switch as a `role="group"` of four buttons with `aria-pressed`, segmented styling (`border border-line-strong`, first/last `rounded-l-md`/`rounded-r-md`, active `bg-accent text-white`), prev/next as 38px outlined icon buttons with `ChevronLeftIcon`/`ChevronRightIcon` and `aria-label="Previous"/"Next"`, Today as an outlined button, `+ Event` as primary with `data-testid="new-event-button"`.

`fullcalendar-overrides.css`: target `.fc` custom properties — `--fc-border-color: #e8eaec`, `--fc-today-bg-color: transparent`, `--fc-page-bg-color: #fff`, `--fc-neutral-bg-color: #f2f4f4`, `--fc-event-border-color: transparent`, `--fc-event-text-color: var(--color-ink)`, `--fc-list-event-hover-bg-color: #e0ebf5`, `--fc-button-*` radii 4px and no shadow, `.fc-col-header-cell` 36px/14px/700 `#586874`, `.fc-daygrid-day-number` 14px `#586874` with `.fc-day-today` number rendered as a 28px `#2b7abc` circle with white text (use `width/height/border-radius/display:grid` on the anchor), out-of-month `#9ea6ad`, `.fc-event` `border-radius:3px; font-size:13px; border:0; border-left-width:3px; border-left-style:solid` (colour comes from `eventDidMount`), `.fc-timegrid-slot-label` 12px `#586874`, `.fc-list-table` Canvas table treatment (header `#e4e9ed`, `14px 7px` cells, row dividers `#e8eaec`, hover `#e0ebf5`).

`CalendarView.tsx`: import the override sheet after the FullCalendar styles. `EventPopover.tsx`: `rounded-md border border-line-strong bg-surface shadow-menu p-4`, title `text-base font-normal`, when/metadata `text-sm text-ink-soft`, read-only note `bg-well rounded-md`, buttons `sm`. `EventDialog.tsx`: fields per spec §7, two-column time row on `sm+`, footer right-aligned `Cancel` (secondary) / `Save` (primary). `CalendarShell.tsx`: only class changes on the wrapping `<section>` (none required beyond spacing) — no logic edits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/calendar-style.spec.ts tests/e2e/events.spec.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add components/calendar tests/e2e/calendar-style.spec.ts
git commit -m "feat(calendar): Canvas grid, segmented view switch and solid events"
```

---

### Task 8: Login page

**Files:**
- Modify: `app/login/page.tsx`, `app/login/LoginForm.tsx`
- Test: existing `tests/e2e/auth.spec.ts` (no new file)

**Interfaces:**
- Consumes: Task 1 tokens, Task 2 icons, Task 3 primitives.
- Produces: no API change. Must keep `getByLabel("Email")`, `getByLabel("Password")`, `getByRole("button", { name: /sign in/i })`, and the existing error rendering.

- [ ] **Step 1: Run the existing test to establish the baseline**

Run: `npx playwright test tests/e2e/auth.spec.ts`
Expected: PASS (this is the regression guard; it must still pass at Step 4).

- [ ] **Step 2: Implement the Canvas login**

Full-bleed `bg-rail` page, centred 400px white card (`rounded-md p-8 shadow-dialog`), logomark tile above the card (same treatment as the rail), `<h1 className="text-2xl font-normal">` with the app name, inputs per spec §7, full-width primary submit, inline error as a 6px-radius alert (`bg-danger-soft text-danger-ink border border-danger`), footer links in white on the dark background with `hover:underline`.

- [ ] **Step 3: Run the test to verify it still passes**

Run: `npx playwright test tests/e2e/auth.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/login
git commit -m "feat(login): Canvas login page"
```

---

### Task 9: Settings page

**Files:**
- Modify: `app/(app)/settings/page.tsx`, `components/settings/SettingsForm.tsx`
- Test: existing `tests/e2e/settings.spec.ts` (no new file)

**Interfaces:**
- Consumes: Task 1 tokens, Task 2 icons, Task 3 primitives.
- Produces: unchanged props and labels. New structure: `<h1>Settings</h1>` page heading (e2e asserts it), 192px sub-nav (Profile, Household, Account), white cards with 24px/400 section headings, dividers, form rows.

- [ ] **Step 1: Run the existing test to establish the baseline**

Run: `npx playwright test tests/e2e/settings.spec.ts`
Expected: PASS.

- [ ] **Step 2: Implement the Canvas settings layout**

Sub-nav items are anchors to `#profile`, `#household`, `#account` with the active item `bg-info-soft shadow-[inset_2px_0_0_var(--color-accent)]`; cards `rounded-md border border-line-strong bg-surface p-6`; section headings `text-2xl font-normal` inside the card with a `border-b border-line` rule under them; keep every existing label, button name, and `data-testid="backup-codes"` exactly.

- [ ] **Step 3: Run the test to verify it still passes**

Run: `npx playwright test tests/e2e/settings.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add app/"(app)"/settings components/settings
git commit -m "feat(settings): Canvas settings layout"
```

---

### Task 10: Screenshots and README

**Files:**
- Modify: `tests/e2e/screenshot.spec.ts`
- Modify: `README.md`
- Regenerate: `docs/screenshots/calendar-desktop.png`, `docs/screenshots/calendar-mobile.png`
- Create: `docs/screenshots/login.png`, `docs/screenshots/settings.png`

**Interfaces:**
- Consumes: every prior task.
- Produces: four committed PNGs referenced by the README.

- [ ] **Step 1: Extend the screenshot spec**

Add a desktop 1440×900 test capturing `/` to `docs/screenshots/calendar-desktop.png` (replace the existing 1280×820 viewport), a `docs/screenshots/settings.png` capture, and a `docs/screenshots/login.png` capture taken before signing in; keep the phone test at 375×812 writing `calendar-mobile.png`. All remain behind the existing `CAPTURE_SCREENSHOTS !== "1"` skip.

- [ ] **Step 2: Capture**

Run: `$env:CAPTURE_SCREENSHOTS="1"; npx tsx scripts/seed-test-db.mts; npx playwright test tests/e2e/screenshot.spec.ts; Remove-Item Env:CAPTURE_SCREENSHOTS`
Expected: PASS, four PNGs rewritten.

- [ ] **Step 3: Read the PNGs back and confirm they show the Canvas shell**

Open each of the four images. Confirm: dark rail present, breadcrumb bar, left course-nav with `Shared`/`Andrew`/`Partner`, solid event fills, no rounded-3xl anything, no uppercase-tracked headings, and that no text is clipped. If not, fix the offending task before committing.

- [ ] **Step 4: Update the README**

Replace the screenshot section: keep the desktop month-view image and the phone `<details>` block, add the settings image, and update the intro sentence to describe the Canvas-based interface. Do not change the stack, quickstart, or out-of-scope sections except to add `@fontsource/lato` provenance to the stack list.

- [ ] **Step 5: Commit**

```bash
git add docs/screenshots README.md tests/e2e/screenshot.spec.ts
git commit -m "docs: refresh screenshots for the Canvas redesign"
```

---

### Task 11: Verification gate

**Files:** none modified.

- [ ] **Step 1: Lint and typecheck**

Run: `npm run lint; npm run typecheck`
Expected: exit 0, no warnings introduced.

- [ ] **Step 2: Unit and integration suite**

Run: `npm test`
Expected: exit 0, 0 failures.

- [ ] **Step 3: Full e2e suite**

Run: `npm run test:e2e`
Expected: exit 0, all specs pass. Investigate any failure — do not skip or loosen an assertion to make it pass; fix the UI or update the selector to the new accessible name.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Manual pass (record the result in the PR/commit message)**

At 1440×900 and 375×812: sign in; create, edit and delete a calendar; add a sub-calendar; toggle visibility; mark a calendar view-only and confirm the lock and read-only popover; create a recurring event; drag a non-recurring event; switch Month/Week/Day/List; open and close the mobile sheet. Then tab through the page and confirm every control shows a visible focus ring, including the rail.

- [ ] **Step 6: Commit any fixes, then report**

```bash
git status --short
git log --oneline feat/v0.1.0..HEAD
```
Report the command outputs for Steps 1–4 verbatim. No completion claim without them.
