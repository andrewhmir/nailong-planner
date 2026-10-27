import { expect, test, type Page } from "@playwright/test";
import { ANDREW, PARTNER, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

// The first hit compiles `/tasks` on a cold `.next-e2e`; leave room for that.
test.setTimeout(120_000);

interface ApiTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  collectionId: string;
  scheduledOn: string | null;
  dueOn: string | null;
}

interface ApiCounts {
  counts: { all: number; today: number; week: number; someday: number; overdue: number };
  byCollection: Record<string, number>;
}

/** Tasks created by one test, removed in `afterEach` so the shared seed stays clean. */
let createdIds: string[] = [];

test.beforeEach(async ({ page }) => {
  createdIds = [];
  await signIn(page, ANDREW, fixtures.password);
});

test.afterEach(async ({ page }) => {
  for (const id of createdIds) {
    try {
      await page.request.delete(`/api/tasks/${id}`);
    } catch {
      // Already deleted by the test; the shared database simply stays clean.
    }
  }
  createdIds = [];
});

/** A unique suffix, so a failed cleanup cannot collide with the next run. */
function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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

function addDaysToDate(date: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

async function householdTimezone(page: Page): Promise<string> {
  const response = await page.request.get("/api/session");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { household: { timezone: string } | null };
  return body.household?.timezone ?? "Asia/Taipei";
}

/** Create a probe through the real API, so the test owns a task the seed cannot move. */
async function createTask(page: Page, body: Record<string, unknown>): Promise<ApiTask> {
  const response = await page.request.post("/api/tasks", { data: body });
  expect(response.ok()).toBeTruthy();
  const created = ((await response.json()) as { task: ApiTask }).task;
  createdIds.push(created.id);
  return created;
}

async function patchTask(page: Page, id: string, body: Record<string, unknown>): Promise<ApiTask> {
  const response = await page.request.patch(`/api/tasks/${id}`, { data: body });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { task: ApiTask }).task;
}

async function apiTask(page: Page, id: string): Promise<ApiTask> {
  const response = await page.request.get(`/api/tasks/${id}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { task: ApiTask }).task;
}

async function apiCounts(page: Page): Promise<ApiCounts> {
  const response = await page.request.get("/api/tasks/counts");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ApiCounts;
}

async function tasksInCollection(page: Page, collectionId: string): Promise<ApiTask[]> {
  const response = await page.request.get(`/api/tasks?collectionId=${collectionId}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { tasks: ApiTask[] }).tasks;
}

/** The seeded `/tasks` list view, ready for locators. */
async function openTasks(page: Page): Promise<void> {
  await page.goto("/tasks");
  await expect(page.getByTestId("tasks-shell")).toBeVisible();
  await expect(page.getByTestId("task-list")).toBeVisible();
}

/** One row, in either list or board layout (the id is unique across the page). */
function rowById(page: Page, id: string) {
  return page.locator(`li[data-task-id="${id}"]`);
}

/** The scope tab; its accessible name carries the open count ("All, 4 open"). */
function scopeTab(page: Page, label: "All" | "Today" | "Week" | "Someday") {
  return page
    .getByRole("group", { name: "Task scopes" })
    .getByRole("button", { name: new RegExp(`^${label}(,|$)`) });
}

/** One collapsible group section in the list (`<section aria-label="To do tasks">`). */
function groupSection(page: Page, label: string) {
  return page.getByRole("region", { name: `${label} tasks` });
}

/** The task ids painted in DOM order (list rows or board cards). */
async function renderedIds(page: Page): Promise<string[]> {
  return page
    .locator("li[data-task-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-id") ?? ""));
}

function toast(page: Page, text: string) {
  return page.locator("[data-sonner-toast]", { hasText: text }).first();
}

async function chooseStatus(page: Page, id: string, next: string): Promise<void> {
  const row = rowById(page, id);
  // The visible pill's test id names its *current* status.
  await row.locator('[data-testid^="task-status-"]').click();
  await page.getByRole("menuitemradio", { name: next, exact: true }).click();
}

async function choosePriority(page: Page, id: string, next: string): Promise<void> {
  await rowById(page, id).locator('[data-testid^="task-priority-"]').click();
  await page.getByRole("menuitemradio", { name: next, exact: true }).click();
}

