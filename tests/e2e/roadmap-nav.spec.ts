import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

/** Every planned destination and the promise the rail makes for it. */
const GATED = [
  { label: "Tasks", gate: "Coming in v0.2.0" },
  { label: "Today", gate: "Planned" },
  { label: "Notes", gate: "Planned" },
  { label: "Focus", gate: "Planned" },
] as const;

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

test("planned destinations are greyed-out buttons, not links", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Primary navigation" });
  // A live rail icon is full white; a gated one must render dimmer than that.
  const liveColour = await rail
    .getByRole("link", { name: "Settings" })
    .evaluate((el) => getComputedStyle(el).color);

  for (const entry of GATED) {
    const item = rail.getByRole("button", { name: `${entry.label} — ${entry.gate}` });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-haspopup", "dialog");
    const colour = await item.evaluate((el) => getComputedStyle(el).color);
    expect(colour).not.toBe(liveColour);
  }

  // No gated destination is a route you can navigate to yet.
  await expect(rail.getByRole("link", { name: "Tasks" })).toHaveCount(0);
});

test("the rail does not scroll", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Primary navigation" });
  const overflow = await rail.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a gated destination explains itself and returns focus", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Primary navigation" });
  const trigger = rail.getByRole("button", { name: "Tasks — Coming in v0.2.0" });

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Tasks" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Coming in v0.2.0")).toBeVisible();
  await expect(dialog.getByText("Triage in the morning: Today, This week or Someday")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("phone drawer lists the gated destinations", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Open collections" }).click();

  const drawer = page.getByRole("dialog", { name: "Collections" });
  await drawer.getByRole("button", { name: "Focus — Planned" }).click();

  const dialog = page.getByRole("dialog", { name: "Focus" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Pomodoro presets that need no setup")).toBeVisible();
});
