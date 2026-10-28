# Shell and sidebar

This area is the persistent application frame — the dark rail, breadcrumb bar, page frame and the mixed collection sidebar tree — plus the context that carries which collections are currently drawn. Read it when a page has the wrong frame, a nav element does not route or highlight, collection checkboxes/pills misbehave, a calendar/list row shows the wrong kind marker or lock, or a collection create/edit/delete dialog saves the wrong fields.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, add/move/delete its section and run `npm run docs:check`.

| File | Role |
|---|---|
| `components/shell/AppShell.tsx` | Viewport-locked frame: rail, breadcrumb, desktop sidebar, phone sheet, global capture |
| `components/shell/Brand.tsx` | Logomark tile (initial in a white square), optional name |
| `components/shell/BreadcrumbBar.tsx` | 72px header: household + route crumb, search, person pills |
| `components/shell/ComingSoonDialog.tsx` | "What's coming" dialog behind a gated roadmap destination |
| `components/shell/GlobalCapture.tsx` | `Shift+K` quick-capture dialog that files a task in the Inbox from any page |
| `components/shell/GlobalNavRail.tsx` | 54px dark rail: live destinations, greyed roadmap icons, account menu |
| `components/shell/VisibilityProvider.tsx` | React context carrying the `VisibilityApi` to descendants |
| `components/sidebar/CollectionDialog.tsx` | Create/rename collection form (kind, owner, visibility, hue) |
| `components/sidebar/CollectionRow.tsx` | One sidebar collection row: checkbox, calendar swatch or list glyph, shades, lock, menu |
| `components/sidebar/CollectionTree.tsx` | Grouped mixed calendar/list tree, New menu, CRUD and visibility wiring |
| `components/sidebar/PersonPills.tsx` | Ours/me/partner cross-check toggle pills |
| `components/sidebar/SidebarMiniMonth.tsx` | Sidebar mini month with event dots, `/?date=` navigation and the task-row drop target |

## App shell

### components/shell/AppShell.tsx

**Safe areas (v0.3.0)** — the phone top bar is a `bg-rail` wrapper with `safe-pt` around the 56px row (the rail paints behind the status bar); `main` uses `safe-x` plus bottom `calc(padding + var(--safe-bottom))`; the Collections sheet uses `safe-x-4`/`safe-pb-4` and `75dvh`. All insets are 0 under Playwright, so the shell and viewport specs keep their exact geometry. It also mounts `ServiceWorkerRegistrar` (production-only SW registration and update detection) and `UpdatePill` (the phone top-bar update action); see `pwa.md`.

**Purpose** — The application frame for every `app/(app)` route. It renders the nav rail, breadcrumb bar, one desktop sidebar, and a phone/tablet sheet that reuses the same collection tree, inside a `h-dvh overflow-hidden` viewport lock. The landmarks name the mixed tree, not just calendars: the tree is a `nav` labelled `Collection tree`, the sheet is a `dialog` labelled `Collections`, and its controls are `Open collections` / `Close collections`. Both mini-month copies are also task-row drop targets, which is how a row dragged on `/tasks` gets its due date moved to that day.

**Public API** — `export interface MemberSummary { id: string; name: string; isSelf: boolean }`; `export function AppShell(props: Props)`. Props: `currentUser: { id; name }`, `members: MemberSummary[]`, `householdName: string`, `timezone: string`, `preferences: UserPreferences` (the server snapshot read by `app/(app)/layout.tsx`; `timeFormat` for the header and the initial data for `GlobalCapture` come from it), `children: React.ReactNode`. Route labels live in module scope: `ROUTE_CRUMBS`, built from `LIVE_ENTRIES` in `lib/roadmap.ts`, and `FALLBACK_CRUMB = "Calendar"`.

**State & side effects** — `usePathname()` for the crumb and rail highlight; `sidebarOpen` state for the sheet; `comingSoon: RoadmapEntry | null` plus a `comingSoonTrigger` ref drive the shared "what's coming" dialog — the rail and the phone drawer both call `openComingSoon(entry, trigger)`, and `closeComingSoon` restores focus to that trigger once the dialog has unmounted; `useVisibility(currentUser.id)` owns the visibility state (persisted under `localStorage` key `nailong.visibility.<userId>` by that hook); `useTreeFold(currentUser.id)` owns the sidebar's fold state (persisted under `nailong.treeFold.<userId>`) and is passed to both tree copies as `fold`, so folding moves them in lockstep; `VisibilityProvider` publishes the visibility API. **Task drop:** `planTaskDrop = useTaskPlanDrop()` is passed as `onTaskDrop` to both `SidebarMiniMonth` instances. The hook starts no query and reads no cache: the dragged row stamps `{ id, dueOn }` into the payload at `dragstart` (`lib/ui/taskDrag.ts`), so a drop PATCHes `dueOn` (keeping any stored `dueTime`) through the optimistic `useUpdateTask` and the targeted `Due date set` toast's Undo restores the date the row showed. No URL writes. The `CollectionTree` element is created once and rendered twice (desktop `aside` and the sheet), so both copies share the TanStack cache and the fold state but have independent local dialog state. `<GlobalCapture initialPreferences={preferences} />` is mounted once at the end of the frame, so the global `Shift+K` gesture exists on every signed-in page; the component seeds `usePreferences` with this snapshot and gates itself on the live `shortcutsEnabled` value. Focus is not trapped in the sidebar sheet (the global capture dialog does trap focus while it is open).

