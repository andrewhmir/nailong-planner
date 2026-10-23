import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

/**
 * Google-style repeat controls in the full event dialog: interval, weekday
 * picker, Never / On / After ends, the human summary they produce, and the
 * RRULE the server finally stores.
 *
 * The summary and the stored rule are asserted instead of clicking the new
 * block on the grid: several probes share today's crowded month cell, and
 * FullCalendar folds the overflow into "+N more", which would hide the block.
 */

const fixtures = loadFixtures();

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** RFC 5545 weekday codes, indexed like `Date#getDay()`. */
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

async function openNewEvent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New event" }).click();
  await expect(page.getByLabel("Title")).toBeVisible();
}

/** The live summary paragraph inside the custom-recurrence panel. */
function repeatSummary(page: Page) {
  return page.locator('fieldset [aria-live="polite"]');
}

/** The RRULE the server stored for the event with this title. */
async function storedRrule(page: Page, title: string): Promise<string | null> {
  const response = await page.request.get("/api/events");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    events: Array<{ title: string; rrule: string | null }>;
  };
  return body.events.find((event) => event.title === title)?.rrule ?? null;
}

test("a daily repeat can end after three occurrences", async ({ page }) => {
  await openNewEvent(page);
  await page.getByLabel("Title").fill("Repeat daily probe");
  await page.locator("#event-repeat").selectOption("daily");

  await expect(page.getByRole("group", { name: "Custom recurrence" })).toBeVisible();
  await page.getByLabel("After").check();
  await page.getByLabel("Number of occurrences").fill("3");
  await expect(repeatSummary(page)).toHaveText("Daily, 3 times");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Event created")).toBeVisible();
  await expect.poll(() => storedRrule(page, "Repeat daily probe")).toBe("FREQ=DAILY;COUNT=3");
});

test("a weekly repeat can run on two weekdays", async ({ page }) => {
  await openNewEvent(page);
  await page.getByLabel("Title").fill("Repeat weekly probe");
  await page.locator("#event-repeat").selectOption("weekly");

  // The weekly preset starts on the event's start weekday (today); add a second.
  const today = await page.evaluate(() => new Date().getDay());
  const other = (today + 2) % 7;
  await page
    .getByRole("group", { name: "Repeat on" })
    .getByRole("button", { name: WEEKDAY_NAMES[other]! })
    .click();

  const summary = repeatSummary(page);
  await expect(summary).toContainText("Weekly on");
  await expect(summary).toContainText(WEEKDAY_NAMES[today]!);
  await expect(summary).toContainText(WEEKDAY_NAMES[other]!);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Event created")).toBeVisible();

  const rrule = (await storedRrule(page, "Repeat weekly probe")) ?? "";
  expect(rrule).toContain("FREQ=WEEKLY");
  const byday = /BYDAY=([A-Z,]+)/.exec(rrule)?.[1]?.split(",") ?? [];
  expect(byday).toEqual(expect.arrayContaining([WEEKDAY_CODES[today]!, WEEKDAY_CODES[other]!]));
});

test("the repeat summary shows its end date, and the rule stores it", async ({ page }) => {
  await openNewEvent(page);
  await page.getByLabel("Title").fill("Repeat end probe");
  await page.locator("#event-repeat").selectOption("weekly");

  await page.getByLabel("On", { exact: true }).check();
  const endField = page.getByRole("button", { name: /^Repeat ends: / });
  const label = await endField.getAttribute("aria-label");
  const endDate = label?.split(": ")[1] ?? "";
  expect(endDate).not.toBe("");

  await expect(repeatSummary(page)).toContainText(`until ${endDate}`);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Event created")).toBeVisible();
  await expect.poll(() => storedRrule(page, "Repeat end probe")).toMatch(/UNTIL=\d{8}T\d{6}Z$/);
});

test("Every weekday writes Monday to Friday", async ({ page }) => {
  await openNewEvent(page);
  await page.getByLabel("Title").fill("Repeat weekdays probe");
  await page.locator("#event-repeat").selectOption("weekdays");

  await expect(page.getByRole("group", { name: "Repeat on" })).toBeVisible();
  await expect(repeatSummary(page)).toHaveText(
    "Weekly on Monday, Tuesday, Wednesday, Thursday and Friday",
  );

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Event created")).toBeVisible();
  await expect
    .poll(() => storedRrule(page, "Repeat weekdays probe"))
    .toContain("BYDAY=MO,TU,WE,TH,FR");
});
