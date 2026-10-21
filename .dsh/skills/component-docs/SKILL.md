---
name: component-docs
description: Use when adding, moving, renaming, deleting or changing the behaviour of any file under app/, components/, lib/ or scripts/ in Nailong Planner, when adding a feature, route, hook, service, env var, schema column or npm script, or when starting to debug a bug or failing test. Keeps docs/COMPONENTS/ and docs/DEBUGGING.md accurate and routes debugging through them instead of blind grepping.
---

# Nailong Planner component docs

This repository documents every source file under `app/`, `components/`,
`lib/` and `scripts/` in `docs/COMPONENTS/*.md`, one `### <repo-relative path>`
section per file, and it documents the debugging map in `docs/DEBUGGING.md`.
`npm run docs:check` is a CI gate: an undocumented source file fails the build.

## When this skill fires

- You are about to **read, edit, add, move or delete** a file under `app/`,
  `components/`, `lib/` or `scripts/`.
- You are **debugging** anything, or a test/build failed and you do not already
  know the cause.
- You are adding a **feature** — including a route, endpoint, hook, service,
  env var, schema column or npm script.

## Workflow

1. **Before searching the code**, read `docs/DEBUGGING.md` and then the single
   area doc that owns the code you are about to touch. The area map is in
   `docs/COMPONENTS/README.md`. Each section lists the file's purpose, exports,
   side effects, callers, gotchas and tests — that is usually the whole session's
   research.
2. **If you must grep anyway**, note what the docs lacked.
3. **Make the change**, then keep the docs true:
   - new/moved/deleted file → add/move/delete its `### <path>` section;
   - behaviour change → update that section's `Public API`,
     `State & side effects`, `Depends on / Used by` or `Debugging` lines;
   - new feature → update the owning doc (`app-routes.md`, `api-layer.md`,
     `lib-services.md`, `lib-data.md`, `lib-domain.md`, `lib-ui.md`,
     `scripts-and-ops.md`) and `docs/OPERATIONS.md` for env/deploy changes;
   - new spec → add a row to `docs/COMPONENTS/tests.md`;
   - a trap you learned → add it to `docs/DEBUGGING.md`.
4. Run `npm run docs:check`. It prints `add  ### <path>  →  <doc>` for every
   missing section — copy that heading into the named doc.
5. Verify with the smallest check that can fail (`npx vitest run <file>`,
   `npx playwright test <spec>`), then `npm run lint && npm run typecheck`.
6. Commit code and docs together (conventional commit). Read `AGENTS.md` for the
   full definition of done.

## Section template (canonical copy in docs/COMPONENTS/README.md)

```markdown
### components/calendar/CalendarShell.tsx

**Purpose** — one or two sentences.
**Public API** — exported symbols, props, return types.
**State & side effects** — hooks, query keys, mutations, storage, URL params.
**Depends on / Used by** — imports that matter; who renders/calls it.
**Debugging** — `symptom -> likely cause -> first thing to check`.
**Tests** — the exact spec/test files, or "No direct test coverage".
```

Heading rules: the `###` line contains exactly the repo-relative path — no
backticks, no trailing prose, forward slashes, brackets kept as written
(`app/api/events/[id]/route.ts`). `##` is for grouping; `###` is reserved for
paths. A file may be documented exactly once.

## Do not

- Do not document intended behaviour the code does not have.
- Do not hand-edit `docs/superpowers/` — it is the historical record.
- Do not gate on tests: `tests/` is documented as lookup tables in `tests.md`.
- Do not add a section for generated or binary files (`app/fonts/*`).
