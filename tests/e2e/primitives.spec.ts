import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();
test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("primary button is 38px tall with a 4px radius and Canvas blue", async ({ page }) => {
  const button = page.getByTestId("new-event-button");
  const style = await button.evaluate((element) => {
    const s = getComputedStyle(element);
    return { height: s.height, radius: s.borderTopLeftRadius, background: s.backgroundColor, shadow: s.boxShadow };
  });
  expect(style).toEqual({ height: "38px", radius: "4px", background: "rgb(43, 122, 188)", shadow: "none" });
});

test("dialogs are square-cornered with the Canvas scrim", async ({ page }) => {
  await page.getByTestId("new-event-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const radius = await dialog.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  expect(radius).toBe("4px");
  const overlay = await page.getByTestId("dialog-overlay").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(overlay.startsWith("rgba(51, 68, 81")).toBe(true);
});
