import path from "node:path";
import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();
const sample = path.resolve("tests/fixtures/ics/google-sample.ics");

// The first hit compiles the route on a cold `.next-e2e`; leave room for that.
test.setTimeout(120_000);

test("imports a Google export, shows it on the calendar, and undoes it", async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);

  await page.goto("/settings");
  await page.getByRole("link", { name: "Open the importer" }).click();
  await expect(page.getByRole("heading", { name: "Import from Google Calendar" })).toBeVisible({
    timeout: 45_000,
  });

  await page.getByLabel("Google Calendar files").setInputFiles(sample);
  await expect(page.getByText("3 to add, 0 to update, 0 already up to date.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Family", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Import target for Family")).toBeVisible();
  await page.getByRole("button", { name: "Import 3 events" }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();
  await expect(page.getByText("3 added, 0 updated, 0 already up to date.")).toBeVisible();

  await page.getByRole("link", { name: "Go to calendar" }).click();
  await page.waitForURL("/");
  await expect(page.getByText("Dentist appointment")).toBeVisible();

  // The report step is gone after navigating, so undo from the history table.
  await page.goto("/settings/import");
  await expect(page.getByRole("heading", { name: "Past imports" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Committed" })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByText("Import undone")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Undone" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("Dentist appointment")).toHaveCount(0);
});
