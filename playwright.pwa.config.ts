import { defineConfig, devices } from "@playwright/test";

/**
 * Production-build PWA suite. Unlike `playwright.config.ts` (which runs
 * `next dev` and therefore must never register a service worker), this config
 * starts the built app with `next start` so registration, caching and offline
 * behaviour are real. Run it with `npm run build && npm run test:pwa`.
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /pwa-offline\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    timezoneId: "Asia/Taipei",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: BASE_URL,
    // Never reuse a dev server: the whole point is the production build.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: "file:./.playwright/test.db",
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: "playwright-test-secret-0123456789abcdef",
      AUTH_RATE_LIMIT: "off",
      TZ: "Asia/Taipei",
    },
  },
});
