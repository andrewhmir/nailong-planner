import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

function monthDay(day: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Each test creates a throwaway event straight through the API only for cleanup.
async function deleteProbe(page: Page, title: string): Promise<void> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 7 * 86_400_000;
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() + 7 * 86_400_000;
  const response = await page.request.get(`/api/events?from=${from}&to=${to}`);
  const payload = (await response.json()) as { events: Array<{ id: string; title: string }> };
  for (const event of payload.events.filter((candidate) => candidate.title === title)) {
    await page.request.delete(`/api/events/${event.id}`, { data: { scope: "all" } });
  }
}

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("single click on a day opens quick create and Enter saves", async ({ page }) => {
  // Click the quiet top-left of the cell: other specs leave events on some days,
  // and clicking an event chip opens details instead of the quick-create bubble.
  await page.locator(`[data-date="${monthDay(24)}"]`).click({ position: { x: 8, y: 8 } });
  const title = page.getByLabel("Title");
  await expect(title).toBeFocused();

  await title.fill("Dinner with Sam");
  await title.press("Enter");
  await expect(page.getByText("Dinner with Sam")).toBeVisible();
  await deleteProbe(page, "Dinner with Sam");
});

test("Escape closes the bubble without saving", async ({ page }) => {
  // Click the quiet top-left of the cell: other specs leave events on some days,
  // and clicking an event chip opens details instead of the quick-create bubble.
  await page.locator(`[data-date="${monthDay(24)}"]`).click({ position: { x: 8, y: 8 } });
  await expect(page.getByLabel("Title")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Title")).toHaveCount(0);
  await expect(page.getByText("Dinner with Sam")).toHaveCount(0);
});

test("More options carries the draft into the full dialog", async ({ page }) => {
  // Click the quiet top-left of the cell: other specs leave events on some days,
  // and clicking an event chip opens details instead of the quick-create bubble.
  await page.locator(`[data-date="${monthDay(24)}"]`).click({ position: { x: 8, y: 8 } });
  await page.getByLabel("Title").fill("Dentist");
  await page.getByRole("button", { name: "More options" }).click();

  await expect(page.getByRole("dialog")).toContainText("New event");
  await expect(page.getByLabel("Title")).toHaveValue("Dentist");
  await expect(page.getByLabel("Repeat")).toBeVisible();

  // The typed title armed the guard, so closing asks first.
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Discard this event/)).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("closing a dirty full dialog asks before discarding", async ({ page }) => {
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill("Half typed");
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toContainText(/Discard this event/);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Half typed");

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Shift+C opens the bubble with today's default range", async ({ page }) => {
  await page.keyboard.press("Shift+c");
  await expect(page.getByLabel("Title")).toBeFocused();
  await expect(page.getByText("All day")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Title")).toHaveCount(0);
});
