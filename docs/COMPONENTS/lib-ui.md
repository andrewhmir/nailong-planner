# Client UI state

The browser-only layer that holds a device's view and visibility preferences, the keyboard and
media-query hooks, and the two pieces of session-scoped glue (search focus bus, undo stack).
Read it when a preference does not survive a reload, a shortcut fires in a text field, a hidden
calendar still draws, or an undo action does nothing.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, update its section and run `npm run docs:check`.

| File | Role |
|---|---|
| lib/ui/calendarPicker.ts | Flattens the two-level calendar tree into nested-picker rows with swatch colours |
| lib/ui/lastView.ts | Persists the last FullCalendar view per user in `localStorage` |
| lib/ui/view.ts | Resolves which view a device opens on (`auto` = phone/desktop split) |
| lib/ui/useVisibility.ts | Visibility state + per-user `localStorage` persistence |
| lib/ui/visibility.ts | Pure visibility rules — person pills, parent inheritance, "display only this" — plus the stored-state parser (calendar and list ids alike) |
| lib/ui/visibleCollections.ts | Turns the rules into the set of collection ids the grid draws |
| lib/ui/useDebouncedValue.ts | Delays a fast-changing value by `delayMs` |
| lib/ui/useKeyboardShortcuts.ts | Single-key shortcuts with the "no shortcut while typing" guard |
| lib/ui/useMediaQuery.ts | Reactive `matchMedia` subscription |
| lib/ui/useUndoHotkey.ts | Binds `z` and `Ctrl/Cmd+Z` to the undo stack |
| lib/ui/searchBus.ts | Custom-event bus for "focus the search field" |
| lib/ui/undo.ts | In-memory LIFO undo stack that the Sonner toasts call into |

## View and persistence

### lib/ui/calendarPicker.ts

**Purpose** — Pure derivation for the nested calendar picker: flatten the two-level tree into the rows the dropdown draws, decide which branch must be open, and resolve a trigger's name and swatch.

**Public API**
- `interface PickerRow { id: string; name: string; depth: 0 | 1; hasChildren: boolean; expanded: boolean; color: string }`.
- `buildPickerRows(collections: CollectionNode[], expandedIds: ReadonlySet<string>): PickerRow[]` — every root is listed; a root's `children` follow only when `expandedIds.has(root.id)`. Root rows carry `depth: 0`, `hasChildren: root.children.length > 0`, `expanded`; child rows are fixed at `depth: 1`, `hasChildren: false`, `expanded: false`.
- `expandedForSelection(collections: CollectionNode[], selectedId: string): Set<string>` — the one root whose child is selected, else an empty set (a root selection needs no branch open).
- `toggleExpanded(expanded: ReadonlySet<string>, id: string): Set<string>` — returns a new `Set`, never mutates the argument.
- `calendarSwatch(collections: CollectionNode[], id: string): { name: string; color: string } | null` — works for a root or a child anywhere in the tree, `null` for an unknown id.

**Derived rules** — Colour always comes from the *root's* family: roots render `shadeTokens(family, PARENT_SHADE_INDEX).mainHex` (slot 3) and children `shadeTokens(family, child.shadeIndex).mainHex`, so a child's stored `shadeIndex` is what distinguishes siblings. The private `familyOf` falls back to `"slate"` when `hueFamily` is null or not a `HueFamily`, which is why an uncoloured legacy calendar still renders a grey swatch.

**State & side effects** — None. No storage, no DOM, no memoisation; every call rebuilds from its arguments, so the expansion set lives in the caller's `useState`.

**Depends on / Used by** — `PARENT_SHADE_INDEX`, `shadeTokens`, `isHueFamily`, `HueFamily` from `lib/color/palette`; `CollectionRow` from `lib/db/schema`; `CollectionNode` from `lib/services/collections`. Used by `components/calendar/CalendarPicker.tsx` (all four exports) and `components/calendar/QuickCreatePopover.tsx` (`calendarSwatch`, to label the default calendar).

**Debugging**
- A sub-calendar's swatch is the same colour as its parent -> its `shadeIndex` is 3 (the parent slot) or the row is not a child -> check `collection.shade_index` and which branch of `buildPickerRows` produced the row.
- The picker opens with the selected sub-calendar collapsed -> `expandedForSelection` only opens one level and returns nothing for a stale id -> check the id passed from the toolbar and that the calendar list is fresh.
- Expanding a parent does not reveal children -> the caller stored a mutated set instead of the returned one, or `expandedIds` is a new set each render -> check `toggleExpanded` usage in `CalendarPicker.tsx`.

**Tests** — `tests/unit/calendarPicker.test.ts`; `tests/e2e/calendar-picker.spec.ts` covers the dropdown end to end.

### lib/ui/lastView.ts

**Purpose** — Remembers the last FullCalendar view this device used, per user, so a reload reopens it.

