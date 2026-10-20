import { expect, test } from "@playwright/test";
import { loadFixtures, PARTNER, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, PARTNER, fixtures.password);
});

test("a partner sees the view-only event without edit affordances", async ({ page }) => {
  await page.getByText("On-call shift").click();
  await expect(page.getByText(/you can.t edit this calendar/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("the view-only event is still visible in the grid and the owner's calendars show", async ({
  page,
}) => {
  await expect(page.getByText("On-call shift")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Work" })).toBeVisible();
});

test("a view-only calendar still lets the partner toggle its visibility", async ({ page }) => {
  const onCall = page.getByRole("checkbox", { name: "On-call" });
  await expect(onCall).toBeChecked();
  await onCall.click();
  await expect(onCall).not.toBeChecked();
  await expect(page.getByText("On-call shift")).toHaveCount(0);
});
