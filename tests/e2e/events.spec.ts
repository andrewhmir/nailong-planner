import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("renders the month grid with seeded events", async ({ page }) => {
  await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
  await expect(page.getByText("Math quiz")).toBeVisible();
  await expect(page.getByText("Kyoto trip")).toBeVisible();
});

test("creates a timed event from the toolbar", async ({ page }) => {
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill("Dentist");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Dentist")).toBeVisible();
});

test("edits and deletes an event through its popover", async ({ page }) => {
  await page.getByText("Math quiz").click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Math quiz (moved)");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Math quiz (moved)")).toBeVisible();

  await page.getByText("Math quiz (moved)").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Math quiz (moved)")).toHaveCount(0);
});

test("drags an event to another day", async ({ page }) => {
  const event = page.getByText("Kyoto trip");
  const dayCells = page.locator('[data-date]');
  const count = await dayCells.count();
  expect(count).toBeGreaterThan(10);

  await event.dragTo(dayCells.nth(count - 1));
  await expect(page.getByText("Kyoto trip")).toBeVisible();
});

test("a weekly event appears in the following month", async ({ page }) => {
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill("Swim class");
  await page.getByLabel("Repeat").selectOption("weekly");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Swim class").first()).toBeVisible();

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Swim class").first()).toBeVisible();
});

test("skipping one occurrence leaves the rest of the series", async ({ page }) => {
  const occurrences = page.getByText("Weekly class");
  await expect(occurrences.first()).toBeVisible();
  const before = await occurrences.count();
  expect(before).toBeGreaterThan(1);

  await occurrences.first().click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "This event" }).click();

  await expect.poll(async () => occurrences.count()).toBe(before - 1);
});

test("the create dialog keeps the focused field's ring clear of its scroll edges", async ({ page }) => {
  await page.getByRole("button", { name: "New event" }).click();
  const field = page.locator("#event-title");
  await expect(field).toBeFocused();

  // `CONTROL` paints a 2px accent outline 2px outside the border box. A scroll
  // container clips at its padding box, so less than 4px of horizontal padding
  // shaves the ring off - the title field is first in the form, flush left.
  const room = await field.evaluate((el) => {
    const scroller = el.closest("form")?.querySelector<HTMLElement>(".overflow-y-auto");
    if (!scroller) throw new Error("event dialog scroll area not found");
    const style = getComputedStyle(scroller);
    const borderLeft = parseFloat(style.borderLeftWidth);
    const borderRight = parseFloat(style.borderRightWidth);
    const scrollbar = scroller.offsetWidth - scroller.clientWidth - borderLeft - borderRight;
    const rect = scroller.getBoundingClientRect();
    const fieldRect = el.getBoundingClientRect();
    return {
      left: fieldRect.left - (rect.left + borderLeft),
      right: rect.right - borderRight - scrollbar - fieldRect.right,
    };
  });

  expect(room.left).toBeGreaterThanOrEqual(4);
  expect(room.right).toBeGreaterThanOrEqual(4);
});

test("switching to the week view keeps events visible", async ({ page }) => {
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill("Week check");
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByText("Week check").first()).toBeVisible();
});
