# Shell and sidebar

This area is the persistent application frame — the dark rail, breadcrumb bar, page frame and the calendar sidebar tree — plus the context that carries which calendars are currently drawn. Read it when a page has the wrong frame, a nav element does not route or highlight, calendar checkboxes/pills misbehave, or a calendar create/edit/delete dialog saves the wrong fields.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, add/move/delete its section and run `npm run docs:check`.

| File | Role |
|---|---|
| `components/shell/AppShell.tsx` | Viewport-locked frame: rail, breadcrumb, desktop sidebar, phone sheet |
| `components/shell/Brand.tsx` | Logomark tile (initial in a white square), optional name |
| `components/shell/BreadcrumbBar.tsx` | 72px header: household + route crumb, search, person pills |
| `components/shell/GlobalNavRail.tsx` | 54px dark rail: Calendar/Settings links, account menu, sign out |
| `components/shell/VisibilityProvider.tsx` | React context carrying the `VisibilityApi` to descendants |
| `components/sidebar/CalendarDialog.tsx` | Create/rename calendar form (owner, view-only, hue) |
| `components/sidebar/CalendarRow.tsx` | One sidebar calendar row: checkbox, swatch, shade strip, menu |
| `components/sidebar/CalendarTree.tsx` | Grouped calendar tree, CRUD wiring, delete confirmation |
| `components/sidebar/PersonPills.tsx` | Ours/me/partner cross-check toggle pills |
| `components/sidebar/SidebarMiniMonth.tsx` | Sidebar mini month with event dots and `/?date=` navigation |

## App shell

### components/shell/AppShell.tsx

**Purpose** — The application frame for every `app/(app)` route. It renders the nav rail, breadcrumb bar, one desktop sidebar, and a phone/tablet sheet that reuses the same calendar tree, inside a `h-dvh overflow-hidden` viewport lock.

**Public API** — `export interface MemberSummary { id: string; name: string; isSelf: boolean }`; `export function AppShell(props: Props)`. Props: `currentUser: { id; name }`, `members: MemberSummary[]`, `householdName: string`, `timezone: string`, `timeFormat: TimeFormat`, `children: React.ReactNode`. Route labels live in module scope: `ROUTE_CRUMBS` (`"/" → "Calendar"`, `"/settings" → "Settings"`) and `FALLBACK_CRUMB = "Calendar"`.

**State & side effects** — `usePathname()` for the crumb and rail highlight; `sidebarOpen` state for the sheet; `useVisibility(currentUser.id)` owns the visibility state (persisted under `localStorage` key `nailong.visibility.<userId>` by that hook); `VisibilityProvider` publishes it. No queries and no URL writes. The `CalendarTree` element is created once and rendered twice (desktop `aside` and the sheet), so both copies share the TanStack cache but have independent local dialog state. Focus is not trapped in the sheet.

**Depends on / Used by** — `next/link`, `next/navigation`, `components/sidebar/CalendarTree`, `components/sidebar/SidebarMiniMonth`, `components/ui/button`, `components/ui/icons`, `lib/services/preferences` (`TimeFormat`), `lib/ui/useVisibility`. Plus `./Brand`, `./BreadcrumbBar`, `./GlobalNavRail`, `./VisibilityProvider`. Rendered by `app/(app)/layout.tsx`, which resolves the session, members, household name/timezone and preferences.

**Debugging** —
- A new `(app)` route shows "Calendar" as its crumb -> `ROUTE_CRUMBS` has no entry and route-derived labels are the only mechanism -> add the path here.
- The document scrolls on a phone -> the `h-dvh overflow-hidden` frame or `min-h-0` on an inner flex child was dropped -> this file's top-level `div` and `main`.
- The sidebar sheet opens on desktop -> `lg:hidden` on the overlay wrapper was lost -> the `sidebarOpen` block.
- Calendar mutations from the sheet seem to reset -> two `CalendarTree` instances with separate `dialog`/`pendingDelete` state -> expected; the shared cache keeps data consistent.

**Tests** — `tests/e2e/shell.spec.ts`, `tests/e2e/mobile.spec.ts`, `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/sidebar.spec.ts`.

### components/shell/Brand.tsx

**Purpose** — The household logomark: a 32 px white tile containing the first letter of the name, optionally followed by the full name.

**Public API** — `export function Brand(props: { name: string; showName?: boolean; testId?: string; className?: string })`. `showName` defaults to `false`; falls back to `"N"` when the trimmed name is empty.

