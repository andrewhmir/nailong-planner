# Contributing

Thanks for taking a look. This is a small, opinionated household planner, so
contributions are most welcome as **issues first**: describe the problem or the
idea, and we can agree on the shape before a PR.

## Getting set up

```bash
npm install
cp .env.example .env.local
# edit .env.local: BETTER_AUTH_SECRET, BETTER_AUTH_URL, SEED_USER_1_*, SEED_USER_2_*
npm run db:migrate
npm run provision
npm run dev            # http://localhost:3000
```

Node 22+ is required (`engines` in `package.json`, `.nvmrc` pins it).

## Before opening a pull request

Run the same checks CI runs:

```bash
npm run lint
npm run typecheck
npm test               # Vitest unit + integration (in-memory SQLite)
npm run test:e2e       # Playwright; seeds .playwright/test.db first
```

`npm run test:e2e` starts its own dev server on **:3100** with the seeded test
database. Next allows only one dev server per project directory, so stop your
own `npm run dev` (or let Playwright use the existing :3100 server) before
running it.

## Code conventions

- TypeScript everywhere, strict mode, no `any` unless a library boundary forces it.
- Next.js App Router: server components by default, `"use client"` only where
  interactivity or browser APIs are needed.
- SQL access lives in `lib/services/*`; keep it there.
- Tailwind utility classes for styling; design tokens live in `app/globals.css`.
- Tests are required for behaviour changes — bug fixes start with a failing test.
  The viewport and layout guarantees live in `tests/e2e/viewport-fit.spec.ts`;
  keep them green when touching the shell or the calendar.

## Commits and branches

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`),
one concern per commit. Branch names: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`.

## Privacy

Never commit real credentials, `.env.local`, the SQLite database under `data/`,
or screenshots containing real household data. The seeded demo data
(`scripts/seed-test-db.mts`) is what the committed screenshots are captured
from — see `tests/e2e/screenshot.spec.ts`.
