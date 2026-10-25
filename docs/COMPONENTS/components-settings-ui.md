# Settings surfaces and UI primitives

This area covers the two settings components (the page-level form and the per-user Calendar card) and the small `components/ui/` primitives every surface in the app is built from — buttons, Radix wrappers, the icon set and the sonner theming. Read it when changing a settings control, when a preference does not reach the calendar, or when a primitive's wrapper behaviour differs from the underlying Radix/HTML component.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, add/move/delete its section and run `npm run docs:check`.

| File | Role |
|---|---|
| components/settings/CalendarPreferencesCard.tsx | Settings → Calendar card; every control writes a preference immediately, no Save |
| components/settings/SettingsForm.tsx | Settings page shell: anchored sections for profile, household, calendar and account security |
| components/ui/button.tsx | Project-wide `<button>` with Canvas variants and sizes |
| components/ui/checkbox.tsx | Radix checkbox wrapper with an `aria-label`-only API |
| components/ui/dialog.tsx | Radix dialog wrapper with a required title and optional phone bottom sheet |
| components/ui/dropdown-menu.tsx | Radix dropdown wrappers used by the nav rail and sidebar rows |
| components/ui/icons.tsx | The project's only icon source: inline 24×24 stroke SVGs |
| components/ui/toast.tsx | sonner `ToasterProps` (Canvas flash styling); the toast/undo API itself is `sonner` + `lib/ui/undo.ts` |

## Settings surfaces

### components/settings/CalendarPreferencesCard.tsx

**Purpose** — Renders the `#calendar` section of the settings page: the five per-user preferences the calendar loops read. Every control saves on change and mirrors into the React Query cache; there is no Save button.

**Public API** — `export function CalendarPreferencesCard({ initialPreferences, currentUserId }: Props)`; `Props = { initialPreferences: UserPreferences; currentUserId: string }`, with `UserPreferences` imported as a type from `@/lib/services/preferences`. Local, non-exported: `VIEW_OPTIONS` (`auto`, `dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listMonth`), `TIME_FORMATS` (`24h`, `12h`), and the `FIELD`/`LABEL`/`CARD`/`CARD_HEADING` class recipes duplicated from `SettingsForm.tsx`.

**State & side effects** — No React state. `usePreferences(initialPreferences)` (query key `["preferences"]`, `initialData`, `staleTime: Infinity`), `useUpdatePreferences()` (`PATCH /api/settings/preferences`, optimistic merge plus a sequence guard against out-of-order responses), and `useCollections()` (query key `["collections"]`, `GET /api/collections`). Each control writes one key:

| Control | Preference key written |
|---|---|
| Time format segmented buttons (`aria-pressed`) | `timeFormat` — `"24h"` or `"12h"` |
| Default view `<select>` | `defaultView` — `auto`, `dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listMonth` |
| Week numbers checkbox | `showWeekNumbers` |
| Keyboard shortcuts checkbox | `shortcutsEnabled` |
| Default event calendar `<select>` | `lastEventCalendarId` — `null` for "None" |

`save(patch)` fires `update.mutate` and toasts `Preferences updated` on success or `error.message` on failure (the mutation restores the previous cache in `onError`). The section carries `id="calendar"` so `/settings#calendar` scrolls to it.

**Depends on / Used by** — `sonner` (`toast`), `components/ui/checkbox`, `lib/query/preferences`, `lib/query/collections`, `lib/services/permissions` (`canWriteCollection`, `foldCollectionPermission`), `lib/utils` (`cn`). Rendered only by `components/settings/SettingsForm.tsx`.

**Downstream of each preference** — `defaultView` is read by `components/calendar/CalendarShell.tsx` through `resolveInitialView` (`auto` → `listMonth` on narrow screens, `dayGridMonth` otherwise) and only applies when the device has no stored `nailong.lastView.<userId>`; `timeFormat` and `showWeekNumbers` are props of `CalendarView`; `shortcutsEnabled` gates `useKeyboardShortcuts` (calendar), `useTaskShortcuts` (via `TasksShell`) and `GlobalCapture` (via `usePreferences`); `lastEventCalendarId` is the create-default in `CalendarShell` and is written back by `EventDialog`/`QuickCreatePopover` after a save. The Default event calendar `<select>` offers writable **calendars** only: a list is not an event target, and `CalendarShell` also ignores a stored list/stale id. Visibility is not a preference: it lives in `localStorage` `nailong.visibility.<userId>` via `lib/ui/useVisibility.ts`, and an active "display only this calendar" overrides `lastEventCalendarId` for new events when that calendar is writable.

