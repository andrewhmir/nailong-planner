import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings/preferences", {
    data: { defaultView: "auto", showWeekNumbers: false },
  });
});

test("desktop defaults to month, phone defaults to list", async ({ browser }) => {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(desktop, ANDREW, fixtures.password);
  await expect(desktop.getByRole("button", { name: "Month", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await desktop.close();

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await signIn(phone, ANDREW, fixtures.password);
  await expect(phone.getByRole("button", { name: "List", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(phone.getByRole("heading", { name: /October 2026/ })).toBeVisible();
  await phone.close();
});

test("the last view survives a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a persistent default view overrides auto on first visit", async ({ page }) => {
  await page.goto("/settings#calendar");
  // Wait for hydration before driving a controlled select, or the synthetic
  // change can land before React's listener is attached.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Default view").selectOption("timeGridWeek");
  await expect(page.getByLabel("Default view")).toHaveValue("timeGridWeek");
  await expect(page.getByText(/preferences updated/i)).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("overlapping events sit side by side, not on top of each other", async ({ page }) => {
  const week = new Date();
  const monday = new Date(week.getFullYear(), week.getMonth(), week.getDate() - week.getDay() + 1);
  const day = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;

  const calendarId = fixtures.calendars.household;
  const start = new Date(`${day}T10:00:00`);
  for (const [title, offset] of [
    ["Overlap A", 0],
    ["Overlap B", 1],
  ] as const) {
    await page.request.post("/api/events", {
      data: {
        calendarId,
        title,
        allDay: false,
        startAt: start.getTime() + offset * 30 * 60 * 1000,
        endAt: start.getTime() + offset * 30 * 60 * 1000 + 90 * 60 * 1000,
      },
    });
  }

  await page.reload();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByText("Overlap A").first()).toBeVisible();

  const boxes = await page.evaluate(() => {
    const find = (title: string) => {
      const nodes = [...document.querySelectorAll(".fc-event")] as HTMLElement[];
      const node = nodes.find((candidate) => candidate.textContent?.includes(title));
      const rect = node?.getBoundingClientRect();
      return rect ? { left: rect.left, right: rect.right, width: rect.width } : null;
    };
    const header = document.querySelector(".fc-col-header-cell") as HTMLElement | null;
    return {
      a: find("Overlap A"),
      b: find("Overlap B"),
      day: header?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(boxes.a).not.toBeNull();
  expect(boxes.b).not.toBeNull();
  const a = boxes.a!;
  const b = boxes.b!;
  expect(a.width, "each overlap column keeps a readable width").toBeGreaterThanOrEqual(
    boxes.day * 0.4,
  );
  expect(a.right, "columns must not paint over each other").toBeLessThanOrEqual(b.left + 1);

  for (const title of ["Overlap A", "Overlap B"]) {
    const response = await page.request.get("/api/events?from=0&to=9999999999999");
    if (response.ok()) {
      const payload = (await response.json()) as { events: Array<{ id: string; title: string }> };
      for (const event of payload.events.filter((candidate) => candidate.title === title)) {
        await page.request.delete(`/api/events/${event.id}`, { data: { scope: "all" } });
      }
    }
  }
});
