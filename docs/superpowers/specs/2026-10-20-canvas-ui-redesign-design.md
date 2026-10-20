# Canvas UI redesign â€” design spec

**Date:** 2026-10-20
**Status:** approved in conversation; awaiting written-spec review
**Scope:** visual + component redesign of Nailong Planner to match Canvas LMS (Instructure)
**Reference recon:** [`docs/redesign/canvas-recon.md`](../redesign/canvas-recon.md) â€” every token value below traces to that document, which cites `instructure/canvas-lms` and `instructure/instructure-ui` source paths.

---

## 1. Context and goal

Nailong Planner v0.1.0 is a private two-person calendar planner with a nested, shade-inheriting calendar hierarchy. Its current design is a warm cream/coral "cosy" language: rounded 12â€“24px surfaces, a coral accent, uppercase tracking-wide micro-labels, a 288px left sidebar.

The goal is to re-skin it so it reads unmistakably as Canvas LMS: dark slate icon rail, Instructure blue, Lato, flat 1px-bordered surfaces with 3/4/6px radii, regular-weight headings, dense enterprise layout. Canvas supplies the **visual language and chrome structure**, not the product model.

The chosen shell (approved 2026-10-20) is Canvas's **course-page layout**: dark rail + full-width breadcrumb bar + left course-nav panel + content. The calendar hierarchy stays on the left, so navigation does not change.

## 2. Success criteria

1. Opened side by side with Canvas, the app reads as the same design system: same blues, same greys, same type, same corner radii, same control heights.
2. Every existing behaviour is unchanged: nested calendars, shade inheritance, per-calendar visibility, view-only protection, drag/resize, recurrence, dialogs, toasts, two-person scoping.
3. `npm run lint`, `npm run typecheck`, `npm test` pass; `npm run test:e2e` passes after the two selector updates in Â§11.
4. Desktop screenshots (1440Ã—900) of `/login`, `/`, `/settings` and a 375Ã—812 phone screenshot are committed under `docs/screenshots/` and embedded in the README.

## 3. Non-goals

- No Canvas brand assets: no Canvas logomark, no "Canvas" wordmark, no Instructure fonts beyond Lato (SIL OFL).
- No new dependency on `@instructure/ui-*` or any component library. Tokens and patterns are reimplemented in Tailwind CSS 4 + Radix primitives already present.
- No Dashboard, course cards, assignments, grades, or any LMS feature.
- No dark mode. Canvas ships a dark global nav but no dark content theme; inventing one would be off-reference.
- No changes to the database schema, API routes, services, validation, auth, or recurrence logic.
- No change to the shape of the data or the colour model (shade counts, child-shade order, hue families).

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Canvas **course-page** shell: rail â†’ breadcrumb bar â†’ 224px course-nav panel â†’ content | User chose Option B over Canvas's Calendar-page layout (right panel). |
| D2 | Rail is 54px, `#334451`, white 26px line icons; active item = white tile with `#2B7ABC` icon | Canvas's real global nav metrics (`_ic_app_header.scss`); the 180px "expanded" figure is dead code. |
| D3 | Keep the app's existing **semantic token names** (`paper`, `surface`, `card`, `line`, `ink`, `accent`â€¦) and change their values | ~112 existing utility usages re-skin with no markup edits; new names added only for chrome and status. |
| D4 | **Two blues, never one**: `#2B7ABC` for fills/active, `#0E68B3` for links and link hover | Collapsing them is the most common fake-Canvas tell. |
| D5 | Radii collapse to 3px (legacy button) / 4px (InstUI button, input, card) / 6px (alert, popover) | The current 12â€“24px rounds are the loudest non-Canvas signal. |
| D6 | Headings are **weight 400**, h1/h2 28.8px, h3 24px | Canvas headings are not bold; bold 32â€“36px headings break the illusion. |
| D7 | Lato self-hosted via `next/font/local`, woff2 from `@fontsource/lato` | Canvas declares the stack; fonts must not come from a runtime CDN. |
| D8 | Icons are a hand-rolled inline SVG set, no icon package | Matches Canvas's filled 26px rail glyphs and 16px button glyphs; avoids a dependency. |
| D9 | Calendar events keep the **pale shaded fill** with ink text and gain a **3px saturated left bar** in the calendar's own colour | Solid fills fail AA on the mid shades: white needs fill luminance â‰¤0.183, ink needs â‰¥0.330, and the ramp's middle sits between. Pale fill + accent bar clears 4.5:1 on all 80 shade pairs while keeping all 8 shades distinguishable. |
| D10 | Group headings become sentence case: `Shared`, `Andrew`, `Sam` | Canvas never uses uppercase-tracked micro-labels. Requires two e2e selector updates (Â§11). |

