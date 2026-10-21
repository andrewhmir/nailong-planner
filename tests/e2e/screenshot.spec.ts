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

  test("quick create bubble", async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      Math.min(now.getDate() + 3, 28),
    ).padStart(2, "0")}`;
    await page.locator(`[data-date="${day}"]`).click({ position: { x: 8, y: 8 } });
    await expect(page.getByLabel("Title")).toBeFocused();
    await page.getByLabel("Title").fill("Dinner with Sam");
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/quick-create.png" });
    await page.keyboard.press("Escape");
  });

  test("event details", async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
    await page.getByText("Weekly class").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/event-details.png" });
  });

  test("search results", async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
    await page.getByLabel("Search events").first().fill("kyo");
    await expect(page.getByRole("option", { name: /Kyoto trip/ })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/search.png" });
  });

  test("planned destination dialog", async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: "Tasks — Coming in v0.2.0" })
      .click();
    await expect(page.getByRole("dialog", { name: "Tasks" })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "docs/screenshots/roadmap-dialog.png" });
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