**State & side effects** — None. Server-compatible (no `"use client"`), no hooks, no queries. The tile is `aria-hidden`, so the accessible name comes from the surrounding link (`aria-label`/`title` in `GlobalNavRail`) or text.

**Depends on / Used by** — `lib/utils` (`cn`). Rendered by `GlobalNavRail` (rail logomark, `testId="rail-logomark"`) and `AppShell`'s phone top bar (`showName`).

**Debugging** —
- The rail logomark disappears -> the `name` prop became empty and the fallback was removed -> this file's `initial`.
- Screen readers announce only the letter -> expected: the tile is `aria-hidden`; the wrapping `Link` must carry the label -> `GlobalNavRail`.

**Tests** — `tests/e2e/shell.spec.ts` (rail logomark).

### components/shell/BreadcrumbBar.tsx

**Purpose** — The 72 px header: household name, a chevron and the current route crumb, plus search (inline on wide screens, dialog below `lg`) and the person pills.

**Public API** — `export function BreadcrumbBar(props: Props)`. Props: `householdName`, `crumb`, `visibility: VisibilityApi`, `me`, `partner`, `timezone`, `timeFormat: TimeFormat`, `onOpenSidebar()`. Renders `data-testid="breadcrumb-household"` and `data-testid="breadcrumb-crumb"`.

**State & side effects** — One state: `mobileSearchOpen`, which mounts a `Dialog` containing `SearchBox` with `inline autoFocus` and closes it via `onNavigate`. Search results themselves navigate with `router.push` inside `SearchBox`, not here. The household span is hidden below `sm`; the pills are hidden below 360 px (`min-[360px]:block`); the menu button only shows between `md` and `lg`.

**Depends on / Used by** — `components/calendar/SearchBox`, `components/sidebar/PersonPills`, `components/ui/button`, `components/ui/dialog`, `components/ui/icons`, `lib/services/preferences`, `lib/ui/useVisibility` (`VisibilityApi`). Rendered by `AppShell`.

**Debugging** —
- Search is missing at tablet width -> expected: the inline field is `lg`-only and the icon opens the dialog -> this file's two search branches.
- The household crumb vanishes on a phone -> `hidden … sm:block` -> intentional; only the crumb shows.
- Person pills overflow a 320 px viewport -> the `min-[360px]` guard was lowered -> this file's pills wrapper.

**Tests** — `tests/e2e/shell.spec.ts`, `tests/e2e/search.spec.ts`, `tests/e2e/viewport-fit.spec.ts`.

### components/shell/GlobalNavRail.tsx

**Purpose** — The dark 54 px rail on `md` and up: household logomark, Calendar and Settings links with tooltips, and an account menu that signs out.

**Public API** — `export function GlobalNavRail(props: { householdName: string; currentUser: { id: string; name: string } })`. Internal: `RAIL_FOCUS`, `RAIL_ITEM`, `RailTooltip`.

**State & side effects** — `usePathname()` decides `aria-current="page"` (`/` for Calendar, `/settings` or `/settings/*` for Settings); `signingOut` disables the trigger and the menu item. Sign out is a direct `fetch("/api/auth/sign-out", { method: "POST", … body: "{}" })` (not the Better Auth client); on `response.ok` it calls `router.replace("/login")` then `router.refresh()`; on failure it re-enables the button and toasts "Could not sign out. Try again.". The dropdown item calls `event.preventDefault()` to keep the menu mounted while pending. Tooltips appear on hover and `group-focus-within`, and are `aria-hidden`.

**Depends on / Used by** — `next/link`, `next/navigation`, `sonner`, `components/ui/dropdown-menu`, `components/ui/icons`, `lib/utils`, `./Brand`. Rendered by `AppShell`; hidden below `md`, where `AppShell`'s top bar replaces it.

**Debugging** —
- Sign out appears to succeed but the session survives -> `router.replace` ran without the POST succeeding -> check the `response.ok` branch and the `/api/auth/sign-out` route.
- The account menu closes immediately after clicking Sign out -> the `preventDefault` in `onSelect` was removed -> this file.
- Focus ring invisible on the white active tile -> the inset `RAIL_FOCUS` shadow was simplified to a plain outline -> this file.
- Rail shows on a phone -> `hidden … md:flex` changed -> this file's `nav`.

**Tests** — `tests/e2e/shell.spec.ts` (rail, focus ring, sign-out success/failure, tab order), `tests/e2e/auth.spec.ts`.