## 5. Design tokens

Values are Canvas defaults verified in the recon. Sources are cited there by repo path; the mapping to InstUI primitives is `instui:packages/ui-themes/src/legacySharedThemeTokens/colors/primitives.ts`.

### 5.1 Colour

| Token | Value | Canvas role |
|---|---|---|
| `--color-paper` | `#ffffff` | page surface |
| `--color-surface` | `#ffffff` | sidebar, cards, popovers |
| `--color-card` | `#ffffff` | card |
| `--color-well` | `#f2f4f4` | secondary panel / well |
| `--color-line` | `#e8eaec` | dividers, grid lines |
| `--color-line-strong` | `#d7dade` | component strokes, outlined buttons |
| `--color-field` | `#8d959f` | input borders â€” darker than card borders |
| `--color-ink` | `#273540` | body text |
| `--color-ink-soft` | `#586874` | metadata |
| `--color-ink-mute` | `#6a7883` | labels, placeholders-adjacent |
| `--color-placeholder` | `#9ea6ad` | placeholder |
| `--color-accent` | `#2b7abc` | primary fill, active nav |
| `--color-accent-hover` | `#0e68b3` | primary hover |
| `--color-accent-press` | `#0a5a9e` | primary active |
| `--color-link` | `#0e68b3` | links, inline actions |
| `--color-info-soft` / `--color-info-ink` | `#e0ebf5` / `#334451` | info callout |
| `--color-rail` | `#334451` | global nav |
| `--color-rail-hover` | `#273540` | rail hover |
| `--color-rail-active-bg` | `#ffffff` | active rail tile |
| `--color-success` / `--color-success-ink` / `--color-success-soft` | `#03893d` / `#027634` / `#dceee4` | status |
| `--color-warning` / `--color-warning-ink` / `--color-warning-soft` | `#cf4a00` / `#b34000` / `#fce5d9` | status |
| `--color-danger` / `--color-danger-ink` / `--color-danger-soft` | `#e62429` / `#c71f23` / `#fce4e5` | status |
| `--color-scrim` | `#334451bf` | modal overlay |

### 5.2 Type

| Token | Value |
|---|---|
| `--font-sans` | `Lato, "Helvetica Neue", Helvetica, Arial, sans-serif` (`Lato` resolved through `next/font/local`) |
| `--font-mono` | `Menlo, Consolas, Monaco, "Andale Mono", monospace` |
| base | 16px / 1.5 / weight 400 |
| `--text-h1`, `--text-h2` | 1.8rem (28.8px), line-height 1.5, weight 400 |
| `--text-h3` | 1.5rem (24px), weight 400 |
| `--text-h4` | 1.125rem (18px), weight 400 |
| small | 0.875rem (14px) |
| micro-label | 0.75rem (12px), weight 700, **letter-spacing normal, no uppercase** |

### 5.3 Shape, depth, motion

| Token | Value |
|---|---|
| `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill` | `3px` / `4px` / `6px` / `9999px` |
| `--shadow-menu` | `0 3px 6px rgba(0,0,0,.1), 0 3px 6px rgba(0,0,0,.15)` |
| `--shadow-dialog` | `0 6px 7px rgba(0,0,0,.1), 0 10px 28px rgba(0,0,0,.25)` |
| `--shadow-flash` | `0 1px 8px rgba(0,0,0,.25)` |
| transition | `background-color .2s ease-in-out` for controls, `300ms ease-in-out` general |

