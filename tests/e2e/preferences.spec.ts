import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, setCheckbox, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

// Preferences are per-user and the suite shares one database, so reset them
// after every test; otherwise a 12-hour run would change other specs' text.
test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings/preferences", {
    data: {
      timeFormat: "24h",
      defaultView: "auto",
      showWeekNumbers: false,
      shortcutsEnabled: true,
      lastEventCalendarId: null,
    },
  });
});

test("time format changes the grid and survives reload", async ({ page }) => {
  await page.goto("/settings#calendar");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "12-hour" }).click();
  await expect(page.getByText(/preferences updated/i)).toBeVisible();

  // FullCalendar formats the chip itself, so accept either space or a narrow
  // no-break space before the meridiem.
  await page.goto("/");
  await expect(page.getByText(/9:00\s?AM/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(/9:00\s?AM/).first()).toBeVisible();
});

test("the default view select persists", async ({ page }) => {
  await page.goto("/settings#calendar");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Default view").selectOption("timeGridWeek");
  await expect(page.getByText(/preferences updated/i)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Default view")).toHaveValue("timeGridWeek");
});

test("the calendar card is reachable from the settings sub-nav", async ({ page }) => {
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Time format" })).toBeVisible();
});

test("week numbers and shortcuts toggles persist", async ({ page }) => {
  await page.goto("/settings#calendar");
  // Wait for hydration before driving controlled Radix checkboxes.
  await page.waitForLoadState("networkidle");
  await setCheckbox(page, "Week numbers", true);
  await expect(page.getByLabel("Week numbers")).toBeChecked();
  await setCheckbox(page, "Keyboard shortcuts", false);
  await expect(page.getByLabel("Keyboard shortcuts")).not.toBeChecked();

  await page.reload();
  await expect(page.getByLabel("Week numbers")).toBeChecked();
  await expect(page.getByLabel("Keyboard shortcuts")).not.toBeChecked();
});
