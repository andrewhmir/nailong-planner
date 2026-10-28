# Client UI state

The browser-only layer that holds a device's view and visibility preferences, the keyboard and
media-query hooks, and the two pieces of session-scoped glue (search focus bus, undo stack).
Read it when a preference does not survive a reload, a shortcut fires in a text field, a hidden
calendar still draws, or an undo action does nothing.

**How to update this doc:** every source file in this area has its own `### <repo-relative path>` section. When you add, move, or delete a file, update its section and run `npm run docs:check`.

| File | Role |
|---|---|
| lib/ui/calendarPicker.ts | Flattens the `kind="calendar"` collection tree into nested-picker rows with swatch colours; list branches are skipped |
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
| lib/ui/undo.ts | In-memory undo stack: targeted handles for toasts, LIFO for the hotkeys |
| lib/ui/undoToast.ts | Success toast whose Undo action reverts exactly the change the toast names |
| lib/ui/taskDrag.ts | The `text/x-nailong-task` drag payload contract (id + previous `dueOn`) shared by task rows and their drop targets |
| lib/ui/taskDeepLink.ts | Pure decision table for the one-shot `/tasks?task=` deep link (settle-before-handled rule) |
| lib/ui/taskViewParams.ts | The `/tasks` toolbar's URL state: defaults, parse and merge (replace, never push) |
| lib/ui/taskUndo.ts | The delete-undo payloads: the re-create input and the restore PATCH (priority/status survive an undo) |
| lib/ui/useTaskPlanDrop.ts | Drop→PATCH `dueOn` handler with a targeted undo and the `Due date set` toast |

## View and persistence

### lib/ui/calendarPicker.ts

**Purpose** — Pure derivation for the nested calendar picker: flatten the calendar (`kind="calendar"`) part of the two-level tree into the rows the dropdown draws, decide which branch must be open, and resolve a trigger's name and swatch. The picker chooses an event target, so it deliberately emits calendars only.

**Public API**
- `interface PickerRow { id: string; name: string; depth: 0 | 1; hasChildren: boolean; expanded: boolean; color: string }`.
- `buildPickerRows(collections: CollectionNode[], expandedIds: ReadonlySet<string>): PickerRow[]` — every `kind === "calendar"` root is listed; a root's `children` follow only when `expandedIds.has(root.id)`. A `kind === "list"` root is skipped entirely and so is any non-calendar child, so a mixed calendar/list tree renders only its calendars. Root rows carry `depth: 0`, `hasChildren: root.children.length > 0`, `expanded`; child rows are fixed at `depth: 1`, `hasChildren: false`, `expanded: false`.
- `expandedForSelection(collections: CollectionNode[], selectedId: string): Set<string>` — the one root whose child is selected, else an empty set (a root selection needs no branch open).
- `toggleExpanded(expanded: ReadonlySet<string>, id: string): Set<string>` — returns a new `Set`, never mutates the argument.
- `calendarSwatch(collections: CollectionNode[], id: string): { name: string; color: string } | null` — works for a root or a child anywhere in the tree, `null` for an unknown id.

**Derived rules** — Colour always comes from the *root's* family: roots render `shadeTokens(family, PARENT_SHADE_INDEX).mainHex` (slot 3) and children `shadeTokens(family, child.shadeIndex).mainHex`, so a child's stored `shadeIndex` is what distinguishes siblings. The private `familyOf` falls back to `"slate"` when `hueFamily` is null or not a `HueFamily`, which is why an uncoloured legacy calendar still renders a grey swatch.

**State & side effects** — None. No storage, no DOM, no memoisation; every call rebuilds from its arguments, so the expansion set lives in the caller's `useState`.

**Depends on / Used by** — `PARENT_SHADE_INDEX`, `shadeTokens`, `isHueFamily`, `HueFamily` from `lib/color/palette`; `CollectionRow` from `lib/db/schema`; `CollectionNode` from `lib/services/collections`. Used by `components/calendar/CalendarPicker.tsx` (all four exports) and `components/calendar/QuickCreatePopover.tsx` (`calendarSwatch`, to label the default calendar).

**Debugging**
- A sub-calendar's swatch is the same colour as its parent -> its `shadeIndex` is 3 (the parent slot) or the row is not a child -> check `collection.shade_index` and which branch of `buildPickerRows` produced the row.
- An event picker lists a task list -> the `kind` filter was dropped from `buildPickerRows` (or a caller built picker rows itself) -> check the `root.kind`/`child.kind` guards; the server also rejects a list target with 400 "Events live in calendars.".
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

**Purpose** — The single implementation of "which collection ids is the grid drawing", shared by the main grid and the sidebar mini-month so they cannot disagree — plus its exact complement, which the tasks workspace sends to `GET /api/tasks` so the person pills filter tasks as well as calendars.

**Public API** — `visibleCollectionIds(roots: CollectionNode[], state: VisibilityState, userId: string): Set<string>` and `hiddenCollectionIds(roots: CollectionNode[], state: VisibilityState, userId: string): string[]` (sorted; the complement of the drawn set, including every child of a hidden root).

**Derivation rules** — When `state.only !== null` it returns `new Set([state.only])` immediately: exact, and deliberately bypassing the branch pruning below so a sub-calendar can be isolated while its parent is filtered out. Otherwise it walks roots in order: a root that fails `isCollectionVisible(state, root, userId)` is skipped **together with all of its children** (the loop `continue`s), and each child is then tested with `isCollectionVisible(state, child, userId, root)` — the root is passed so the child's pill follows the root's owner rather than a stale child row. The result is a `Set` of ids only — never collection rows — and it is rebuilt on every call. The function never reads `kind`: a list id contributes and is pruned exactly like a calendar id, and only the consumers that draw events care that a list has none. `hiddenCollectionIds` flattens `[root, ...root.children]` in that order and keeps the ids the visible set does not contain, then sorts them so the resulting query string (and TanStack key) is stable across renders.

