import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the settings page saves the household name", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByLabel("Household name").fill("Nest Two");
  await page.getByRole("button", { name: "Save household" }).click();
  await expect(page.getByText(/household updated/i)).toBeVisible();

  await page.reload();
  await expect(page.getByText("Nest Two").first()).toBeVisible();
  // The crumb above is shell chrome; this proves the form itself repopulated.
  await expect(page.getByLabel("Household name")).toHaveValue("Nest Two");
});

test("the sub-nav state follows the URL hash", async ({ page }) => {
  await page.goto("/settings");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "Household" }).click();
  await expect(nav.getByRole("link", { name: "Household" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(nav.getByRole("link", { name: "Profile" })).not.toHaveAttribute(
    "aria-current",
    "location",
  );

  // A direct load of a hash deep link marks that section, not Profile.
  await page.goto("/settings#account");
  await expect(nav.getByRole("link", { name: "Account" })).toHaveAttribute(
    "aria-current",
    "location",
  );
});

test("the security panel offers password change and two-factor setup", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
  await expect(page.getByRole("button", { name: /set up two-factor/i })).toBeVisible();
});

test("two-factor setup asks for a verification code and shows backup codes", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Account password").fill(fixtures.password);
  await page.getByRole("button", { name: /set up two-factor/i }).click();

  await expect(page.getByLabel("Verification code")).toBeVisible();
  await expect(page.getByTestId("backup-codes")).toBeVisible();
});

test("security headers are set on responses", async ({ request }) => {
  const response = await request.get("/login");
  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["referrer-policy"]).toBe("same-origin");
});