**Depends on / Used by** — `next/link`, `next/navigation`, `components/sidebar/CollectionTree`, `components/sidebar/SidebarMiniMonth`, `components/ui/button`, `components/ui/icons`, `lib/roadmap` (`LIVE_ENTRIES`, `ROADMAP`, `gateLabel`, `RoadmapEntry`), `lib/services/preferences` (`UserPreferences`), `lib/ui/useTaskPlanDrop`, `lib/ui/useTreeFold`, `lib/ui/useVisibility`. Plus `./Brand`, `./BreadcrumbBar`, `./ComingSoonDialog`, `./GlobalCapture`, `./GlobalNavRail`, `./VisibilityProvider`. Rendered by `app/(app)/layout.tsx`, which resolves the session, members, household name/timezone and preferences.

**Debugging** —
- A new `(app)` route shows "Calendar" as its crumb -> its roadmap entry is still `status: "planned"` (route-derived labels are the only mechanism) -> flip `lib/roadmap.ts`, not this file.
- A gated dialog closes onto the document body instead of its trigger -> the opening control unmounted before the close (the phone drawer closed first) -> `openComingSoon`/`closeComingSoon`.
- `Shift+K` does nothing on every page -> `GlobalCapture` is not mounted, or the server snapshot says `shortcutsEnabled: false` -> this file plus the `preferences` row.
- `Shift+K` keeps firing after the Settings toggle is turned off -> `GlobalCapture` stopped reading `usePreferences` and used the static prop -> check `components/shell/GlobalCapture.tsx`.
- The document scrolls on a phone -> the `h-dvh overflow-hidden` frame or `min-h-0` on an inner flex child was dropped -> this file's top-level `div` and `main`.
- The sidebar sheet opens on desktop -> `lg:hidden` on the overlay wrapper was lost -> the `sidebarOpen` block.
- Collection mutations from the sheet seem to reset -> two `CollectionTree` instances with separate `dialog`/`pendingDelete` state -> expected; the shared cache keeps data consistent.
- A Playwright locator for the sidebar stops resolving -> the landmark/control names changed with the mixed tree (`Collection tree`, `Collections`, `Open collections`/`Close collections`) -> update the spec, not this file.
- Dragging a task row onto the sidebar mini month does nothing -> the `onTaskDrop` prop was dropped from either `SidebarMiniMonth`, or it is the wrong MIME type -> this file plus `components/calendar/MiniMonth.tsx` and `lib/ui/taskDrag.ts`.
- A drop sets the wrong day or its Undo restores the wrong date -> the handler bypassed `useTaskPlanDrop`, or the drag payload no longer carries the row's previous `dueOn` (stamped at `dragstart`) -> this file's `planTaskDrop`, `lib/ui/taskDrag.ts`.

**Tests** — `tests/e2e/shell.spec.ts`, `tests/e2e/mobile.spec.ts`, `tests/e2e/viewport-fit.spec.ts`, `tests/e2e/sidebar.spec.ts`, `tests/e2e/roadmap-nav.spec.ts`; the mounted `GlobalCapture` gesture is scenario 2 of `tests/e2e/tasks.spec.ts`. The task-row→mini-month drop has no e2e after the v0.2.1 rewrite (the old scenario 3 was removed with the Plan popover); its payload is unit-tested in `tests/unit/task-drag.test.ts`.

### components/shell/GlobalCapture.tsx

**Purpose** — App-wide quick capture: pressing `Shift+K` anywhere opens a one-field dialog; `Enter` files the title in the viewer's Inbox without navigating, toasts `Task captured` with a targeted Undo action, closes and returns focus to whatever was focused before the dialog opened.

**Public API** — `export function GlobalCapture(props: { initialPreferences: UserPreferences })`. Mounted once by `AppShell`; no route or page props. The dialog input id is `global-capture-title` (the page capture row owns `task-capture`).

