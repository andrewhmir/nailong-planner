# Component documentation

Every source file under `app/`, `components/`, `lib/` and `scripts/` has its own
section in one of the twelve area docs below. Each section follows the same
shape — Purpose, Public API, State & side effects, Depends on / Used by,
Debugging, Tests — so you can jump to the file you care about instead of reading
the tree.

This directory is **generated and maintained by whoever changes the code**; it is
not hand-written history. `docs/superpowers/` is the historical record and is
never edited.

## Start here

- Debugging a symptom → [`../DEBUGGING.md`](../DEBUGGING.md) first.
- Changing a file → find its area below, read that section, then patch it.
- Adding a file → `npm run docs:check` tells you the heading and the doc to add.

## Area map

| Doc | Covers | Read it when |
|---|---|---|
| [`app-routes.md`](app-routes.md) | `app/` — layouts, pages, API route handlers, global styles/tokens | Routing, auth guards, HTTP status codes, design tokens, viewport contract |
| [`api-layer.md`](api-layer.md) | `lib/api/` — request pipeline, error mapping, handlers | A route returns the wrong status/body, auth or validation rejection |
| [`lib-services.md`](lib-services.md) | `lib/services/` — SQL + business rules | Collection/event/task semantics, permissions, shade assignment, recurrence writes |
| [`lib-data.md`](lib-data.md) | `lib/db/`, `lib/query/`, `lib/auth/`, `lib/validation/` | Schema, query keys, optimistic cache updates, auth tables, Zod schemas |
| [`lib-domain.md`](lib-domain.md) | Colour, recurrence, time, env, errors, utils | Shade maths, RRULE/EXDATE expansion, all-day vs timed, error codes |
| [`lib-ui.md`](lib-ui.md) | `lib/ui/` — client state hooks and storage | View/visibility preferences, keyboard shortcuts, undo, search bus |
| [`components-calendar.md`](components-calendar.md) | `components/calendar/` | Calendar grid, quick create, event dialog/details, miniature month, search |
| [`components-shell-and-sidebar.md`](components-shell-and-sidebar.md) | `components/shell/`, `components/sidebar/` | App frame, nav rail, breadcrumbs, visibility provider, mixed collection tree |
| [`components-tasks.md`](components-tasks.md) | `components/tasks/` | Tasks workspace: capture row, scope tabs/toolbar, grouped dense list, inline pickers |
| [`components-settings-ui.md`](components-settings-ui.md) | `components/settings/`, `components/ui/` | Settings forms, preference cards, buttons/dialogs/menus/icons/toasts |
| [`tests.md`](tests.md) | `tests/` | Which suite locks a behaviour down, and the exact command to run it |
| [`scripts-and-ops.md`](scripts-and-ops.md) | `scripts/`, `drizzle/`, Docker/CI/tooling config, `package.json` | Migrations, provisioning, backups, CI jobs, deploy settings |

## Section template

Use this verbatim for a new or rewritten section:

```markdown
### components/calendar/CalendarShell.tsx

**Purpose** — one or two sentences: what it does in the product.

**Public API** — exported symbols, props/signatures, return types, key imported types.

**State & side effects** — hooks, TanStack Query keys, mutations, DOM listeners,
storage keys, URL params, timers, optimistic updates.

**Depends on / Used by** — imports that matter; the files that render or call it.

**Debugging** — `symptom -> likely cause -> first thing to check (file/function)`.

**Tests** — `tests/...` files that exercise it, or "No direct test coverage".
```

Heading rules, enforced by `npm run docs:check`:

- The `###` line holds **exactly** the repo-relative path — no backticks, no
  trailing prose, forward slashes, brackets as written:
  `### app/api/events/[id]/route.ts`
- `##` is for grouping inside a doc; `###` is reserved for file paths.
- A file is documented exactly once across the whole directory.
- Every documented path must still exist, and every gated source file must be
  documented. Tests are the exception — see below.

## The drift gate

```bash
npm run docs:check
```

It walks `app/`, `components/`, `lib/`, `scripts/`, parses the `###` headings out
of these docs (ignoring fenced code blocks), and fails when:

- a source file has no section — prints the heading and the doc to add it to;
- a documented path is gone (renamed/deleted without a doc update);
- the same path is documented twice;
- `docs/DEBUGGING.md` or this directory is missing.

Run it after any change under those directories. CI runs it in the `verify` job,
so an undocumented feature cannot merge green.

Intentionally **not** gated:

- `tests/` — documented as lookup tables in [`tests.md`](tests.md), because a
  table of "spec → behaviour → command" is more useful than 55 one-file sections.
- `app/fonts/` — vendored binary woff2 files.
- Root config files (`next.config.ts`, `Dockerfile`, …) — documented in
  [`scripts-and-ops.md`](scripts-and-ops.md) but only existence-checked, not
  required, because they are not application components.
- `docs/superpowers/` — historical specs/plans, never edited.

## Adding a new area doc

Create `docs/COMPONENTS/<area>.md` with the same shape, add it to the area map
above, and move the `###` sections for the files it takes over out of their old
doc. The gate scans every `*.md` here except this README, so a new doc needs no
code change — but `scripts/docs-check.mjs` has an `AREA_DOCS` table used to
suggest the right doc for a missing section; add the new prefix there too so the
suggestion stays accurate.
