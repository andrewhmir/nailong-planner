# AGENTS.md — working in Nailong Planner

Instructions for coding agents (any harness: DSH, Claude Code, Codex, Cursor).
They exist to cut debugging iterations: **read the generated documentation before
grepping the source**, and **keep that documentation true as you change code**.

Project rules that are not about docs (stack, conventions, tests) live in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Operational docs: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## 1. Read first — this is the fast path

Before you search, reproduce or guess:

1. **`docs/DEBUGGING.md`** — layer map, data-model rules, known traps, and a
   symptom → likely file → command table. Most "where is this?" questions end here.
2. **`docs/COMPONENTS/README.md`** — maps every area of the tree to its doc file.
   Open only the doc for the area you are about to touch.
3. Only if those two do not answer it: `grep`/`glob` the source. When the docs
   were wrong or silent, **fix the doc in the same change** — that is how the next
   agent gets the shorter path.

Each component doc has a fixed per-file section, so you can jump straight to the
file you care about:

```
Purpose · Public API · State & side effects · Depends on / Used by · Debugging · Tests
```

The `Depends on / Used by` and `Debugging` lines are the ones that collapse a
debugging session: they name the callers, the storage keys, the query keys and
the known failure modes without a repo-wide search.

## 2. Documentation map

| Doc | Contents | Update when |
|---|---|---|
| [`docs/DEBUGGING.md`](docs/DEBUGGING.md) | Debugging playbook: layer map, traps, symptom table, focused commands | A trap, root cause or reproduction command changes |
| [`docs/COMPONENTS/`](docs/COMPONENTS/README.md) | Per-file component/library/route documentation | Any file under `app/`, `components/`, `lib/`, `scripts/` changes |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Env vars, deploy, backups, recovery | Deployment, env vars or operations change |
| [`README.md`](README.md) | What the project is, features, stack, quickstart | User-visible behaviour or setup changes |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, conventions, CI checks | The workflow changes |
| [`docs/superpowers/`](docs/superpowers) | Historical specs and plans | **Never** — it is a record of past work |

## 3. Definition of done — docs ship with code (hard rule)

A change is **not done** until all of the following are true:

1. **Every file added, moved, renamed or deleted** under `app/`, `components/`,
   `lib/`, or `scripts/` has its `### <repo-relative-path>` section added, moved
   or removed in the right `docs/COMPONENTS/*.md` file.
2. **Behaviour changes** update that file's `Public API`, `State & side effects`,
   `Depends on / Used by`, or `Debugging` lines — not just the heading.
3. **New feature / route / hook / service / env var / schema column / npm script**
   is written into the doc that owns it: `app-routes.md` (pages + endpoints),
   `api-layer.md` (request pipeline), `lib-services.md` (business rules),
   `lib-data.md` (schema + query keys), `lib-domain.md` (domain rules), `lib-ui.md`
   (client-state hooks), `scripts-and-ops.md` (scripts, config, CI),
   `docs/OPERATIONS.md` (env vars, deploy, backup).
4. **New test suite or spec** gets a row in `docs/COMPONENTS/tests.md`.
5. `npm run docs:check` exits 0.
6. `npm run lint`, `npm run typecheck`, `npm test` pass; UI changes also run the
   owning Playwright spec. Never run the full E2E suite as an edit loop.

`npm run docs:check` is a CI gate: a source file with no documentation section
fails the build. The output names the exact section heading and the doc file to
add it to.

## 4. How to update the component docs

1. Find the owning doc: `docs/COMPONENTS/README.md` area table, or just run
   `npm run docs:check` — it prints `add  ### <path>  →  <doc>` for every gap.
2. Add or patch the section using the template
   (`docs/COMPONENTS/README.md` has the canonical copy):

   ```markdown
   ### components/calendar/CalendarShell.tsx

   **Purpose** — one or two sentences.
   **Public API** — exported symbols, props, return types.
   **State & side effects** — hooks, query keys, mutations, storage, URL params.
   **Depends on / Used by** — imports that matter; who renders/calls it.
   **Debugging** — `symptom -> likely cause -> first thing to check`.
   **Tests** — the exact spec/test files, or "No direct test coverage".
   ```

3. Keep the heading text **exactly** the repo-relative path, alone on the `###`
   line, no backticks, no trailing prose. Use `##` headings for grouping only.
4. Be factual and present-tense: real exports, real side effects, real gotchas.
   Never document intended behaviour that the code does not have.
5. Run `npm run docs:check` and commit the code and doc changes together
   (conventional commit, e.g. `feat(calendar): …` with the doc update in the same
   commit).

A project skill (`.dsh/skills/component-docs/SKILL.md`) carries the same rules
for DSH agents and routes them here automatically.

## 5. Debugging protocol (fewer turns, less guessing)

1. `docs/DEBUGGING.md` — match the symptom in the table, read the listed trap.
2. Component doc for the suspect file — use `Depends on / Used by` to walk to the
   real source instead of grepping.
3. Run the **smallest** check that can fail:
   - `npx vitest run tests/unit/<file>.test.ts` or `tests/integration/<file>.test.ts`
   - `npx playwright test tests/e2e/<spec>.spec.ts`
   - full suites only at the end: `npm test`, then `npm run test:e2e`.
4. Reproduce before editing, state the failing evidence, then fix root cause.
5. Fix code **and** doc together; if you learned something non-obvious, add it to
   the section's `Debugging` bullets or to `docs/DEBUGGING.md` traps.

## 6. Local environment notes

- Node 22+ (`.nvmrc`), `npm install` once. `.env.local` is required for the dev
  server, migrations and provisioning (see `.env.example`).
- Playwright seeds `.playwright/test.db` and serves **:3100**; stop your own dev
  server first (Next allows one dev server per project directory).
- Never commit `.env.local`, `data/`, or real household data; screenshots come
  from `scripts/seed-test-db.mts`.
- Generated/ignored: `.next/`, `.next-e2e/`, `data/`, `test-results/`,
  `.playwright/`, `tsconfig.tsbuildinfo`.