**Public API**
- `readLastView(userId: string): PlannerView | null` — `null` when nothing is stored, when the stored string is not one of `dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listMonth`, or when `localStorage` throws.
- `writeLastView(userId: string, view: PlannerView): void` — swallows storage errors.

**State & side effects** — `localStorage` key `nailong.lastView.<userId>`; the value is the bare view id (`"dayGridMonth"`), not JSON. Both accessors are wrapped in `try/catch`, so private mode degrades to "the view does not persist". The module is `"use client"` and touches `window` directly — calling it during SSR throws.

**Depends on / Used by** — `PlannerView` from `components/calendar/Toolbar`. Used by `components/calendar/CalendarShell.tsx`: written when the user changes view, read as `readLastView(currentUserId) ?? resolveInitialView(preferences.defaultView, narrow)` when the grid initialises.

**Debugging**
- The view resets to month on reload -> nothing was written (the view-change path was not reached), or the stored value failed the `VALID_VIEWS` check -> inspect `nailong.lastView.<userId>` in devtools.
- Two accounts on one device appear to share a view -> the key is per user id, so check that `currentUserId` is the session user's id and not a constant.
- A phone reopens a desktop view -> a valid stored value short-circuits `resolveInitialView` entirely, so the last view always outranks the `defaultView` preference -> clear the key to fall back to `auto`.

**Tests** — No direct unit test; `tests/e2e/view-preference.spec.ts` ("the last view survives a reload") covers it end to end.

### lib/ui/view.ts

**Purpose** — Decides the view a device opens on. `auto` is the spec's phone/desktop split: agenda on a narrow screen, month grid everywhere else.

**Public API** — `resolveInitialView(defaultView: DefaultView, narrow: boolean): PlannerView`. `auto` returns `"listMonth"` when `narrow` is true and `"dayGridMonth"` otherwise; any other `DefaultView` (`dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listMonth`) is returned unchanged.

**State & side effects** — None, and importantly this module does not query media: `narrow` is supplied by the caller. `DefaultView` additionally contains `"auto"`, so the non-`auto` branch always yields a real `PlannerView`.

**Depends on / Used by** — Types only: `PlannerView` from `components/calendar/Toolbar`, `DefaultView` from `lib/services/preferences`. Used by `components/calendar/CalendarShell.tsx` as the fallback after `readLastView`; the `narrow` argument there is `useMediaQuery("(max-width: 767px)")`.

**Debugging**
- A phone opens on the month grid -> `narrow` was false: the breakpoint is `max-width: 767px` and `useMediaQuery`'s server snapshot is `false` for the first render -> check the query string and the initial view state.
- A configured default view is ignored -> `readLastView` returned a value, which short-circuits this function -> clear `nailong.lastView.<userId>` or fix the precedence in `CalendarShell`.
- A new `DefaultView` value falls through as `auto`-like -> the function returns it verbatim; the narrowing happens in the type, so an invalid stored value is normalised in `lib/services/preferences.ts`, not here.

**Tests** — `tests/unit/view.test.ts`; `tests/e2e/view-preference.spec.ts` ("desktop defaults to month, phone defaults to list") exercises it in a real viewport.

## Visibility

### lib/ui/useVisibility.ts

**Purpose** — Holds the household's visibility state in React and persists it per user in `localStorage`, exposing the four mutators the sidebar and calendar pickers call.

**Public API**
- `interface VisibilityApi { state: VisibilityState; setGroup(group: GroupKey, visible: boolean): void; toggleCollection(id: string): void; setCollections(ids: string[], visible: boolean): void; setOnly(id: string | null): void }`.
- `useVisibility(userId: string): VisibilityApi`.

**State & side effects** — `localStorage` key `nailong.visibility.${userId}` (unchanged across the v0.2 collection rename); the value is `JSON.stringify(VisibilityState)`, i.e. `{ groups: { ours, me, partner }, collections: { <id>: boolean }, only: string | null }`. The read happens in an effect after mount (it cannot be a `useState` initialiser because the server has no `localStorage`), through `parseVisibility` from `./visibility`, then `loaded` flips true and a second effect writes on every state change; both effects swallow storage exceptions, so private mode degrades to session-only visibility. The parser is the read-side defence: `groups` is merged over `DEFAULT_VISIBILITY.groups`, only boolean `collections` entries survive, a legacy `calendars` map is not a known key (so it reads as no overrides), and `only` is kept only when it is a string. Collection ids are opaque here — a list id persists and toggles exactly like a calendar id.

**Derived rules** — Every mutator except `setOnly` sets `only: null`, which is how touching any pill or checkbox leaves the isolated "display only this calendar" view. `toggleCollection` treats a missing entry as visible (`!(previous.collections[id] ?? true)`), so the first click hides a collection rather than enabling it. `setCollections` writes the same flag for each id and replaces the map copy, never mutating the previous state.

