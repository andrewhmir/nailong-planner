import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

/** The household's calendar date, mirroring `localToday` in `lib/domain/tasks.ts`. */
function householdToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Taipei",
  }).formatToParts(new Date());
  const pick = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** One day of the month `today` belongs to, as a `YYYY-MM-DD` string. */
function dayInMonth(today: string, day: number): string {
  const [year, month] = today.split("-");
  return `${year}-${month}-${String(day).padStart(2, "0")}`;
}

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

test("task chips join a day's stack without breaking +N more or event drag", async ({ page }) => {
  const today = householdToday();
  // Days 2–5 are never a seeded event day (the 15th/20th) nor a day another spec
  // pins a task chip on (the 10th–13th). The seed itself schedules a chip on
  // today and on the end of the household week, so read the already-scheduled
  // dates from the API instead of assuming the week ends late in the month.
  const tasksResponse = await page.request.get("/api/tasks?view=all");
  expect(tasksResponse.ok()).toBeTruthy();
  const scheduledDays = new Set(
    ((await tasksResponse.json()) as { tasks: Array<{ scheduledOn: string | null }> }).tasks
      .map((task) => task.scheduledOn)
      .filter((date): date is string => date !== null),
  );
  const quietDays = [2, 3, 4, 5]
    .map((day) => dayInMonth(today, day))
    .filter((date) => date !== today && !scheduledDays.has(date));
  const [chipDay, dragDay] = quietDays;
  expect(chipDay).toBeTruthy();
  expect(dragDay).toBeTruthy();

  // Four open tasks on one day exceed `dayMaxEventRows=3`. FullCalendar charges
  // the "+N more" link itself as one of those rows: in `maxEventRows` mode
  // `computeDayGridMoreLinkLevelTax()` returns 1, so the link reserves the third
  // level and evicts the chip that was placed there — four chips render as two
  // chips plus a link for the other two, not as three chips. Chips share the
  // `events` array with event occurrences; this is the regression guard that the
  // shared array still stacks like a plain event day.
  const stamp = Date.now().toString(36);
  const chipPrefix = `E2E stack chip ${stamp}`;
  // The E2E database is one shared seed and CI retries a flaky test with it
  // already written to. Track every row this test creates and delete it in the
  // `finally`, so a failed first attempt cannot leave four chips behind and make
  // the retry's "+2 more" assertion fail deterministically.
  const createdIds: string[] = [];

  try {
    for (let index = 0; index < 4; index += 1) {
      const created = await page.request.post("/api/tasks", {
        data: { title: `${chipPrefix} ${index}` },
      });
      expect(created.ok()).toBeTruthy();
      const task = ((await created.json()) as { task: { id: string } }).task;
      createdIds.push(task.id);
      const planned = await page.request.patch(`/api/tasks/${task.id}`, {
        data: { scheduledOn: chipDay },
      });
      expect(planned.ok()).toBeTruthy();
    }

    await page.goto("/");
    const chipCell = page.locator(`[data-date="${chipDay}"]`);
    // Count only this test's chips: the title prefix keeps the assertion honest
    // even if the seed's quiet day is not quiet on a retry or another spec adds
    // a chip to the same day.
    await expect(
      chipCell.locator(".fc-task-chip").filter({ hasText: chipPrefix }),
    ).toHaveCount(2);
    const moreLink = chipCell.locator(".fc-more-link");
    await expect(moreLink).toBeVisible();
    // The link reports the two chips it folded away ("+2 more"; the month view
    // uses the long form, not the numeric-only micro/column form).
    await expect(moreLink).toHaveText(/^\+2( more)?$/);

    // Event drag still works with the chips in the same `events` array.
    await page
      .getByText("Kyoto trip")
      .dragTo(page.locator(`[data-date="${dragDay}"]`), { steps: 5 });
    await expect(page.locator(`[data-date="${dragDay}"]`).getByText("Kyoto trip")).toBeVisible();
  } finally {
    for (const id of createdIds) {
      await page.request.delete(`/api/tasks/${id}`);
    }
  }
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