/**
 * Drive the board's HTML5 drag. Playwright's pointer-driven `dragTo` cannot
 * finish a native HTML5 drag in this headless shell — the browser takes pointer
 * capture at dragstart and reports the mouseup as intercepted by `<html>` — so
 * dispatch the same events with a real `DataTransfer`. That still runs the
 * production `dragstart` payload writer, the column's MIME-checked `dragover`
 * and its `drop` handler, which is the contract the board owns.
 */
async function dragBoardCard(page: Page, taskId: string, columnTestId: string): Promise<void> {
  await page.evaluate(
    ({ cardId, columnId }) => {
      const card = document.querySelector(`li[data-task-id="${cardId}"]`);
      const column = document.querySelector(`[data-testid="${columnId}"]`);
      if (!(card instanceof HTMLElement) || !(column instanceof HTMLElement)) {
        throw new Error("Board card or column is not rendered.");
      }
      const transfer = new DataTransfer();
      const fire = (target: HTMLElement, type: string): void => {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      };
      fire(card, "dragstart");
      fire(column, "dragover");
      fire(column, "drop");
      fire(card, "dragend");
    },
    { cardId: taskId, columnId: columnTestId },
  );
}

// Spec §8 styling/§6 views: the default `/tasks` is the grouped status list, and
// the List/Board toggle reaches the same payload as a status board. The active
// pair of columns is always painted; the closed pair only with "show closed".
test("the default view is the grouped list and the board shows the status columns", async ({ page }) => {
  const doneTitle = `E2E board done ${stamp()}`;
  const doneTask = await createTask(page, { title: doneTitle });
  await patchTask(page, doneTask.id, { status: "done" });
  await openTasks(page);

  // Scope badges are painted from the payload, and All is the default tab.
  await expect(page.getByTestId("tasks-count-all")).toBeVisible();
  await expect(scopeTab(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(groupSection(page, "To do")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Call the plumber" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Book a dentist appointment" })).toBeVisible();

  await page.getByRole("group", { name: "Task layout" }).getByRole("button", { name: "Board" }).click();
  await expect(page.getByTestId("task-board")).toBeVisible();
  await expect(page.getByTestId("task-board-column-open")).toBeVisible();
  await expect(page.getByTestId("task-board-column-in_progress")).toBeVisible();
  await expect(page.getByTestId("task-board-column-open")).toContainText("Call the plumber");
  // Hide closed is on by default, so the closed columns do not render at all.
  await expect(page.getByTestId("task-board-column-done")).toHaveCount(0);
  await expect(page.getByTestId("task-board-column-dropped")).toHaveCount(0);

  await page.getByTestId("task-toggle-closed").click();
  await expect(page.getByTestId("task-board-column-done")).toBeVisible();
  await expect(page.getByTestId("task-board-column-dropped")).toBeVisible();
  await expect(page.getByTestId("task-board-column-done")).toContainText(doneTitle);

  await page.getByRole("group", { name: "Task layout" }).getByRole("button", { name: "List" }).click();
  await expect(page.getByTestId("task-list")).toBeVisible();

  // A retired scope value renders All and is normalised out of the URL, so an
  // old shared link cannot keep claiming a scope the page is not showing.
  await page.goto("/tasks?view=inbox");
  await expect(page.getByTestId("tasks-shell")).toBeVisible();
  await expect(scopeTab(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/view=/);
});

// Inline status: To do → In progress is a real transition between two painted
// groups (both are active statuses, so no "show closed" switch is involved).
test("changing a row's status moves it between groups and Ctrl+Z restores it", async ({ page }) => {
  const title = `E2E status ${stamp()}`;
  const task = await createTask(page, { title });
  await openTasks(page);

  await expect(rowById(page, task.id)).toBeVisible();
  await chooseStatus(page, task.id, "In progress");

  await expect(toast(page, "Task started")).toBeVisible();
  await expect(groupSection(page, "In progress").locator(`li[data-task-id="${task.id}"]`)).toBeVisible();
  await expect(groupSection(page, "To do").locator(`li[data-task-id="${task.id}"]`)).toHaveCount(0);
  await expect.poll(async () => (await apiTask(page, task.id)).status).toBe("in_progress");

  await page.keyboard.press("Control+z");
  await expect(groupSection(page, "To do").locator(`li[data-task-id="${task.id}"]`)).toBeVisible();
  await expect.poll(async () => (await apiTask(page, task.id)).status).toBe("open");
});

// Inline priority: the flag changes in place, the toast's undo stack exists, and
// the value is stored server-side rather than carried in this tab's URL.
test("changing a row's priority shows the flag and survives a reload", async ({ page }) => {
  const title = `E2E priority ${stamp()}`;
  const task = await createTask(page, { title });
  await openTasks(page);

  const row = rowById(page, task.id);
  await expect(row.getByTestId("task-priority-none")).toBeVisible();
  await choosePriority(page, task.id, "High");

  await expect(toast(page, "Priority updated")).toBeVisible();
  await expect(row.getByTestId("task-priority-high")).toBeVisible();
  await expect.poll(async () => (await apiTask(page, task.id)).priority).toBe("high");

  await page.reload();
  await expect(page.getByTestId("tasks-shell")).toBeVisible();
  await expect(rowById(page, task.id).getByTestId("task-priority-high")).toBeVisible();
});

// The toolbar's Group/Sort/Hide-closed controls: grouping really reorders the
// sections, sort=due reorders within the view, and the Done filter pulls in the
// closed rows by turning "show closed" on for the user.
test("grouping, sorting, hide-closed and the Done filter change the painted rows", async ({ page }) => {
  const timezone = await householdTimezone(page);
  const today = householdToday(timezone);
  const base = stamp();
  const urgentTitle = `E2E urgent ${base}`;
  const lowTitle = `E2E low ${base}`;
  const doneTitle = `E2E done ${base}`;
  const dueNewTitle = `E2E due new ${base}`;
  const dueOldTitle = `E2E due old ${base}`;

  const urgent = await createTask(page, { title: urgentTitle, priority: "urgent" });
  const low = await createTask(page, { title: lowTitle, priority: "low" });
  const done = await createTask(page, { title: doneTitle });
  await patchTask(page, done.id, { status: "done" });
  // `dueOld` is created after `dueNew`, so manual order is [dueNew, dueOld] and
  // the due-date sort must visibly reverse that pair in the Today view.
  const dueNew = await createTask(page, {
    title: dueNewTitle,
    collectionId: fixtures.collections.andrewInbox,
    scheduledOn: addDaysToDate(today, -1),
  });
  const dueOld = await createTask(page, {
    title: dueOldTitle,
    collectionId: fixtures.collections.andrewInbox,
    scheduledOn: addDaysToDate(today, -2),
  });

  await openTasks(page);

  // Group by priority: urgent's section paints before low's, and the DOM order
  // follows the group order.
  await page.getByRole("button", { name: "Group: Status", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Priority", exact: true }).click();
  await expect(page).toHaveURL(/group=priority/);
  await expect(groupSection(page, "Urgent").locator(`li[data-task-id="${urgent.id}"]`)).toBeVisible();
  await expect(groupSection(page, "Low").locator(`li[data-task-id="${low.id}"]`)).toBeVisible();
  const groupedIds = await renderedIds(page);
  expect(groupedIds.indexOf(urgent.id)).toBeGreaterThanOrEqual(0);
  expect(groupedIds.indexOf(urgent.id)).toBeLessThan(groupedIds.indexOf(low.id));

  await page.getByRole("button", { name: "Group: Priority", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Status", exact: true }).click();

  // Hide closed hides the done probe; turning it off paints the Done section.
  await expect(rowById(page, done.id)).toHaveCount(0);
  await page.getByTestId("task-toggle-closed").click();
  await expect(page.getByTestId("task-toggle-closed")).toHaveAttribute("aria-pressed", "false");
  await expect(groupSection(page, "Done").locator(`li[data-task-id="${done.id}"]`)).toBeVisible();
  await page.getByTestId("task-toggle-closed").click();
  await expect(rowById(page, done.id)).toHaveCount(0);

  // Ticking Done in the filter is enough: it enables closed rows itself.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Done", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("task-toggle-closed")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("task-filter-count")).toHaveText("1");
  await expect(rowById(page, done.id)).toBeVisible();
  await expect(rowById(page, urgent.id)).toHaveCount(0);

  // Untick Done rather than using the menu's Clear-filters action: with every
  // writable list in the menu, the last item can sit below a 720px viewport,
  // while unticking the one checked status is the same filter change.
  await page.getByRole("button", { name: "Filter, 1 active", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Done", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(rowById(page, urgent.id)).toBeVisible();
  await page.getByTestId("task-toggle-closed").click();
  await expect(page.getByTestId("task-toggle-closed")).toHaveAttribute("aria-pressed", "true");

  // Sort by due date in Today: the older schedule must come first.
  await scopeTab(page, "Today").click();
  await expect(page).toHaveURL(/view=today/);
  await expect(rowById(page, dueNew.id)).toBeVisible();
  await expect(rowById(page, dueOld.id)).toBeVisible();
  const manualIds = await renderedIds(page);
  expect(manualIds.indexOf(dueNew.id)).toBeLessThan(manualIds.indexOf(dueOld.id));

  await page.getByRole("button", { name: "Sort: Manual", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Due date", exact: true }).click();
  await expect(page).toHaveURL(/sort=due/);
  await expect.poll(async () => {
    const ids = await renderedIds(page);
    return ids.indexOf(dueOld.id) < ids.indexOf(dueNew.id);
  }).toBe(true);
});

// The panel replaced the old modal: Enter and the title button open the same
// non-modal slide-over, Escape closes it and returns focus to the selected row.
test("a row opens the slide-over panel and Escape returns focus to the row", async ({ page }) => {
  const title = `E2E panel ${stamp()}`;
  const task = await createTask(page, { title });
  await openTasks(page);

  const row = rowById(page, task.id);
  await row.focus();
  await expect(row).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Enter");

  const panel = page.getByTestId("task-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("task-panel-title")).toHaveValue(title);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(row).toBeFocused();

  // The title button is the pointer path to the same panel.
  await row.getByRole("button", { name: title, exact: true }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close task" }).click();
  await expect(panel).toHaveCount(0);
  await expect(row).toBeFocused();
});

// `?task=<id>` is one-shot: it opens the panel once, and closing removes the
// param so a reload (or Back) does not reopen a dismissed panel.
test("the ?task deep link opens the panel once and closing clears the param", async ({ page }) => {
  const title = `E2E deep link ${stamp()}`;
  const task = await createTask(page, { title });

  await page.goto(`/tasks?task=${task.id}`);
  const panel = page.getByTestId("task-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("task-panel-title")).toHaveValue(title);
  await expect(page).toHaveURL(new RegExp(`task=${task.id}`));

  await panel.getByRole("button", { name: "Close task" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);

  await page.reload();
  await expect(page.getByTestId("tasks-shell")).toBeVisible();
  await expect(page.getByTestId("task-panel")).toHaveCount(0);
});

// Keyboard triage: `j` selects the first row, typing in the capture field is
// inert, `2` schedules the selection out of Someday and `x` completes it.
// The scope itself is URL state, so `?view=someday` opens Someday directly.
test("keyboard triage works and typing in the capture row does not fire it", async ({ page }) => {
  const base = stamp();
  const scheduleTitle = `E2E key schedule ${base}`;
  const completeTitle = `E2E key complete ${base}`;
  const scheduleTask = await createTask(page, { title: scheduleTitle });
  const completeTask = await createTask(page, { title: completeTitle });

  // The undated captures are Someday rows now: `2`/`x` remove them there.
  await page.goto("/tasks?view=someday");
  await expect(page.getByTestId("tasks-shell")).toBeVisible();
  await expect(page.getByTestId("task-list")).toBeVisible();
  await expect(scopeTab(page, "Someday")).toHaveAttribute("aria-pressed", "true");
  // The scope really filters: a Today-only seeded row is not painted here.
  await expect(page.getByRole("checkbox", { name: "Take out the recycling" })).toHaveCount(0);

  // `j` with no selection lands on the first painted row; retry the press so a
  // cold hydration on the dev server cannot swallow the key.
  await expect(async () => {
    await page.keyboard.press("j");
    await expect(page.locator('li[data-task-id][data-selected="true"]')).toHaveCount(1, {
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
  const firstId = await page
    .locator('li[data-task-id][data-selected="true"]')
    .getAttribute("data-task-id");
  expect(firstId).toBeTruthy();

  // Typing in the capture input must stay typed text: no selection change.
  await page.locator("#task-capture").click();
  await page.keyboard.press("j");
  await expect(page.locator("#task-capture")).toHaveValue("j");
  await expect(page.locator(`li[data-task-id="${firstId}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.locator("#task-capture").fill("");

  // `2` schedules the selected row to the end of the household week; it leaves
  // Someday (Today or Week owns it now).
  await rowById(page, scheduleTask.id).focus();
  await page.keyboard.press("2");
  await expect(toast(page, "Task scheduled")).toBeVisible();
  await expect.poll(async () => (await apiTask(page, scheduleTask.id)).scheduledOn).not.toBeNull();
  await expect(rowById(page, scheduleTask.id)).toHaveCount(0);

  // `x` completes the selected row.
  await rowById(page, completeTask.id).focus();
  await page.keyboard.press("x");
  await expect(toast(page, "Task completed")).toBeVisible();
  await expect.poll(async () => (await apiTask(page, completeTask.id)).status).toBe("done");
  await expect(rowById(page, completeTask.id)).toHaveCount(0);

  await page.goto("/tasks?view=today");
  await expect(page.getByTestId("tasks-shell")).toBeVisible();
  await expect(scopeTab(page, "Today")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox", { name: "Take out the recycling" })).toBeVisible();

  // The All tab is canonical as the bare URL: switching back deletes `view`.
  await scopeTab(page, "All").click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(scopeTab(page, "All")).toHaveAttribute("aria-pressed", "true");
});

// The global capture is the other way into the Inbox: `Shift+K` from the
// calendar writes a task without navigating, and its toast Undo deletes exactly
// that capture.
test("global Shift+K capture writes an Inbox task and the toast undoes it", async ({ page }) => {
  const title = `E2E global capture ${stamp()}`;
  await expect(page).toHaveURL(/\/$/);

  await page.keyboard.press("Shift+K");
  const dialog = page.getByRole("dialog", { name: "Capture a task" });
  await expect(dialog).toBeVisible();
  await dialog.locator("#global-capture-title").fill(title);
  await dialog.locator("#global-capture-title").press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(toast(page, "Task captured")).toBeVisible();

  const created = (await tasksInCollection(page, fixtures.collections.andrewInbox)).find(
    (task) => task.title === title,
  );
  expect(created).toBeTruthy();
  createdIds.push(created!.id);

  await toast(page, "Task captured").getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await page.request.get(`/api/tasks/${created!.id}`)).status())
    .toBe(404);
});

// Board drag: a card dropped on another status column is the same status
// transition (and the same targeted undo) as the row pill.
test("dragging a card to another column changes its status and is undoable", async ({ page }) => {
  const title = `E2E board drag ${stamp()}`;
  const task = await createTask(page, { title });

  await page.goto("/tasks?layout=board");
  await expect(page.getByTestId("task-board")).toBeVisible();
  const card = rowById(page, task.id);
  await expect(page.getByTestId("task-board-column-open").locator(`li[data-task-id="${task.id}"]`)).toBeVisible();

  await dragBoardCard(page, task.id, "task-board-column-in_progress");

  await expect(toast(page, "Task started")).toBeVisible();
  await expect(
    page
      .getByTestId("task-board-column-in_progress")
      .locator(`li[data-task-id="${task.id}"]`),
  ).toBeVisible();
  await expect.poll(async () => (await apiTask(page, task.id)).status).toBe("in_progress");

  await toast(page, "Task started").getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByTestId("task-board-column-open").locator(`li[data-task-id="${task.id}"]`),
  ).toBeVisible();
  await expect.poll(async () => (await apiTask(page, task.id)).status).toBe("open");
  await expect(card).toBeVisible();
});

// The sidebar's list row is a real count + a quick add that creates into that
// list. Scope the locators by the row: the phone sheet mounts a second tree, so
// a bare `getByTestId` can be ambiguous.
test("a sidebar list shows its active count and quick-add creates a task in it", async ({ page }) => {
  const title = `E2E sidebar quick add ${stamp()}`;
  const errandsId = fixtures.collections.errands;
  const before = (await apiCounts(page)).byCollection[errandsId] ?? 0;

  await page.goto("/tasks");
  await expect(page.getByTestId("tasks-shell")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Collection tree" });
  const row = nav.getByRole("checkbox", { name: "Errands", exact: true }).locator("..");
  await expect(row.getByTestId(`collection-task-count-${errandsId}`)).toHaveText(String(before));

  await row.hover();
  await row.getByTestId("sidebar-quick-add").click();
  const dialog = page.getByRole("dialog", { name: "Add a task to Errands" });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("sidebar-quick-add-input").fill(title);
  await dialog.getByRole("button", { name: "Add task", exact: true }).click();

  await expect(toast(page, "Task added")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByTestId(`collection-task-count-${errandsId}`)).toHaveText(String(before + 1));

  const created = (await tasksInCollection(page, errandsId)).find((task) => task.title === title);
  expect(created).toBeTruthy();
  expect(created!.collectionId).toBe(errandsId);
  createdIds.push(created!.id);
});

// The page capture row is the pointer path into the Inbox list: Enter creates
// the task without leaving `/tasks`, and because All is the default scope the
// settle refetch paints it in the To do group (no dates, so it is Someday).
test("the page capture row creates an Inbox task that appears in the list", async ({ page }) => {
  const title = `E2E capture row ${stamp()}`;
  await openTasks(page);

  const input = page.locator("#task-capture");
  await input.fill(title);
  await input.press("Enter");

  // The field clears only after the create succeeds.
  await expect(input).toHaveValue("");

  await expect
    .poll(async () => {
      const tasks = await tasksInCollection(page, fixtures.collections.andrewInbox);
      return tasks.some((task) => task.title === title);
    })
    .toBe(true);
  const created = (await tasksInCollection(page, fixtures.collections.andrewInbox)).find(
    (task) => task.title === title,
  );
  expect(created).toBeTruthy();
  createdIds.push(created!.id);
  await expect(
    groupSection(page, "To do").locator(`li[data-task-id="${created!.id}"]`),
  ).toBeVisible();
});

// A board column's own capture row creates straight into that status: the create
// body carries `in_progress`, so the API row and the painted column agree.
test("a board column's capture row creates a task with that column's status", async ({ page }) => {
  const title = `E2E column capture ${stamp()}`;
  await page.goto("/tasks?layout=board");
  await expect(page.getByTestId("task-board")).toBeVisible();

  const input = page.locator("#task-capture-in_progress");
  await input.fill(title);
  await input.press("Enter");
  await expect(input).toHaveValue("");

  await expect
    .poll(async () => {
      const tasks = await tasksInCollection(page, fixtures.collections.andrewInbox);
      return tasks.some((task) => task.title === title);
    })
    .toBe(true);
  const created = (await tasksInCollection(page, fixtures.collections.andrewInbox)).find(
    (task) => task.title === title,
  );
  expect(created).toBeTruthy();
  createdIds.push(created!.id);
  expect(created!.status).toBe("in_progress");
  await expect(
    page
      .getByTestId("task-board-column-in_progress")
      .locator(`li[data-task-id="${created!.id}"]`),
  ).toBeVisible();
});

// Acceptance criterion 3: the partner cannot see the private list or its tasks,
// in the tree, the views or the API.
test("the partner cannot see the private list or its tasks", async ({ page }) => {
  await page.context().clearCookies();
  await signIn(page, PARTNER, fixtures.password);
  await page.goto("/tasks");
  await expect(page.getByTestId("tasks-shell")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Collection tree" });
  await expect(nav.getByRole("checkbox", { name: "Journal", exact: true })).toHaveCount(0);
  for (const title of ["Morning pages", "Weekly reflection"]) {
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  }

  // The boundary is server-side, not just hidden markup.
  for (const id of fixtures.tasks.private) {
    expect((await page.request.get(`/api/tasks/${id}`)).status()).toBe(404);
  }
  const collectionsResponse = await page.request.get("/api/collections");
  expect(collectionsResponse.ok()).toBeTruthy();
  expect(JSON.stringify(await collectionsResponse.json())).not.toContain(
    fixtures.collections.journal,
  );
  const filtered = await page.request.get(
    `/api/tasks?collectionId=${fixtures.collections.journal}`,
  );
  expect(filtered.ok()).toBeTruthy();
  expect(((await filtered.json()) as { tasks: ApiTask[] }).tasks).toHaveLength(0);
});
