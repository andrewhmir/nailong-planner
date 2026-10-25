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
  collections: {
    ours: string;
    errands: string;
    projects: string;
    journal: string;
    andrewInbox: string;
    partnerInbox: string;
  };
  events: {
    mathQuiz: string;
    trip: string;
    weeklyClass: string;
    onCallShift: string;
  };
  tasks: {
    inbox: string[];
    today: string;
    week: string;
    someday: string;
    overdue: string;
    done: string;
    shared: string;
    private: string[];
  };
}

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(".playwright/fixtures.json", "utf8")) as Fixtures;
}

export const ANDREW = "andrew@example.test";
export const PARTNER = "partner@example.test";

/**
 * "October 2026" for the month the app is showing. The grid renders the
 * household's current month, so specs must not hardcode a month literal —
 * literals were why this suite was green only during October 2026.
 */
export function currentMonthLabel(timeZone = "Asia/Taipei"): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone }).format(
    new Date(),
  );
}

/** "22 Oct" in the current month, for the details dialog's occurrence heading. */
export function dayMonthLabel(day: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Taipei",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(year, month - 1, day, 12),
  );
}

/** "Oct" — the short month name the details dialog prints. */
export function monthShortLabel(): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Asia/Taipei" }).format(
    new Date(),
  );
}

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
