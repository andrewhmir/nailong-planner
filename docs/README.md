# Documentation

Everything about how Nailong Planner works, ordered by what you need first.

## For agents and new contributors

| Read | Why |
|---|---|
| [`../AGENTS.md`](../AGENTS.md) | The rules: read these docs first, and docs ship with code (hard definition of done) |
| [`DEBUGGING.md`](DEBUGGING.md) | Start here for any bug: layer map, known traps, symptom → file → command |
| [`COMPONENTS/README.md`](COMPONENTS/README.md) | Area map for the per-file component documentation |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup, conventions, the checks CI runs |

## Reference

| Doc | Contents |
|---|---|
| [`../README.md`](../README.md) | What the project is, features, stack, quickstart |
| [`OPERATIONS.md`](OPERATIONS.md) | Environment variables, Railway deploy, backups, restore drill, account recovery |
| [`COMPONENTS/`](COMPONENTS/README.md) | One section per source file: purpose, API, side effects, callers, gotchas, tests |
| [`redesign/canvas-recon.md`](redesign/canvas-recon.md) | Canvas LMS visual-language reconnaissance behind the redesign |
| [`screenshots/`](screenshots) | Committed screenshots captured from seeded demo data |

## History (do not edit)

[`superpowers/specs/`](superpowers/specs) and [`superpowers/plans/`](superpowers/plans)
are the dated design specs and implementation plans for each milestone. They are a
record of decisions at the time, not current documentation — never update them;
write the current truth into the reference docs above.

## Keeping these docs true

- Docs for `app/`, `components/`, `lib/` and `scripts/` are enforced by
  `npm run docs:check` (also run in CI). Add a `### <repo-relative-path>` section
  for every new file; update the section when behaviour changes.
- New env vars, deploy steps or backup/restore changes go in `OPERATIONS.md`.
- New traps, root causes or reproduction commands go in `DEBUGGING.md`.
- `npm run docs:check` is fast and offline; run it before every commit that
  touches the gated directories.
