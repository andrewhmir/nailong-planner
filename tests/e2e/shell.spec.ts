import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

/** The seed household name; the long-name test restores it afterwards. */
const SEED_HOUSEHOLD = "Our Nest";
/** Over 40ch at 14px, so the breadcrumb ancestor has to truncate. */
const LONG_HOUSEHOLD = "The Very Long Nailong Household Of Cousins And Dragons";

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the shell has a Canvas rail, breadcrumb bar and course nav", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await expect(page.getByRole("banner").getByText("Calendar", { exact: true })).toBeVisible();
  // The household name is visible chrome, not a screen-reader-only copy.
  await expect(page.getByTestId("breadcrumb-household")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Collection tree" })).toBeVisible();
  const railWidth = await rail.evaluate((el) => getComputedStyle(el).width);
  expect(railWidth).toBe("54px");
});

test("the breadcrumb derives its current crumb from the route", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("breadcrumb-crumb")).toHaveText("Settings");

  await page.goto("/");
  await expect(page.getByTestId("breadcrumb-crumb")).toHaveText("Calendar");
});

test("focus is visible on the dark rail", async ({ page }) => {
  // Tab until focus lands on the Settings link: programmatic .focus() does not
  // match :focus-visible, so the ring must be reached the way a keyboard user does.
  let reached = false;
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    const reach = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") === "Settings",
    );
    if (reach) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return { outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow };
  });
  expect(ring.outlineWidth !== "0px" || ring.boxShadow !== "none").toBe(true);
});

test("a 320px viewport does not scroll horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a long household name truncates in the 72px breadcrumb bar", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Household name").fill(LONG_HOUSEHOLD);
  await page.getByRole("button", { name: "Save household" }).click();
  await expect(page.getByText(/household updated/i)).toBeVisible();

  await page.goto("/");
  const ancestor = page.getByTestId("breadcrumb-household");
  await expect(ancestor).toHaveText(LONG_HOUSEHOLD);

  const truncated = await ancestor.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(truncated).toBe(true);

  const barOverflow = await page
    .getByRole("banner")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(barOverflow).toBeLessThanOrEqual(1);

  // Restore the seeded name so the rest of the suite sees a stable fixture.
  await page.goto("/settings");
  await page.getByLabel("Household name").fill(SEED_HOUSEHOLD);
  await page.getByRole("button", { name: "Save household" }).click();
  await expect(page.getByText(/household updated/i)).toBeVisible();
});

test("signing out ends the session, not just the route", async ({ page }) => {
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  // The cookie is gone: asking for the app again must not render it.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("a failed sign-out keeps the session and reports the error", async ({ page }) => {
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );

  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByText("Could not sign out. Try again.")).toBeVisible();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeEnabled();

  await page.reload();
  await expect(page).toHaveURL("/");
});

test("tab order runs rail → person pills → calendar nav", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Collection tree" });
  // The tree loads client-side; wait for a row before tabbing into it.
  await expect(nav.getByRole("checkbox").first()).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Calendar" })
    .focus();

  const seen: string[] = [];
  let pillIndex = -1;
  let rowIndex = -1;

  for (let i = 0; i < 40 && (pillIndex === -1 || rowIndex === -1); i += 1) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) {
        return { name: "", pill: false, row: false };
      }
      return {
        name: el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 40),
        pill: Boolean(el.closest('[role="group"][aria-label="Cross-check calendars"]')),
        row: Boolean(el.closest('nav[aria-label="Collection tree"] li')),
      };
    });
    seen.push(hit.name);
    if (pillIndex === -1 && hit.pill) {
      pillIndex = seen.length - 1;
    }
    if (rowIndex === -1 && hit.row) {
      rowIndex = seen.length - 1;
    }
  }

  const route = seen.join(" → ");
  expect(pillIndex, `person pills were not reachable after the rail; saw ${route}`).toBeGreaterThan(
    -1,
  );
  expect(rowIndex, `no calendar row was reachable after the pills; saw ${route}`).toBeGreaterThan(
    -1,
  );
  expect(pillIndex, `pills must precede the calendar rows; saw ${route}`).toBeLessThan(rowIndex);
});
