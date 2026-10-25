import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

// The first hit compiles `/tasks` on a cold `.next-e2e`; leave room for that.
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

interface HouseholdInfo {
  timezone: string;
  weekStartsOn: 0 | 1;
}

interface TaskCounts {
  inbox: number;
  today: number;
  week: number;
  someday: number;
  overdue: number;
}

/** The household's calendar date, mirroring `localToday` in `lib/domain/tasks.ts`. */
function householdToday(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date());
  const pick = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function partsOf(date: string): { year: number; month: number; day: number } {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return { year, month, day };
}

function weekdayOf(date: string): number {
  const { year, month, day } = partsOf(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDaysToDate(date: string, days: number): string {
  const { year, month, day } = partsOf(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Last day of the household week, mirroring `endOfWeek` in `lib/domain/tasks.ts`. */
function endOfWeek(date: string, weekStartsOn: 0 | 1): string {
  const offset = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDaysToDate(date, 6 - offset);
}

/** Household zone and week start come from the server, never from a literal. */
async function householdInfo(page: Page): Promise<HouseholdInfo> {
  const response = await page.request.get("/api/session");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    household: { timezone: string; weekStartsOn: number } | null;
  };
  return {
    timezone: body.household?.timezone ?? "Asia/Taipei",
    weekStartsOn: body.household?.weekStartsOn === 1 ? 1 : 0,
  };
}

async function serverCounts(page: Page): Promise<TaskCounts> {
  const response = await page.request.get("/api/tasks");
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { counts: TaskCounts }).counts;
}

interface ApiTask {
  id: string;
  title: string;
  status: string;
}

/** The tasks of one view, in the exact order the server sends (and the shell renders). */
async function tasksInView(page: Page, view: "inbox" | "today"): Promise<ApiTask[]> {
  const response = await page.request.get(`/api/tasks?view=${view}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { tasks: ApiTask[] }).tasks;
}

/** The task row `li`; `data-task-id` makes the locator self-describing. */
function taskRow(page: Page, title: string) {
  return page.locator("li[data-task-id]", {
    has: page.getByRole("checkbox", { name: title }),
  });
}

async function capture(page: Page, title: string): Promise<void> {
  await page.locator("#task-capture").fill(title);
  await page.locator("#task-capture").press("Enter");
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();
  await expect(page.locator("#task-capture")).toHaveValue("");
}

/** Pick a date in the row's Plan popover, navigating a month when needed. */
async function planTask(
  page: Page,
  title: string,
  date: string,
  today: string,
): Promise<void> {
  await taskRow(page, title).getByRole("button", { name: `Plan ${title}` }).click();
  // The anchored popover carries its own test id, so the grid can never be
  // confused with the sidebar's mini month (which uses the same `data-mini-date`).
  const popover = page.getByTestId("task-plan-popover");
  await expect(popover).toBeVisible();
  if (date.slice(0, 7) !== today.slice(0, 7)) {
    await popover.getByRole("button", { name: "Next month" }).click();
  }
  await popover.locator(`[data-mini-date="${date}"]`).click();
  await expect(popover).toBeHidden();
}

/** The switcher's accessible name is "<Label>, <count> open". */
async function selectView(page: Page, label: "Inbox" | "Today" | "Week" | "Someday") {
  await page.getByRole("button", { name: new RegExp(`^${label},`) }).click();
}

test("captured and planned tasks keep their buckets across a reload", async ({ page }) => {
  const { timezone, weekStartsOn } = await householdInfo(page);
  const today = householdToday(timezone);
  const weekTarget = endOfWeek(today, weekStartsOn);
  // On the last day of the household week `endOfWeek` is today, so D6 puts the
  // task in Today. The scenario still exercises the Plan pick; its assertion
  // adapts to the bucket the server will derive.
  const weekIsToday = weekTarget === today;
  const stamp = Date.now().toString(36);
  const listName = `E2E errands ${stamp}`;
  const inboxTitle = `E2E inbox task ${stamp}`;
  const todayTitle = `E2E today task ${stamp}`;
  const weekTitle = `E2E week task ${stamp}`;

  // Lists and tasks share the sidebar tree; create a list first so the run also
  // proves the two kinds coexist.
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New list" }).click();
  await page.getByLabel("Name").fill(listName);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("checkbox", { name: listName })).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();

  // Counts are global (seeded tasks may exist), so assert deltas, not absolutes.
  const before = await serverCounts(page);

  await capture(page, inboxTitle);
  await capture(page, todayTitle);
  await capture(page, weekTitle);

  // Scenario 1 deliberately uses the Plan popover, so it keeps testing the mouse
  // path; the keyboard triage layer has its own scenario below.
  await planTask(page, todayTitle, today, today);
  await planTask(page, weekTitle, weekTarget, today);

  await expect(page.getByRole("checkbox", { name: inboxTitle })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: todayTitle })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: weekTitle })).toHaveCount(0);

  await selectView(page, "Today");
  await expect(page.getByRole("checkbox", { name: todayTitle })).toBeVisible();
  if (weekIsToday) {
    await expect(page.getByRole("checkbox", { name: weekTitle })).toBeVisible();
  } else {
    await expect(page.getByRole("checkbox", { name: weekTitle })).toHaveCount(0);
  }

  await selectView(page, "Week");
  if (weekIsToday) {
    await expect(page.getByRole("checkbox", { name: weekTitle })).toHaveCount(0);
  } else {
    await expect(page.getByRole("checkbox", { name: weekTitle })).toBeVisible();
  }
  await expect(page.getByRole("checkbox", { name: inboxTitle })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();

  const after = await serverCounts(page);
  expect(after.inbox).toBe(before.inbox + 1);
  expect(after.today).toBe(before.today + (weekIsToday ? 2 : 1));
  expect(after.week).toBe(before.week + (weekIsToday ? 0 : 1));
  expect(after.someday).toBe(before.someday);
  expect(after.overdue).toBe(before.overdue);

  // The badges paint what the API reports...
  await expect(page.getByTestId("tasks-count-inbox")).toHaveText(String(after.inbox));
  await expect(page.getByTestId("tasks-count-today")).toHaveText(String(after.today));
  await expect(page.getByTestId("tasks-count-week")).toHaveText(String(after.week));
  await expect(page.getByTestId("tasks-count-someday")).toHaveText(String(after.someday));

  // ...and the rows stayed in their buckets: Inbox on load, then Today and Week.
  await expect(page.getByRole("checkbox", { name: inboxTitle })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: todayTitle })).toHaveCount(0);
  await selectView(page, "Today");
  await expect(page.getByRole("checkbox", { name: todayTitle })).toBeVisible();
  await selectView(page, "Week");
  if (weekIsToday) {
    await expect(page.getByRole("checkbox", { name: weekTitle })).toHaveCount(0);
  } else {
    await expect(page.getByRole("checkbox", { name: weekTitle })).toBeVisible();
  }
});

test("Shift+K captures from the calendar and triage keys work without a mouse", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `E2E global capture ${stamp}`;
  const neighbourTitle = `E2E triage neighbour ${stamp}`;

  // Global capture starts on the calendar and must not navigate there.
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("Shift+K");
  const captureDialog = page.getByRole("dialog", { name: "Capture a task" });
  await expect(captureDialog).toBeVisible();
  await captureDialog.locator("#global-capture-title").fill(title);
  await captureDialog.locator("#global-capture-title").press("Enter");
  await expect(page.locator("[data-sonner-toast]", { hasText: "Task captured" })).toBeVisible();
  await expect(captureDialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  // Inbox is the default view: the captured task is visible without switching.
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();

  // A second Inbox task gives the keyboard selection somewhere to move. Both
  // titles are unique, so the row locators cannot collide with seeded tasks.
  await page.locator("#task-capture").fill(neighbourTitle);
  await page.locator("#task-capture").press("Enter");
  await expect(page.getByRole("checkbox", { name: neighbourTitle })).toBeVisible();

  const inbox = await tasksInView(page, "inbox");
  const captured = inbox.find((task) => task.title === title);
  const neighbour = inbox.find((task) => task.title === neighbourTitle);
  expect(captured).toBeTruthy();
  expect(neighbour).toBeTruthy();
  const taskId = captured!.id;
  const neighbourId = neighbour!.id;
  const neighbourIndex = inbox.findIndex((task) => task.id === neighbourId);
  expect(neighbourIndex).toBeGreaterThan(0);

  // Focus the first row, then walk with `j` until the neighbour (captured after
  // the task, so it follows it in the list) and step back with `k`.
  const firstRow = page.locator("li[data-task-id]").first();
  await firstRow.focus();
  await expect(firstRow).toHaveAttribute("data-selected", "true");
  for (let step = 0; step < neighbourIndex; step += 1) {
    await page.keyboard.press("j");
  }
  await expect(page.locator(`li[data-task-id="${neighbourId}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.keyboard.press("k");
  await expect(
    page.locator(`li[data-task-id="${inbox[neighbourIndex - 1]!.id}"]`),
  ).toHaveAttribute("data-selected", "true");

  // Select the captured task directly (focus = selection), then prove typing
  // inside the page capture field does not move it.
  await page.locator(`li[data-task-id="${taskId}"]`).focus();
  await expect(page.locator(`li[data-task-id="${taskId}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.locator("#task-capture").focus();
  await page.keyboard.press("j");
  await expect(page.locator("#task-capture")).toHaveValue("j");
  await expect(page.locator(`li[data-task-id="${taskId}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.locator("#task-capture").fill("");

  // `1` schedules the selected task for Today; it leaves the Inbox.
  await page.locator(`li[data-task-id="${taskId}"]`).focus();
  await expect(page.locator(`li[data-task-id="${taskId}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.keyboard.press("1");
  await expect(page.getByRole("checkbox", { name: title })).toHaveCount(0);
  expect((await tasksInView(page, "today")).some((task) => task.id === taskId)).toBe(true);

  // `x` completes the remaining task without any pointer input: focus the first
  // Inbox row, walk to the neighbour, complete it. This is acceptance criterion 1.
  const remaining = await tasksInView(page, "inbox");
  const remainingNeighbourIndex = remaining.findIndex((task) => task.id === neighbourId);
  expect(remainingNeighbourIndex).toBeGreaterThanOrEqual(0);
  const firstRemaining = page.locator("li[data-task-id]").first();
  await firstRemaining.focus();
  await expect(firstRemaining).toHaveAttribute("data-selected", "true");
  for (let step = 0; step < remainingNeighbourIndex; step += 1) {
    await page.keyboard.press("j");
  }
  await expect(page.locator(`li[data-task-id="${neighbourId}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: neighbourTitle })).toHaveCount(0);
  const completed = await page.request.get(`/api/tasks/${neighbourId}`);
  expect(completed.ok()).toBeTruthy();
  expect(((await completed.json()) as { task: ApiTask }).task.status).toBe("done");

  // The scheduled task is still open and now lives in Today.
  await selectView(page, "Today");
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();
});
