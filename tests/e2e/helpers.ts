import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

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
