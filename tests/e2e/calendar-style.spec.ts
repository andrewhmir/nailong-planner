import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();
test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("the grid uses Canvas hairlines and a blue today badge", async ({ page }) => {
  await expect(page.getByText("Weekly class").first()).toBeVisible();
  const cellBorder = await page.locator(".fc-daygrid-day").first().evaluate(
    (el) => getComputedStyle(el).borderRightColor,
  );
  expect(cellBorder).toBe("rgb(232, 234, 236)");
  const today = page.locator(".fc-day-today .fc-daygrid-day-number");
  await expect(today).toBeVisible();
  expect(await today.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(43, 122, 188)");
});

test("events carry a saturated left bar over the pale container fill", async ({ page }) => {
  const event = page.locator(".fc-event").filter({ hasText: "Weekly class" }).first();
  await expect(event).toBeVisible();
  const style = await event.evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, barWidth: s.borderLeftWidth, barColor: s.borderLeftColor };
  });
  expect(style.background).toMatch(/^rgb\(/);
  expect(style.barWidth).toBe("3px");
  expect(style.barColor).toMatch(/^rgb\(/);
  expect(style.barColor).not.toBe(style.background);
});

test("the Canvas theme variables win on specificity, not import order", async ({ page }) => {
  const fc = page.locator(".fc").first();
  await expect(fc).toBeVisible();
  const resolved = await fc.evaluate((el) => {
    const raw = getComputedStyle(el).getPropertyValue("--fc-classic-border").trim();
    // Resolve whatever token syntax the variable computes to through a real element.
    const probe = document.createElement("span");
    probe.style.color = raw;
    el.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return { raw, colour };
  });
  expect(resolved.raw).not.toBe("");
  // The Canvas line token resolves to rgb(232, 234, 236); FullCalendar's own
  // `:root` default (#ddd) would resolve to rgb(221, 221, 221) and fail here.
  expect(resolved.colour).toBe("rgb(232, 234, 236)");
});

test("the view switch is a segmented control with the active segment marked", async ({ page }) => {
  const month = page.getByRole("button", { name: "Month", exact: true });
  await expect(month).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
});
