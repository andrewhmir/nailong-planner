import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

// The settings toggle is per-user state; leave it on for the rest of the suite.
test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings/preferences", {
    data: { shortcutsEnabled: true },
  });
});

test("t returns to today and w switches to the week view", async ({ page }) => {
  const week = page.getByRole("button", { name: "Week", exact: true });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.keyboard.press("t");
  await expect(week).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("w");
  await expect(week).toHaveAttribute("aria-pressed", "true");
});

test("c opens the full editor and typing a sentence does not fire shortcuts", async ({ page }) => {
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog")).toHaveCount(1);

  const title = page.getByLabel("Title");
  await title.fill("Call car repair? c / t");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(title).toHaveValue("Call car repair? c / t");
});

test("? opens the shortcut sheet", async ({ page }) => {
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog", { name: /Keyboard shortcuts/i })).toBeVisible();
  await expect(page.getByText("Create event")).toBeVisible();
});

test("the toolbar button opens the shortcut sheet too", async ({ page }) => {
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByRole("dialog", { name: /Keyboard shortcuts/i })).toBeVisible();
});

test("z is undo, but Delete removes the selected event", async ({ page }) => {
  await page.getByText("Math quiz").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  await expect(page.getByText("Math quiz")).toHaveCount(0);

  // The optimistic removal lands before the mutation's undo entry exists.
  await expect(
    page.locator("[data-sonner-toast]", { hasText: "Event deleted" }),
  ).toBeVisible();
  await page.keyboard.press("z");
  await expect(page.getByText("Math quiz")).toBeVisible();
});

test("the settings toggle disables single-key shortcuts", async ({ page }) => {
  await page.goto("/settings#calendar");
  await page.getByRole("checkbox", { name: /Keyboard shortcuts/ }).uncheck();

  await page.goto("/");
  await page.keyboard.press("w");
  await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
