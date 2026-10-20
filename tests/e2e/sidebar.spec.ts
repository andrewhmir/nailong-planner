import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the sidebar shows the household groups", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Calendar list" });
  await expect(nav.getByText("Shared", { exact: true })).toBeVisible();
  await expect(nav.getByText("Andrew", { exact: true })).toBeVisible();
  await expect(nav.getByText("Partner", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "School" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Math" })).toBeVisible();
});

test("a parent calendar row previews its children's shades", async ({ page }) => {
  const strip = page.getByTestId("shade-strip-school");
  await expect(strip).toBeVisible();
  await expect(strip.locator("span")).toHaveCount(3);
});

test("toggling a calendar persists across a reload", async ({ page }) => {
  const school = page.getByRole("checkbox", { name: "School" });
  await expect(school).toBeChecked();
  await school.click();
  await expect(school).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "School" })).not.toBeChecked();
});

test("adding a sub-calendar appends it under its parent", async ({ page }) => {
  await page.getByRole("button", { name: "Options for School" }).click();
  await page.getByRole("menuitem", { name: "Add sub-calendar" }).click();
  await page.getByLabel("Name").fill("Chemistry");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("checkbox", { name: "Chemistry" })).toBeVisible();
});

test("a calendar created as mine is saved with an owner", async ({ page }) => {
  await page.getByRole("button", { name: "New calendar" }).click();
  await page.getByLabel("Name").fill("Personal");
  await page.getByLabel("Belongs to").selectOption({ label: "Andrew" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("checkbox", { name: "Personal" })).toBeVisible();
});

test("calendar settings can mark a calendar view-only", async ({ page }) => {
  await page.getByRole("button", { name: "New calendar" }).click();
  await page.getByLabel("Name").fill("Private notes");
  await page.getByLabel("Belongs to").selectOption({ label: "Andrew" });
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Options for Private notes" }).click();
  await page.getByRole("menuitem", { name: "Calendar settings" }).click();
  await page.getByLabel("View only").check();
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Options for Private notes" }).click();
  await page.getByRole("menuitem", { name: "Calendar settings" }).click();
  await expect(page.getByLabel("View only")).toBeChecked();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("a person pill hides only that person's calendars", async ({ page }) => {
  await expect(page.getByRole("checkbox", { name: "Health" })).toBeVisible();
  await page.getByRole("button", { name: /^Andrew$/ }).click();
  const school = page.getByRole("checkbox", { name: "School" });
  await expect(school).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Health" })).toBeChecked();
});

test("long calendar names truncate inside the nav", async ({ page }) => {
  await page.getByRole("button", { name: "New calendar" }).click();
  const long = "Community volunteering and neighbourhood outreach";
  await page.getByLabel("Name").fill(long);
  await page.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("checkbox", { name: long });
  await expect(row).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Calendar list" });
  expect(await nav.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test("the nav panel scrolls instead of pushing the page wide", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Calendar list" });
  const overflow = await nav.evaluate((el) => getComputedStyle(el).overflowY);
  expect(["auto", "scroll"]).toContain(overflow);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
