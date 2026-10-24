import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the sidebar mini-month jumps the grid to a date", async ({ page }) => {
  const mini = page.getByRole("grid", { name: /Mini calendar/ });
  await expect(mini).toBeVisible();

  const now = new Date();
  await mini
    .getByRole("gridcell", { name: new RegExp(`\\b${now.getDate()}\\b`) })
    .click();
  await expect(
    page.getByRole("heading", { name: new RegExp(MONTHS[now.getMonth()] ?? "") }),
  ).toBeVisible();

  await mini.getByRole("button", { name: "Next month" }).click();
  await mini.getByRole("gridcell", { name: /\b18\b/ }).click();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`${MONTHS[nextMonth.getMonth()] ?? ""} ${nextMonth.getFullYear()}`),
    }),
  ).toBeVisible();
});

test("the toolbar title opens a date picker", async ({ page }) => {
  const now = new Date();
  const title = page.getByRole("button", {
    name: new RegExp(`${MONTHS[now.getMonth()] ?? ""} ${now.getFullYear()}`),
  });
  await title.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a wheel gesture over the grid moves to the next month", async ({ page }) => {
  const now = new Date();
  await expect(
    page.getByRole("heading", { name: new RegExp(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`) }),
  ).toBeVisible();

  await page.locator("[data-date]").first().hover();
  await page.mouse.wheel(0, 300);

  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`${MONTHS[next.getMonth()] ?? ""} ${next.getFullYear()}`),
    }),
  ).toBeVisible();
});

test("a ?date= deep link opens that month", async ({ page }) => {
  await page.goto("/?date=2027-03-15");
  await expect(page.getByRole("heading", { name: /March 2027/ })).toBeVisible();
});

test("the toolbar title stays a heading for assistive tech", async ({ page }) => {
  const heading = page.getByRole("heading", { level: 2 }).first();
  await expect(heading).toBeVisible();
  await expect(heading.getByRole("button")).toHaveAttribute("aria-haspopup", "dialog");
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("wheel navigation changes the month without the slide", async ({ page }) => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    await page.locator("[data-date]").first().hover();
    await page.mouse.wheel(0, 300);
    await expect(
      page.getByRole("heading", {
        name: new RegExp(`${MONTHS[next.getMonth()] ?? ""} ${next.getFullYear()}`),
      }),
    ).toBeVisible();

    // The animated path would leave a running Web Animation on the grid.
    const running = await page.evaluate(
      () => document.querySelector(".fc")?.getAnimations().length ?? 0,
    );
    expect(running).toBe(0);
  });
});
