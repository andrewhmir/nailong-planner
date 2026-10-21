import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, PARTNER, signIn } from "./helpers";

const fixtures = loadFixtures();

test.describe("details as the owner", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ANDREW, fixtures.password);
  });

  test("details show the calendar and the repeat summary", async ({ page }) => {
    await page.getByText("Weekly class").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("School");
    await expect(dialog).toContainText("Weekly on Tuesday");
  });

  test("a later occurrence shows its own date, not the series start (F28)", async ({ page }) => {
    const occurrences = page.getByText("Weekly class");
    await expect(occurrences.nth(1)).toBeVisible();
    await occurrences.nth(1).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/2[0-9] Oct/);
    await expect(dialog).not.toContainText(/15 Oct/);
  });

  test("Escape closes the details and returns focus to the event", async ({ page }) => {
    const event = page.locator(".fc-event").filter({ hasText: "Math quiz" }).first();
    await event.click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(event).toBeFocused();
  });

  test("duplicate opens a prefilled create dialog and saves a second event", async ({ page }) => {
    await page.getByText("Math quiz").click();
    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByLabel("Title")).toHaveValue("Math quiz");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Math quiz")).toHaveCount(2);

    // Undo the duplicate so later specs still see exactly one Math quiz. Wait for
    // the DELETE to finish: the count drops optimistically before the server row
    // is gone, and a closing context would abort the request.
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes("/api/events/"),
    );
    await page.getByRole("button", { name: "Undo" }).click();
    await deleted;
    await expect(page.getByText("Math quiz")).toHaveCount(1);
  });
});

test.describe("details as the partner", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PARTNER, fixtures.password);
  });

  test("a view-only event has no edit, delete or duplicate actions", async ({ page }) => {
    await page.getByText("On-call shift").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Duplicate" })).toHaveCount(0);
    await expect(page.getByText(/you can.t edit this calendar/i)).toBeVisible();
  });
});
