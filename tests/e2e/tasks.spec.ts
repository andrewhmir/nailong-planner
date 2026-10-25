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

/** One day of the month `date` belongs to, as a `YYYY-MM-DD` string. */
function dayInMonth(date: string, day: number): string {
  const { year, month } = partsOf(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Last day of the household week, mirroring `endOfWeek` in `lib/domain/tasks.ts`. */
function endOfWeek(date: string, weekStartsOn: 0 | 1): string {
  const offset = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDaysToDate(date, 6 - offset);
}

/** The due-date badge text, mirroring `formatWallDate` in `lib/time/format.ts`. */
function wallDateLabel(date: string): string {
  const { year, month, day } = partsOf(date);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
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
  collectionId: string;
  scheduledOn: string | null;
  dueOn: string | null;
  checklist: Array<{ id: string; title: string; done: boolean }>;
}

/** The tasks of one view, in the exact order the server sends (and the shell renders). */
async function tasksInView(page: Page, view: "inbox" | "today"): Promise<ApiTask[]> {
  const response = await page.request.get(`/api/tasks?view=${view}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { tasks: ApiTask[] }).tasks;
}

/** One task by id, for the delete-undo assertions (the re-created row has a new id). */
async function apiTask(page: Page, id: string): Promise<ApiTask> {
  const response = await page.request.get(`/api/tasks/${id}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { task: ApiTask }).task;
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

/** Capture a task from anywhere with `Shift+K`; asserts the dialog/toast lifecycle. */
async function globalCapture(page: Page, title: string): Promise<void> {
  await page.keyboard.press("Shift+K");
  const dialog = page.getByRole("dialog", { name: "Capture a task" });
  await expect(dialog).toBeVisible();
  await dialog.locator("#global-capture-title").fill(title);
  await dialog.locator("#global-capture-title").press("Enter");
  await expect(dialog).toBeHidden();
  // Several captures can be on screen at once, so existence is enough here.
  await expect(
    page.locator("[data-sonner-toast]", { hasText: "Task captured" }).first(),
  ).toBeVisible();
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
  const undoProbeTitle = `E2E undo probe ${stamp}`;
  const title = `E2E global capture ${stamp}`;
  const neighbourTitle = `E2E triage neighbour ${stamp}`;

  // Global capture starts on the calendar and must not navigate there.
  await expect(page).toHaveURL(/\/$/);
  await globalCapture(page, undoProbeTitle);
  // A second capture inside the same 10-second toast window reproduces the
  // shared-LIFO bug: Sonner prepends the newest toast, so the toast with
  // `data-index="1"` is the FIRST capture's toast. Its Undo must delete that
  // task, not the newest one.
  await globalCapture(page, title);
  await expect(page).toHaveURL(/\/$/);

  // Sonner keeps the older toast collapsed behind the front one: a non-front
  // toast is offset by just the 14px gap (`--lift-amount`), scaled, drawn at a
  // lower `--z-index`, and its children sit at `opacity: 0`. The stack only
  // expands on hover (`onMouseEnter`/`onMouseMove` on `[data-sonner-toaster]`),
  // and Playwright checks the hit target at the element's centre *before* it
  // clicks — that point is covered by the front toast, so clicking the older
  // Undo directly retries until the actionability timeout. Hovering the front
  // toast expands the stack (and pauses both dismiss timers), which moves the
  // older toast clear of the front one; `data-expanded="true"` proves the
  // expansion landed before the click.
  const frontToast = page.locator('[data-sonner-toast][data-index="0"]', {
    hasText: "Task captured",
  });
  await expect(frontToast).toBeVisible();
  await frontToast.hover();

  const olderToast = page.locator('[data-sonner-toast][data-index="1"]', {
    hasText: "Task captured",
  });
  await expect(olderToast).toHaveAttribute("data-expanded", "true");
  await olderToast.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await tasksInView(page, "inbox")).some((task) => task.title === undoProbeTitle))
    .toBe(false);
  expect((await tasksInView(page, "inbox")).some((task) => task.title === title)).toBe(true);

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

test("the task editor persists title, notes and checklist, and Escape discards", async ({ page }) => {
  const { timezone } = await householdInfo(page);
  const today = householdToday(timezone);
  const stamp = Date.now().toString(36);
  const originalTitle = `E2E editor task ${stamp}`;
  const editedTitle = `E2E edited task ${stamp}`;
  const notes = `First line ${stamp}\nSecond line`;
  const itemA = `Checklist milk ${stamp}`;
  const itemB = `Checklist bread ${stamp}`;

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await page.locator("#task-capture").fill(originalTitle);
  await page.locator("#task-capture").press("Enter");
  await expect(page.getByRole("checkbox", { name: originalTitle })).toBeVisible();

  const taskId = await taskRow(page, originalTitle).getAttribute("data-task-id");
  expect(taskId).toBeTruthy();
  const editor = page.getByRole("dialog", { name: "Edit task" });

  // The row menu's `Edit task…` action opens the same editor as `Enter`.
  await taskRow(page, originalTitle)
    .getByRole("button", { name: `Options for ${originalTitle}` })
    .click();
  await page.getByRole("menuitem", { name: /^Edit task/ }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Title")).toHaveValue(originalTitle);
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toBeHidden();

  // Keyboard-only opening: focus selects the row, Enter opens its editor.
  await taskRow(page, originalTitle).focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();

  await editor.getByLabel("Title").fill(editedTitle);
  await editor.getByLabel("Notes").fill(notes);

  // Two checklist items; Enter in the add field adds without submitting the form.
  const addField = editor.getByLabel("New checklist item");
  await addField.fill(itemA);
  await addField.press("Enter");
  await expect(editor.getByRole("checkbox", { name: itemA })).toBeVisible();
  await addField.fill(itemB);
  await editor.getByRole("button", { name: "Add item" }).click();
  await expect(editor.getByRole("checkbox", { name: itemB })).toBeVisible();
  await editor.getByRole("checkbox", { name: itemA }).click();

  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("checkbox", { name: editedTitle })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: originalTitle })).toHaveCount(0);

  // The save survives a reload, and the API payload proves notes + checklist.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: editedTitle })).toBeVisible();
  const saved = await page.request.get(`/api/tasks/${taskId}`);
  expect(saved.ok()).toBeTruthy();
  const body = (await saved.json()) as {
    task: {
      title: string;
      notes: string | null;
      checklist: Array<{ title: string; done: boolean }>;
    };
  };
  expect(body.task.title).toBe(editedTitle);
  expect(body.task.notes).toBe(notes);
  expect(body.task.checklist).toHaveLength(2);
  expect(body.task.checklist.find((item) => item.title === itemA)?.done).toBe(true);
  expect(body.task.checklist.find((item) => item.title === itemB)?.done).toBe(false);

  // Due date: the editor's popover sets it, the task re-buckets from Inbox to
  // Today (D6 anchors on the earliest commitment) and the row paints the badge.
  const dueLabel = wallDateLabel(today);
  await taskRow(page, editedTitle).focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await editor.getByTestId("task-editor-due-trigger").click();
  const duePopover = page.getByTestId("task-editor-due-popover");
  await expect(duePopover).toBeVisible();
  await duePopover.getByRole("button", { name: "Today", exact: true }).click();
  await expect(duePopover).toBeHidden();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  // The optimistic PATCH keeps the row in the cached Inbox list until the
  // settle refetch re-derives its bucket, so this waits for the move.
  await expect(page.getByRole("checkbox", { name: editedTitle })).toHaveCount(0);
  await selectView(page, "Today");
  const dueRow = taskRow(page, editedTitle);
  await expect(dueRow).toBeVisible();
  await expect(dueRow.getByText(dueLabel, { exact: true })).toBeVisible();

  // Clearing it removes the badge and returns the undated task to the Inbox.
  await dueRow.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await editor.getByTestId("task-editor-due-trigger").click();
  await expect(duePopover).toBeVisible();
  await duePopover.getByRole("button", { name: "Clear due date" }).click();
  await expect(duePopover).toBeHidden();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(dueRow).toHaveCount(0);
  await selectView(page, "Inbox");
  const inboxRow = taskRow(page, editedTitle);
  await expect(inboxRow).toBeVisible();
  await expect(inboxRow.getByText(dueLabel, { exact: true })).toHaveCount(0);
  expect((await apiTask(page, taskId!)).dueOn).toBeNull();

  // Escape closes without saving: the edited title never reaches the server.
  await taskRow(page, editedTitle).focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Title").fill(`E2E discarded ${stamp}`);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: editedTitle })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `E2E discarded ${stamp}` })).toHaveCount(0);
});

