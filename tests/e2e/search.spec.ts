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

  await search.fill("kyoto");
  await expect(page.getByRole("option", { name: /Kyoto trip/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: /Kyoto trip/ })).toHaveCount(0);
});

test("short query shows the hint, not an empty box", async ({ page }) => {
  await page.getByLabel("Search events").first().click();
  await expect(page.getByText("Search titles, notes and locations.")).toBeVisible();
});

test("opening the results panel does not resize the search field", async ({ page }) => {
  const search = page.getByLabel("Search events").first();
  // The bordered field wrapper is the input's parent; the input itself is a fixed
  // width, so the wrapper is what used to grow to the results panel's width.
  const field = search.locator("..");
  const before = await field.boundingBox();
  await search.click();
  await expect(page.getByText("Search titles, notes and locations.")).toBeVisible();
  const after = await field.boundingBox();
  console.log(`field width before=${before?.width} after=${after?.width}`);
  expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThanOrEqual(1);
});

test("search escapes LIKE wildcards end to end", async ({ page }) => {
  await page.getByLabel("Search events").first().fill("%%");
  await expect(page.getByText(/No matches for/)).toBeVisible();
});

test("starting a new event before the deep link lands never stacks two popups", async ({
  page,
}) => {
  // Search from another month so the deep link has to move the grid and wait for
  // the event to load. Starting a quick-create in that window used to leave the
  // event-details popover open next to the new-event bubble.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "New event" })).toBeVisible();

  const search = page.getByLabel("Search events").first();
  await search.fill("Kyoto trip");
  await page.getByRole("option", { name: /Kyoto trip/ }).click();
  // Do not wait for the details surface: click a day straight away.
  await page.locator(".fc-daygrid-day").nth(3).click({ position: { x: 12, y: 8 } });

  // The quick-create bubble may stay; the searched event's details must not open
  // on top of it.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More options" })).toBeVisible();
});

test("choosing a search result replaces an open quick-create bubble", async ({ page }) => {
  await page.locator(".fc-daygrid-day").nth(3).click({ position: { x: 12, y: 8 } });
  await expect(page.getByRole("button", { name: "More options" })).toBeVisible();

  const search = page.getByLabel("Search events").first();
  await search.fill("Kyoto trip");
  await page.getByRole("option", { name: /Kyoto trip/ }).click();

  // The result click is the newer action: details open, the bubble goes away.
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "More options" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
});