**Debugging** — `toggle flips then snaps back -> the PATCH failed and the mutation rolled the cache back -> check the PATCH /api/settings/preferences response and the session`. `a calendar is missing from Default event calendar -> canWriteCollection filtered it (not shared and not owned by this viewer; a child inherits the root's folded owner/visibility) or it is a list (never an event target) -> check the collection's kind/ownerId/visibility, not the select`. `the select looks empty after load -> the stored lastEventCalendarId is not in the writable list (deleted, now view-only, or a list) -> compare the preference row with the rendered options`.

**Tests** — `tests/e2e/preferences.spec.ts` (all five controls), `tests/e2e/view-preference.spec.ts` (default view reaches the calendar), `tests/integration/preferences-api.test.ts` (handler contract).

### components/settings/SettingsForm.tsx

**Purpose** — The client shell of `/settings`: a sticky section sub-nav plus the Profile, Household, Calendar, Google Calendar import and Account cards. Profile and Household save explicitly per card; Calendar saves per control through `CalendarPreferencesCard`; the import card links to `/settings/import`; Account owns password change and two-factor setup.

**Public API** — `export function SettingsForm({ initialName, initialHousehold, initialPreferences, currentUserId, currentUserEmail }: Props)`; `Props` takes `initialName: string`, `initialHousehold: HouseholdValues` (`{ name: string; timezone: string; weekStartsOn: number }`), `initialPreferences: UserPreferences`, `currentUserId: string`, `currentUserEmail: string` (rendered into the Password form's hidden `autocomplete="username"` input). Non-exported: `SECTIONS` (`profile`, `household`, `calendar`, `account`), `TIMEZONES` (eight fixed zones), `SectionId`, and copies of the `FIELD`/`LABEL`/`CARD`/`CARD_HEADING` recipes.

**Section → request → field**

| Section (anchor) | Control | Request | Data written |
|---|---|---|---|
| Profile (`#profile`) | Display name → Save profile | `PATCH /api/settings/profile` `{ name }` | `user.name` via `updateMemberName` |
| Household (`#household`) | Name, timezone, week start → Save household | `PATCH /api/settings/household` `{ name, timezone, weekStartsOn }` | `household.name`, `household.timezone`, `household.weekStartsOn` (`0` Sunday, `1` Monday) |
| Calendar (`#calendar`) | `CalendarPreferencesCard` | `PATCH /api/settings/preferences` (per control) | `userPreference` row: `defaultView`, `timeFormat`, `showWeekNumbers`, `shortcutsEnabled`, `lastEventCalendarId` |
| Google Calendar import (no anchor) | "Open the importer" link | — (navigation only) | Opens `/settings/import` |
| Account (`#account`) — Password | Current + new password in a native `<form>` → Change password (submit) | `POST /api/auth/change-password` `{ currentPassword, newPassword, revokeOtherSessions: true }` | Better Auth credential; other sessions revoked |
| Account (`#account`) — 2FA | Account password → Set up two-factor | `POST /api/auth/two-factor/enable` `{ password }` → `{ totpURI, backupCodes }` | Pending TOTP secret, rendered as a URI plus one-time backup codes |
| Account (`#account`) — 2FA | Verification code → Verify and enable | `POST /api/auth/two-factor/verify-totp` `{ code }` | Turns TOTP on for the user |

The three `/api/auth/*` calls are served by the Better Auth catch-all `app/api/auth/[...all]/route.ts`; the `twoFactor()` plugin is registered in `lib/auth/server.ts`.

**State & side effects** — `useState` for `name`, `household`, `savingProfile`, `savingHousehold`, `currentPassword`, `newPassword`, `twoFactorPassword`, `twoFactorCode`, `totpUri`, `backupCodes`, `twoFactorEnabled`, `activeSection`. A `hashchange` listener (plus one initial sync) is the only source of `activeSection`; scrolling does not change it. `router.refresh()` runs after a successful profile or household save, so the server-rendered shell re-reads name and household; password and 2FA saves do not refresh. Toasts: `Profile updated`, `Household updated`, `Password changed`, `Add the key to your authenticator, then confirm a code.`, `Two-factor authentication is on`, and `toast.error(message)` on every failure. Client-side gating only: Change password is disabled until the current password is non-empty and the new one is at least 12 characters; Verify is disabled below 6 trimmed characters. The Password card is a native `<form>` (`noValidate`; the submit event is prevented and routed to `changePassword`) whose inputs carry `name` plus `autoComplete="current-password"` / `"new-password"`, and whose hidden `autoComplete="username"` input carries `currentUserEmail`. Those tokens are what let Chrome's Password Manager (and 1Password/Bitwarden/Safari) detect the change-password flow, offer a generated password in the empty new-password field, and offer to update the saved credential once the submit succeeds.

**Depends on / Used by** — `next/link` (`Link`), `next/navigation` (`useRouter`), `sonner`, `components/ui/button`, `components/settings/CalendarPreferencesCard`, `lib/utils` (`cn`), and the `UserPreferences` type. Used only by `app/(app)/settings/page.tsx`, which passes the session name, the session email, the household row and `getPreferences(db, session.user.id)`.

**Debugging** — `a saved name or household reverts on the next navigation -> the PATCH was rejected (validation is server-side too) -> check the response body and lib/validation/settings.ts, not the input`. `fields keep the value you typed after Save even though the server changed -> router.refresh() updates props but the local useState was initialised once -> remount/reload, do not look for a second fetch`. `the highlighted section jumps to Account while you scroll -> that is by design (hash only, no scroll spy) -> check the hash, not the viewport`. `a password below 12 characters cannot be submitted at all -> the button's disabled condition, not the auth handler`. `Chrome never offers a generated password here -> the Password card lost its <form> or its autocomplete/name tokens, or the new-password input is not empty and focused -> check the Password form markup; Chrome also only offers it on https or localhost`.

**Tests** — `tests/e2e/settings.spec.ts` (household save, hash sub-nav, 2FA panel and backup codes, password-manager wiring: form, autocomplete tokens, hidden username, submit button), `tests/integration/settings-api.test.ts` (profile/household handlers).

## Import surfaces

### components/import/ImportWizard.tsx

**Purpose** — The four-step Google Calendar import wizard on `/settings/import`: choose exported `.ics` files, preview the counts, map each source calendar to a new `From Google` sub-calendar owned by the current user or an existing writable one, commit, then show the report with an Undo action.

**Public API** — `export function ImportWizard({ currentUserId }: { currentUserId: string })`. Local `type Step = "upload" | "preview" | "mapping" | "report"`; the Canvas `FIELD`/`LABEL`/`CARD`/`CARD_HEADING` recipes are copied from `SettingsForm.tsx`.

**State & side effects** — Local `step`, `files`, `preview`, `report`, `mapping` (`Record<sourceCalendarName, { mode: "new" } | { mode: "existing", collectionId }>`), `busy`. Reads the writable calendar list through `useCollections()` (`["collections"]`) and folds `canWriteCollection` over roots and children so view-only targets are never offered; roots and children whose `kind !== "calendar"` are skipped too, because lists are task containers and never receive events. Network: `POST /api/import/preview` (multipart, repeated `files` fields) on file selection; `POST /api/import/commit` (the same files plus a JSON `mapping` field) on Import; `POST /api/import/batches/[id]/rollback` on Undo. After commit/undo it invalidates `["events"]`, `["collections"]` and `["import-batches"]`. The preview table shows overrides and a note naming any source timezone that differs from the household zone; the report repeats skipped/dropped counts; the undo toast names how many events were kept because they changed after the import (`skipped` from the rollback payload). Accessible names the e2e spec depends on: label "Google Calendar files", buttons "Continue", `Import N events`, "Undo this import", "Go to calendar", "Back". The import button is disabled while a request is in flight; errors toast the server message and leave the wizard on the current step.

**Depends on / Used by** — `next/link`, `@tanstack/react-query` (`useQueryClient`), `sonner`, `components/ui/button`, `components/import/ImportBatchesCard`, `lib/query/collections` (`useCollections`), `lib/services/permissions` (`canWriteCollection`, `foldCollectionPermission`), and the `ImportPreview`/`ImportReport`/`ImportCalendarMode` types. Rendered by `app/(app)/settings/import/page.tsx`.

**Debugging** — Selecting files shows no preview -> the preview request failed (size, not an `.ics`, no users) -> the toast carries the server message. The Import button is missing -> the mapping step never rendered because `preview` is null -> re-select the files. A committed import does not appear on the calendar -> the `["events"]` invalidation did not run, or the events landed under a collapsed `From Google` calendar -> check the tree. Undo leaves events -> the service skipped them because they were edited after the import (`skipped` in the rollback payload). Imported events hide when the Shared ("Ours") pill is hidden -> the target calendar was imported by an older version and still has `owner_id` NULL -> re-import (the new tree is personal) or change the calendar's owner in the calendar dialog.

**Tests** — `tests/e2e/import.spec.ts`; handler contracts in `tests/integration/import-api.test.ts`.

### components/import/ImportBatchesCard.tsx

**Purpose** — "Past imports" table under the wizard: one row per `import_batch` with counts, status and an Undo button while the batch is still committed.

**Public API** — `export function ImportBatchesCard({ onUndo, busy }: Props)`; `Props = { onUndo: (batchId: string) => Promise<void>; busy: boolean }`.

**State & side effects** — `useQuery(["import-batches"])` → `GET /api/import/batches`; no local state. Undo delegates to the wizard's `onUndo` (which performs the rollback, toasts and invalidates queries), so there is exactly one rollback path. Dates render with the browser locale/timezone.

**Depends on / Used by** — `@tanstack/react-query`, `sonner`, `components/ui/button`, and the `ImportBatchView` type. Rendered only by `components/import/ImportWizard.tsx`.

**Debugging** — "No imports yet." right after a commit -> the `["import-batches"]` key was not invalidated by the wizard. A row stays "Committed" after Undo -> the rollback request failed (409 after an earlier undo, 404 if it belongs to another household) -> read the toast.

**Tests** — `tests/e2e/import.spec.ts`.

## UI primitives

### components/ui/button.tsx

**Purpose** — The only button primitive: a plain `<button>` carrying the Canvas variants, sizes and focus ring. It adds no behaviour, so all click handling stays with the caller.

**Public API** — `export function Button(...)`, `export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>`. Props: `variant?: "primary" | "outline" | "ghost"` — default `"outline"`; `size?: "sm" | "md"` — default `"md"`; `type` — default `"button"`. `primary` = accent fill with a literal `#2468a2` border and `accent`/`accent-hover`/`accent-press` backgrounds; `outline` = `border-line-strong` on `bg-well`; `ghost` = transparent border. Sizes: `sm` = `h-7 px-2 text-sm`, `md` = `h-[38px] px-3 text-base`. Disabled uses `disabled:opacity-50`; focus ring is `outline-link`.

**State & side effects** — None. No ref forwarding, no loading state, no analytics.

**Depends on / Used by** — `@/lib/utils` (`cn`) only. Imported by `app/login/LoginForm.tsx`, `components/settings/SettingsForm.tsx`, `components/shell/AppShell.tsx`, `components/shell/BreadcrumbBar.tsx`, `components/sidebar/CollectionDialog.tsx`, `components/sidebar/CollectionTree.tsx`, `components/sidebar/PersonPills.tsx`, and `components/calendar/{CalendarShell,CalendarPicker,DatePickerPopover,EventDetails,EventDialog,MiniMonth,QuickCreatePopover,ShortcutHelpDialog,Toolbar}.tsx`.

**Debugging** — `a form does not submit on click -> the default type is "button"; pass type="submit"`. `the primary border stays blue after a token change -> the border is the hard-coded hex 2468a2, not the accent token -> edit the class here`. `a button renders 30px tall where the design is 38px -> size="sm" (or a caller className) -> check the call site`.

**Tests** — `tests/e2e/primitives.spec.ts` asserts the primary button is 38px tall, 4px radius and `rgb(43, 122, 188)` via `data-testid="new-event-button"`.

### components/ui/checkbox.tsx

**Purpose** — A thin styled Radix checkbox: a 4×4 box with a `CheckIcon` indicator. The visible label is always rendered by the caller; `label` only supplies the accessible name.

**Public API** — `export function Checkbox({ label, checked, onCheckedChange, className })` with `label: string`, `checked: boolean`, `onCheckedChange: (checked: boolean) => void`, `className?: string`. No `disabled`, no `id`, no forwarded ref.

**State & side effects** — None of its own. It is fully controlled: Radix's `onCheckedChange` value (`boolean | "indeterminate"`) is coerced with `value === true`, so an indeterminate state would arrive as `false`. Checked styling hangs off `data-[state=checked]`.

**Depends on / Used by** — `@radix-ui/react-checkbox`, `components/ui/icons` (`CheckIcon`), `@/lib/utils` (`cn`). Used by `components/settings/CalendarPreferencesCard.tsx` and `components/sidebar/CollectionRow.tsx` (calendar visibility).

**Debugging** — `the checkbox cannot be toggled by clicking the text -> only the box is clickable; the caller's label is a sibling span -> wrap or pass the real label. the box looks unchecked though state is true -> an uncontrolled defaultChecked was used instead of the checked prop -> check the call site. Playwright's .check() races on first load -> controlled Radix boxes need hydration -> wait for networkidle (see tests/e2e/preferences.spec.ts)`.

**Tests** — No unit test. Exercised by `tests/e2e/preferences.spec.ts` (week numbers / keyboard shortcuts) and `tests/e2e/sidebar.spec.ts`.

### components/ui/dialog.tsx

**Purpose** — Radix dialog wrapper that owns the portal, scrim, positioning and accessible title. Callers supply only content; `DialogContent` must sit inside a `Dialog` root.

**Public API** — Re-exports `Dialog`, `DialogTrigger`, `DialogClose` from `@radix-ui/react-dialog`; `export function DialogContent({ title, description, children, sheet = false })` with `title: string` (required, always rendered as the Radix title), `description?: string`, `children: React.ReactNode`, `sheet?: boolean` (default `false`, switches to a bottom sheet below `md`).

**State & side effects** — None; open state belongs to the Radix root at the call site. The overlay carries `data-testid="dialog-overlay"`. No caller passes `sheet` today (a repo grep finds no `sheet=` at a call site), so the phone bottom-sheet variant exists but is unused.

**Depends on / Used by** — `@radix-ui/react-dialog`, `@/lib/utils` (`cn`). Imported by `components/shell/BreadcrumbBar.tsx`, `components/sidebar/CollectionTree.tsx`, `components/sidebar/CollectionDialog.tsx`, `components/calendar/CalendarShell.tsx`, `components/calendar/EventDetailsPopover.tsx`, `components/calendar/QuickCreatePopover.tsx` and `components/calendar/ShortcutHelpDialog.tsx`.

**Debugging** — `the dialog paints under the sidebar/toolbar -> content is z-50 and the overlay z-40 inside the portal -> check for a caller stacking context, not the Radix root. the phone layout is still a centred box -> the caller did not pass sheet. a long form is clipped at 90dvh -> max-h-[90dvh] plus overflow-y-auto here -> scroll inside the content. Escape/outside-click does nothing -> the Dialog root has no open/onOpenChange pair -> check the caller`.

**Tests** — `tests/e2e/primitives.spec.ts` (4px radius, Canvas scrim); dialogs are also driven by `tests/e2e/details.spec.ts` and `tests/e2e/sidebar.spec.ts`. No unit test.

### components/ui/dropdown-menu.tsx

**Purpose** — Small Radix dropdown set used for the account menu, the per-collection options menu and its Visibility submenu. Content and items are pre-styled; the root, trigger, sub root and radio group are direct Radix exports.

**Public API** — `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuSub`, `DropdownMenuRadioGroup` (Radix re-exports); `DropdownMenuContent({ children })` — always portalled, `align="end"`, `sideOffset={4}`, `min-w-44`; `DropdownMenuItem({ children, onSelect, danger = false, disabled = false })` where `onSelect: (event: Event) => void` is required and receives the DOM event (call `event.preventDefault()` to keep the menu open); `DropdownMenuLabel({ children })`; `DropdownMenuSeparator()`; `DropdownMenuSubTrigger({ children, disabled = false })` — an item-shaped trigger with a trailing chevron and `data-[state=open]` highlight; `DropdownMenuSubContent({ children })` — portalled, `sideOffset={4}`, `alignOffset={-4}`, same surface as the menu; `DropdownMenuRadioItem({ children, value, disabled = false })` — a `menuitemradio` with a check indicator, bold when `data-[state=checked]`.

**State & side effects** — None; Radix owns open state, focus and the submenu's pointer grace. Items close the menu after `onSelect` unless the handler prevents default; choosing a radio item also closes it. Submenus open on hover, click, and keyboard.

**Depends on / Used by** — `@radix-ui/react-dropdown-menu`, `components/ui/icons` (`CheckIcon`, `ChevronRightIcon`), `@/lib/utils` (`cn`). Used by `components/shell/GlobalNavRail.tsx` (account menu, label + separator) and `components/sidebar/CollectionRow.tsx` (add/rename/delete/isolate, the root `Visibility` submenu, separator, `danger` delete).

**Debugging** — `selecting an item closes the menu before a nested dialog opens -> expected Radix behaviour; the item's onSelect has already run -> check the handler's order. the menu opens off the left edge -> content is hard-coded align="end"; pick a different primitive for left-aligned triggers. a disabled item still looks active -> disabled is passed but styling uses data-[disabled] -> verify the prop reached the item. a submenu renders behind the parent menu -> the sub content lost its portal/z-50 class -> this file's DropdownMenuSubContent. a submenu trigger does not open by keyboard -> the ChevronRightIcon wrapper replaced the SubTrigger -> keep the Radix SubTrigger root`.

**Tests** — No unit test. `tests/e2e/sidebar.spec.ts` drives the items via `role="menuitem"` and the visibility picks via `role="menuitemradio"`; `tests/e2e/only-this-calendar.spec.ts` drives the isolation item.

### components/ui/icons.tsx

**Purpose** — The project's only icon source: inline 24×24 stroke SVGs, no icon package. Every icon renders `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}` with round caps and joins, and is decorative unless given a `title`.

**Public API** — `export interface IconProps { size?: number; className?: string; title?: string }`; `size` defaults to `20`. Every icon is `(props: IconProps) => JSX.Element`; the internal `Svg` helper is not exported. `title` makes the SVG `role="img"` with a `<title>` child; without it the SVG is `aria-hidden="true"`. The file has no `"use client"`, so it renders from server components too.

| Icon | Use | Icon | Use |
|---|---|---|---|
| `CalendarIcon` | calendar nav / empty states | `SettingsIcon` | settings nav |
| `PlusIcon` | create / add sub-calendar | `ChevronLeftIcon` | previous period, back link |
| `ChevronRightIcon` | next period, breadcrumb | `ChevronsLeftIcon` | jump back |
| `ChevronsRightIcon` | jump forward | `CheckIcon` | checkbox indicator |
| `XIcon` | close / dismiss | `MenuIcon` | mobile menu, breadcrumb |
| `TrashIcon` | delete actions | `PencilIcon` | edit actions |
| `MoreVerticalIcon` | row overflow menu | `UserIcon` | person chips |
| `LockIcon` | private / view-only row lock | `EyeIcon` | show |
| `EyeOffIcon` | hide | `AlertTriangleIcon` | warnings |
| `SearchIcon` | search box / bar | `ChevronDownIcon` | pickers, collapsed groups |
| `TasksIcon` | Tasks rail (planned) | `TodayIcon` | Today rail (planned) |
| `NotesIcon` | Notes rail (planned) | `FocusIcon` | Focus rail (planned) |
| `ListIcon` | sidebar task-list rows (in place of a calendar swatch) | `ClockIcon` | event dialog time field |

**State & side effects** — None; pure rendering.

**Depends on / Used by** — Only `import type { ReactNode } from "react"`. Imported by `app/(app)/settings/page.tsx`, `components/ui/checkbox.tsx`, `components/shell/{AppShell,GlobalNavRail,BreadcrumbBar}.tsx`, `components/sidebar/{CollectionRow,CollectionTree}.tsx`, `components/calendar/{CalendarPicker,DateField,MiniMonth,SearchBox,TimeField,Toolbar}.tsx`; also by `tests/unit/icons.test.ts`.

**Debugging** — `an icon does not exist under the name you guessed -> names are PascalCase plus an "Icon" suffix and only the 26 in the table above exist -> import from here, never from a package. an icon ignores its size -> width/height come from the size prop with a 20 default -> check the caller. a screen reader stays silent on a meaningful icon -> pass title; otherwise aria-hidden is intentional`.

**Tests** — `tests/unit/icons.test.ts` (stroke/fill, default 20px, `aria-hidden`, `title` handling, and `ListIcon`'s shared contract).

### components/ui/toast.tsx

**Purpose** — Exports the single sonner configuration object that gives toasts the Canvas flash metrics. It is a props module, not a component: the wrapper is `<Toaster {...TOASTER_PROPS} />` mounted once in `app/providers.tsx`, and call sites import `toast` from `sonner` directly.

**Public API** — `export const TOASTER_PROPS: ToasterProps` (type imported from `sonner`): `position: "top-center"`, `closeButton: true`, and `toastOptions.classNames` for `toast` (`rounded-lg! border-2! bg-surface! shadow-flash! text-ink!`), `success` (`border-success!`), `error` (`border-danger!`), `warning` (`border-warning!`) and `info` (`border-line-strong!`). No component, function or hook is exported, and there is no project-level `toast` re-export.

**Undo / toast API used across the app** — `lib/ui/undo.ts` owns a module-level stack (max 20, cleared on reload): `pushUndo({ label, undo })` returns an opaque `UndoHandle`; `peekUndo(): string | null`; `undoLast(): Promise<boolean>` (pops the newest, returns `false` on empty or failure, toasts the failure) for the `z`/`Ctrl+Z` hotkeys; `undoAction(handle): Promise<boolean>` removes and runs exactly that action for toast buttons; `clearUndo()` is the test seam. Call sites push an action after a successful mutation and show the shared `undoToast(message, handle)` from `lib/ui/undoToast.ts`, which is `toast.success(message, { action: { label: "Undo", onClick: () => void undoAction(handle) }, duration: 10_000 })` — `CalendarShell` (moved/deleted/series deleted/occurrence skipped), `EventDialog`, `QuickCreatePopover`, `GlobalCapture` and `TasksShell`.

**State & side effects** — None in this file. The important global side effect is sonner's own runtime `<Toaster>` in `app/providers.tsx`; toast bodies, timers and the `[data-sonner-toast]` DOM live there.

**Depends on / Used by** — `import type { ToasterProps } from "sonner"`. Used only by `app/providers.tsx`. The `toast` function itself is imported from `sonner` in `components/settings/SettingsForm.tsx`, `components/settings/CalendarPreferencesCard.tsx`, `components/shell/GlobalNavRail.tsx`, `components/sidebar/CollectionTree.tsx`, `components/calendar/{CalendarShell,EventDialog,QuickCreatePopover}.tsx`, `components/shell/GlobalCapture.tsx`, `components/tasks/TasksShell.tsx` and `lib/ui/{undo,undoToast}.ts`.

**Debugging** — `toasts ignore the radius/border/shadow -> sonner injects an unlayered stylesheet that outranks Tailwind utilities; the ! modifiers here are load-bearing -> do not "clean up" the classNames. no toast appears at all -> the Toaster is mounted only in app/providers.tsx -> check that call site and the top-center position where it renders. the Undo action is a no-op -> the action was already undone or dropped (the stack clears on reload and caps at 20), or its closure threw -> check the handle passed to undoToast and push order around the mutation`.

**Tests** — `tests/e2e/undo.spec.ts` (toast Undo button, `Ctrl+Z`/`z`, dismissal), `tests/e2e/shortcuts.spec.ts` (undo toast text). No unit test for `TOASTER_PROPS`.

## Focused verification
```bash
npx vitest run tests/unit/icons.test.ts tests/integration/preferences-api.test.ts tests/integration/settings-api.test.ts
npx playwright test tests/e2e/settings.spec.ts tests/e2e/preferences.spec.ts tests/e2e/primitives.spec.ts
npm run lint && npm run typecheck
```
