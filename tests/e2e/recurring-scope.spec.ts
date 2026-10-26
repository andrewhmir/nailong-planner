import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

/**
 * Google-calendar recurring edit scopes: dragging, resizing, editing and
 * deleting one occurrence of a repeating series offers “This event” / “This and
 * following events” / “All events”, and the stored rows prove the choice.
 *
 * Each test seeds its own series through the API (never a shared fixture) because
 * the suite mutates the same test database; the series starts on the 1st of the
 * household's current month so the month grid always shows 4–5 occurrences.
 */

const fixtures = loadFixtures();
const DAY_MS = 24 * 60 * 60 * 1000;

function taipeiParts(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return { year: value("year"), month: value("month") };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const { year, month } = taipeiParts();
const monthKey = `${year}-${pad(month)}`;
const dayKey = (day: number) => `${monthKey}-${pad(day)}`;
const firstDate = dayKey(1);
const daysInMonth = new Date(year, month, 0).getDate();
/** Occurrences of a series that starts on the 1st and repeats weekly. */
const occurrenceCount = [1, 8, 15, 22, 29].filter((day) => day <= daysInMonth).length;

function cell(page: Page, date: string) {
  return page.locator(`[data-date="${date}"]`);
}

interface StoredEvent {
  id: string;
  title: string;
  startDate: string | null;
  startAt: number | null;
  rrule: string | null;
  exdates: string | null;
  recurrenceParentId: string | null;
}

async function storedEvents(page: Page): Promise<StoredEvent[]> {
  const from = new Date(year, month - 1, 1).getTime() - 7 * DAY_MS;
  const to = new Date(year, month, 1).getTime() + 7 * DAY_MS;
  const response = await page.request.get(`/api/events?from=${from}&to=${to}`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { events: StoredEvent[] };
  return payload.events;
}

/** Creates an all-day weekly series on the 1st of the current month. */
async function createSeries(page: Page, title: string): Promise<string> {
  const response = await page.request.post("/api/events", {
    data: {
      collectionId: fixtures.calendars.school,
      title,
      allDay: true,
      startDate: firstDate,
      endDate: firstDate,
      rrule: "FREQ=WEEKLY",
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { event: { id: string } };
  await page.reload();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  return payload.event.id;
}

/**
 * Deletes this spec's series (a previous aborted run or a failing test can
 * leave them behind, and a day cell folds more than three events into
 * "+N more", which would hide the blocks the next test needs).
 */
async function cleanupScopeEvents(page: Page): Promise<void> {
  const events = await storedEvents(page);
  for (const event of events.filter((candidate) => candidate.title.startsWith("Scope "))) {
    await page.request.delete(`/api/events/${event.id}`, { data: { scope: "all" } });
  }
}

function scopeDialog(page: Page) {
  return page.getByRole("dialog");
}

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
  await cleanupScopeEvents(page);
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await cleanupScopeEvents(page);
});

test("moves this occurrence only, and the moved row behaves as a single event", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope one off");

  await cell(page, dayKey(8)).getByText("Scope one off").dragTo(cell(page, dayKey(9)));
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Move repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "This event", exact: true }).click();

  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const series = events.find((event) => event.id === seriesId);
      const exceptions = events.filter((event) => event.recurrenceParentId === seriesId);
      return {
        exdates: JSON.parse(series?.exdates ?? "[]") as string[],
        exceptionDates: exceptions.map((event) => event.startDate),
      };
    })
    .toEqual({ exdates: [dayKey(8)], exceptionDates: [dayKey(9)] });

  // Reload proves the original slot is gone and the exception renders once at
  // the new date (the task's "exactly once" guarantee).
  await page.reload();
  await expect(cell(page, dayKey(9)).getByText("Scope one off")).toHaveCount(1);
  await expect(cell(page, dayKey(8)).getByText("Scope one off")).toHaveCount(0);

  // The exception is now a plain event: dragging it asks no scope question.
  await cell(page, dayKey(9)).getByText("Scope one off").dragTo(cell(page, dayKey(10)));
  await expect(scopeDialog(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      return events.find((event) => event.recurrenceParentId === seriesId)?.startDate;
    })
    .toBe(dayKey(10));
});

test("cancelling the chooser snaps the drop back", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope cancel");

  await cell(page, dayKey(8)).getByText("Scope cancel").dragTo(cell(page, dayKey(9)));
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Move repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const series = events.find((event) => event.id === seriesId);
      return {
        exdates: series?.exdates ?? null,
        exceptions: events.filter((event) => event.recurrenceParentId === seriesId).length,
      };
    })
    .toEqual({ exdates: null, exceptions: 0 });

  await page.reload();
  await expect(cell(page, dayKey(8)).getByText("Scope cancel")).toHaveCount(1);
});