No card shadows: 1px borders do the work, as in Canvas.

### 5.4 Layout

| Metric | Value | Canvas reference |
|---|---|---|
| rail width | 54px | `$ic-header-primary-width` âˆ’ 30 |
| rail icon | 26px | `_ic_app_header.scss` |
| rail logomark tile | 32px, 4px radius | adaptation of the 75px landomark slot |
| breadcrumb bar height | 72px, 1px `#e8eaec` bottom rule | `$ic-breadcrumbs-height` |
| breadcrumb text | 18px | `_breadcrumbs.scss` |
| course-nav panel | **224px** (deviation from 192px, D1) | `_ic_app_layout.scss` |
| content padding | 24px 36px 36px 36px desktop, 12px mobile | `36px 48px 48px` in Canvas, tightened for a single-pane app |
| phone rail | 56px dark top bar | adaptation |

## 6. Shell

**Desktop â‰¥ 1024px**

```
â”Œâ”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ rail â”‚ breadcrumb bar 72px                       â”‚
â”‚ 54px â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚      â”‚ course nav    â”‚ content (white)           â”‚
â”‚      â”‚ 224px         â”‚                           â”‚
â””â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- **Rail**: logomark tile (link to `/`) at the top; nav items Calendar (active) and Settings; spacer; 30px avatar with 2px white border at the bottom opening a menu with the member's name and sign-out. Each item is 54Ã—48, icon centred, label in a dark tooltip on hover/focus. The Settings item is an icon-only link carrying the accessible name `Settings` (this is the only Settings entry point in the chrome â€” `tests/e2e/settings.spec.ts` clicks it). Focus ring is Canvas's `inset 0 0 0 2px #6a7883, inset 0 0 0 4px #fff`.
- **Breadcrumb bar**: nav toggle (below 1024px only), `Calendar` crumb 18px `#273540`, then right-aligned: person pills. The primary `+ Event` action stays in the calendar toolbar on every viewport â€” as in Canvas, where the calendar owns its own create control. This keeps `AppShell` and `CalendarShell` decoupled (no lifted dialog state).
- **Course-nav panel**: white, 1px `#e8eaec` right border, headers (`Shared`, `Andrew`, `Sam`) at 12px/700 `#273540`, rows 32px tall: 16px checkbox, 10px colour swatch, 16px name, hover/focus-revealed 24px action menu (add sub-calendar, edit, delete). **No active-row fill**: the panel has no selected-calendar concept â€” the checkboxes are visibility filters, not a current location â€” so Canvas's active-nav treatment has no honest trigger and is deliberately omitted (ruled during execution; hover, focus-visible and menu-open each get distinct treatment instead). View-only rows get a lock icon and `#586874` text.
- **Content**: white, Toolbar + FullCalendar grid.

**Tablet 768â€“1023px**: rail stays, course nav collapses behind the breadcrumb-bar toggle (overlay panel, 224px, 4px radius, `shadow-menu`).

**Phone < 768px**: rail collapses into a 56px `#334451` top bar (mark + `Nailong Planner` + hamburger). Course nav opens as the existing bottom sheet, restyled (4px top radius, `shadow-dialog`, `Calendars` dialog label preserved). Content padding 12px; the agenda (list) view remains the default, as today.

## 7. Components

Every row is an implementation contract; sizes are CSS px at default zoom.

