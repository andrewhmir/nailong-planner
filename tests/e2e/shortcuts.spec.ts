import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, setCheckbox, signIn } from "./helpers";

const fixtures = loadFixtures();

// The suite shares one database and CI retries a failed test, so the probe needs
// a unique title and an explicit cleanup: otherwise a retry sees two events with
// the same text and every "toHaveCount(0)" assertion becomes ambiguous.
async function deleteProbe(page: Page, title: string): Promise<void> {
  const response = await page.request.get("/api/events?from=0&to=4102444800000");
  if (!response.ok()) {
    return;
  }
  const payload = (await response.json()) as { events: Array<{ id: string; title: string }> };
  for (const event of payload.events.filter((candidate) => candidate.title === title)) {
    await page.request.delete(`/api/events/${event.id}`, { data: { scope: "all" } });
  }
}

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
  const title = `Shortcut probe ${Date.now()}`;
  const start = new Date();
  start.setHours(15, 0, 0, 0);
  const created = await page.request.post("/api/events", {
    data: {
      collectionId: fixtures.calendars.math,
      title,
      allDay: false,
      startAt: start.getTime(),
      endAt: start.getTime() + 60 * 60 * 1000,
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "List", exact: true }).click();

  await page.getByText(title).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(page.getByText(title)).toHaveCount(0);

  // The optimistic removal lands before the mutation's undo entry exists.
  await expect(
    page.locator("[data-sonner-toast]", { hasText: "Event deleted" }),
  ).toBeVisible();
  await page.keyboard.press("z");
  await expect(page.getByText(title)).toBeVisible();
  await deleteProbe(page, title);
});

test("the settings toggle disables single-key shortcuts", async ({ page }) => {
  await page.goto("/settings#calendar");
  await page.waitForLoadState("networkidle");
  await setCheckbox(page, /Keyboard shortcuts/, false);
  await expect(page.getByRole("checkbox", { name: /Keyboard shortcuts/ })).not.toBeChecked();

  await page.goto("/");
  await page.keyboard.press("w");
  await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
