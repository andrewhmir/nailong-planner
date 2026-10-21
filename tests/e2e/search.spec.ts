import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("search finds an event outside the loaded month and opens it", async ({ page }) => {
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "New event" })).toBeVisible();

  const search = page.getByLabel("Search events").first();
  await search.fill("Kyoto trip");
  await page.getByRole("option", { name: /Kyoto trip/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Kyoto trip");
  await expect(dialog).toContainText("All day");
});

test("slash focuses search and Escape closes the results", async ({ page }) => {
  await page.keyboard.press("/");
  const search = page.getByLabel("Search events").first();
  await expect(search).toBeFocused();

  await search.fill("math");
  await expect(page.getByRole("option", { name: /Math quiz/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: /Math quiz/ })).toHaveCount(0);
});

test("short query shows the hint, not an empty box", async ({ page }) => {
  await page.getByLabel("Search events").first().click();
  await expect(page.getByText("Search titles, notes and locations.")).toBeVisible();
});

test("search escapes LIKE wildcards end to end", async ({ page }) => {
  await page.getByLabel("Search events").first().fill("%%");
  await expect(page.getByText(/No matches for/)).toBeVisible();
});