test("completing a task is undoable from the toast and restores the counts", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `E2E undo complete ${stamp}`;

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await page.locator("#task-capture").fill(title);
  await page.locator("#task-capture").press("Enter");
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();

  const before = await serverCounts(page);
  const inbox = await tasksInView(page, "inbox");
  const taskId = inbox.find((task) => task.title === title)?.id;
  expect(taskId).toBeTruthy();

  // Complete with the keyboard: the row leaves the open view on the settle refetch.
  await taskRow(page, title).focus();
  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: title })).toHaveCount(0);
  await expect.poll(async () => (await serverCounts(page)).inbox).toBe(before.inbox - 1);
  const completed = await page.request.get(`/api/tasks/${taskId}`);
  expect(completed.ok()).toBeTruthy();
  expect(((await completed.json()) as { task: ApiTask }).task.status).toBe("done");

  // The toast is bound to this completion, not to the newest stack entry.
  const toast = page.locator("[data-sonner-toast]", { hasText: "Task completed" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();
  // It returns exactly once, with its original status and the counts restored.
  await expect
    .poll(async () => (await tasksInView(page, "inbox")).filter((task) => task.id === taskId).length)
    .toBe(1);
  await expect.poll(async () => (await serverCounts(page)).inbox).toBe(before.inbox);
  const restored = await page.request.get(`/api/tasks/${taskId}`);
  expect(restored.ok()).toBeTruthy();
  expect(((await restored.json()) as { task: ApiTask }).task.status).toBe("open");
});

