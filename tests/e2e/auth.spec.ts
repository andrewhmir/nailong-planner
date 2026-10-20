import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test("unauthenticated visit redirects to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("the login page renders email and password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("a wrong password shows an error and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ANDREW);
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert").filter({ hasText: /incorrect|invalid|wrong/i })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("the correct password lands on the calendar page", async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
  await expect(page.getByRole("heading", { name: /nailong planner/i })).toBeVisible();
});

test("the session survives a reload", async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
  await page.reload();
  await expect(page).toHaveURL("/");
});