**State & side effects** — None. Both are pure over their arguments.

**Depends on / Used by** — `CollectionNode` from `lib/services/collections`; `isCollectionVisible`, `VisibilityState` from `./visibility`. `visibleCollectionIds` is called by `components/calendar/CalendarShell.tsx` (memoised over `collections`, `currentUserId`, `visibility.state`; its result filters the fetched events by `collectionId`) and `components/sidebar/SidebarMiniMonth.tsx`. `hiddenCollectionIds` is called by `components/tasks/TasksShell.tsx`, which passes the result to `useTasks` (and filters its `lists` picker projections by the same set).

**Debugging**
- The grid is empty while a calendar is ticked -> `state.only` is set to a different id -> check `visibility.state.only`.
- A list branch stays drawn when its root is unticked -> the caller filtered by hand instead of using the root/child pair here -> call this function with the whole mixed tree.
- Grid and mini-month disagree -> both call this function, so the difference is in the arguments (stale provider state, or a mini-month built from a different calendar list) -> log `roots.length` and `state` at both sites.
- A child shows while its parent's checkbox is off -> the root was filtered but the child test was reached, which only happens when you call `isCollectionVisible` directly instead of going through this function -> check the caller.
- A hidden person's tasks still paint, or the tab badge counts them -> `hiddenCollectionIds` was not passed to `useTasks`, or the two calls saw different trees (the set must come from the same `["collections"]` payload the sidebar draws) -> check `TasksShell`'s `hiddenIds` memo and the `useTasks` fourth argument.

**Tests** — `tests/unit/visibleCollections.test.ts` (mixed calendar/list trees: list branches prune and isolate like calendar ones; `hiddenCollectionIds` pill/checkbox/`only` complements and the empty tree); `tests/e2e/sidebar.spec.ts`, `tests/e2e/only-this-calendar.spec.ts` and `tests/e2e/tasks.spec.ts` cover the rendered result.

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

### lib/ui/shortcutGuards.ts

**Purpose** — The two guards every single-key keyboard layer shares: "this event started in a text field" and "a Radix dialog/menu/popover is open". Task 9 extracted them from `useKeyboardShortcuts.ts` and `useUndoHotkey.ts`, which had drifted into two copies (`isTextEntryTarget` vs `isEditableTarget`), so the calendar keys, the task triage keys, the undo hotkeys and the global `Shift+K` capture all agree on when a key belongs to the page.

**Public API**
- `isTextEntryTarget(target: EventTarget | null): boolean` — true when the target is an `HTMLElement` whose `tagName` is `INPUT`, `TEXTAREA` or `SELECT`, or whose `isContentEditable` is true. Non-element targets (`window`, `document`, `null`) are false.
- `hasOpenOverlay(): boolean` — `document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]') !== null`. Radix Dialog and DropdownMenu provide those roles; a Radix Popover's content carries no role, so its positioned wrapper is matched by the data attribute instead — the task due-date popover blocks page keys while it is open.

**State & side effects** — Neither function stores state; both read browser globals at call time (`HTMLElement`, `document`). They must not be called during SSR; importing the module is safe because nothing runs until a function is invoked.

**Depends on / Used by** — No imports. Used by `lib/ui/useKeyboardShortcuts.ts` (calendar keys), `lib/ui/useUndoHotkey.ts` (`z` / `Ctrl+Z`), `lib/ui/useTaskShortcuts.ts` (triage keys) and `components/shell/GlobalCapture.tsx` (`Shift+K`).

**Debugging**
- A shortcut fires while typing -> the field is not one of the four recognised shapes (for example a `div[role="textbox"]`) -> add it here, not in each hook.
- Page keys still fire under a dialog or popover -> the overlay container lacks `role="dialog"`/`role="menu"`, and (for a popover) the positioned wrapper is missing `data-radix-popper-content-wrapper` -> check the overlay component.
- Escape closes two things -> the overlay's own handler and a page hook both ran -> the hook checks `hasOpenOverlay()` before dispatching Escape.

**Tests** — `tests/unit/shortcut-guards.test.ts` installs a fake `HTMLElement`/`document`, asserts all four editable shapes plus ordinary elements/null/non-element targets, and checks the overlay selector matches dialogs, menus and the Radix popper wrapper.

### lib/ui/useKeyboardShortcuts.ts

**Purpose** — Binds Google Calendar's single-key shortcuts (`spec §7.9 / D7`) on `window`, while refusing to fire from text fields, while a modifier is held, and while a dialog or menu is open. Undo is deliberately not here — `useUndoHotkey` owns `z` and `Ctrl/Cmd+Z`.

**Public API** — `useKeyboardShortcuts(enabled: boolean, handlers: ShortcutHandlers): void` with
`ShortcutHandlers = { onCreateFull; onCreateAtCursor; onFocusSearch; onToday; onView(view: PlannerView); onPeriod(direction: 1 | -1); onEditSelected; onDeleteSelected; onHelp; onEscape; onOpenDatePicker? }`.
`onOpenDatePicker` is optional; when it is absent the `g` key is ignored entirely (and not `preventDefault`ed).

**Key map** — `?` help, `/` focus search, `Shift+C` quick create at the viewport centre, `Delete`/`Backspace` delete selected, `c` full editor, `t` today, `d`/`w`/`m`/`l` = `timeGridDay`/`timeGridWeek`/`dayGridMonth`/`listMonth`, `j`/`n` next period (+1), `k`/`p` previous period (-1), `e` edit selected, `g` date picker, `Escape` close. Every handled key calls `preventDefault()` except `Escape` and `g`.