test("deleting a task is undoable from the toast and restores its checklist", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `E2E undo delete ${stamp}`;
  const itemA = `Checklist milk ${stamp}`;
  const itemB = `Checklist bread ${stamp}`;

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await page.locator("#task-capture").fill(title);
  await page.locator("#task-capture").press("Enter");
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();

  const captured = (await tasksInView(page, "inbox")).find((task) => task.title === title);
  expect(captured).toBeTruthy();
  const deletedId = captured!.id;

  // Give the task a checklist first, so the undo has to restore more than a
  // title. The editor save itself pushes no undo action.
  const editor = page.getByRole("dialog", { name: "Edit task" });
  await taskRow(page, title).focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  const addField = editor.getByLabel("New checklist item");
  await addField.fill(itemA);
  await addField.press("Enter");
  await addField.fill(itemB);
  await addField.press("Enter");
  await expect(editor.getByRole("checkbox", { name: itemA })).toBeVisible();
  await expect(editor.getByRole("checkbox", { name: itemB })).toBeVisible();
  await editor.getByRole("checkbox", { name: itemA }).click();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  // Reload before deleting: the undo captures the row snapshot from the list
  // query, so the checklist must be in that snapshot, not just on the server.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();

  const before = await apiTask(page, deletedId);
  expect(before.collectionId).toBeTruthy();
  expect(before.checklist.map((item) => [item.title, item.done])).toEqual([
    [itemA, true],
    [itemB, false],
  ]);

  // Delete from the row menu, so the shared delete-undo path is exercised.
  await taskRow(page, title).getByRole("button", { name: `Options for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: title })).toHaveCount(0);
  await expect.poll(async () => (await page.request.get(`/api/tasks/${deletedId}`)).status()).toBe(404);

  const toast = page.locator("[data-sonner-toast]", { hasText: "Task deleted" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();

  // There is no trash table, so the undo re-creates the task with a NEW id while
  // the title, owning list and checklist come back (the checklist and position
  // arrive in a follow-up PATCH, so poll instead of reading once).
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();
  await expect
    .poll(async () => (await tasksInView(page, "inbox")).filter((task) => task.title === title).length)
    .toBe(1);
  const recreated = (await tasksInView(page, "inbox")).find((task) => task.title === title)!;
  expect(recreated.id).not.toBe(deletedId);
  await expect.poll(async () => (await apiTask(page, recreated.id)).checklist.length).toBe(2);
  const after = await apiTask(page, recreated.id);
  expect(after.title).toBe(title);
  expect(after.collectionId).toBe(before.collectionId);
  expect(after.status).toBe("open");
  expect(after.checklist.map((item) => [item.title, item.done])).toEqual([
    [itemA, true],
    [itemB, false],
  ]);

  // Asking for the same undo twice must not duplicate the task. Sonner dismisses
  // a toast as soon as its action runs (`deleteToast`), so the second request is
  // the `z` hotkey; the consumed handle must be a no-op, not a second re-create.
  await expect(toast).toHaveCount(0);
  await page.keyboard.press("z");
  await expect
    .poll(async () => (await tasksInView(page, "inbox")).filter((task) => task.title === title).length)
    .toBe(1);
});

test("dropping a task on a day plans it, and its chip opens the task editor", async ({ page }) => {
  const { timezone, weekStartsOn } = await householdInfo(page);
  const today = householdToday(timezone);
  const weekTarget = endOfWeek(today, weekStartsOn);
  const stamp = Date.now().toString(36);
  const title = `E2E chip task ${stamp}`;
  // Days 10–13 are never one of the seeded event days (the 15th and 20th) and
  // are not where earlier scenarios plan tasks (Today / end of week), so the
  // chip cannot be pushed behind a full day's "+N more".
  const chipDay = [10, 11, 12, 13]
    .map((day) => dayInMonth(today, day))
    .find((date) => date !== today && date !== weekTarget);
  expect(chipDay).toBeTruthy();

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await page.locator("#task-capture").fill(title);
  await page.locator("#task-capture").press("Enter");
  await expect(page.getByRole("checkbox", { name: title })).toBeVisible();
  const taskId = await taskRow(page, title).getAttribute("data-task-id");
  expect(taskId).toBeTruthy();

  // The task row lives on /tasks and the full grid lives on /, so the row is
  // dragged onto the sidebar mini month — the month grid both pages share.
  // `steps` synthesises the intermediate `dragover` events of a real drag, so
  // the highlight path is exercised too (the drop itself reads the payload).
  await taskRow(page, title).dragTo(page.locator(`[data-mini-date="${today}"]`), { steps: 5 });
  await expect.poll(async () => (await apiTask(page, taskId!)).scheduledOn).toBe(today);
  const plannedToast = page.locator("[data-sonner-toast]", { hasText: "Task planned" });
  await expect(plannedToast).toBeVisible();
  // The Today bucket is the visible consequence of the drop.
  await selectView(page, "Today");
  await expect(taskRow(page, title)).toBeVisible();

  // The toast is bound to this drop: its Undo restores the date the dragged row
  // actually showed (unscheduled, so `null`) exactly once. Sonner dismisses the
  // toast as soon as its action runs, so the second attempt is the `z` hotkey;
  // the consumed handle must be a no-op, not a second PATCH.
  await plannedToast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await apiTask(page, taskId!)).scheduledOn).toBeNull();
  await expect(plannedToast).toHaveCount(0);
  await page.keyboard.press("z");
  await expect.poll(async () => (await apiTask(page, taskId!)).scheduledOn).toBeNull();

  // The undo put it back in the Inbox, where the Plan popover can move it to a
  // quiet day; the month grid must then draw the chip on exactly that day.
  await selectView(page, "Inbox");
  await expect(taskRow(page, title)).toBeVisible();
  await expect
    .poll(async () => (await tasksInView(page, "inbox")).filter((task) => task.id === taskId).length)
    .toBe(1);
  await planTask(page, title, chipDay!, today);
  await expect.poll(async () => (await apiTask(page, taskId!)).scheduledOn).toBe(chipDay);

  await page.goto("/");
  const chip = page.locator(`[data-date="${chipDay}"] .fc-task-chip`, { hasText: title });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-task-id", taskId!);
  await expect(chip).toHaveAttribute("aria-label", `Task: ${title}`);

  // A chip is a task, not an event: click opens the task editor, never the
  // event details popover or the event form.
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${taskId}$`));
  const editor = page.getByRole("dialog", { name: "Edit task" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Title")).toHaveValue(title);
  await expect(page.getByText("Edit event")).toHaveCount(0);

  // Closing the editor drops the deep-link param, so a reload stays on /tasks.
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toBeHidden();
  await expect(page).toHaveURL(/\/tasks$/);
});