| Component | Spec |
|---|---|
| Button â€” primary | 38px tall, `0 12px`, 16px/400, 4px radius, bg `#2b7abc`, 1px border `#2468a2`, white text; hover/active bg `#0e68b3`; focus 2px white inset + 2px blue outer; disabled 50% opacity |
| Button â€” secondary | same box; bg `#f2f4f4`, 1px `#d7dade`, text `#273540`; hover bg `#e8eaec` |
| Button â€” ghost/icon | transparent, text `#273540`, hover bg `#f2f4f4`; icon 16px, gap 8px |
| Button â€” small | 28px tall, `0 8px`, 14px |
| Text input / select / textarea | 38px tall (textarea auto), padding 12px, 1px `#8d959f`, 4px radius, 16px; focus 2px `#2b7abc` outline (no glow); error 1px `#e62429` + `#e62429` message 14px; label 16px above; help 12px `#6a7883` |
| Checkbox | 16px, 4px radius, 1px `#8d959f`, checked bg `#2b7abc` white tick, label 16px with 8px gap |
| Pill | 24px tall, full radius, 1px `#d7dade`, `0 8px`, 14px |
| Avatar | 30px, 2px `#ffffff` border on rail; 36px in menus, 2px `#d3d9d9` |
| Menu / popover | white, 1px `#d7dade`, 4px radius, `shadow-menu`, items 16px/`10px 16px`, hover bg `#e8eaec`, selected bg `#e0ebf5` |
| Dialog | white, 4px radius, `shadow-dialog`, no border; header 24px padding, title 1.25rem/400; body 24px; footer right-aligned with 12px gap; scrim `#334451bf` |
| Flash / toast | white card, **2px** status border, 6px radius, `shadow-flash`, 36px solid status icon block flush left, `8px 16px 8px 52px` padding, max 512px, top-centre on desktop, top on mobile |
| Inline alert | 6px radius, `12px` padding, info `#e0ebf5`/`#334451`, success `#dceee4`/`#03893d`, warning `#fce5d9`/`#b34000`, danger `#fce4e5`/`#c71f23` |
| Tooltip | bg `#273540`, white 14px text, 3px radius, 6px padding, `shadow-menu` |
| Tabs | 48px row, 2px `#2b7abc` bottom indicator on the active tab, labels 16px |

**Icons** (`components/ui/icons.tsx`): `calendar`, `settings`, `plus`, `chevron-left`, `chevron-right`, `chevrons-left`, `chevrons-right`, `check`, `x`, `menu`, `trash`, `pencil`, `more-vertical`, `user`, `lock`, `eye`, `eye-off`, `alert-triangle`. Each is a 24Ã—24 viewBox path with `stroke="currentColor"`, `stroke-width="1.5"`, `fill="none"`, `stroke-linecap="round"`, sized via props (16/20/26). No emoji in the chrome.

## 8. Calendar view

- **Toolbar**: view switch as a segmented control (Month / Week / Day / List), prev / Today / next as bordered icon buttons, label as h2 28.8px/400 `#273540` positioned left, `+ Event` as the primary button on the right (all viewports).
- **Grid**: 1px `#e8eaec` cell borders, header row 36px with 14px/700 `#586874` day names, day numbers 14px `#586874` top-right, today's number in a 28px `#2b7abc` circle with white text, out-of-month days `#9ea6ad`.
- **Events**: 3px radius, 13px/400 ink text on the shade's pale container fill, a **3px left bar in the shade's saturated `main` colour**, 1px white gap between stacked events, `+N more` link in `#0e68b3`.
- **List/agenda**: Canvas table treatment â€” header `#e4e9ed`, row dividers `#e8eaec`, `14px 7px` cell padding, hover row `#e0ebf5`.
- FullCalendar is restyled through CSS variables in `app/globals.css` (`.fc` custom properties) and a small override file; no FullCalendar behavioural options change.

## 9. Colour system change

The shade model stays exactly as it is (10 hue families Ã— 8 shades, `PARENT_SHADE_INDEX = 3`, `CHILD_SHADE_ORDER = [4,2,5,1,6,0,7]`). Two additions to `lib/color/palette.ts`:

