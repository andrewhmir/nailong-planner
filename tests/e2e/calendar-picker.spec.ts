import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

function monthDay(day: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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

/**
 * The picker opens with the branch holding the current selection expanded, and
 * earlier specs leave a different default calendar behind, so collapse the
 * branch first instead of assuming it starts closed.
 */
async function collapseBranch(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("button", { name: new RegExp(`sub-calendars of ${name}$`) });
  if ((await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }
}

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("quick create reveals sub-calendars only when the parent is expanded", async ({ page }) => {
  // Quiet top-left of the cell: other specs leave events on some days.
  await page.locator(`[data-date="${monthDay(24)}"]`).click({ position: { x: 8, y: 8 } });
  await expect(page.getByLabel("Title")).toBeFocused();

  await page.getByTestId("calendar-picker-trigger").click();
  const list = page.getByTestId("calendar-picker-list");
  await expect(list).toBeVisible();

  // Both top-level calendars are listed, but School's children stay hidden.
  await expect(list.getByRole("button", { name: "School", exact: true })).toBeVisible();
  await collapseBranch(page, "School");
  await expect(list.getByRole("button", { name: "Biology", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Show sub-calendars of School" }).click();
  await expect(page.getByRole("button", { name: "Hide sub-calendars of School" })).toBeVisible();
  await expect(list.getByRole("button", { name: "Biology", exact: true })).toBeVisible();
  await expect(list.getByRole("button", { name: "Math", exact: true })).toBeVisible();

  // The list is the scroll container: capped at 320px, scrolled when it outgrows it.
  const maxHeight = await list.evaluate((element) => getComputedStyle(element).maxHeight);
  const overflowY = await list.evaluate((element) => getComputedStyle(element).overflowY);
  expect(maxHeight).toBe("320px");
  expect(overflowY).toBe("auto");

  await list.getByRole("button", { name: "Biology", exact: true }).click();
  await expect(page.getByTestId("calendar-picker-trigger")).toContainText("Biology");
  await expect(page.getByTestId("calendar-picker-list")).toHaveCount(0);

  await page.getByLabel("Title").fill("Picker probe");
  await page.getByLabel("Title").press("Enter");
  await expect(page.getByText("Picker probe")).toBeVisible();
  await deleteProbe(page, "Picker probe");
});

test("Escape inside the picker closes only the list, keeping the draft", async ({ page }) => {
  await page.locator(`[data-date="${monthDay(24)}"]`).click({ position: { x: 8, y: 8 } });
  const title = page.getByLabel("Title");
  await expect(title).toBeFocused();
  await title.fill("Still here");

  await page.getByTestId("calendar-picker-trigger").click();
  await expect(page.getByTestId("calendar-picker-list")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("calendar-picker-list")).toHaveCount(0);
  await expect(title).toHaveValue("Still here");

  // And the bubble itself still closes on a second Escape, discarding the draft.
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Title")).toHaveCount(0);
});

test("the full dialog's Calendar field uses the same nested picker", async ({ page }) => {
  await page.getByRole("button", { name: "New event" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("New event");

  const trigger = page.getByTestId("calendar-picker-trigger");
  await expect(trigger).toHaveAttribute("id", "event-calendar");
  await trigger.click();

  const list = page.getByTestId("calendar-picker-list");
  await expect(list).toBeVisible();
  await collapseBranch(page, "School");
  await expect(list.getByRole("button", { name: "Biology", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Show sub-calendars of School" }).click();
  await list.getByRole("button", { name: "Math", exact: true }).click();

  await expect(trigger).toContainText("Math");
  await expect(page.getByLabel("Title")).toBeVisible();

  await page.keyboard.press("Escape");
  const discard = page.getByRole("button", { name: "Discard" });
  if (await discard.count()) {
    await discard.click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