**The guards, in order**
1. The listener is attached only while `enabled` is true, and never reacts to `event.repeat`, `ctrlKey`, `metaKey` or `altKey`.
2. **No shortcut while typing**: `isTextEntryTarget(event.target)` from `./shortcutGuards` returns true for `INPUT`, `TEXTAREA`, `SELECT` or `isContentEditable`, and then the handler returns before any key is looked at.
3. `hasOpenOverlay()` (also from `./shortcutGuards`) checks `document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')`. `Escape` is handled *before* this check but returns early when an overlay is open (Radix owns Escape); every other key is dropped once an overlay exists.
4. Shift is a separate branch: only `Shift+C` is a gesture (the key is lowercased first because browsers differ on `"C"` vs `"c"`), and shifted keys return without falling through to the letter switch.

Handlers are mirrored into a ref by an effect that runs after every render, so the `keydown` listener closes over the latest callbacks while the effect itself only re-subscribes when `enabled` changes.

**State & side effects** — One `window` `keydown` listener and one ref. No storage, no URL params.

**Depends on / Used by** — `PlannerView` from `components/calendar/Toolbar` and the shared guards from `./shortcutGuards`. Mounted once in `components/calendar/CalendarShell.tsx` as `useKeyboardShortcuts(preferences.shortcutsEnabled, {...})`; the settings toggle in `components/settings/SettingsForm.tsx` flips that preference.

**Debugging**
- No shortcut works -> `enabled` is false (`shortcutsEnabled` preference) or focus sits in an input/textarea -> check the preference row and `document.activeElement`.
- Shortcuts fire while typing an event title -> the target is not an `INPUT`/`TEXTAREA` (for example a `div[role="textbox"]` in a custom field) -> check `isTextEntryTarget` in `./shortcutGuards.ts`.
- `Escape` closes nothing, or closes two things -> `hasOpenOverlay` found a leftover `[role="dialog"]`/`[role="menu"]` in the DOM -> inspect the open overlay stack.
- A shortcut still fires while a dialog is open -> its container lacks `role="dialog"`/`role="menu"` -> check the overlay component.
- `z` does not undo -> by design, see `useUndoHotkey`.

**Tests** — `tests/e2e/shortcuts.spec.ts` (today/week, `c` with typing, `?`, the settings toggle, `z` vs `Delete`); the guard primitives are unit-tested in `tests/unit/shortcut-guards.test.ts`.

### lib/ui/useTaskShortcuts.ts

**Purpose** — The `/tasks` page's keyboard triage layer: `j`/`k` move the row selection, `1`/`2`/`3` triage into Today / the end of this week / Someday, `4` moves to the next writable list, `x` completes, `Enter` opens, `?` lists the keys and `Escape` clears the selection. `1`/`2` set the single due date; `3` clears the due date and its time, so a dated row drops back to Someday; an already-undated row is told `Already in Someday` instead of issuing a no-op PATCH. It is page-scoped like the calendar hook: the calendar's `j`/`k` still mean period navigation on `/`, and the task keys do nothing there because the hook is mounted by `TasksShell` only.

**Public API**
- `type TaskShortcutAction = { kind: "move"; delta: 1 | -1 } | { kind: "bucket"; bucket: 1 | 2 | 3 } | { kind: "next-list" } | { kind: "complete" } | { kind: "open" } | { kind: "help" } | { kind: "escape" }`.
- `interface TaskShortcutHandlers { onMoveSelection(delta: 1 | -1); onBucket(bucket: 1 | 2 | 3); onNextList(); onComplete(); onOpen(); onHelp(); onEscape(); }`.
- `type SomedayTriageAction = { kind: "clear-due" } | { kind: "already-someday" }` and `resolveSomedayTriage({ dueOn, dueTime }): SomedayTriageAction` — the **pure** decision table behind `3` (no view or list id: an undated task is Someday in every list); either a `dueOn` or a `dueTime` means the task is still "dated", so the shell clears the due pair, while a row with neither already says `Already in Someday`; the shell owns the PATCH/toast.
- `resolveTaskShortcut(event: KeyboardEvent): TaskShortcutAction | null` — the **pure** key map; no DOM reads and no side effects.
- `useTaskShortcuts(enabled: boolean, handlers: TaskShortcutHandlers): void`.

**Key map**

| Key | Action | Notes |
|---|---|---|
| `j` / `k` | `move` +1 / -1 | Clamped by the shell; from no selection `j` starts at the first row and `k` at the last. |
| `1` | `bucket` 1 | `dueOn = localToday(timezone)`; the stored `dueTime` is left alone. |
| `2` | `bucket` 2 | `dueOn = endOfWeek(today, weekStartsOn)`; on the household week's last day this equals today, so the task appears in Today (D6). |
| `3` | `bucket` 3 | Dated task: clears `dueOn` **and** `dueTime` in one PATCH, so it drops back to Someday. Already-undated task: toasts `Already in Someday` (no PATCH). |
| `4` | `next-list` | Cycles through the viewer's writable collections (calendars and lists); the shell toasts when there is no other collection. |
| `x` | `complete` | PATCHes `status: "done"`. |
| `Enter` | `open` | Calls the shell's `openTask`, which opens `TaskPanel` for the selection. |
| `?` | `help` | Opens `TaskShortcutHelpDialog`. |
| `Escape` | `escape` | Clears the selection (no overlay is open when this fires). |

