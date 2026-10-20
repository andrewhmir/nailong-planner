import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test("Canvas tokens are applied on :root", async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name: string) => s.getPropertyValue(name).trim();
    return {
      ink: read("--color-ink"),
      accent: read("--color-accent"),
      link: read("--color-link"),
      rail: read("--color-rail"),
      field: read("--color-field"),
      radiusMd: read("--radius-md"),
    };
  });
  expect(tokens).toEqual({
    ink: "#273540",
    accent: "#2b7abc",
    link: "#0e68b3",
    rail: "#334451",
    field: "#8d959f",
    radiusMd: "4px",
  });
});

test("Lato is self-hosted and applied", async ({ page }) => {
  const woff2: string[] = [];
  page.on("response", (response) => {
    if (/\.woff2($|\?)/.test(response.url())) woff2.push(response.url());
  });
  await signIn(page, ANDREW, fixtures.password);
  await page.evaluate(() => document.fonts.ready);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).not.toContain("-apple-system");
  expect(woff2.length).toBeGreaterThan(0);
  const first = family.split(",")[0]!.replace(/["']/g, "").trim();
  expect(await page.evaluate((f) => document.fonts.check(`16px "${f}"`), first)).toBe(true);
});
