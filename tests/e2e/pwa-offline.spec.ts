import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

/**
 * Runs against `next start` via playwright.pwa.config.ts — see `npm run test:pwa`.
 * The dev-server spec (tests/e2e/pwa.spec.ts) asserts that no SW exists in dev.
 */
test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("serves the service worker with no-store and root scope", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["service-worker-allowed"]).toBe("/");
});

test("registers a worker and takes control of the page", async ({ page }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(controlled).toBe(true);
});

test("never caches API responses", async ({ page }) => {
  await expect(page.getByText("Weekly class").first()).toBeVisible();
  const cachedPaths = await page.evaluate(async () => {
    const names = await caches.keys();
    const lists = await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        return (await cache.keys()).map((request) => new URL(request.url).pathname);
      }),
    );
    return lists.flat();
  });
  expect(cachedPaths.some((path) => path.startsWith("/api/"))).toBe(false);
  expect(cachedPaths.length).toBeGreaterThan(0);
});

test("serves the cached shell when the network is gone", async ({ context, page }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // One controlled navigation populates the pages cache.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("breadcrumb-crumb")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("You're offline");
  await context.setOffline(false);
});

test("falls back to the offline page for an uncached route", async ({ context, page }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.goto("/settings/import");
  await expect(page.getByRole("heading", { name: /You.re offline/i })).toBeVisible();
  await context.setOffline(false);
});

test("raises the update prompt when a worker is waiting", async ({ page }) => {
  // The real waiting-worker path needs a deploy; dispatch the event the
  // registrar raises so the prompt UI itself is covered.
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("nailong:sw-update-ready", {
        detail: { waiting: { postMessage() {} } },
      }),
    );
  });
  await expect(page.getByText("A new version of Nailong is ready")).toBeVisible();
});
