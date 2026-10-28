import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // The production-build suite (playwright.pwa.config.ts, `npm run test:pwa`)
  // owns this spec; in dev it would run without a service worker.
  testIgnore: /pwa-offline\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // `next dev` compiles routes on first hit; leave room on a loaded machine.
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // The server renders "today" in TZ=Asia/Taipei (see webServer.env below). A
    // browser left in the host zone (UTC on CI) hydrates a different date, which
    // React reports as a hydration mismatch and which shifts every date-based
    // assertion. Pin the browser so client and server agree on the day.
    timezoneId: "Asia/Taipei",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: "file:./.playwright/test.db",
      NEXT_DIST_DIR: ".next-e2e",
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: "playwright-test-secret-0123456789abcdef",
      AUTH_RATE_LIMIT: "off",
      NODE_ENV: "development",
      TZ: "Asia/Taipei",
    },
  },
});