`resolveTaskShortcut` ignores `event.repeat`, Ctrl/Cmd/Alt, and shifted keys other than `?` (so the calendar's `Shift+C` never reaches triage); Caps Lock uppercase letters still map because letter comparison is lower-cased.

**Guards** — `useTaskShortcuts` applies the shared `isTextEntryTarget(event.target)` and `hasOpenOverlay()` from `./shortcutGuards` before resolving: typing `j` in the capture field or a task title never moves the selection, and no task key leaks through an open dialog/menu/popover. `Enter` is also left to native activation when focus is on a button, link, menu item or checkbox inside the row (the status/priority/due chip, Options and the completion checkbox are all buttons), so the focused control opens/toggles instead of the panel hand-off. When `enabled` is false (the `shortcutsEnabled` preference) the listener is never attached.

**State & side effects** — One `window` `keydown` listener plus a handlers ref (the listener closes over the latest handlers while re-subscribing only when `enabled` flips). No storage, no queries.

**Depends on / Used by** — `./shortcutGuards` and React. Mounted once by `components/tasks/TasksShell.tsx`; the row selection lives there, not in this hook.

**Debugging**
- `j`/`x` do nothing -> `shortcutsEnabled` is off, focus is in an input/textarea, or a dialog/menu is open -> check the `data-shortcuts-enabled` attribute on `[data-testid="tasks-shell"]`, `document.activeElement`, and the overlay stack.
- `j` scrolls the page instead of moving -> the handler did not `preventDefault` (the action was not recognised) -> check the key map’s shift/modifier branches.
- Task keys fire on the calendar -> `useTaskShortcuts` moved out of `TasksShell` into `AppShell`/a server layout -> the hook must stay page-scoped.
- Pressing `Enter` does nothing -> the focused element is a button/menu item (native activation wins) or no row is selected -> `TasksShell`'s `openSelection`, or this file's native-activation guard.

**Tests** — `tests/unit/use-task-shortcuts.test.ts` (every mapping, modifiers, repeats, shifted keys, Caps Lock, unknown keys, and the `resolveSomedayTriage` table: `clear-due` for a `dueOn`, a `dueTime` or both, and `already-someday` for a row with neither); the guard side is in `tests/unit/shortcut-guards.test.ts`; the end-to-end triage flow (`2` → `Due this week`, then `x`) is scenario 2 of `tests/e2e/tasks.spec.ts`.

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

**The typing guard** — `isTextEntryTarget(event.target)` from `./shortcutGuards` returns true for `INPUT`, `TEXTAREA`, `SELECT` or `isContentEditable`, and the handler returns immediately: `Ctrl+Z` while typing must edit the text, never revert an event. This is the same shared predicate the calendar and task shortcut hooks use, so the three lists cannot drift.

**State & side effects** — One `window` listener, no state, no storage. It calls into module-level undo state (`lib/ui/undo.ts`), so an undo triggered here is the same stack the toasts use.

**Depends on / Used by** — `undoLast` from `./undo` and `isTextEntryTarget` from `./shortcutGuards`. Mounted once per page: `components/calendar/CalendarShell.tsx` and `components/tasks/TasksShell.tsx` (the listener is `window`-scoped, but only the mounted page is live, so the two never both exist).

**Debugging**
- `Ctrl+Z` reverts an event while the cursor is in a field -> the field is not a text-entry element (a `div[role="textbox"]`, a canvas editor) -> check `isTextEntryTarget` in `./shortcutGuards.ts`.
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

**Purpose** — A session-scoped undo stack (`spec D5`). The UI pushes an action after a mutation succeeds and gets an opaque handle back; the toast helper (`lib/ui/undoToast.ts`) uses that handle to undo exactly the change its toast names, while the `z`/`Ctrl+Z` hotkeys call `undoLast` (newest first).

**Public API**
- `interface UndoAction { label: string; undo: () => Promise<void> | void }`.
- `type UndoHandle = UndoAction` — an opaque token: the action object itself, matched by identity, so a structurally equal copy is not a handle.
- `pushUndo(action: UndoAction): UndoHandle` — appends and returns the handle, then `shift()`s from the front while the stack exceeds `MAX_UNDO = 20` (a dropped action's handle stops matching).
- `peekUndo(): string | null` — the top action's `label`, or `null` when empty.
- `undoLast(): Promise<boolean>` — pops the newest action and runs it; `true` on success, `false` when the stack was empty or the closure threw (after `toast.error`).
- `undoAction(handle: UndoHandle): Promise<boolean>` — removes and runs that exact action if it is still on the stack; `false` and nothing run for an action already undone, dropped by the cap or never pushed. A thrown closure still shows `toast.error` and returns `false`.
- `clearUndo(): void` — empties the stack (test seam).

**Stack shape and toast integration** — The stack is a module-level `UndoAction[]` (newest last, consumed from the end), holding closures — not serialisable payloads — so it cannot be persisted and a reload clears it. This module creates no success toast: call sites push, keep the returned handle and call `undoToast(message, handle)` from `lib/ui/undoToast.ts`. `toast` is imported here only for the error path. The undo closures typically replay the inverse mutation through the TanStack Query hooks. Toast Undo is **targeted** (it reverts its own action even when newer actions landed inside the toast window); `undoLast` (the hotkeys) is LIFO across the whole session.

**State & side effects** — Module-level mutable `stack`, capped at 20; one `sonner` `toast.error` on failure. No storage, no listeners, not shared across tabs or users on the same browser tab.

**Depends on / Used by** — `toast` from `sonner`. Used by `lib/ui/undoToast.ts`, `lib/ui/useUndoHotkey.ts`, `components/calendar/CalendarShell.tsx` (event move, delete, series delete and skip-occurrence pushes), `components/calendar/EventDialog.tsx` and `QuickCreatePopover.tsx` (event create), `components/shell/GlobalCapture.tsx` (capture) and `components/tasks/TasksShell.tsx` (task mutations), plus `lib/ui/useTaskPlanDrop.ts` (a dropped task's plan).

**Debugging**
- The Undo toast button does nothing -> the action was already undone (a second click), was dropped by the 20-action cap, or the mutation path never pushed it -> log `peekUndo()` at the call site and check the handle passed to `undoToast`.
- Undo restores the wrong item -> the toast still calls `undoLast()` instead of its own handle, or a no-op PATCH pushed an action -> check `undoToast(message, handle)` at the call site.
- A failed undo loses the action -> both `undoLast` and `undoAction` remove the entry **before** running it, so a thrown error cannot be retried -> check the error toast and re-push if retry matters.
- `z` reverts a newer change than the toast you clicked -> intended: the toast is targeted, the hotkey is LIFO.

**Tests** — `tests/unit/undo.test.ts` covers push/handle identity, `undoLast` LIFO, targeted `undoAction`, never-pushed/already-undone/structural-copy handles, the thrown-closure error path and the `MAX_UNDO` cap; `tests/e2e/undo.spec.ts` covers the toast button, `Ctrl+Z`, plain `z`, `z` after the toast is dismissed and `z` in a title field; `tests/e2e/tasks.spec.ts` scenario 2 covers two captures in one toast window with the older toast's Undo.

### lib/ui/undoToast.ts

**Purpose** — The single success-toast-with-Undo helper: a 10-second Sonner success toast whose "Undo" action reverts exactly the action that produced the message.

**Public API** — `undoToast(message: string, handle: UndoHandle): void`. No other exports.

**State & side effects** — Calls `toast.success(message, { action: { label: "Undo", onClick: () => void undoAction(handle) }, duration: 10_000 })`; the handler is fire-and-forget (Sonner dismisses the toast on click) and `undoAction` reports failures through its own `toast.error`. No storage, no query work, no state.

**Depends on / Used by** — `sonner` (`toast`) and `./undo` (`undoAction`, `UndoHandle`). Call sites: `components/calendar/CalendarShell.tsx` ("Event moved to …", "Event deleted", "Series deleted", "Occurrence skipped"), `components/calendar/EventDialog.tsx` and `QuickCreatePopover.tsx` ("Event created"), `components/shell/GlobalCapture.tsx` ("Task captured") and `components/tasks/TasksShell.tsx` (task complete/drop/delete/due/move), plus `lib/ui/useTaskPlanDrop.ts` ("Due date set").

**Debugging**
- The toast's Undo reverts the wrong change -> the call site showed the toast without the handle from its own `pushUndo`, or reused another action's handle -> check the `undoToast(message, handle)` argument.
- The toast's Undo does nothing -> the action was already undone or dropped (returns `false` silently), or its closure threw (its own error toast) -> `lib/ui/undo.ts`.
- A toast has no Undo button -> the call site used plain `toast.success`/`toast(...)` -> this file's contract.

**Tests** — No direct unit test (a thin Sonner wrapper); `tests/e2e/undo.spec.ts` and `tests/e2e/tasks.spec.ts` scenario 2 exercise it end to end.

## Task views

### lib/ui/taskViewParams.ts

**Purpose** — The pure URL codec for the `/tasks` toolbar: read `layout`, `group`, `sort`, `closed`, `status`, `priority` and `list` into a `TaskViewState`, fall back to the defaults for missing or unknown values, and merge the state back while leaving `?task=` and any other unknown params untouched. It is also the scope codec: `parseTaskScope` reads `?view=` (absent, unknown and the retired `inbox` all mean All) and `mergeTaskScopeParams` writes a real scope or deletes `view` for All. It is the module of record for spec §6's "all non-`view` params are client state mirrored with `router.replace`".

**Public API**
- `interface TaskViewState { layout: TaskLayout; group: GroupBy; sort: TaskSort; closed: boolean; status: TaskStatus[]; priority: TaskPriority[]; collectionId: string | null }`.
- `DEFAULT_TASK_VIEW_STATE` — `{ layout: "list", group: "status", sort: "manual", closed: false, status: [], priority: [], collectionId: null }`.
- `parseTaskViewState(params: URLSearchParams): TaskViewState` — `layout`/`group`/`sort` only accept their enum members, otherwise they default; `closed` is true only for the literal `closed=1`; `status`/`priority` are comma-separated, trimmed, filtered to `TASK_STATUS_ORDER`/`TASK_PRIORITY_ORDER`, and de-duplicated in first-seen order; `list` is the `collectionId` and an empty value is `null`; the value may be a root **or** a sub-collection id, and the shell expands a root to `{self} ∪ children` when filtering (the URL keeps the raw id). `view`/`task` are ignored by design.
- `mergeTaskViewParams(base: URLSearchParams, state: TaskViewState): URLSearchParams` — returns a new `URLSearchParams` (never mutates `base`): it deletes every managed key (`layout`, `group`, `sort`, `closed`, `status`, `priority`, `list`) and writes back only non-defaults — `layout`/`group`/`sort` when they differ from the default, `closed=1` when closed rows are shown, comma-joined `status`/`priority` when non-empty, and `list=<id>` when a collection is selected.
- `DEFAULT_TASK_SCOPE: TaskScope = "all"`; `parseTaskScope(params: URLSearchParams): TaskScope` — a valid `view` wins, everything else (absent, unknown, `inbox`) falls back to `all`.
- `mergeTaskScopeParams(base: URLSearchParams, scope: TaskScope): URLSearchParams` — returns a new params object with `view=<scope>` for today/week/someday and `view` **deleted** for `all`, so switching Today → All cannot leave a stale `view=today` in the URL.

**State & side effects** — None: pure over its arguments; a fresh params object and fresh arrays on every call, no storage, no React, no router. The caller owns the URL write.

**Replace, never push** — Toolbar changes must call `router.replace` with `mergeTaskViewParams(searchParams, state)`, not `router.push`: spec §6 makes the non-`view` params view state, so Back must leave `/tasks` instead of stepping through every filter change, while a reload or a shared URL restores the same layout/group/sort/filters. `view` and `task` survive the toolbar merge precisely so switching scope or closing the panel does not drop the other params; the scope itself is then written by `mergeTaskScopeParams`, which deletes `view` for All.

**Depends on / Used by** — `TaskLayout`, `GroupBy`, `TaskSort`, `TASK_STATUS_ORDER` and `TASK_PRIORITY_ORDER` from `lib/domain/taskViews`; `TASK_SCOPES`/`TaskScope` from `lib/domain/tasks`; `TaskStatus`/`TaskPriority` types from `lib/db/schema`. Used by `components/tasks/TasksShell.tsx` (the shell parses the initial state and scope, re-parses both on every URL change, and writes them back through `updateState`/`changeScope`/`clearTaskParam`) and rendered from by `components/tasks/TaskToolbar.tsx` (`TaskViewState` only).

**Debugging**
- A toolbar choice does not survive a reload -> the shell wrote local state only, or `mergeTaskViewParams` was not given the full state -> check the `/tasks` URL and the merge argument.
- Back steps through every filter change -> the caller used `router.push` -> replace it with `router.replace`; this module only builds the params.
- A stale `layout=board`/`closed=1` comes back after selecting the defaults -> the merge's delete pass was skipped and it set values on top of `base` -> check `mergeTaskViewParams`.
- A filter is on but the rows ignore it -> the value is not one of the enum members and `parseTaskViewState` dropped it -> log the parsed state; statuses are `open`/`in_progress`/`done`/`dropped`, priorities `none`/`low`/`normal`/`high`/`urgent`.
- A list filter selects the wrong list -> `list` is the collection id, never the list name -> check the value.
- A calendar filter misses its sub-calendars' tasks -> the URL stores only the selected root id; the shell's `filterCollectionIds` must expand it to `{self} ∪ children` before `filterTasks` -> `components/tasks/TasksShell.tsx`.

**Tests** — `tests/unit/task-view-params.test.ts` (defaults, valid parse with unknown values dropped, duplicate collapse, unknown enum fallbacks, merge preserving `view`/`task`, stale managed params cleared, non-default round-trip; plus `parseTaskScope`'s All default/unknown/retired fallbacks and `mergeTaskScopeParams` deleting `view` for All, writing the three time scopes and never mutating the base).

### lib/ui/taskUndo.ts

**Purpose** — The two payloads behind "delete + undo". There is no trash table, so undoing a delete re-creates the row: `POST /api/tasks` restores everything a create accepts (title, notes, dates, list, **priority**, and `in_progress`), and one PATCH restores what a create cannot — the checklist, the original list position and a closed `done`/`dropped` status, whose `completedAt`/`droppedAt` the service stamps on that transition. Extracted from `TasksShell.deleteTaskWithUndo` so the payloads are unit-tested without a renderer.

**Public API**
- `deletedTaskCreateInput(task: TaskView): CreateTaskInput` — `{ title, notes, collectionId, dueOn, dueTime, priority }`, plus `status: "in_progress"` when the deleted row was in progress. `open` is the server default so no status key is sent for it, and a closed status is never a create value (`POST /api/tasks` accepts only the active pair). The due time is sent only alongside a due date (the service rejects a time alone).
- `deletedTaskRestorePatch(task: TaskView): UpdateTaskInput` — `checklist` mapped to `{ title, done }` when the task has items, `sortOrder` when it was not `0`, and `status` when it is `done`/`dropped`; `{}` when the create body already said everything.

**State & side effects** — None: pure over the `TaskView`, no fetch, no storage. The shell owns the requests (`createTask.mutateAsync` then, only when the patch is non-empty, `updateTask.mutateAsync`).

**Depends on / Used by** — `TaskView` from `lib/services/tasks` (type only) and `CreateTaskInput`/`UpdateTaskInput` from `lib/validation/tasks` (type only). Used by `components/tasks/TasksShell.tsx` (`deleteTaskWithUndo`). The re-created task gets a new id; the old one is gone.

**Debugging**
- Undo of a delete brings the task back with `priority: "none"` or `status: "open"` -> the shell inlined the create body again instead of calling `deletedTaskCreateInput` -> this file.
- Undo of a delete loses the checklist or the position -> the restore PATCH was skipped or built by hand -> `deletedTaskRestorePatch` plus the shell's "only when non-empty" call.
- Undo of a done/dropped delete leaves the audit timestamps null -> `status` was sent in the create body (which ignores a closed value) instead of the restore PATCH -> `deletedTaskCreateInput`/`deletedTaskRestorePatch`.
- A delete undo fires a PATCH that changes nothing -> the `{}` guard was dropped -> the shell's `Object.keys(restore).length === 0` early return.

**Tests** — `tests/unit/task-undo.test.ts` (exact create/patch objects for open, in_progress, done with checklist + sortOrder, and dropped, including that `priority` always travels and that no status key is sent for `open`).

### lib/ui/taskDrag.ts

**Purpose** — One place for the HTML5 drag contract that lets a task row be dragged onto a day: the custom MIME type, the source-side payload (the task id **and** the row's `dueOn` at `dragstart`) and the target-side read/guard. Sharing it keeps the row, the month grid and the sidebar mini month from drifting apart on a string literal or a payload shape. The previous due date travels with the drag instead of being looked up in a cache at drop time, because cached `["tasks", …]` payloads can disagree and Undo must restore the date the dragged row actually showed.

**Public API** — `export const TASK_DRAG_TYPE = "text/x-nailong-task"`; `export interface DragTransfer` (the structural subset of `DataTransfer` the helpers need: `types`, `getData`, `setData`, `effectAllowed`, `dropEffect`); `export interface TaskDragPayload { id: string; dueOn: string | null }`; `export interface TaskDragSource` (the same two fields, what a row hands to the source helper); `isTaskDrag(transfer: Pick<DragTransfer, "types"> | null | undefined): boolean`; `setTaskDragPayload(transfer: DragTransfer, task: TaskDragSource): void` (writes JSON `{ id, dueOn }` and sets `effectAllowed = "move"`); `readTaskDrag(transfer: DragTransfer | null | undefined): TaskDragPayload | null` (null for a non-task drag, an empty payload, a legacy raw-id payload, corrupt JSON, a missing/empty `id`, or a `dueOn` that is neither `null`/absent nor `YYYY-MM-DD`; an absent field reads back as `null`).

**State & side effects** — None; pure and DOM-free. The caller owns the actual `DataTransfer`; only `dragover`/`drop` listeners call `preventDefault`, and only after `isTaskDrag` is true. JSON is used so a `null` date survives `setData` and so a malformed drag is rejectable rather than PATCHed into the column.

**Depends on / Used by** — No imports. Used by `components/tasks/TaskRow.tsx` (`setTaskDragPayload`), `components/calendar/CalendarView.tsx`, `components/calendar/MiniMonth.tsx`, `components/sidebar/SidebarMiniMonth.tsx` (`isTaskDrag`, `readTaskDrag`, `TaskDragPayload`) and `lib/ui/useTaskPlanDrop.ts` (`TaskDragPayload`).

**Debugging**
- A drag of an event, file or text is accepted by a day cell -> the `preventDefault` moved outside the `isTaskDrag` guard -> this file's callers.
- A task row drops nothing -> the source and target disagree on the MIME type (one hardcoded it) -> this file's `TASK_DRAG_TYPE`.
- `readTaskDrag` returns null on a real drop -> the browser does not expose the custom type on `dragover`; check the payload is set in `dragstart` via `setTaskDragPayload` -> this file.
- A drop works but Undo restores the wrong day -> the source stamped `dueOn` from something other than the rendered row, or the drop target passed its own date as the previous value -> `TaskRow.onDragStart` and `useTaskPlanDrop`.

**Tests** — `tests/unit/task-drag.test.ts` (source stamp incl. a null date, move effect, type recognition, read-back of the undo date, and rejection of other drags / empty / raw-id / corrupt / bad-date payloads).

### lib/ui/taskBoardDrag.ts

**Purpose** — The status board's HTML5 drag contract: one custom MIME type (`application/x-nailong-task-status`) plus the source/target helpers, so a board card and a board column agree on the payload without duplicating a string literal. It is deliberately a **third** drag type, separate from `lib/ui/taskDrag.ts`'s row→day payload: a column accepts only the board type, so dragging a row onto a column (or a card onto a calendar day) cannot change a status or plan a task.

**Public API** — `export const BOARD_DRAG_TYPE = "application/x-nailong-task-status"`; `export type BoardDragTransfer = DragTransfer` (the `DataTransfer` subset from `lib/ui/taskDrag.ts`: `types`, `getData`, `setData`, `effectAllowed`, `dropEffect`); `setBoardDragPayload(transfer, taskId): void` (writes the raw id and sets `effectAllowed = "move"`); `readBoardDragPayload(transfer: BoardDragTransfer | null | undefined): string | null`.

**State & side effects** — None; pure and DOM-free (the caller owns the real `DataTransfer`). The payload is the raw task id, not JSON: a drop needs nothing else, and the column already has the task because the id must name a card that is currently rendered. **Corrupt payload handling:** the only corruption a plain string can carry is an empty or whitespace-only value (a browser that exposes the type on `dragover` but withholds the data on `drop`, or a hand-built empty `setData`) — it reads as `null`, and a padded value is trimmed back to the id. A non-empty id that no longer names a rendered card is not "corrupt" at this layer: `TaskBoard` resolves it against the cards it is rendering and silently ignores a miss, so a stale drag can never PATCH an unknown task.

**Depends on / Used by** — `lib/ui/taskDrag.ts` (`DragTransfer`, type-only). Used by `components/tasks/TaskBoardCard.tsx` (`setBoardDragPayload` on `dragstart`) and `components/tasks/TaskBoard.tsx` (`BOARD_DRAG_TYPE` in `dragover`, `readBoardDragPayload` on `drop`).

**Debugging**
- A card drag is rejected by every column -> the card wrote the row's `text/x-nailong-task` payload instead of this type -> `components/tasks/TaskBoardCard.tsx` `onDragStart`.
- A column accepts a task row dragged from the list -> the `dragover` guard stopped checking `BOARD_DRAG_TYPE` -> `components/tasks/TaskBoard.tsx`.
- A drop is a silent no-op -> the payload read as `null` (empty/whitespace) or the id is not in the current filtered board -> this file plus `TaskBoard`'s `byId` lookup.
- A same-column drop produces no toast -> intended: the column ignores a drop whose card already has that status -> `TaskBoard.onDrop`.

**Tests** — `tests/unit/task-board-drag.test.ts` (round trip, move effect, board type only — the calendar type and plain text are rejected — null for a missing type/empty/whitespace payload, trimming, null transfer).

### lib/ui/taskDeepLink.ts

**Purpose** — The pure decision table behind `TasksShell`'s `/tasks?task=<id>` effect (the shareable `?task=` link). It exists because the effect's correctness is an ordering rule, not a branch: the param may only be marked handled once its lookup settles. React 19's development StrictMode (`reactStrictMode: true`) runs setup → cleanup → setup, so the first closure is cancelled before its `GET` lands; an early marker makes the second setup return and no editor ever opens. The table keeps the second setup on `await-request` (the promise is cached in a ref keyed by the param) and only then on `skip`.

**Public API** — `export type TaskDeepLinkAction = "reset" | "skip" | "open-cached" | "await-request" | "fetch"`; `export interface TaskDeepLinkState { param: string | null; handled: string | null; hasCachedRow: boolean; pendingParam: string | null }`; `taskDeepLinkAction(state): TaskDeepLinkAction`. Order: no param → `reset`; `handled === param` → `skip` (one-shot even if a stale row is cached); a cached row → `open-cached`; a pending request for the same param → `await-request`; otherwise `fetch`.

**State & side effects** — None; a pure function over plain values (no React, no fetch, no storage). `TasksShell` owns the refs it is fed (`deepLinkHandledRef`, `deepLinkRequestRef`) and the `GET`/`setEditorTask`/`router.replace` side effects.

**Depends on / Used by** — No imports. Used by `components/tasks/TasksShell.tsx` (the deep-link effect). The effect's `GET /api/tasks/{id}` is the normal path, not a fallback: a chip is only drawn for a task with a due date, so it can sit outside the loaded scope (for example dated beyond this week while Someday is open).

**Debugging**
- A chip click lands on `/tasks?task=<id>` with no editor, and only in dev -> the handled marker was set before the request settled (or the in-flight promise cache was dropped), so StrictMode's second setup skipped while the first closure was cancelled -> this file's table plus `TasksShell`'s effect.
- The editor reopens after being dismissed -> `handled` was cleared while the param still names the task, or `closeEditor` stopped calling `router.replace("/tasks")` -> `components/tasks/TasksShell.tsx`.
- A second chip for a different task does not open it -> `handled` was compared across params instead of per param -> this file's `handled === param` rule.

**Tests** — `tests/unit/task-deep-link.test.ts` (absent param, cached row, StrictMode setup → cleanup → setup sequence never skipping before a settle, one-shot after a settle, and a new param after a settle fetching again).

### lib/ui/useTaskPlanDrop.ts

**Purpose** — The shared "a task was dropped on a day" handler. Both month-grid drop surfaces use it: the sidebar mini month (the practical target on `/tasks`, where the rows are) and the full month grid's day cells. It PATCHes `dueOn` (the stored `dueTime`, if any, is left untouched), toasts `Due date set` with a targeted Undo that restores the exact previous date, and toasts `Could not set the due date.` on failure.

**Public API** — `useTaskPlanDrop(): (drag: TaskDragPayload, date: string) => void`. No other exports.

**State & side effects** — `useUpdateTask()` (the optimistic PATCH hook); it starts no query and reads no cache. The previous `dueOn` comes from the drag payload, stamped by the dragged row at `dragstart` (`lib/ui/taskDrag.ts`), so Undo restores the date the user saw even when cached views disagree. A drop onto the row's own due day is a silent no-op (the server echo guard also skips the toast when the row is unchanged). Otherwise it pushes `{ label: "Set due date", undo: PATCH dueOn back }` and calls `undoToast("Due date set", handle)`; failures toast `Could not set the due date.`.

**Depends on / Used by** — `react` (`useCallback`), `sonner`, `lib/query/tasks` (`useUpdateTask`), `./undo` (`pushUndo`), `./undoToast`, `./taskDrag` (`TaskDragPayload`). Used by `components/calendar/CalendarShell.tsx` (`onTaskDrop` for the full grid) and `components/shell/AppShell.tsx` (passed to both `SidebarMiniMonth` instances).

**Debugging**
- The Undo clears the date instead of restoring the previous day -> the payload stamped `null` because the source read the wrong field, or the drop target rebuilt the payload from a cache instead of passing `readTaskDrag`'s result -> `components/tasks/TaskRow.tsx`, `lib/ui/taskDrag.ts`.
- A drop toasts but the row does not move -> the PATCH failed (view-only list, 404) -> read the network response; the optimistic patch rolls back.
- A drop on the same day shows a toast -> the `dueOn === date` no-op guard was dropped -> this file.
- Two drops in one toast window undo the wrong plan -> the toast was shown without `pushUndo`'s handle -> this file plus `lib/ui/undoToast.ts`.

**Tests** — No direct unit test (a TanStack mutation hook; the repo has no hook-test harness). The payload it consumes is unit-tested in `tests/unit/task-drag.test.ts`. The row→mini-month drop has **no e2e after the v0.2.1 rewrite** (the old `tasks.spec` scenario 3 was deleted with the Plan popover); the hook's PATCH/undo path is shared with the calendar's own drop handling.

## Focused verification

```bash
npx vitest run tests/unit/calendarPicker.test.ts tests/unit/view.test.ts tests/unit/visibility.test.ts tests/unit/visibleCollections.test.ts tests/unit/treeFold.test.ts tests/unit/shortcut-guards.test.ts tests/unit/use-task-shortcuts.test.ts tests/unit/undo.test.ts tests/unit/task-drag.test.ts tests/unit/task-deep-link.test.ts tests/unit/task-undo.test.ts
npm run lint && npm run typecheck
```
