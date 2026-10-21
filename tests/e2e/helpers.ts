import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export interface Fixtures {
  householdId: string;
  password: string;
  users: { andrew: string; partner: string };
  calendars: {
    household: string;
    chores: string;
    trips: string;
    school: string;
    math: string;
    biology: string;
    work: string;
    onCall: string;
    health: string;
  };
  events: {
    mathQuiz: string;
    trip: string;
    weeklyClass: string;
    onCallShift: string;
  };
}

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(".playwright/fixtures.json", "utf8")) as Fixtures;
}

export const ANDREW = "andrew@example.test";
export const PARTNER = "partner@example.test";

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("/");
}

/**
 * Flip a Radix checkbox whose value is applied through a server mutation.
 *
 * `locator.check()` clicks exactly once and fails if that click lands before
 * hydration has attached the handler — a real race on a slow CI dev server, where
 * the server-rendered button paints a moment before React takes it over. Retry
 * the click until the controlled `aria-checked` actually flips.
 */
export async function setCheckbox(
  page: Page,
  name: string | RegExp,
  checked: boolean,
): Promise<void> {
  const box = page.getByRole("checkbox", { name });
  await expect(async () => {
    if ((await box.isChecked()) !== checked) {
      await box.click();
    }
    await expect(box).toBeChecked({ checked, timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
}
