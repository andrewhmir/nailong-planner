# Pull request

## What changed

<!-- One paragraph: what does this PR do, and why? -->

## How was it verified

<!-- Commands run, screenshots for UI changes, tests added. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run docs:check`
- [ ] `npm test`
- [ ] `npm run test:e2e` (if behaviour or layout changed)

## Notes for reviewers

<!-- Anything surprising, deliberately out of scope, or worth a second look. -->

## Checklist

- [ ] Tests cover the change (bug fixes started from a failing test)
- [ ] No secrets, `.env.local`, database files, or real household data added
- [ ] Screenshots committed for visible UI changes (`CAPTURE_SCREENSHOTS=1 npm run test:e2e`)
- [ ] Docs updated: `docs/COMPONENTS/` section added/moved/updated for every source file touched, and `npm run docs:check` passes