## Visibility context

### components/shell/VisibilityProvider.tsx

**Purpose** — A one-value React context that publishes the `VisibilityApi` (state + `setGroup`, `toggleCalendar`, `setCalendars`, `setOnly`) so the grid, sidebar and mini month read the same visibility state without prop drilling.

**Public API** — `export function VisibilityProvider(props: { value: VisibilityApi; children: React.ReactNode })` and `export function useVisibilityApi(): VisibilityApi`. The hook throws `"useVisibilityApi must be used inside VisibilityProvider"` when the context is missing.

**State & side effects** — None of its own: no state, effects, queries, storage or URL params. The state lives in `useVisibility` (called by `AppShell`); this file only distributes it. Its meaning is defined elsewhere: `lib/ui/visibility.ts` owns `VisibilityState`, `GroupKey`, `GROUP_ORDER`, `DEFAULT_VISIBILITY`, `groupOf` and `isCalendarVisible`, and `lib/ui/visibleCalendars.ts` owns `visibleCalendarIds`, the single implementation used by `CalendarShell` and `SidebarMiniMonth` so the grid and sidebar dots cannot disagree.

**Depends on / Used by** — `react` (`createContext`, `useContext`) and `lib/ui/useVisibility` (`VisibilityApi`). Provided by `AppShell`; consumed by `CalendarShell`, `SidebarMiniMonth` and, indirectly via `AppShell` props, `CalendarTree`/`BreadcrumbBar`/`PersonPills` (they take the API as a prop, not from the context).

**Debugging** —
- "useVisibilityApi must be used inside VisibilityProvider" -> a component was rendered outside the `(app)` layout (or in a story/test without the provider) -> this file / `AppShell`.
- Grid and sidebar mini month disagree about visible calendars -> one of them filters by hand instead of calling `visibleCalendarIds` -> `lib/ui/visibleCalendars.ts`.
- Toggling a pill leaves an isolated calendar showing -> `setOnly` is not cleared by `setOnly`; only `setGroup`/`toggleCalendar`/`setCalendars` clear it -> `lib/ui/useVisibility.ts`.

**Tests** — No direct test coverage of the provider; its semantics are covered by `tests/unit/visibility.test.ts`, `tests/unit/visibleCalendars.test.ts`, `tests/e2e/sidebar.spec.ts` and `tests/e2e/only-this-calendar.spec.ts`.

## Calendar sidebar

### components/sidebar/CalendarDialog.tsx

**Purpose** — The calendar create/rename dialog. Roots also get owner, view-only and colour controls; sub-calendars only get a name because they inherit colour and sharing.

**Public API** — `export type CalendarDialogState = { mode: "create-root" } | { mode: "create-child"; parentId: string } | { mode: "edit"; calendar: CalendarRow }`; `export interface CalendarDialogResult { name: string; hueFamily?: HueFamily; ownerId?: string | null; isViewOnlyForPartner?: boolean }`; `export function CalendarDialog(props: Props)`. Props: `state: CalendarDialogState | null`, `pending: boolean`, `currentUserId`, `currentUserName`, `onClose()`, `onSubmit(values: CalendarDialogResult)`. Returns `null` when `state` is null.

**State & side effects** — `CalendarForm` (internal, keyed by mode/parent/calendar id so switching targets remounts it) holds `name`, `hueFamily` (default `"teal"`), `ownerId` and `viewOnly`. The owner select only offers `"ours"` (→ `null`) and the current user — the partner cannot be assigned. The view-only checkbox is disabled and forced unticked unless the calendar belongs to the current user (`isMine`), and submit sends `isViewOnlyForPartner: isMine ? viewOnly : false`. Non-root submits send `hueFamily`/`ownerId`/`isViewOnlyForPartner` as `undefined`. Save is disabled while `pending` or the trimmed name is empty. No queries: mutation wiring is the caller's.

**Depends on / Used by** — `components/ui/button`, `components/ui/dialog`, `lib/color/palette` (`HUE_FAMILIES`, `PARENT_SHADE_INDEX`, `shadeTokens`), `lib/db/schema` (`CalendarRow`), `lib/utils`. Rendered by `CalendarTree` with `pending={createCalendar.isPending || updateCalendar.isPending}`.

