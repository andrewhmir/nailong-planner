import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

function monthBounds(): { from: number; to: number } {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 7 * 86_400_000,
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() + 7 * 86_400_000,
  };
}

// Each undo test seeds its own event through the API rather than relying on a
// fixture row another spec may have deleted or dragged.
async function createProbe(page: Page, title: string): Promise<void> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 28), 11, 0);
  const response = await page.request.post("/api/events", {
    data: {
      calendarId: fixtures.calendars.math,
      title,
      allDay: false,
      startAt: start.getTime(),
      endAt: start.getTime() + 60 * 60 * 1000,
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  // List view lists every event; the month grid can hide a busy day's events
  // behind "+N more" once other specs have added to it.
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByText(title).first()).toBeVisible();
}

async function deleteProbe(page: Page, title: string): Promise<void> {
  const { from, to } = monthBounds();
  const response = await page.request.get(`/api/events?from=${from}&to=${to}`);
  const payload = (await response.json()) as { events: Array<{ id: string; title: string }> };
  for (const event of payload.events.filter((candidate) => candidate.title === title)) {
    await page.request.delete(`/api/events/${event.id}`, { data: { scope: "all" } });
  }
}

test("deleting an event is immediate and undoable from the toast", async ({ page }) => {
  await createProbe(page, "Undo probe toast");
  await page.getByText("Undo probe toast").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Undo probe toast")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undo probe toast").first()).toBeVisible();
  await deleteProbe(page, "Undo probe toast");
});

test("Ctrl+Z restores a deleted event", async ({ page }) => {
  await createProbe(page, "Undo probe ctrl");
  await page.getByText("Undo probe ctrl").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Event deleted")).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(page.getByText("Undo probe ctrl").first()).toBeVisible();
  await deleteProbe(page, "Undo probe ctrl");
});

test("z (Google's undo shortcut) also restores the last change", async ({ page }) => {
  await createProbe(page, "Undo probe z");
  await page.getByText("Undo probe z").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Event deleted")).toBeVisible();

  await page.keyboard.press("z");
  await expect(page.getByText("Undo probe z").first()).toBeVisible();
  await deleteProbe(page, "Undo probe z");
});

test("z still works after the toast has been dismissed", async ({ page }) => {
  await createProbe(page, "Undo probe late");
  await page.getByText("Undo probe late").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Event deleted")).toBeVisible();

  await expect(page.getByText("Event deleted")).toBeHidden({ timeout: 20_000 });
  await page.keyboard.press("z");
  await expect(page.getByText("Undo probe late").first()).toBeVisible();
  await deleteProbe(page, "Undo probe late");
});

test("a failed PATCH snaps the dragged event back", async ({ page }) => {
  await page.route("**/api/events/*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Drag rejected" } }),
    }),
  );

  const originalCell = page.locator("[data-date]").filter({ hasText: "Kyoto trip" }).first();
  const originalDate = await originalCell.getAttribute("data-date");
  expect(originalDate).toBeTruthy();

  const dayCells = page.locator("[data-date]");
  const count = await dayCells.count();
  expect(count).toBeGreaterThan(10);
  // Drop on a different day than the event's own cell, or FullCalendar would
  // see no change and never PATCH.
  const targetDate = await dayCells.evaluateAll(
    (cells, excluded) =>
      cells
        .map((cell) => cell.getAttribute("data-date"))
        .find((date) => date !== null && date !== excluded),
    originalDate,
  );
  expect(targetDate).toBeTruthy();
  await page.getByText("Kyoto trip").dragTo(page.locator(`[data-date="${targetDate}"]`));

  await expect(page.getByText("Drag rejected")).toBeVisible();
  await expect(
    page.locator(`[data-date="${originalDate}"]`).getByText("Kyoto trip"),
  ).toBeVisible();
});

test("typing z in a title field does not undo anything", async ({ page }) => {
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill("Jaz");
  await page.getByLabel("Title").press("z");
  await expect(page.getByLabel("Title")).toHaveValue("Jazz");
});