1. **Container lightness floor.** `containerLightness` becomes `clamp(lightness + CONTAINER_LIFT, 0.70, 0.97)` instead of `min(0.97, lightness + CONTAINER_LIFT)`. Without the floor the two darkest shades' containers fall into the contrast dead band (luminance 0.183â€“0.330) where neither white nor ink clears 4.5:1. A 0.68 floor is still too low â€” measured across all 80 pairs it leaves 30 below 4.5:1 (worst 4.2356); 0.70 is the smallest two-decimal floor that clears it (minimum 4.5753). With the floor every container is a pale tint and every `onContainer` is ink.
2. **Canvas text constants.** `DARK_TEXT` changes from the warm `#4a3f36` to `#273540`; `LIGHT_TEXT` becomes `#ffffff`. With the floor applied `onContainer` returns ink for all 80 shade pairs; `LIGHT_TEXT` stays as the dark-fill fallback.

`ShadeTokens.main` / `mainHex` are unchanged â€” they still drive swatches, dots, drag highlights and the new event left bar, so the hierarchy stays visible at full saturation.

`occurrenceToFcEvent` uses the container fill for **every** event (all-day and timed alike), sets `contrastColor` from `onContainer`, and passes the saturated colour through `extendedProps.accent` so the view can paint the left bar. FullCalendar 7 has no `borderColor` event property (it replaced `backgroundColor`/`borderColor`/`textColor` with `color` + `contrastColor`), so the bar is applied in `eventDidMount` by writing `el.style.borderLeftColor`.

## 10. Pages

**Login (`/login`)**: full-bleed `#334451`; a 400px white card, 4px radius, `shadow-dialog`, 32px padding, centred both axes; logomark tile above the card; title 1.5rem/400 `#273540`; inputs per Â§7; primary full-width button; secondary link in `#0e68b3`; error state uses `#e62429` with a 6px-radius `#fce4e5` alert. The page is the logomark plus the card only â€” there is no footer, because the app has no privacy or help routes.

**Settings (`/settings`)**: keeps a page `<h1>Settings</h1>` (e2e asserts this heading) and a breadcrumb bar reading `Settings`; two-column: 192px sub-nav (Profile, Household, Account) with active item `#e0ebf5` + 2px blue inset bar, then white cards 1px `#d7dade` 4px radius, each with a 24px/400 heading, 1px divider under it, and form rows using Â§7 field styles, spaced on the 12px grid. Destructive actions get danger styling.

## 11. Copy changes and test impact

| Change | Impact |
|---|---|
| Group headings `OURS` / `MINE Â· Andrew` / `PARTNER Â· X` â†’ `Shared` / `Andrew` / `X` | `tests/e2e/sidebar.spec.ts:13` asserts `/^PARTNER Â· .+/`; update to the new sentence-case heading |
| Header title block (`Nailong Planner` + `our nest`) â†’ breadcrumb `Calendar` | `tests/e2e/settings.spec.ts:11-12` expects link `Settings` and heading `Settings`; keep both accessible names on the new rail link and settings page heading |
| Emoji ðŸ‰ â†’ logomark tile showing the household's initial | No test depends on the emoji |
| `tests/e2e/sidebar.spec.ts` group-heading assertions updated to `Shared` / `Andrew` / `Partner` | Copy change is deliberate (Â§4 D10), so the assertion follows the copy |
| Mobile sheet keeps `aria-label="Calendars"` | `tests/e2e/mobile.spec.ts:22` keeps passing |
| Person pill labels stay driven by DB names | No code change; set `SEED_USER_2_NAME=Sam` to display "Sam" |

Any other e2e selector that breaks must be fixed by preserving the accessible name, not by loosening the assertion.

## 12. File change map