**Depends on / Used by** — `DEFAULT_VISIBILITY`, `GroupKey`, `VisibilityState` from `./visibility`. Instantiated once in `components/shell/AppShell.tsx` (`useVisibility(currentUser.id)`) and distributed through `VisibilityProvider`/`useVisibilityApi`; the API type is imported by `components/shell/{VisibilityProvider,BreadcrumbBar}.tsx`, `components/sidebar/{PersonPills,CollectionTree}.tsx`, and the state is read by `components/calendar/CalendarShell.tsx` and `components/sidebar/SidebarMiniMonth.tsx`.

**Debugging**
- A hidden calendar comes back after a reload -> the state changed before `loaded` was true (the write effect is gated on it), or another tab overwrote the key -> watch writes to `nailong.visibility.<userId>`.
- Re-checking one calendar does not leave the isolated view -> expected: every mutator clears `only`, so the symptom points at a caller mutating state directly instead of calling the API.
- The sidebar and the grid disagree right after a change -> two independent sources: `AppShell` owns the only instance, so a second `useVisibility` call would create a second copy -> check that consumers use `useVisibilityApi`.

**Tests** — No direct unit test; the pure rules it persists are covered by `tests/unit/visibility.test.ts`, and `tests/e2e/sidebar.spec.ts` ("toggling a calendar persists across a reload") plus `tests/e2e/only-this-calendar.spec.ts` cover persistence end to end.

### lib/ui/visibility.ts

**Purpose** — The pure rules that decide whether a collection is drawn: three person pills, a per-collection checkbox, parent inheritance for sub-collections, and Google's "display only this calendar" override.

**Public API**
- `type GroupKey = "ours" | "me" | "partner"`; `GROUP_ORDER: readonly GroupKey[] = ["ours", "me", "partner"]`.
- `interface VisibilityState { groups: Record<GroupKey, boolean>; collections: Record<string, boolean>; only: string | null }` — a missing `collections` entry means visible.
- `DEFAULT_VISIBILITY: VisibilityState` — all three groups true, empty `collections`, `only: null`.
- `parseVisibility(raw: string | null): VisibilityState` — storage-read defence: missing/malformed JSON and non-objects fall back to `DEFAULT_VISIBILITY`; only boolean `groups`/`collections` entries are trusted; `only` is kept only when it is a string. A pre-v0.2 `calendars` map is ignored, so legacy storage reads as "nothing overridden".
- `effectiveOwnerOf(collection: Pick<CollectionRow, "ownerId">, parent?: Pick<CollectionRow, "ownerId"> | null): string | null` — the owner that actually applies: a child inherits its parent's owner (`parent.ownerId ?? collection.ownerId`), matching the server's `getCollectionAccess` fold.
- `groupOf(collection: Pick<CollectionRow, "ownerId">, viewerId: string, parent?: Pick<CollectionRow, "ownerId"> | null): GroupKey` — effective owner `null` -> `"ours"` (a shared collection), equals `viewerId` -> `"me"`, anything else -> `"partner"`.
- `isCollectionVisible(state, collection: Pick<CollectionRow, "id" | "ownerId">, viewerId, parent?: Pick<CollectionRow, "id" | "ownerId"> | null): boolean`. Passing the parent makes the child's pill follow the root, so a stale per-row `ownerId` on a sub-collection cannot put it in the wrong group.

**Derivation rules, in evaluation order**
1. `state.only !== null` -> exactly `collection.id === state.only`. This outranks everything, so an isolated sub-collection draws even when its pill and its parent's checkbox are off.
2. The collection's person pill (`groupOf`, folded through `parent` when one is supplied) is false -> hidden (a missing key counts as visible).
3. A `parent` is supplied and `state.collections[parent.id] === false` -> hidden. Only checked when the caller passes the parent, which is why a child's visibility is a caller responsibility outside the tree.
4. Otherwise the collection's own checkbox, defaulting to visible.

**Kind and privacy** — Collection ids are opaque: a `kind: "list"` collection groups, hides, isolates and persists exactly like a calendar one, and the rules here never read `kind`. This module is display-only and deliberately contains no privacy check: the server already filters a partner's private collections out of `GET /api/collections`, so a private row that reaches the client is one its viewer may see. Adding `visibility === "private"` logic here would create a second, divergent privacy rule.

**State & side effects** — None. No storage here — `useVisibility` owns persistence and calls `parseVisibility` on the stored value.

**Depends on / Used by** — `CollectionRow` from `lib/db/schema`. Used by `lib/ui/visibleCollections.ts` and `components/sidebar/CollectionTree.tsx` (checkbox states and the "currently visible" check used when toggling a parent for its children). `GROUP_ORDER` and `groupOf` group the tree's roots into the three sections; child checks pass the root so they group with it.

