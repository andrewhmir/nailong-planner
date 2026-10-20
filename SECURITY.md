# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** (GitHub Security Advisories).
3. Include reproduction steps, affected version/commit, and impact.

You can expect an initial response within a few days. Once a fix is ready it will
be released with credit to the reporter unless you prefer otherwise.

## Scope and design notes

- This is a **self-hosted, private-by-design** application: it provisions exactly
  two accounts and disables public sign-up. It is not a multi-tenant service.
- Never commit `BETTER_AUTH_SECRET`, `SEED_USER_*` passwords, `.env.local`, the
  SQLite database under `data/`, or real household data. These are gitignored;
  keep it that way.
- Run with a real (≥32 character, random) secret in any deployment, serve over
  HTTPS, and keep `AUTH_RATE_LIMIT` enabled outside local E2E runs.
- Dependencies are monitored by Dependabot and CodeQL is run in CI.
