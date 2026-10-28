import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

/**
 * The event dialog's date and time controls: a field-styled button over the
 * shared MiniMonth grid and a quick-pick list, replacing `<input type="date">`
 * and `<input type="time">`. The browser widgets also ignored the household's
 * 24-hour preference, so the assertions below read 24-hour text.
 */

const fixtures = loadFixtures();

// `formatWallDate` renders a short month name (en-GB), e.g. "Tue, 3 Nov 2026".
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

async function openNewEvent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New event" }).click();
  await expect(page.getByLabel("Title")).toBeVisible();
}

function timeList(page: Page, label: "Start time" | "End time") {
  return page.getByRole("listbox", { name: `${label} quick pick` });
}

test("the time field opens the quick-pick list and saves the chosen times", async ({ page }) => {
  await openNewEvent(page);
  await page.getByLabel("Title").fill("Picker probe");

  await page.getByRole("button", { name: /^Start time:/ }).click();
  const startList = timeList(page, "Start time");
  await expect(startList).toBeVisible();
  await startList.getByRole("option", { name: "10:15" }).click();
  await expect(page.getByRole("button", { name: /^Start time: 10:15/ })).toBeVisible();
  await expect(startList).toHaveCount(0);

  await page.getByRole("button", { name: /^End time:/ }).click();
  const endList = timeList(page, "End time");
  await expect(endList).toBeVisible();
  await endList.getByRole("option", { name: "11:15" }).click();
  await expect(page.getByRole("button", { name: /^End time: 11:15/ })).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  // A busy day folds extra events into "+N more" (today already carries several
  // events from the seed and earlier specs), so assert the save itself rather
  // than the grid text: the success toast appears and the dialog closes.
  await expect(page.getByText("Event created")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveCount(0);
});

test("arrow keys walk the time list and Enter picks the row", async ({ page }) => {
  await openNewEvent(page);
  const trigger = page.getByRole("button", { name: /^Start time:/ });
  const before = await trigger.getAttribute("aria-label");

  await trigger.click();
  const list = timeList(page, "Start time");
  await expect(list).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(list).toHaveCount(0);
  await expect(trigger).not.toHaveAttribute("aria-label", before ?? "");
});

test("typing an off-grid minute works, and bad text explains itself", async ({ page }) => {
  await openNewEvent(page);
  const trigger = page.getByRole("button", { name: /^Start time:/ });

  await trigger.click();
  const typed = page.getByLabel("Type a time");
  await typed.fill("8:37");
  await typed.press("Enter");
  await expect(page.getByRole("button", { name: /^Start time: 08:37/ })).toBeVisible();

  await trigger.click();
  await page.getByLabel("Type a time").fill("half past");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("Escape closes the time list without closing the event dialog", async ({ page }) => {
  await openNewEvent(page);
  await page.getByRole("button", { name: /^Start time:/ }).click();
  const list = timeList(page, "Start time");
  await expect(list).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(page.getByLabel("Title")).toBeVisible();
});

test("the date field opens the mini calendar and picks a day", async ({ page }) => {
  await openNewEvent(page);
  const starts = page.getByRole("button", { name: /^Starts:/ });
  await starts.click();

  const popover = page.getByTestId("date-field-popover");
  const grid = popover.getByRole("grid");
  await expect(grid).toBeVisible();

  await grid.getByRole("button", { name: "Next month" }).click();
  await grid.getByRole("gridcell", { name: /\b15\b/ }).click();

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const expected = new RegExp(
    `^Starts: \\w{3}, 15 ${SHORT_MONTHS[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`,
  );
  await expect(page.getByRole("button", { name: expected })).toBeVisible();
  await expect(popover).toHaveCount(0);
});