**Debugging** —
- Editing a sub-calendar wipes its parent's colour/sharing -> a root-only field was submitted for a child -> `isRoot` in this file plus `CalendarTree.submit`'s `parentId === null` spread.
- "View only" cannot be ticked -> the calendar is shared or owned by the partner (`isMine` false) -> `ownerId`/`viewOnly` state here.
- The dialog keeps stale values after switching targets -> the `formKey` remount was removed -> this file.

**Tests** — `tests/e2e/sidebar.spec.ts`, `tests/e2e/viewonly.spec.ts`.

### components/sidebar/CalendarRow.tsx

**Purpose** — One row of the sidebar tree: visibility checkbox, colour swatch, name, optional view-only lock, a child-shade preview strip on roots, and an options menu.

**Public API** — `export function CalendarRow(props: Props)`. Props: `calendar: CalendarRow`, `checked`, `isChild`, `ownerHue: HueFamily`, `childShades: string[]`, `readOnly`, `showViewOnlyBadge`, `onlyId: string | null`, and callbacks `onToggle`, `onAddChild`, `onEdit`, `onDelete`, `onShowOnly`, `onShowAll`.

**State & side effects** — No state; the row is fully controlled. Colour swatch is `shadeTokens(ownerHue, isChild ? calendar.shadeIndex : PARENT_SHADE_INDEX)`, i.e. the family hue always comes from the parent. `isOnly` adds a `bg-well` highlight and swaps the menu entry to "Display all calendars". The menu omits "Add sub-calendar" for children and for read-only rows, and omits Edit/Delete when `readOnly`. The menu button is invisible until group hover/focus or `data-[state=open]`. Roots with children render a strip with `data-testid="shade-strip-<lowercased name>"` and decreasing opacity per shade.

**Depends on / Used by** — `components/ui/dropdown-menu`, `components/ui/checkbox`, `components/ui/icons`, `lib/color/palette`, `lib/db/schema`, `lib/utils`. Rendered by `CalendarTree` for roots and their children.

**Debugging** —
- The options menu is unreachable by keyboard -> the `group-focus-within:opacity-100` class was removed -> this file's `DropdownMenuTrigger`.
- A view-only row offers Edit/Delete -> the `readOnly` prop was computed without folding the parent's flags -> `CalendarTree.effectivePermission`.
- Sub-calendar dots all look identical -> `shadeIndex` is duplicated in the DB or `ownerHue` fell back to `"slate"` -> `hueOf` in `CalendarTree`.

**Tests** — `tests/e2e/sidebar.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`.

### components/sidebar/CalendarTree.tsx

**Purpose** — The sidebar calendar list: groups roots into Shared / me / partner, renders each root with its children, and wires create, rename, delete and "display only this calendar".

**Public API** — `export function CalendarTree(props: Props)`. Props: `visibility: VisibilityApi`, `currentUserId`, `currentUserName`, `partnerName`. Internal: `GROUP_LABEL`, `hueOf`, `Effective`, `effectivePermission`, `isReadOnlyFor`, `previewShades`.

**State & side effects** — Queries/mutations: `useCalendars()` (`["calendars"]`), `useCreateCalendar`, `useUpdateCalendar`, `useDeleteCalendar` (which also invalidates `["events"]`). Local: `dialog: CalendarDialogState | null` and `pendingDelete: CalendarRow | null`. Visibility writes go through `visibility.setCalendars(ids, visible)` (toggling a root also toggles its children in one call) and `visibility.setOnly(id | null)`. Grouping uses `groupOf`/`GROUP_ORDER`; effective permission folds the root's `ownerId`/`isViewOnlyForPartner` into every child (`Math.max`), so a protected parent protects its children. `previewShades` lists real child shades first, then fills to three from `CHILD_SHADE_ORDER`. Edit submits root-only fields only when `parentId === null`. Delete opens a Canvas confirmation (never `window.confirm`) whose text differs for roots vs children, then toasts `Deleted <name>`. A `role="status"` banner shows "Showing only <name>" with a "Show all" button. Loading and error states are inline text.

**Depends on / Used by** — `sonner`, `components/ui/button`, `components/ui/dialog`, `components/ui/icons`, `lib/color/palette`, `lib/db/schema`, `lib/services/calendars` (`CalendarNode`), `lib/query/calendars`, `lib/ui/visibility` (`GROUP_ORDER`, `groupOf`, `isCalendarVisible`), `lib/ui/useVisibility` (`VisibilityApi`), `./CalendarDialog`, `./CalendarRow`. Rendered by `AppShell` (desktop sidebar and phone sheet).

