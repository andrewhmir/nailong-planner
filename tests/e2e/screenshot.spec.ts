import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

// Screenshots only refresh with an explicit env flag so a normal suite run never
// rewrites tracked files (and never depends on other specs' mutations).
test.skip(process.env.CAPTURE_SCREENSHOTS !== "1", "set CAPTURE_SCREENSHOTS=1 to refresh");

// Wait for the self-hosted Lato faces and the calendar's post-layout paint
// (event bars, today badge) so a capture never catches a fallback font.
async function settle(page: Page): Promise<void> {
  // The Next.js dev badge/overlay is development tooling, not part of the UI.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(600);
}

test.describe("desktop screenshots", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/login.png" });
  });

  test("desktop month view", async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
    await expect(page.getByText("Weekly class").first()).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/calendar-desktop.png" });
  });

  test("settings", async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/settings.png" });
  });
});

test.describe("phone screenshots", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("phone month view", async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
    await expect(page.getByText("Weekly class").first()).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/calendar-mobile.png" });
  });
});