test("moves the whole series by the same offset", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope all");

  await cell(page, dayKey(8)).getByText("Scope all").dragTo(cell(page, dayKey(9)));
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Move repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "All events", exact: true }).click();

  // The series starts a day later and its weekly BYDAY moves with it.
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const series = events.find((event) => event.id === seriesId);
      return { startDate: series?.startDate, rrule: series?.rrule };
    })
    .toEqual({ startDate: dayKey(2), rrule: expect.stringContaining(`BYDAY=${codes[(startWeekday + 1) % 7]}`) });

  await page.reload();
  await expect(cell(page, dayKey(2)).getByText("Scope all")).toHaveCount(1);
  await expect(cell(page, dayKey(1)).getByText("Scope all")).toHaveCount(0);
});

test("editing this and following events splits the series", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope split");

  await cell(page, dayKey(15)).getByText("Scope split").click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Scope split edited");
  await page.getByRole("button", { name: "Save" }).click();

  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Change repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "This and following events" }).click();

  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const original = events.find((event) => event.id === seriesId);
      const later = events.find((event) => event.title === "Scope split edited");
      return {
        originalTitle: original?.title,
        truncated: Boolean(original?.rrule?.includes("UNTIL=")),
        laterStart: later?.startDate,
        laterRrule: later?.rrule,
      };
    })
    .toEqual({
      originalTitle: "Scope split",
      truncated: true,
      laterStart: dayKey(15),
      laterRrule: "FREQ=WEEKLY",
    });

  await page.reload();
  await expect(cell(page, dayKey(1)).getByText("Scope split")).toHaveCount(1);
  await expect(cell(page, dayKey(15)).getByText("Scope split edited")).toHaveCount(1);
});

test("deleting this and following events keeps the earlier occurrences", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope cut");

  await cell(page, dayKey(15)).getByText("Scope cut").click();
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Delete repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "This and following events" }).click();

  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const series = events.find((event) => event.id === seriesId);
      return { rows: events.filter((event) => event.title === "Scope cut").length, rrule: series?.rrule };
    })
    .toEqual({ rows: 1, rrule: expect.stringContaining("UNTIL=") });

  await page.reload();
  await expect(page.getByText("Scope cut")).toHaveCount(2);
  await expect(cell(page, dayKey(15)).getByText("Scope cut")).toHaveCount(0);
});

test("undo restores a following-events delete", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope undelete");

  await cell(page, dayKey(15)).getByText("Scope undelete").click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Delete repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "This and following events" }).click();
  await expect(page.locator("[data-sonner-toast]", { hasText: "Following events deleted" })).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();

  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const series = events.find((event) => event.id === seriesId);
      return {
        rows: events.filter((event) => event.title === "Scope undelete").length,
        rrule: series?.rrule,
      };
    })
    .toEqual({ rows: 1, rrule: "FREQ=WEEKLY" });

  await page.reload();
  await expect(page.getByText("Scope undelete")).toHaveCount(occurrenceCount);
  await expect(cell(page, dayKey(15)).getByText("Scope undelete")).toHaveCount(1);
});

test("editing all events from a later occurrence keeps the series start", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope all edit");

  await cell(page, dayKey(15)).getByText("Scope all edit").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title").fill("Scope all edit renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Change repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "All events", exact: true }).click();

  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const series = events.find((event) => event.id === seriesId);
      return { startDate: series?.startDate, title: series?.title };
    })
    .toEqual({ startDate: dayKey(1), title: "Scope all edit renamed" });

  await page.reload();
  await expect(cell(page, dayKey(1)).getByText("Scope all edit renamed")).toHaveCount(1);
  await expect(page.getByText("Scope all edit renamed")).toHaveCount(occurrenceCount);
});

test("undo restores a following-events move", async ({ page }) => {
  const seriesId = await createSeries(page, "Scope undo");

  await cell(page, dayKey(8)).getByText("Scope undo").dragTo(cell(page, dayKey(9)));
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Move repeating event" })).toBeVisible();
  await dialog.getByRole("button", { name: "This and following events" }).click();
  await expect(page.locator("[data-sonner-toast]", { hasText: "Following events moved" })).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();

  await expect
    .poll(async () => {
      const events = await storedEvents(page);
      const rows = events.filter((event) => event.title === "Scope undo");
      return { rows: rows.length, rrule: events.find((event) => event.id === seriesId)?.rrule };
    })
    .toEqual({ rows: 1, rrule: "FREQ=WEEKLY" });

  await page.reload();
  await expect(page.getByText("Scope undo")).toHaveCount(occurrenceCount);
});

test("a custom repeat rule only offers this event", async ({ page }) => {
  const startAt = new Date(`${firstDate}T09:00:00+08:00`).getTime();
  const response = await page.request.post("/api/events", {
    data: {
      collectionId: fixtures.calendars.math,
      title: "Scope custom",
      allDay: false,
      startAt,
      endAt: startAt + 60 * 60 * 1000,
      rrule: "FREQ=WEEKLY;BYDAY=SA;BYHOUR=9",
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();

  await page.getByText("Scope custom").first().dragTo(cell(page, dayKey(9)));
  const dialog = scopeDialog(page);
  await expect(dialog.getByRole("heading", { name: "Move repeating event" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "This and following events" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "All events", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "This event", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});