| Area | Files |
|---|---|
| Tokens, font, FullCalendar overrides | `app/globals.css`, `app/layout.tsx`, new `app/fonts/lato-*.woff2`, `components/calendar/fullcalendar-overrides.css` |
| Shell | `components/shell/AppShell.tsx`, `TopBar.tsx` â†’ `BreadcrumbBar.tsx`, new `GlobalNavRail.tsx`, `Brand.tsx` |
| Toasts | `app/providers.tsx` (Toaster position/classNames), new `components/ui/toast.tsx` (Canvas flash styles) |
| Course-nav panel | `components/sidebar/CalendarTree.tsx`, `CalendarRow.tsx`, `CalendarDialog.tsx`, `PersonPills.tsx` |
| Primitives | `components/ui/button.tsx`, `checkbox.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, new `icons.tsx` |
| Calendar | `components/calendar/CalendarShell.tsx` (layout only), `Toolbar.tsx`, `CalendarView.tsx`, `EventDialog.tsx`, `EventPopover.tsx` |
| Colour | `lib/color/palette.ts` (container lightness floor, retuned text constants), `components/calendar/toFcEvent.ts` (pale fill + `accent`) |
| Pages | `app/login/page.tsx`, `app/login/LoginForm.tsx`, `app/(app)/settings/page.tsx`, `components/settings/SettingsForm.tsx` |
| Docs | `README.md` (screenshots), `docs/screenshots/*` |

No file outside this map changes. `lib/db`, `lib/services`, `lib/api`, `lib/auth`, `lib/validation`, `lib/recurrence`, `lib/time`, `lib/query` and `drizzle/` are untouched.

## 13. Deliberate deviations from Canvas

| Deviation | Why |
|---|---|
| 224px course nav instead of 192px | Our rows carry a checkbox, a swatch and a hover menu; 192px truncates names |
| Person pills in the breadcrumb bar | No Canvas equivalent; preserves the two-person visibility feature |
| 24px/36px content padding instead of 36/48 | Single-pane app; the grid needs the width |
| Household initial in the logomark tile | The plan permits an inline SVG dragon or the household initial; the 32px tile renders the household name's initial, not the dragon emoji, and Canvas tenants brand the slot too |
| No Canvas brand assets | Legal and practical; the design language is what is being matched |
| Events fill at their shade colour | Canvas uses one colour per course; we have a hierarchy, so shade = colour |
| Events use a pale fill plus a saturated left bar rather than Canvas's solid block | Solid blocks cannot clear 4.5:1 across an 8-shade ramp (Â§9); the bar keeps the calendar's identity legible |

## 14. Verification

1. `npm run lint`, `npm run typecheck`, `npm test` â€” all green.
2. `npm run test:e2e` â€” green after the Â§11 selector updates; the mobile sheet and view-only flows are the risky ones.
3. Manual: desktop 1440Ã—900 and phone 375Ã—812 â€” create/edit/delete a calendar, create/edit a recurring event, drag a non-recurring event, toggle visibility, view a view-only calendar, sign in and out.
4. Accessibility: no contrast regressions (body `#273540`/white â‰ˆ 12.6:1, link `#0e68b3`/white â‰ˆ 5.7:1, white on `#2b7abc` â‰ˆ 4.55:1 â€” the last passes AA for normal text but has no margin, so never put body-size white text on blue other than button labels), focus visible on every interactive element, keyboard reachable rail and nav.
5. Screenshots re-captured with Playwright and committed; README embedded images updated.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `npm install @fontsource/lato` fails under the sandbox | Verified reachable when `npm_config_cache` points inside the workspace; the two woff2 files are copied into `app/fonts/` and the package stays a build-time source, removable afterwards |
| FullCalendar internals resist restyling | Only CSS variables and a scoped override sheet change; all handler logic in `CalendarShell.tsx` stays as is |
| Event text unreadable on pale or dark shades | Container lightness is floored at 0.70, and the unit test enumerates all 80 shade/text pairs against 4.5:1 |
| Palette change breaks the popover/accent contract | `container`/`onContainer` stay exported unchanged; only `DARK_TEXT` shifts to Canvas ink |
| Radii/typography changes break e2e layout assertions | E2E suites assert roles and text, not geometry; the mobile test checks the sheet is visible, not its radius |
| Scope creep into a Dashboard | Explicitly a non-goal; the rail has no Dashboard item |

## 16. Out of scope for this redesign

Reminders and notifications Â· Google Calendar sync / ICS Â· per-occurrence overrides Â· dark mode Â· PWA Â· tasks and notes modules Â· presence or multi-user beyond two Â· any change to the shade model, hue families, or calendar hierarchy rules.
