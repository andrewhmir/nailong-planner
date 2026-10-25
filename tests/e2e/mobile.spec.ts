import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.use({ viewport: { width: 375, height: 812 } });

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the month grid does not overflow the viewport horizontally", async ({ page }) => {
  await expect(page.getByText("Weekly class").first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the calendar tree opens as a sheet and closes again", async ({ page }) => {
  await page.getByRole("button", { name: "Open collections" }).click();
  const sheet = page.getByRole("dialog", { name: "Collections" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("checkbox", { name: "School" })).toBeVisible();

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
});

test("the phone sheet folds the same calendar tree the desktop shows", async ({ page }) => {
  await page.getByRole("button", { name: "Open collections" }).click();
  const sheet = page.getByRole("dialog", { name: "Collections" });
  await expect(sheet.getByRole("checkbox", { name: "Math" })).toBeVisible();

  await sheet.getByRole("button", { name: "Collapse School" }).click();
  await expect(sheet.getByRole("checkbox", { name: "Math", includeHidden: true })).toBeHidden();

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);

  // Reopening mounts a second tree; the fold lives in AppShell, so it is remembered.
  await page.getByRole("button", { name: "Open collections" }).click();
  const reopened = page.getByRole("dialog", { name: "Collections" });
  await expect(reopened.getByRole("button", { name: "Expand School" })).toBeVisible();
  await expect(reopened.getByRole("checkbox", { name: "Math", includeHidden: true })).toBeHidden();
});
