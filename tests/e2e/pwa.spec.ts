import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("serves an installable manifest", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    display?: string;
    start_url?: string;
    scope?: string;
    icons?: Array<{ sizes?: string; purpose?: string }>;
  };
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(JSON.stringify(manifest.icons)).toContain("maskable");
  expect(JSON.stringify(manifest.icons)).toContain("192x192");
  expect(JSON.stringify(manifest.icons)).toContain("512x512");
});

test("emits standalone head metadata", async ({ page }) => {
  await page.goto("/");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("viewport-fit=cover");
  // Never disable zoom: the fix for iOS focus zoom is 16px inputs.
  expect(viewport).not.toContain("maximum-scale");
  expect(viewport).not.toContain("user-scalable");

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#334451");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    "content",
    "black-translucent",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "Nailong",
  );
  // Next emits the standardised name and/or the legacy apple name depending on
  // version; either satisfies the standalone launch on iOS.
  const capable = page.locator('meta[name$="-web-app-capable"]');
  await expect(capable).toHaveCount(1);
  await expect(capable).toHaveAttribute("content", "yes");
});

test("does not register a service worker in development", async ({ page }) => {
  await page.goto("/");
  const registrations = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistrations()).length,
  );
  expect(registrations).toBe(0);
});
test("shows the offline banner when the network drops", async ({ context, page }) => {
  await page.goto("/");
  await context.setOffline(true);
  await expect(page.getByText(/Offline/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/Offline/)).toBeHidden();
});

test("names the missing saved view when offline with nothing saved", async ({ context, page }) => {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("nailong.offline.")) {
        localStorage.removeItem(key);
      }
    }
  });
  await context.setOffline(true);
  await expect(page.getByText(/no saved view yet/i)).toBeVisible();
  await context.setOffline(false);
});
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test.describe("iPhone install hint", () => {
  test.use({ userAgent: IPHONE_SAFARI, viewport: { width: 375, height: 812 } });

  test("offers Home Screen instructions once and remembers the dismissal", async ({ page }) => {
    await page.goto("/");
    const dismiss = page.getByRole("button", { name: "Dismiss install hint" });
    await expect(dismiss).toBeVisible();
    await dismiss.click();
    await expect(dismiss).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Dismiss install hint" })).toHaveCount(0);
  });
});

test("desktop Chrome gets no install hint", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Dismiss install hint" })).toHaveCount(0);
});

test("Settings explains how to install the app", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Install app" })).toBeVisible();
  await expect(page.getByText(/Android \(Chrome\)/)).toBeVisible();
});