**State & side effects** — Local `open` and `title`; a `returnFocusRef` for the trigger. `usePreferences(initialPreferences)` seeds from the server snapshot and reads the live cache, so flipping the Settings toggle updates the gesture immediately; `preferences.shortcutsEnabled` gates the `window` `keydown` listener (no listener at all when off). The handler accepts only `Shift+K` with no Ctrl/Meta/Alt and no `event.repeat`, and returns early through `isTextEntryTarget`/`hasOpenOverlay` from `lib/ui/shortcutGuards`, so typing `Shift+K` in a field or opening it under a dialog does nothing. `useCreateTask()` POSTs `{ title }` (the server defaults to the caller's Inbox) and invalidates `["tasks"]`; the title is trimmed and an empty title is ignored. On success: clear the field, force-close, push `{ label: "Capture task", undo: () => deleteTask.mutateAsync(task.id) }` onto `lib/ui/undo.ts` and keep the returned handle, then `undoToast("Task captured", handle)` from `lib/ui/undoToast.ts` — so the toast's Undo deletes exactly this capture even when a newer undoable change lands in its 10-second window (`z`/`Ctrl+Z` remain the shared LIFO stack). A dismissal while the POST is pending is ignored: `close()` takes a `force` flag, the Cancel button is `disabled` and Escape/outside-click cannot close the dialog, because the request cannot be aborted and closing would still create the task the user meant to cancel. Failure keeps the dialog and text open and toasts `Could not add the task.`; cancelling keeps the typed text for the next open. The form's submit button is disabled while pending/empty and both controls grow to 44px on a coarse pointer. Closing (Escape, outside-click, Cancel, or success) restores focus on the next paint if the original element is still connected.

**Depends on / Used by** — `lib/query/tasks` (`useCreateTask`, `useDeleteTask`), `lib/query/preferences` (`usePreferences`), `lib/services/preferences` (`UserPreferences`), `lib/ui/shortcutGuards`, `lib/ui/undo` (`pushUndo`), `lib/ui/undoToast`, `components/ui/button`, `components/ui/dialog`, `sonner`. Rendered once by `components/shell/AppShell.tsx`.

**Debugging**
- `Shift+K` never opens -> `shortcutsEnabled` is off, focus is in an input/textarea, or a dialog/menu is already open -> check the preference and `lib/ui/shortcutGuards.ts`.
- `Shift+K` opens while typing a task title -> the field is not an `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` -> the shared guard.
- The task is not in the Inbox -> `POST /api/tasks` failed (read the toast) or an explicit `collectionId` was added to the payload -> this file's `{ title }` only.
- Undo deletes the wrong task -> the toast no longer carries its own `pushUndo` handle (a shared `undoLast` was restored) -> `lib/ui/undoToast.ts`; the targeted handle is what keeps two captures in one toast window separate.
- The dialog will not close immediately after Enter -> the create is still pending and a dismissal cannot abort the POST, so `close()` ignores it and the Cancel button is disabled -> this file's `close(force)` guard.
- Focus lands on `<body>` after closing -> the previously focused element unmounted -> `returnFocusRef` intentionally skips a disconnected node.
- Capture works on `/` but not `/tasks` -> `GlobalCapture` moved out of `AppShell` or the app layout stopped rendering it -> `components/shell/AppShell.tsx`.

**Tests** — Scenario 2 of `tests/e2e/tasks.spec.ts` (from the calendar: `Shift+K`, type, Enter, toast, no navigation, then the task is in `/tasks` Inbox; two captures in one toast window, then the older toast's Undo deletes exactly the older task). No component renderer exists, so the dialog's focus return and pending-cancel guard are reviewed, not unit-tested.

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

**Safe areas (v0.3.0)** — the 72px header takes its horizontal padding from `safe-x` (0.75rem on phones, 1.5rem from `sm`, plus the landscape insets).

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

**Safe areas (v0.3.0)** — the rail is `w-[calc(54px+var(--safe-left))]` with `pl-[var(--safe-left)]`, so a landscape notch never covers the icons; the inset is 0 in a browser tab, so the 54px rail assertion still holds.

**Purpose** — The dark 54 px rail on `md` and up: household logomark, the live destinations from the roadmap, greyed-out planned destinations, Settings pinned above the account menu, and an account menu that signs out.

**Public API** — `export function GlobalNavRail(props: { householdName: string; currentUser: { id: string; name: string }; onComingSoon: (entry: RoadmapEntry, trigger: HTMLElement) => void })`. Internal: `RAIL_FOCUS`, `RAIL_ITEM`, `ICONS` (roadmap id → icon), `RailTooltip`, `RailEntry`.

**State & side effects** — `usePathname()` picks the active tile (`/` for Calendar, otherwise `href` or `href/…`); `ROADMAP` supplies every entry, with Settings rendered in a `mt-auto` block so it sits just above the account menu. Planned entries are `<button aria-haspopup="dialog">` tiles at `text-white/40`, icon-only, that call `onComingSoon`; their accessible name carries the promise (`"Today — Coming in v0.3.0"`). There is deliberately no version text on the rail and no scroll container around the tiles. `signingOut` disables the trigger and the menu item. Sign out is a direct `fetch("/api/auth/sign-out", { method: "POST", … body: "{}" })` (not the Better Auth client); on `response.ok` it calls `router.replace("/login")` then `router.refresh()`; on failure it re-enables the button and toasts "Could not sign out. Try again.". The dropdown item calls `event.preventDefault()` to keep the menu mounted while pending. Tooltips appear on hover and `group-focus-within`, and are `aria-hidden`.

**Depends on / Used by** — `next/link`, `next/navigation`, `sonner`, `components/ui/dropdown-menu`, `components/ui/icons`, `lib/roadmap` (`ROADMAP`, `gateLabel`, `RoadmapEntry`, `RoadmapId`), `lib/utils`, `./Brand`. Rendered by `AppShell`; hidden below `md`, where `AppShell`'s top bar replaces it.

**Debugging** —
- A rail item routes although it is not shipped -> its roadmap `status` is `live` -> `lib/roadmap.ts`, not this file.
- A gated tile looks as bright as a live one -> the `text-white/40` dim was replaced -> this file's planned branch.
- The rail shows a scrollbar -> an `overflow-y-auto` wrapper crept back in; the tiles must fit without scrolling -> this file's `nav` children.
- Version text reappears on the rail -> deliberate design change, not a bug: the promise lives in the tooltip and the dialog -> this file + `ComingSoonDialog`.
- Sign out appears to succeed but the session survives -> `router.replace` ran without the POST succeeding -> check the `response.ok` branch and the `/api/auth/sign-out` route.
- The account menu closes immediately after clicking Sign out -> the `preventDefault` in `onSelect` was removed -> this file.
- Focus ring invisible on the white active tile -> the inset `RAIL_FOCUS` shadow was simplified to a plain outline -> this file.
- Rail shows on a phone -> `hidden … md:flex` changed -> this file's `nav`.

**Tests** — `tests/e2e/shell.spec.ts` (rail, focus ring, sign-out success/failure, tab order), `tests/e2e/roadmap-nav.spec.ts`, `tests/e2e/auth.spec.ts`.

### components/shell/ComingSoonDialog.tsx

**Purpose** — The "what's coming" dialog a gated rail destination opens: the destination's name and one-line promise, the release it belongs to (`Coming in v0.3.0` or `Planned`) and the list of capabilities. It exists so a greyed icon leads somewhere honest instead of a dead route. Tasks is live since v0.2.0, so Today is the only gated destination with a version today.

**Public API** — `export function ComingSoonDialog(props: { entry: RoadmapEntry | null; onClose: () => void })`. Controlled by `AppShell`; renders `DialogContent` with `sheet` (a phone bottom sheet) only while `entry` is set, and a `DialogClose` "Got it" button.

**State & side effects** — No state of its own. `onOpenChange(false)` — Esc, backdrop click or "Got it" — calls `onClose`, and `AppShell` returns focus to the control that opened it. Portal-rendered, so it can open above the phone drawer without closing it.

**Depends on / Used by** — `components/ui/dialog` (`Dialog`, `DialogClose`, `DialogContent`), `components/ui/button`, `lib/roadmap` (`gateLabel`, `RoadmapEntry`). Rendered once by `AppShell`.

**Debugging** —
- The dialog never opens -> the entry was passed with `status: "live"` (live entries navigate instead) -> `lib/roadmap.ts`.
- Focus lands on `document.body` after closing -> the opening control unmounted before the close ran -> `AppShell`'s `openComingSoon`/`closeComingSoon`.
- A planned entry's dialog is missing its release line -> `gateLabel` falls back to "Planned" when `version` is unset -> `lib/roadmap.ts`.

**Tests** — `tests/e2e/roadmap-nav.spec.ts` (open, contents, Esc, focus return, phone drawer).

## Visibility context

### components/shell/VisibilityProvider.tsx

**Purpose** — A one-value React context that publishes the `VisibilityApi` (state + `setGroup`, `toggleCollection`, `setCollections`, `setOnly`) so the grid, sidebar and mini month read the same visibility state without prop drilling.

**Public API** — `export function VisibilityProvider(props: { value: VisibilityApi; children: React.ReactNode })` and `export function useVisibilityApi(): VisibilityApi`. The hook throws `"useVisibilityApi must be used inside VisibilityProvider"` when the context is missing.

**State & side effects** — None of its own: no state, effects, queries, storage or URL params. The state lives in `useVisibility` (called by `AppShell`); this file only distributes it. Its meaning is defined elsewhere: `lib/ui/visibility.ts` owns `VisibilityState`, `GroupKey`, `GROUP_ORDER`, `DEFAULT_VISIBILITY`, `groupOf` and `isCollectionVisible`, and `lib/ui/visibleCollections.ts` owns `visibleCollectionIds`, the single implementation used by `CalendarShell` and `SidebarMiniMonth` so the grid and sidebar dots cannot disagree.

**Depends on / Used by** — `react` (`createContext`, `useContext`) and `lib/ui/useVisibility` (`VisibilityApi`). Provided by `AppShell`; consumed by `CalendarShell`, `SidebarMiniMonth` and, indirectly via `AppShell` props, `CollectionTree`/`BreadcrumbBar`/`PersonPills` (they take the API as a prop, not from the context).

**Debugging** —
- "useVisibilityApi must be used inside VisibilityProvider" -> a component was rendered outside the `(app)` layout (or in a story/test without the provider) -> this file / `AppShell`.
- Grid and sidebar mini month disagree about visible calendars -> one of them filters by hand instead of calling `visibleCollectionIds` -> `lib/ui/visibleCollections.ts`.
- Toggling a pill leaves an isolated calendar showing -> `setOnly` is not cleared by `setOnly`; only `setGroup`/`toggleCollection`/`setCollections` clear it -> `lib/ui/useVisibility.ts`.

**Tests** — No direct test coverage of the provider; its semantics are covered by `tests/unit/visibility.test.ts`, `tests/unit/visibleCollections.test.ts`, `tests/e2e/sidebar.spec.ts` and `tests/e2e/only-this-calendar.spec.ts`.

## Collection sidebar

### components/sidebar/CollectionDialog.tsx

**Purpose** — The collection create/rename dialog. Roots also get kind-aware title wording, owner, visibility and colour controls; sub-collections only get a name because they inherit kind, colour, owner and sharing.

**Public API** — `export type CollectionDialogState = { mode: "create-root"; kind: CollectionKind } | { mode: "create-child"; parentId: string; kind: CollectionKind; parentVisibility: CollectionVisibility } | { mode: "edit"; collection: CollectionRow; inheritedVisibility?: CollectionVisibility }`; `export interface CollectionDialogResult { name: string; kind?: CollectionKind; hueFamily?: HueFamily; ownerId?: string | null; visibility: CollectionVisibility }` (`visibility` is **not** optional — see State); `export function CollectionDialog(props: Props)`. Props: `state`, `pending`, `currentUserId`, `currentUserName`, `onClose()`, `onSubmit(values)`. Returns `null` when `state` is null.

**State & side effects** — `CollectionForm` (keyed by mode/kind/target id so switching targets remounts it) holds `name`, `hueFamily` (default `"teal"`), `ownerId` and `visibility`. A root's initial visibility is `state.collection.visibility` (all three values), a new root starts `shared`, and a child shows the value inherited from its parent (`parentVisibility` on create, `inheritedVisibility` on edit) with the radios disabled. The owner select only offers `"ours"` (→ `null`) and the current user; choosing `"ours"` resets the value to `shared`. Radios are editable only for a root the current user owns (`isMine`). The submit handler always sends a three-valued `visibility`: for a root it is the value to persist (or `"shared"` when the viewer is not the owner), for a child it echoes the inherited value it was shown — consumers never send that back. Because the field is non-optional, a root rename can never fall back to `"shared"` and silently downgrade a private collection. Non-root submits send no `kind`/`hueFamily`/`ownerId`. Titles are kind-aware (`New calendar`/`New list`, `Add sub-calendar`/`Add sub-list`, `Calendar settings`/`List settings`). Save is disabled while `pending` or the trimmed name is empty. No queries: mutation wiring is the caller's.

**Depends on / Used by** — `components/ui/button`, `components/ui/dialog`, `lib/color/palette` (`HUE_FAMILIES`, `PARENT_SHADE_INDEX`, `shadeTokens`), `lib/db/schema` (`CollectionKind`, `CollectionRow`, `CollectionVisibility`), `lib/utils`. Rendered by `CollectionTree` with `pending={createCollection.isPending || updateCollection.isPending}`.

**Debugging** —
- Editing a sub-collection wipes its parent's colour/sharing -> a root-only field was submitted for a child -> `isRoot` in this file plus `CollectionTree.submit`'s `parentId === null` spread.
- A private collection becomes shared after an unrelated rename -> the initial visibility is not derived from `state.collection.visibility`, or submit hard-coded `"shared"` -> this file's `initialVisibility` and submit handler.
- "View only" or "Private" cannot be picked -> the collection is shared or owned by the partner (`isMine` false) -> `ownerId`/`isMine` state here.
- A child offers an editable visibility control -> the non-root fieldset lost its `disabled` inputs -> this file's child branch.
- The dialog keeps stale values after switching targets -> the `formKey` remount was removed -> this file.

**Tests** — `tests/e2e/sidebar.spec.ts`, `tests/e2e/viewonly.spec.ts`.

### components/sidebar/CollectionRow.tsx

**Purpose** — One row of the sidebar tree: a disclosure control on roots, the visibility checkbox, a calendar hue swatch or a list glyph in the family shade, the name, a private/view-only lock, a child-shade preview strip on roots, and an options menu with a Visibility submenu.

**Public API** — `export function CollectionRow(props: Props)`. Props: `collection: CollectionRow`, `checked`, `isChild`, `ownerHue: HueFamily`, `childShades: string[]`, `readOnly`, `visibility: CollectionVisibility` (the effective value — a child receives its root's), `canChangeVisibility: boolean`, `showViewOnlyBadge: boolean`, `onlyId: string | null`, and callbacks `onToggle`, `onAddChild`, `onEdit`, `onDelete`, `onSetVisibility(visibility)`, `onShowOnly`, `onShowAll`. Fold props: `foldable?: boolean`, `expanded?: boolean` (default `true`), `controlsId?: string`, `onToggleFold?: () => void`. Task props: `taskCount?: number` (the list's active-task total; the row renders a muted pill only when it is positive, and hides it for `0`/`undefined`) and `onQuickAdd?: () => void` (renders the `PlusIcon` quick-add button only when provided; `CollectionTree` passes it only for a writable list).

**State & side effects** — No state; the row is fully controlled. A row with `foldable` and `onToggleFold` renders a leading button labelled `Collapse <name>` / `Expand <name>` carrying `aria-expanded` and `aria-controls`; every other row renders a same-width `aria-hidden` spacer, so checkboxes line up whether or not a root has children and whether or not a branch is open. The kind marker is one fixed 4×4 column with `data-testid="collection-kind-calendar"` / `"collection-kind-list"`: a calendar renders the 2.5 px hue swatch, a list renders `ListIcon` at 14 px with the same family shade as its `color` (so `Work > Client A` still reads as one family), and both use `shadeTokens(ownerHue, isChild ? collection.shadeIndex : PARENT_SHADE_INDEX)`. A row whose effective `visibility` is `private` shows `LockIcon` with title `Private`; a read-only partner-owned view-only row keeps the title `View only`. The menu wording is kind-aware (`Add sub-calendar` / `Add sub-list`, `Calendar settings` / `List settings`; children say `Rename`). The Visibility submenu always opens so a child can show the value it inherits; its `Shared` / `View only` / `Private` radio items are disabled unless `canChangeVisibility`. When they are all disabled the trigger is not a dead end: it carries `aria-describedby` and a `title` naming the effective value and why it is fixed — "Visibility is inherited from the parent <noun>: <value>." for a child, "Only a <noun> you own can change visibility; this one is <value>." for a root the viewer does not own — backed by an `sr-only` span with a `useId` id. The menu omits "Add sub-…" for children and read-only rows, omits Edit/Delete when `readOnly`, and shows "Display only this calendar" only for calendars (a list has no grid events; an isolated row still gets "Display all calendars" to leave that view). `isOnly` adds a `bg-well` highlight. A positive `taskCount` renders a muted pill before the menu (`data-testid="collection-task-count-<id>"`, `rounded-pill border border-line-strong bg-surface px-1.5 text-xs font-bold text-ink-soft`, with a `title` naming the active-task total, and the digits `aria-hidden` beside an `sr-only` "N active tasks" — an `aria-label` on a bare `<span>` is not exposed); `0` and `undefined` render nothing, so a disabled or still-loading counts query cannot flash a misleading zero. `CollectionTree` passes `taskCount` only while the route is `/tasks` (Ruling 23), so a calendar row never paints a task count. When `onQuickAdd` is provided the row renders a `PlusIcon` button before the menu (`aria-label="Add a task to <name>"`, `data-testid="sidebar-quick-add"`) using the options trigger's reveal contract: `opacity-0` on fine pointers, revealed by `group-hover` / `group-focus-within` / `focus-visible`, and forced visible with `[@media(pointer:coarse)]:opacity-100` on touch. Neither control appears on a calendar row, and the tree never passes them for a list the viewer cannot write. Roots with children render a strip with `data-testid="shade-strip-<lowercased name>"` and decreasing opacity per shade for either kind. The visual kind marker is `aria-hidden`, so the row also renders an `sr-only` `Calendar`/`List` word after the name; the checkbox's accessible name stays exactly the collection name and the options button stays `Options for <name>`.

**Depends on / Used by** — `components/ui/dropdown-menu` (sub/radio primitives), `components/ui/checkbox`, `components/ui/icons` (`ChevronRightIcon`, `ListIcon`, `LockIcon`, `MoreVerticalIcon`, `PlusIcon`), `lib/color/palette`, `lib/db/schema`, `lib/utils`. Rendered by `CollectionTree` for roots and their children; its fold props come from that tree's `fold` API.

**Debugging** —
- The options menu is unreachable by keyboard -> the `group-focus-within:opacity-100` class was removed -> this file's `DropdownMenuTrigger`.
- A view-only row offers Edit/Delete -> the `readOnly` prop was computed without folding the parent's flags -> the `foldCollectionPermission` call in `CollectionTree`.
- Sub-calendar dots all look identical -> `shadeIndex` is duplicated in the DB or `ownerHue` fell back to `"slate"` -> `hueOf` in `CollectionTree`.
- A list row has no family colour -> the glyph lost its inherited `color: tokens.main` or the row fell back to a non-palette hue -> this file's kind-marker block plus `hueOf`.
- A private row lacks the lock -> the row was given its own `visibility` instead of the root's folded value -> `foldCollectionPermission` in `CollectionTree`.
- A screen-reader user cannot tell a calendar row from a list row -> the `sr-only` kind word was dropped or moved inside the `aria-hidden` marker -> this file's row body.
- A child row can change Shared/View only/Private -> `canChangeVisibility` was computed for a child -> the child `CollectionRow` wiring in `CollectionTree`.
- A screen reader announces a bare "Visibility" with no reason the options are disabled -> the trigger lost its `aria-describedby`/`title`, or the `sr-only` hint span lost the `useId` wiring -> this file's `visibilityHint`.
- The disclosure chevron does nothing -> `foldable`/`onToggleFold` was not passed for that root, or the row is a child (children fold with their parent) -> this file's `canFold` plus `CollectionTree`.
- Rows shift sideways when a branch folds -> the spacer branch was removed -> this file's spacer `span`.
- A badge flashes `0` or shows on a calendar -> `taskCount` was passed unconditionally instead of only for a writable list with a positive count -> the `taskCount`/`onQuickAdd` props in this file plus the `rootQuickAdd`/`childQuickAdd` gates in `CollectionTree`.
- The quick-add control never appears on a phone -> the `[@media(pointer:coarse)]:opacity-100` class was dropped from the reveal set -> this file's quick-add button.
- A view-only or partner-private list offers quick add -> `CollectionTree` skipped the `canWriteCollection` gate -> the folded-permission wiring in that file.
- The page scrolls a few pixels (or a lot) although the shell is `h-dvh overflow-hidden` and the tree lives in its own scroll container -> a row's `sr-only` spans escaped: Tailwind's `sr-only` is `position: absolute`, and without a positioned ancestor they resolve against the initial containing block instead of being clipped by the tree's scroll box. The row `<li>` is `relative` for exactly this reason -> this file's row class plus `tests/e2e/viewport-fit.spec.ts`.

**Tests** — `tests/e2e/sidebar.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`.

### components/sidebar/CollectionTree.tsx

**Purpose** — The sidebar collection tree: groups roots into Shared / me / partner, renders calendars and task lists side by side, folds groups and roots, and wires the New menu plus create, rename, delete, visibility and "display only this calendar".

**Public API** — `export function CollectionTree(props: Props)`. Props: `visibility: VisibilityApi`, `fold: TreeFoldApi`, `currentUserId`, `currentUserName`, `partnerName`. Internal: `GROUP_LABEL`, `hueOf`, `isReadOnlyFor`, `previewShades`, `QuickAddDialog`; disclosure ids are built per mount from `useId()`.

**State & side effects** — Queries/mutations: `useCollections()` (`["collections"]`), `useCreateCollection`, `useUpdateCollection`, `useDeleteCollection` (which also invalidates `["events"]` and `["tasks"]`). Local: `dialog: CollectionDialogState | null` and `pendingDelete: CollectionRow | null`. The header's single "New" `DropdownMenu` offers `New calendar` / `New list`, opening a create-root dialog with that `kind`; a child created from a row's `Add sub-calendar` / `Add sub-list` sends no kind (the server inherits the parent's) and passes the root's `visibility` into the dialog as the disabled inherited value. Visibility writes go through `useUpdateCollection`: the row's submenu PATCHes `{ id, visibility }` and the server stays authoritative — the tree never filters private rows itself. A root edit also sends the dialog's `visibility` verbatim (the result field is non-optional), so renaming a private root can never default it back to `shared`. Visibility checkboxes go through `visibility.setCollections(ids, visible)` (toggling a root also toggles its children in one call) and `visibility.setOnly(id | null)`. Fold reads and writes go through the `fold` prop only: each group heading is a button with `aria-expanded`/`aria-controls` that toggles that group's list (`<ul id="collection-group-<instance>-<group>" hidden>`), and each root with children gets a disclosure row controlling `<ul id="collection-children-<instance>-<rootId>" hidden>`. `<instance>` is `useId()`, because the desktop aside and the phone sheet mount this tree twice — global ids would let the sheet's buttons point at the hidden aside's list. Everything starts expanded; a successful create or edit calls `fold.expandGroup` for the group the returned collection landed in (a root can be created or re-owned into a folded group), and creating a sub-collection also calls `fold.expandCollection(parentId)`. List badges come from `useTaskCounts({ enabled: pathname.startsWith("/tasks") })` (`usePathname` from `next/navigation`; key `["tasks", "counts"]`), so the calendar never issues `GET /api/tasks/counts` and the two mounted trees share one cache entry. The **prop** is gated by the same pathname (`onTasksRoute`): even a cached counts payload loaded on `/tasks` is not passed into the rows on a calendar route, so a badge can never flash beside a calendar row. `taskCount`/`onQuickAdd` are passed only when `kind === "list"` **and** the folded permission passes `canWriteCollection({ userId: currentUserId, householdId: "" }, foldCollectionPermission(row, parent))` (via the shared `isWritableList` helper) — a root folds without a parent, a child with its root — so calendars and read-only lists (a partner-owned view-only list, a foreign private list) render neither control — a task can be filed under a calendar, but the sidebar badge and quick-add stay list-only; a view-only list the viewer **owns** is writable and does get them. `onQuickAdd` records the opener element and stores the collection in `quickAdd` state; `QuickAddDialog` is mounted only while that state is set and holds the title itself: Enter in the form (or the Add task button) calls `useCreateTask().mutate({ title, collectionId })`, Add is disabled while the trimmed title is empty or the mutation is pending, a failure toasts `error.message` and keeps the dialog and text, and success toasts `Task added`, closes, and lets the mutation's `["tasks"]` invalidation refresh the badge. Esc and the overlay close through `onOpenChange`, Cancel through its own `onClick`; because the dialog mounts without a `DialogTrigger`, Radix cannot restore focus itself, so `CollectionTree` captures the opener and focuses it on the next paint after unmount (the same manual pattern `AppShell` uses). Grouping uses `groupOf`/`GROUP_ORDER`; `foldCollectionPermission` from `lib/services/permissions` folds the root's `ownerId` and a non-`shared` root's visibility into every child, so a protected parent protects its children and only a root the viewer owns gets `canChangeVisibility`. `previewShades` lists real child shades first, then fills to three from `CHILD_SHADE_ORDER` for both kinds. Edit submits root-only fields only when `parentId === null` and always sends the dialog's three-valued visibility back. Delete opens a Canvas confirmation (never `window.confirm`) whose wording (calendar/events vs list/tasks) differs for roots vs children, then toasts `Deleted <name>`. A `role="status"` banner shows "Showing only <name>" with a "Show all" button. Loading and error states are inline text.

**Depends on / Used by** — `sonner`, `components/ui/button`, `components/ui/dialog`, `components/ui/dropdown-menu`, `components/ui/icons` (`ChevronRightIcon`, `PlusIcon`), `lib/color/palette`, `lib/db/schema` (`CollectionKind`, `CollectionRow`, `CollectionVisibility`), `lib/services/collections` (`CollectionNode`), `lib/services/permissions` (`canWriteCollection`, `foldCollectionPermission`), `next/navigation` (`usePathname`), `lib/query/collections`, `lib/query/tasks` (`useCreateTask`, `useTaskCounts`), `lib/ui/visibility` (`GROUP_ORDER`, `groupOf`, `isCollectionVisible`), `lib/ui/useTreeFold` (`TreeFoldApi`), `lib/ui/useVisibility` (`VisibilityApi`), `lib/utils` (`cn`), `./CollectionDialog`, `./CollectionRow`. Rendered by `AppShell` (desktop sidebar and phone sheet), which passes the single `fold` instance.

**Debugging** —
- A collection is missing from the tree -> it is neither a root nor a direct child (only two levels are rendered), its group bucket filtered it, or the server dropped it as a private row for someone else -> `GROUP_ORDER` filter here plus `listCollections`.
- "New list" creates a calendar -> the create-root dialog's `kind` was not forwarded to `createCollection` -> this file's `submit`.
- A sub-list is created as a calendar (or rejected as kind-mismatched) -> child creation sent a `kind` instead of letting the server inherit the parent's -> this file's `submit` (`kind` is `undefined` for children).
- Unticking a parent leaves children visible -> the toggle passed no children -> `onToggle={() => toggle(root, root.children)}`.
- Delete removes events from the grid but not the tree -> `["collections"]` invalidation failed; `["events"]` is invalidated by the mutation -> `lib/query/collections`.
- The partner sees Edit on a protected child -> `foldCollectionPermission` was called without the root -> the child map in this file.
- A child can change visibility -> `canChangeVisibility` was not forced `false` on the child row -> this file's child `CollectionRow`.
- The wrong lock appears on a private child -> the child's stored `shared` was used instead of folding the root's visibility -> the `foldCollectionPermission(child, root)` call in this file.
- Sub-calendars stay visible after collapsing a root -> the child `<ul>` lost its `hidden={!openRoot}` or the disclosure button was given the wrong `controlsId` -> the `collection-children-<instance>-<rootId>` wiring in this file.
- A group heading does not fold -> the heading button lost its `onClick`/`aria-expanded` -> this file's `h3` block.
- The phone sheet's disclosure buttons expand a list in the hidden desktop sidebar -> the `useId()` instance prefix was dropped from the ids -> this file's `instanceId`.
- A newly added sub-calendar is invisible -> the create success handler stopped calling `fold.expandCollection(parentId)` -> this file's `submit`.
- A new or re-owned root calendar is invisible -> its success handler stopped calling `fold.expandGroup(groupOf(result.collection, currentUserId))` -> this file's `submit`.
- A sub-calendar sits under a person's group but disappears with the "Ours" pill -> the checkbox `isCollectionVisible` call omitted the `root` argument, so the child's stale `ownerId` chose the group -> the child rows around `checked={isCollectionVisible(visibility.state, child, currentUserId, root)}` in this file.
- No count badges on `/tasks` -> `useTaskCounts` was left disabled, the pathname gate used the wrong prefix, or the row is not a writable list -> `taskCounts` and the `rootQuickAdd`/`childQuickAdd` derivations in this file.
- `GET /api/tasks/counts` fires on the calendar -> the `enabled: pathname.startsWith("/tasks")` gate was dropped -> this file's `useTaskCounts` call.
- A count badge paints on the calendar after visiting `/tasks` -> only the request was gated; the `taskCount` *prop* must also be gated by `onTasksRoute` -> this file's two `taskCount` props.
- Quick add is missing on a writable list -> the gate used the raw row's visibility instead of `foldCollectionPermission`, or `canWriteCollection` was given the wrong viewer id -> this file's fold calls.
- Submitting the quick add does nothing or the error keeps no text -> the form's `onSubmit` lost its `preventDefault`/`addTask`, or `onError` closed the dialog instead of only toasting -> `QuickAddDialog`.
- A created task does not move the badge -> the create mutation's settle invalidation (`["tasks"]`, which includes `["tasks", "counts"]`) was bypassed -> `lib/query/tasks.ts`.
- The delete dialog for a calendar promises only events -> a task can live under a calendar as well as a list, so the copy must say "events and tasks" for a calendar (and "tasks" for a list) -> this file's `deleteItems`.

**Tests** — `tests/e2e/sidebar.spec.ts` (New menu list creation and rename, sub-lists, private/shared switch, calendar shade and fold scenarios), `tests/e2e/only-this-calendar.spec.ts`, `tests/e2e/mobile.spec.ts`, `tests/e2e/viewonly.spec.ts`.

### components/sidebar/PersonPills.tsx

**Purpose** — The three cross-check pills (Ours / me / partner) that hide or show a whole ownership group at once.

**Public API** — `export function PersonPills(props: { visibility: VisibilityApi; me: string; partner: string })`.

**State & side effects** — No state. `aria-pressed` reflects `visibility.state.groups[group]`; clicking calls `visibility.setGroup(group, !on)`, which also clears `only` (touching a pill is how you leave an isolated view). The "on" look is the outline button's default fill; "off" drops to `bg-surface text-ink-soft`. Inside a `role="group"` labelled "Cross-check calendars".

**Depends on / Used by** — `components/ui/button`, `lib/ui/visibility` (`GroupKey`), `lib/ui/useVisibility` (`VisibilityApi`). Rendered by `BreadcrumbBar`.

**Debugging** —
- Clicking a pill does not change the grid -> the pill group is filtered out by `isCollectionVisible`'s `only` branch; `setGroup` must clear `only` -> `lib/ui/useVisibility.ts`.
- A pill looks permanently pressed -> `aria-pressed`/class condition inverted -> this file's `on` derivation.
- Pills show the wrong name -> `BreadcrumbBar` passed `me`/`partner` from `AppShell`'s `members` -> `AppShell`'s `partnerName` (`"Partner"` fallback).

**Tests** — `tests/e2e/sidebar.spec.ts`, `tests/e2e/shell.spec.ts` (tab order).

### components/sidebar/SidebarMiniMonth.tsx

**Purpose** — The sidebar mini month: neutral dots on days with visible events; clicking a day navigates with `/?date=…` so the grid jumps there. It is also the task-row drop target (the only month grid present on `/tasks`), so a task dragged from a row can be planned onto a day.

**Public API** — `export function SidebarMiniMonth(props: { currentUserId: string; timezone: string; onTaskDrop?: (drag: TaskDragPayload, date: string) => void })`. Internal helpers `pad`, `monthRange`.

**State & side effects** — Local `anchorDate` (today in the household zone) drives `monthRange`, which converts the month's local midnights to UTC bounds with `localWallTimeToUtc`. `useEvents(range)` fetches that month (`["events", from, to]`), `useVisibilityApi()` supplies the state, `visibleCollectionIds` filters events, and `expandOccurrences` expands series inside the range to build the `eventDates` set (all-day uses `occurrence.startKey`, timed uses the local date of `startAt`). Clicking pushes `/?date=<date>` with `router.push`; the grid's `?date=` effect does the navigation. **Drop contract:** `onTaskDrop` is forwarded to `MiniMonth`, which makes each in-month day button accept a `text/x-nailong-task` drag (visual `data-task-drop-active` affordance, `preventDefault` only for that type) and hands the parsed payload (`{ id, dueOn }`) plus the day to the callback. `AppShell` supplies the handler from `useTaskPlanDrop`, so the PATCH of `dueOn` (the stored time is kept) + targeted Undo (`Due date set`, restoring the payload's previous date) happens outside this presentational component. No storage or mutations here; a click still navigates whether or not a drop is in progress.

**Depends on / Used by** — `next/navigation`, `components/calendar/MiniMonth`, `components/shell/VisibilityProvider` (`useVisibilityApi`), `lib/query/collections`, `lib/query/events`, `lib/recurrence/expand`, `lib/services/collections`, `lib/time/zone`, `lib/ui/taskDrag` (`TaskDragPayload`), `lib/ui/visibleCollections`. Rendered by `AppShell` (desktop sidebar and phone sheet, so two instances share the events cache and the same `onTaskDrop`), which is also the only caller that passes `onTaskDrop`.

**Debugging** —
- Dots are missing for events that the grid shows -> the mini month queries only the shown month, so an event spanning the boundary can fall outside `range` -> `monthRange` / `expandOccurrences` range argument.
- Clicking a day does not move the grid -> `CalendarShell`'s `?date=` effect already handled that key, or the grid has no `calendarRef` yet -> `SidebarMiniMonth` push vs the shell's `handledLinkRef`.
- Dots appear for hidden calendars -> `visibleIds` was bypassed -> this file's filter.
- Two mini months disagree after toggling a calendar -> both read the same context; a stale render means the provider value was memoised incorrectly -> `AppShell`/`useVisibility`.
- A task row dropped on a day does nothing -> `AppShell` stopped passing `onTaskDrop`, or the drag is not the task MIME type -> this file's prop pass-through, `lib/ui/taskDrag`, `useTaskPlanDrop`.

**Tests** — `tests/e2e/mini-month.spec.ts`, `tests/e2e/sidebar.spec.ts`, `tests/e2e/only-this-calendar.spec.ts`; the task-row drop payload is unit-tested in `tests/unit/task-drag.test.ts` — no e2e drives the row→mini-month drop after the v0.2.1 rewrite.

## Focused verification
```bash
npx vitest run tests/unit/visibility.test.ts tests/unit/visibleCollections.test.ts tests/unit/treeFold.test.ts
npx playwright test tests/e2e/sidebar.spec.ts
npm run lint && npm run typecheck
```
