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