**Debugging**
- Unchecking a parent leaves children drawn -> the caller omitted the `parent` argument -> check the `isCollectionVisible(state, child, currentUserId, root)` call sites in `CollectionTree.tsx`.
- A list id does not hide although its box is unticked -> the caller passed a different id (a name, or the parent's id) -> ids are opaque; compare `collection.id`.
- A private collection is hidden locally -> a privacy check was added to this module; it is display-only and must not invent one -> remove it and check the server's `listCollections` filter instead.
- A shared calendar hides with the "me" pill -> `ownerId` is null for shared calendars, so it belongs to `ours` -> check the row's `owner_id`.
- A sub-calendar vanishes with the "Ours" pill although it renders under a person's heading -> the caller passed no `parent`, or the row's stale `owner_id` is NULL from a pre-`0004` owner move -> pass the root; migration `0004` backfills the row.
- Isolated view swallows every pill -> expected precedence for `only`; the exit path is any mutator in `useVisibility`, which sets `only: null`.
- A pre-v0.2 profile looks like every collection was re-shown -> expected: `parseVisibility` ignores the old `calendars` key -> clear `nailong.visibility.*` if the old overrides matter.

**Tests** — `tests/unit/visibility.test.ts` (calendar and list ids, `parseVisibility`'s collection/legacy keys and type defence, private rows not filtered client-side).

### lib/ui/visibleCollections.ts

**Purpose** — The single implementation of "which collection ids is the grid drawing", shared by the main grid and the sidebar mini-month so they cannot disagree.

**Public API** — `visibleCollectionIds(roots: CollectionNode[], state: VisibilityState, userId: string): Set<string>`.

**Derivation rules** — When `state.only !== null` it returns `new Set([state.only])` immediately: exact, and deliberately bypassing the branch pruning below so a sub-calendar can be isolated while its parent is filtered out. Otherwise it walks roots in order: a root that fails `isCollectionVisible(state, root, userId)` is skipped **together with all of its children** (the loop `continue`s), and each child is then tested with `isCollectionVisible(state, child, userId, root)` — the root is passed so the child's pill follows the root's owner rather than a stale child row. The result is a `Set` of ids only — never collection rows — and it is rebuilt on every call. The function never reads `kind`: a list id contributes and is pruned exactly like a calendar id, and only the consumers that draw events care that a list has none.

**State & side effects** — None. Pure over its arguments.

**Depends on / Used by** — `CollectionNode` from `lib/services/collections`; `isCollectionVisible`, `VisibilityState` from `./visibility`. Called by `components/calendar/CalendarShell.tsx` (memoised over `collections`, `currentUserId`, `visibility.state`; its result filters the fetched events by `collectionId`) and `components/sidebar/SidebarMiniMonth.tsx`.

**Debugging**
- The grid is empty while a calendar is ticked -> `state.only` is set to a different id -> check `visibility.state.only`.
- A list branch stays drawn when its root is unticked -> the caller filtered by hand instead of using the root/child pair here -> call this function with the whole mixed tree.
- Grid and mini-month disagree -> both call this function, so the difference is in the arguments (stale provider state, or a mini-month built from a different calendar list) -> log `roots.length` and `state` at both sites.
- A child shows while its parent's checkbox is off -> the root was filtered but the child test was reached, which only happens when you call `isCollectionVisible` directly instead of going through this function -> check the caller.

**Tests** — `tests/unit/visibleCollections.test.ts` (mixed calendar/list trees: list branches prune and isolate like calendar ones); `tests/e2e/sidebar.spec.ts` and `tests/e2e/only-this-calendar.spec.ts` cover the rendered result.

## Sidebar folding

### lib/ui/treeFold.ts

**Purpose** — The pure fold rules for the collection sidebar: which groups and which root collections are expanded. Folding is display-only — it hides a branch in the tree and never changes what the grid draws (that is `VisibilityState`'s job).

**Public API**
- `interface TreeFoldState { groups: Record<GroupKey, boolean>; collections: Record<string, boolean> }` — `true` means expanded, and a missing entry means expanded, so an untouched tree looks exactly as it did before folding existed. Keys are opaque collection ids: a list id folds and persists exactly like a calendar id. The storage key `nailong.treeFold.${userId}` is unchanged; a legacy `calendars` map is not a known key and reads as nothing folded.
- `DEFAULT_TREE_FOLD: TreeFoldState` — all three groups open, no collection overrides.
- `isGroupOpen(state, group): boolean`, `isCollectionOpen(state, id): boolean` — default `true` for missing entries.
- `setGroupOpen(state, group, open): TreeFoldState`, `setCollectionOpen(state, id, open): TreeFoldState` — immutable copies; children fold with their root, so only root ids are stored.
- `parseTreeFold(raw: string | null): TreeFoldState` — storage-read defence: malformed JSON, non-objects and non-boolean entries fall back to expanded; only real booleans are trusted, and only the `collections` key is read.

**State & side effects** — None; pure over its arguments. `useTreeFold` owns `localStorage`.

**Depends on / Used by** — `GroupKey` from `./visibility`. Used by `lib/ui/useTreeFold.ts`; `components/sidebar/CollectionTree.tsx` reads it only through that hook.

**Debugging**
- A folded branch reappears after a reload -> `parseTreeFold` returned defaults, which happens when the stored JSON is not an object -> inspect `nailong.treeFold.<userId>`.
- A list branch will not fold -> the tree passed the group key or a name instead of `collection.id` -> ids are opaque; log the id.
- A branch folds although the user never touched it -> a stored entry is the wrong boolean, or a second writer used the same key -> the same storage key.
- Folding is expected to hide grid calendars and does not -> wrong module: fold state must never be read by `isCollectionVisible`/`visibleCollectionIds` -> this file's header comment.
- A pre-v0.2 profile looks fully expanded -> expected: the old `calendars` key is ignored -> clear `nailong.treeFold.*` if the old folds matter.

**Tests** — `tests/unit/treeFold.test.ts` (calendar and list ids, legacy `calendars` ignored).

### lib/ui/useTreeFold.ts

**Purpose** — Holds the sidebar fold state in React and persists it per user in `localStorage`, exposing the expand/collapse mutators `CollectionTree` needs.

**Public API** — `interface TreeFoldApi { isGroupOpen(group: GroupKey): boolean; isCollectionOpen(id: string): boolean; toggleGroup(group: GroupKey): void; toggleCollection(id: string): void; expandGroup(group: GroupKey): void; expandCollection(id: string): void }`; `useTreeFold(userId: string): TreeFoldApi`.

**State & side effects** — `localStorage` key `nailong.treeFold.${userId}`; the value is `JSON.stringify(TreeFoldState)`. The read happens in an effect after mount (the server has no `localStorage`, so it cannot be a `useState` initialiser), then the write effect persists every change; both effects swallow storage exceptions, so private mode degrades to session-only folding. The write effect is gated on the key that was actually loaded (`loadedKey === storageKey`) rather than a boolean, so a `userId` change re-reads before writing and never persists the previous person's state under the new key. `expandGroup`/`expandCollection` exist so a collection created (or re-owned) into a folded group, or a sub-collection added to a folded parent, is not silently hidden.

**Depends on / Used by** — `DEFAULT_TREE_FOLD`, `parseTreeFold`, `isGroupOpen`, `isCollectionOpen`, `setGroupOpen`, `setCollectionOpen`, `TreeFoldState` from `./treeFold`; `GroupKey` from `./visibility`. Instantiated once in `components/shell/AppShell.tsx` (`useTreeFold(currentUser.id)`) and passed to `CollectionTree` as the `fold` prop, so the desktop sidebar and the phone sheet share one fold state.

**Debugging**
- Desktop and the phone sheet fold independently -> a second `useTreeFold` call was added instead of passing `AppShell`'s `fold` prop -> search for `useTreeFold(`.
- Folding one tree does not move the other -> `AppShell` must own the only instance; two instances would also fight over the same storage key -> this hook's call count.
- Fold state appears to belong to the previous account after switching users -> the write gate must compare `loadedKey` with `storageKey`; a plain `loaded` boolean reintroduces the stale write.
- Fold state appears to belong to the wrong person -> the key is per user; clear `nailong.treeFold.*` when debugging a stale local profile.

**Tests** — No direct unit test (Vitest runs in a Node environment with no DOM harness); persistence is covered end to end by `tests/e2e/sidebar.spec.ts` ("folding a parent hides its sub-calendars and remembers the fold", "folding a group hides the whole group and remembers the fold").

## Keyboard, media queries and debouncing

### lib/ui/wheelNav.ts

**Purpose** — Pure gesture maths for Google Calendar's scroll-to-navigate: turn wheel events over the calendar grid into "previous period / next period / nothing", with trackpad accumulation and a per-gesture cooldown. `CalendarShell` owns the actual listener and calls FullCalendar's `next()`/`prev()`.

**Public API** — `stepWheel(accumulator: number, gesture: WheelGesture): WheelStep` where `WheelGesture = { deltaX; deltaY; ctrlKey?; metaKey? }` and `WheelStep = { accumulator; direction: -1 | 0 | 1 }`; `wheelNavAllowed(lastNavigatedAt: number, now: number): boolean`; constants `WHEEL_NAV_THRESHOLD` (40) and `WHEEL_NAV_COOLDOWN_MS` (500).

**State & side effects** — None (pure). `stepWheel` adds `deltaY` to the accumulator, returns direction 1 (down/forward) or -1 (up/backward) once `|accumulator| >= 40` and resets it; a horizontal-dominant or ctrl/meta (pinch-zoom) gesture resets the accumulator and yields 0. `wheelNavAllowed` is a plain elapsed-time check.

**Depends on / Used by** — No imports. Called by `components/calendar/CalendarShell.tsx`'s wheel effect: it also skips the gesture when the target sits in a vertically scrollable `.fc-scroller` (week/day hours, list view), when a `role="dialog"` is open, or while an event is being dragged/resized.

**Debugging**
- The wheel does nothing over the month grid -> the listener did not attach (grid ref missing) or a dialog is open -> the effect in `CalendarShell.tsx` and its `[role="dialog"]` guard.
- One flick jumps several months -> the cooldown branch was dropped, so every accumulated wheel event navigates -> `wheelNavAllowed` and `lastWheelNavAt`.
- The trackpad needs many swipes before it moves -> the threshold was raised above 40 -> `WHEEL_NAV_THRESHOLD`.
- Week/day view stopped scrolling its hours -> the scrollable-`.fc-scroller` escape hatch was removed from the wheel handler -> `CalendarShell.tsx`.

**Tests** — `tests/unit/wheelNav.test.ts`; end-to-end in `tests/e2e/mini-month.spec.ts` ("a wheel gesture over the grid moves to the next month").

### lib/ui/useDebouncedValue.ts

**Purpose** — Returns the previous value until `delayMs` has passed without a change; used so typing in the search box issues one query, not one per keystroke.

**Public API** — `useDebouncedValue<T>(value: T, delayMs: number): T`. Initialised with `value` via `useState`, so the very first render returns it immediately; each change of `value` or `delayMs` restarts a `setTimeout`, cleared on change and on unmount.

**State & side effects** — One `useState`, one `useEffect`, one pending timer per mounted hook. No storage, no listeners.

**Depends on / Used by** — `react` only. Called by `components/calendar/SearchBox.tsx` as `useDebouncedValue(query, 150)`; the debounced value is what the query hook receives.

**Debugging**
- A request fires per keystroke -> the caller passed `query` instead of the debounced value -> check `SearchBox.tsx`'s query argument.
- The first result flashes the previous term -> expected, the hook holds the last value for `delayMs` -> do not "fix" it by seeding state in an effect.
- A query never fires -> the component unmounts before the timer elapses, or the returned value is not the one handed to the query hook -> trace the value inside `SearchBox.tsx`.

**Tests** — No direct test coverage; `tests/e2e/search.spec.ts` covers the input end to end.

### lib/ui/useKeyboardShortcuts.ts

**Purpose** — Binds Google Calendar's single-key shortcuts (`spec §7.9 / D7`) on `window`, while refusing to fire from text fields, while a modifier is held, and while a dialog or menu is open. Undo is deliberately not here — `useUndoHotkey` owns `z` and `Ctrl/Cmd+Z`.

**Public API** — `useKeyboardShortcuts(enabled: boolean, handlers: ShortcutHandlers): void` with
`ShortcutHandlers = { onCreateFull; onCreateAtCursor; onFocusSearch; onToday; onView(view: PlannerView); onPeriod(direction: 1 | -1); onEditSelected; onDeleteSelected; onHelp; onEscape; onOpenDatePicker? }`.
`onOpenDatePicker` is optional; when it is absent the `g` key is ignored entirely (and not `preventDefault`ed).

**Key map** — `?` help, `/` focus search, `Shift+C` quick create at the viewport centre, `Delete`/`Backspace` delete selected, `c` full editor, `t` today, `d`/`w`/`m`/`l` = `timeGridDay`/`timeGridWeek`/`dayGridMonth`/`listMonth`, `j`/`n` next period (+1), `k`/`p` previous period (-1), `e` edit selected, `g` date picker, `Escape` close. Every handled key calls `preventDefault()` except `Escape` and `g`.

**The guards, in order**
1. The listener is attached only while `enabled` is true, and never reacts to `event.repeat`, `ctrlKey`, `metaKey` or `altKey`.
2. **No shortcut while typing**: `isTextEntryTarget(event.target)` returns true for `INPUT`, `TEXTAREA`, `SELECT` or `isContentEditable`, and then the handler returns before any key is looked at.
3. `hasOpenOverlay()` checks `document.querySelector('[role="dialog"], [role="menu"]')`. `Escape` is handled *before* this check but returns early when an overlay is open (Radix owns Escape); every other key is dropped once an overlay exists.
4. Shift is a separate branch: only `Shift+C` is a gesture (the key is lowercased first because browsers differ on `"C"` vs `"c"`), and shifted keys return without falling through to the letter switch.

Handlers are mirrored into a ref by an effect that runs after every render, so the `keydown` listener closes over the latest callbacks while the effect itself only re-subscribes when `enabled` changes.

**State & side effects** — One `window` `keydown` listener and one ref. No storage, no URL params.

**Depends on / Used by** — `PlannerView` from `components/calendar/Toolbar`. Mounted once in `components/calendar/CalendarShell.tsx` as `useKeyboardShortcuts(preferences.shortcutsEnabled, {...})`; the settings toggle in `components/settings/SettingsForm.tsx` flips that preference.

**Debugging**
- No shortcut works -> `enabled` is false (`shortcutsEnabled` preference) or focus sits in an input/textarea -> check the preference row and `document.activeElement`.
- Shortcuts fire while typing an event title -> the target is not an `INPUT`/`TEXTAREA` (for example a `div[role="textbox"]` in a custom field) -> check `isTextEntryTarget` and the field's element.
- `Escape` closes nothing, or closes two things -> `hasOpenOverlay` found a leftover `[role="dialog"]`/`[role="menu"]` in the DOM -> inspect the open overlay stack.
- A shortcut still fires while a dialog is open -> its container lacks `role="dialog"`/`role="menu"` -> check the overlay component.
- `z` does not undo -> by design, see `useUndoHotkey`.

**Tests** — `tests/e2e/shortcuts.spec.ts` (today/week, `c` with typing, `?`, the settings toggle, `z` vs `Delete`).

### lib/ui/useMediaQuery.ts

**Purpose** — Reactive `(max-width: 767px)`-style queries via `useSyncExternalStore`, with a server snapshot of `false` so hydration matches the first client render.

**Public API** — `useMediaQuery(query: string): boolean`. `subscribe` registers a `change` listener on `window.matchMedia(query)` and returns its removal; `getSnapshot` re-reads `.matches`; the server snapshot is the constant `false`.

**State & side effects** — One `MediaQueryList` per subscribe call (created and discarded, not stored) and its `change` listener; `subscribe`/`getSnapshot` are memoised on the `query` string, so a new string identity per render still re-subscribes only when the string differs. No storage. Because the server snapshot is `false`, a phone renders the desktop branch first and flips after hydration.

**Depends on / Used by** — `react` only. Used by `components/calendar/CalendarShell.tsx` (`narrow`), `QuickCreatePopover.tsx` and `EventDetailsPopover.tsx` (`isPhone`), all with `(max-width: 767px)`.

**Debugging**
- Layout visibly jumps after mount -> expected: `false` on the server, real value on the client -> make the consumer's markup hydration-tolerant instead of seeding a different default.
- A query never flips -> the consumer passed a value that is not a constant string, or the browser does not support the feature -> log `window.matchMedia(query).matches`.
- A resize does not re-render -> the media feature is unsupported, or the consumer's `query` string changes between renders so the subscription is torn down and rebuilt -> log `window.matchMedia(query).matches` and hoist the string to a constant.

**Tests** — No direct test coverage; `tests/e2e/view-preference.spec.ts` and `tests/e2e/mobile.spec.ts` run real viewports.

### lib/ui/useUndoHotkey.ts

**Purpose** — Binds Google Calendar's two undo gestures, plain `z` and `Ctrl/Cmd+Z`, to the shared undo stack, while leaving native text undo alone.

**Public API** — `useUndoHotkey(): void`. Attaches one `window` `keydown` listener for the lifetime of the calling component; no arguments, no return value.

**Accepted gestures** — The key must be `z`/`Z` with neither `altKey` nor `shiftKey` (so `Ctrl+Shift+Z` redo is ignored). `plain` = neither `ctrl` nor `meta`; `modified` = exactly one of them (holding both is not the gesture). Either one passes, then `preventDefault()` and `void undoLast()`.

**The typing guard** — `isEditableTarget(event.target)` returns true for `INPUT`, `TEXTAREA`, `SELECT` or `isContentEditable`, and the handler returns immediately: `Ctrl+Z` while typing must edit the text, never revert an event. This is a different helper from `useKeyboardShortcuts`' `isTextEntryTarget`, so the two lists can drift.

**State & side effects** — One `window` listener, no state, no storage. It calls into module-level undo state (`lib/ui/undo.ts`), so an undo triggered here is the same stack the toasts use.

**Depends on / Used by** — `undoLast` from `./undo`. Mounted once in `components/calendar/CalendarShell.tsx` (`useUndoHotkey()`).

**Debugging**
- `Ctrl+Z` reverts an event while the cursor is in a field -> the field is not a text-entry element (a `div[role="textbox"]`, a canvas editor) -> check `isEditableTarget` and the field's markup.
- `z` stops working after a reload -> expected: the undo stack is module state and empty after a reload -> `lib/ui/undo.ts`.
- Undo fires twice for one keystroke -> two components mounted the hook, or another listener also calls `undoLast` -> grep `useUndoHotkey` and `undoLast` call sites.

**Tests** — `tests/e2e/undo.spec.ts` (`Ctrl+Z`, plain `z`, `z` in a title field).

## Search bus and undo

### lib/ui/searchBus.ts

**Purpose** — A tiny event bus with two channels: "focus the search field" (shortcut layer, mobile search button, future command palette) and "the user just picked this search result". Both avoid prop drilling through the shell.

**Public API**
- `focusSearch(): void` — `window.dispatchEvent(new CustomEvent(FOCUS_EVENT))`.
- `onFocusSearch(callback: () => void): () => void` — adds a `window` listener for the same event and returns the removal function for effect cleanup.
- `interface EventLink { date: string; eventId: string }` — the `YYYY-MM-DD` to jump to plus the chosen event id.
- `announceEventLink(link: EventLink): void` — dispatches `"nailong:event-link"` with the link in `event.detail`, **before** the router push.
- `onEventLink(callback: (link: EventLink) => void): () => void` — same listener/cleanup pair for that channel.

**State & side effects** — No module state beyond the two event-name constants `"nailong:focus-search"` and `"nailong:event-link"`; no storage, no URL params. Both functions touch `window`, so the module is `"use client"` and must not run during SSR. Every subscriber gets its own listener (no dedupe), and dispatch is synchronous.

**Depends on / Used by** — No imports. `focusSearch` is dispatched from `components/calendar/CalendarShell.tsx` (`onFocusSearch: focusSearch`, reached by the `/` shortcut) and subscribed once in `components/calendar/SearchBox.tsx` (`useEffect(() => onFocusSearch(() => inputRef.current?.focus()), [])`). `announceEventLink` is dispatched by `SearchBox.choose()` and subscribed by `CalendarShell`, which uses the click-time `overlaySeqRef` value as the deep link's baseline — `useSearchParams()` only reflects the new URL after the navigation commits, which is late enough for the user to start a new event.

**Debugging**
- `/` does not focus the field -> `SearchBox` is not mounted (its panel is closed), or the shortcut is disabled -> check `useKeyboardShortcuts` `enabled` and whether the search box renders.
- Two components steal focus -> two `SearchBox` instances are mounted and both subscribe -> check the shell's render tree.
- A search result opens the details popover *and* leaves a newer quick-create bubble up -> the announced link is missing or its `date`/`eventId` do not match the pushed URL -> check `SearchBox.choose()` and the shell's `onEventLink` subscription.
- The listener leaks on remount -> the effect returned nothing; both `on*` helpers return the removal, so return it from `useEffect`.

**Tests** — No direct unit test; `tests/e2e/search.spec.ts` ("slash focuses search and Escape closes the results", "starting a new event before the deep link lands never stacks two popups", "choosing a search result replaces an open quick-create bubble") covers both channels end to end.

### lib/ui/undo.ts

**Purpose** — A session-scoped LIFO undo stack (`spec D5`). The UI pushes an action after a mutation succeeds, and the Sonner "Undo" toast action plus the `z`/`Ctrl+Z` hotkeys call `undoLast`.

**Public API**
- `interface UndoAction { label: string; undo: () => Promise<void> | void }`.
- `pushUndo(action: UndoAction): void` — appends, then `shift()`s from the front while the stack exceeds `MAX_UNDO = 20`.
- `peekUndo(): string | null` — the top action's `label`, or `null` when empty.
- `undoLast(): Promise<boolean>` — pops the top action and awaits `action.undo()`; returns `true` on success, and on a thrown error shows `toast.error(error.message ?? "Could not undo that change.")` and returns `false`. `false` also means "stack was empty".
- `clearUndo(): void` — empties the stack (test seam).

**Stack shape and toast integration** — The stack is a module-level `UndoAction[]` (newest last, consumed from the end), holding closures — not serialisable payloads — so it cannot be persisted and a reload clears it. This module creates no success toast: each call site pushes and then shows its own Sonner toast with `action: { label: "Undo", onClick: () => void undoLast() }` and a 10-second duration (`undoToast` in `components/calendar/CalendarShell.tsx`, plus the same pattern in `EventDialog.tsx` and `QuickCreatePopover.tsx`). `toast` is imported here only for the error path. The undo closures typically replay the inverse mutation through the TanStack Query hooks.

**State & side effects** — Module-level mutable `stack`, capped at 20; one `sonner` `toast.error` on failure. No storage, no listeners, not shared across tabs or users on the same browser tab.

**Depends on / Used by** — `toast` from `sonner`. Used by `components/calendar/CalendarShell.tsx` (four push sites plus the toast helper), `components/calendar/EventDialog.tsx`, `components/calendar/QuickCreatePopover.tsx`, and `lib/ui/useUndoHotkey.ts`.

**Debugging**
- The Undo toast button does nothing -> the stack is empty because the mutation path never called `pushUndo` (a drag or a delete that bypasses it), or a reload cleared it -> log `peekUndo()` at the call site.
- Undo restores the wrong item -> the stack is global LIFO across every entity and every calendar, not per event -> check the `pushUndo` call order in `CalendarShell`.
- A failed undo loses the action -> `undoLast` pops **before** running the closure, so a thrown error cannot be retried -> check the error toast and re-push if retry matters.
- Undo appears twice -> both the toast action and the hotkey ran; the second call pops the next action or returns `false` -> expected for a double trigger, so look for two triggers.

**Tests** — No direct unit test; `tests/e2e/undo.spec.ts` covers the toast, `Ctrl+Z`, plain `z`, `z` after the toast is dismissed, and typing `z` in a title field.

## Focused verification

```bash
npx vitest run tests/unit/calendarPicker.test.ts tests/unit/view.test.ts tests/unit/visibility.test.ts tests/unit/visibleCollections.test.ts tests/unit/treeFold.test.ts
npm run lint && npm run typecheck
```
