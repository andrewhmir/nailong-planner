import { expect, test, type Page } from "@playwright/test";
import { ANDREW, PARTNER, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

function monthDay(day: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function deleteProbe(page: Page, title: string): Promise<void> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 7 * 86_400_000;
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() + 7 * 86_400_000;
  const response = await page.request.get(`/api/events?from=${from}&to=${to}`);
  const payload = (await response.json()) as { events: Array<{ id: string; title: string }> };
  for (const event of payload.events.filter((candidate) => candidate.title === title)) {
    await page.request.delete(`/api/events/${event.id}`, { data: { scope: "all" } });
  }
}

async function collectionId(page: Page, name: string): Promise<string> {
  const response = await page.request.get("/api/collections");
  const payload = (await response.json()) as {
    collections: Array<{ id: string; name: string; children: Array<{ id: string; name: string }> }>;
  };
  const found = payload.collections
    .flatMap((root) => [root, ...root.children])
    .find((calendar) => calendar.name === name);
  if (!found) {
    throw new Error(`No calendar named ${name}`);
  }
  return found.id;
}

// Own probes rather than seeded events: other specs rename and delete those, so
// their presence depends on file order.
async function createProbe(
  page: Page,
  targetCollectionId: string,
  title: string,
  day: string,
): Promise<void> {
  const response = await page.request.post("/api/events", {
    data: {
      collectionId: targetCollectionId,
      title,
      allDay: true,
      startDate: day,
      endDate: day,
      rrule: null,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.describe("as the owner", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
  });

  test("displays only the chosen calendar and assigns new events to it", async ({ page }) => {
    const mathId = await collectionId(page, "Math");
    const householdId = await collectionId(page, "Household");
    await createProbe(page, mathId, "Math probe", monthDay(16));
    await createProbe(page, householdId, "Ours probe", monthDay(17));

    await page.reload();
    await expect(page.getByText("Math probe")).toBeVisible();
    await expect(page.getByText("Ours probe")).toBeVisible();

    await page.getByRole("button", { name: "Options for Math" }).click();
    await page.getByRole("menuitem", { name: "Display only this calendar" }).click();

    // Only Math remains: its own event stays, the household one disappears, and
    // the checkboxes read back the narrowed view.
    await expect(page.getByText("Showing only Math")).toBeVisible();
    await expect(page.getByText("Math probe")).toBeVisible();
    await expect(page.getByText("Ours probe")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Household" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Math" })).toBeChecked();

    // The quick-create bubble now proposes Math…
    await page.locator(`[data-date="${monthDay(24)}"]`).click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("calendar-picker-trigger")).toContainText("Math");
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Title")).toHaveCount(0);

    // …and the full dialog does too, all the way to the saved event.
    await page.getByRole("button", { name: "New event" }).click();
    await expect(page.getByTestId("calendar-picker-trigger")).toContainText("Math");
    await page.getByLabel("Title").fill("Math only probe");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Math only probe")).toBeVisible();

    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 7 * 86_400_000;
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() + 7 * 86_400_000;
    const eventsResponse = await page.request.get(`/api/events?from=${from}&to=${to}`);
    const eventsPayload = (await eventsResponse.json()) as {
      events: Array<{ title: string; collectionId: string }>;
    };
    expect(
      eventsPayload.events.find((event) => event.title === "Math only probe")?.collectionId,
    ).toBe(mathId);

    // "Show all" restores the view without having touched the saved checkboxes.
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(page.getByText("Showing only Math")).toHaveCount(0);
    await expect(page.getByText("Ours probe")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Household" })).toBeChecked();

    await deleteProbe(page, "Math probe");
    await deleteProbe(page, "Ours probe");
    await deleteProbe(page, "Math only probe");
  });

  test("isolating a calendar dismisses an open bubble, and the next one targets it", async ({
    page,
  }) => {
    // The reported flow: a bubble opened before isolating proposed the settings
    // default (Biology). Choosing "display only Math" dismisses it, so the next
    // click opens a fresh bubble with the isolated calendar.
    const patch = await page.request.patch("/api/settings/preferences", {
      data: { lastEventCalendarId: fixtures.calendars.biology },
    });
    expect(patch.ok(), await patch.text()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Math" })).toBeVisible();

    await page.locator(`[data-date="${monthDay(22)}"]`).click({ position: { x: 8, y: 8 } });
    const trigger = page.getByTestId("calendar-picker-trigger");
    await expect(trigger).toContainText("Biology");

    await page.getByRole("button", { name: "Options for Math" }).click();
    await page.getByRole("menuitem", { name: "Display only this calendar" }).click();
    await expect(page.getByText("Showing only Math")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveCount(0);

    await page.locator(`[data-date="${monthDay(25)}"]`).click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("calendar-picker-trigger")).toContainText("Math");
  });

  test("re-checking any calendar leaves the isolated view", async ({ page }) => {
    const householdId = await collectionId(page, "Household");
    await createProbe(page, householdId, "Ours probe", monthDay(17));
    await page.reload();
    await expect(page.getByText("Ours probe")).toBeVisible();

    await page.getByRole("button", { name: "Options for Math" }).click();
    await page.getByRole("menuitem", { name: "Display only this calendar" }).click();
    await expect(page.getByText("Showing only Math")).toBeVisible();
    await expect(page.getByText("Ours probe")).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Household" }).click();

    await expect(page.getByText("Showing only Math")).toHaveCount(0);
    await expect(page.getByText("Ours probe")).toBeVisible();

    await deleteProbe(page, "Ours probe");
  });
});

test.describe("as the partner", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PARTNER, fixtures.password);
  });

  test("a view-only calendar can still be displayed on its own", async ({ page }) => {
    // Work is view-only for the partner, so its menu offers isolation but no editing.
    await page.getByRole("button", { name: "Options for Work" }).click();
    const menu = page.getByRole("menuitem", { name: "Display only this calendar" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Calendar settings" })).toHaveCount(0);
    await menu.click();

    await expect(page.getByText("Showing only Work")).toBeVisible();
    // On-call is a sub-calendar of Work, so its event is hidden by the exact-only scope.
    await expect(page.getByText("On-call shift")).toHaveCount(0);

    await page.getByRole("button", { name: "Show all" }).click();
    await expect(page.getByText("On-call shift")).toBeVisible();
  });
});