**Debugging** —
- A calendar is missing from the tree -> it is neither a root nor a direct child (only two levels are rendered) or its group bucket filtered it -> `GROUP_ORDER` filter in this file.
- Unticking a parent leaves children visible -> the toggle passed no children -> `onToggle={() => toggle(root, root.children)}`.
- Delete removes events from the grid but not the tree -> `["calendars"]` invalidation failed; `["events"]` is invalidated by the mutation -> `lib/query/calendars`.
- The partner sees Edit on a protected child -> `effectivePermission` was called without the root -> the child map in this file.

**Tests** — `tests/e2e/sidebar.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`, `tests/e2e/mobile.spec.ts`, `tests/e2e/viewonly.spec.ts`.

### components/sidebar/PersonPills.tsx

**Purpose** — The three cross-check pills (Ours / me / partner) that hide or show a whole ownership group at once.

**Public API** — `export function PersonPills(props: { visibility: VisibilityApi; me: string; partner: string })`.

**State & side effects** — No state. `aria-pressed` reflects `visibility.state.groups[group]`; clicking calls `visibility.setGroup(group, !on)`, which also clears `only` (touching a pill is how you leave an isolated view). The "on" look is the outline button's default fill; "off" drops to `bg-surface text-ink-soft`. Inside a `role="group"` labelled "Cross-check calendars".

**Depends on / Used by** — `components/ui/button`, `lib/ui/visibility` (`GroupKey`), `lib/ui/useVisibility` (`VisibilityApi`). Rendered by `BreadcrumbBar`.

**Debugging** —
- Clicking a pill does not change the grid -> the pill group is filtered out by `isCalendarVisible`'s `only` branch; `setGroup` must clear `only` -> `lib/ui/useVisibility.ts`.
- A pill looks permanently pressed -> `aria-pressed`/class condition inverted -> this file's `on` derivation.
- Pills show the wrong name -> `BreadcrumbBar` passed `me`/`partner` from `AppShell`'s `members` -> `AppShell`'s `partnerName` (`"Partner"` fallback).

**Tests** — `tests/e2e/sidebar.spec.ts`, `tests/e2e/shell.spec.ts` (tab order).

### components/sidebar/SidebarMiniMonth.tsx

**Purpose** — The sidebar mini month: neutral dots on days with visible events; clicking a day navigates with `/?date=…` so the grid jumps there.

**Public API** — `export function SidebarMiniMonth(props: { currentUserId: string; timezone: string })`. Internal helpers `pad`, `monthRange`.

**State & side effects** — Local `anchorDate` (today in the household zone) drives `monthRange`, which converts the month's local midnights to UTC bounds with `localWallTimeToUtc`. `useEvents(range)` fetches that month (`["events", from, to]`), `useVisibilityApi()` supplies the state, `visibleCalendarIds` filters events, and `expandOccurrences` expands series inside the range to build the `eventDates` set (all-day uses `occurrence.startKey`, timed uses the local date of `startAt`). Clicking pushes `/?date=<date>` with `router.push`; the grid's `?date=` effect does the navigation. No storage or mutations.

**Depends on / Used by** — `next/navigation`, `components/calendar/MiniMonth`, `components/shell/VisibilityProvider` (`useVisibilityApi`), `lib/query/calendars`, `lib/query/events`, `lib/recurrence/expand`, `lib/services/calendars`, `lib/time/zone`, `lib/ui/visibleCalendars`. Rendered by `AppShell` (desktop sidebar and phone sheet, so two instances share the events cache).

**Debugging** —
- Dots are missing for events that the grid shows -> the mini month queries only the shown month, so an event spanning the boundary can fall outside `range` -> `monthRange` / `expandOccurrences` range argument.
- Clicking a day does not move the grid -> `CalendarShell`'s `?date=` effect already handled that key, or the grid has no `calendarRef` yet -> `SidebarMiniMonth` push vs the shell's `handledLinkRef`.
- Dots appear for hidden calendars -> `visibleIds` was bypassed -> this file's filter.
- Two mini months disagree after toggling a calendar -> both read the same context; a stale render means the provider value was memoised incorrectly -> `AppShell`/`useVisibility`.

**Tests** — `tests/e2e/mini-month.spec.ts`, `tests/e2e/sidebar.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`.

## Focused verification
```bash
npx vitest run tests/unit/visibility.test.ts tests/unit/visibleCalendars.test.ts
npx playwright test tests/e2e/shell.spec.ts
npm run lint && npm run typecheck
```
