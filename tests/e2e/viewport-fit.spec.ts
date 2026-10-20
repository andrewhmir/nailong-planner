import { expect, test } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

/**
 * The shell is a fixed viewport frame: the document never scrolls, the rail and
 * breadcrumb stay put, and the month grid uses exactly the height that is left.
 * Anything that overflows (a long agenda, the settings form) scrolls inside its
 * own panel instead of moving the page.
 */
const VIEWPORTS = [
  { name: "laptop 1440x900", width: 1440, height: 900 },
  { name: "laptop 1366x768", width: 1366, height: 768 },
  { name: "small laptop 1280x720", width: 1280, height: 720 },
  { name: "tablet 1024x768", width: 1024, height: 768 },
  { name: "tablet portrait 768x1024", width: 768, height: 1024 },
  { name: "phone landscape 844x390", width: 844, height: 390 },
  { name: "phone 390x844", width: 390, height: 844 },
  { name: "small phone 320x720", width: 320, height: 720 },
];

interface Fit {
  pageOverflow: number;
  horizontalOverflow: number;
  gridScrolls: number;
  lastCellBottom: number | null;
  innerHeight: number;
  headerTop: number;
  railTop: number | null;
}

async function measureFit(page: import("@playwright/test").Page): Promise<Fit> {
  // Settle fonts before measuring, or the grid is measured against fallback metrics.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const d = document.documentElement;
    const cells = [...document.querySelectorAll(".fc-daygrid-day")];
    const last = cells[cells.length - 1]?.getBoundingClientRect();
    const grid = document.querySelector(".fc") as HTMLElement | null;
    const header = document.querySelector("header")?.getBoundingClientRect();
    const rail = document
      .querySelector('nav[aria-label="Primary navigation"]')
      ?.getBoundingClientRect();
    return {
      pageOverflow: d.scrollHeight - d.clientHeight,
      horizontalOverflow: d.scrollWidth - d.clientWidth,
      gridScrolls: grid ? grid.scrollHeight - grid.clientHeight : 0,
      lastCellBottom: last ? Math.round(last.bottom) : null,
      innerHeight: window.innerHeight,
      headerTop: Math.round(header?.top ?? -1),
      railTop: rail ? Math.round(rail.top) : null,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

for (const viewport of VIEWPORTS) {
  test(`the page never scrolls at ${viewport.name} and the whole month fits`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.reload();
    await expect(page.locator(".fc-daygrid-day").first()).toBeVisible();

    const fit = await measureFit(page);

    // The document is locked to the viewport in both axes.
    expect(fit.pageOverflow, "the document must not overflow vertically").toBe(0);
    expect(fit.horizontalOverflow, "the document must not overflow horizontally").toBeLessThanOrEqual(1);

    // The month grid is shown whole instead of being clipped or made scrollable.
    expect(fit.lastCellBottom, "the grid must render day cells").not.toBeNull();
    expect(fit.lastCellBottom!, "the last week row must be on screen").toBeLessThanOrEqual(
      fit.innerHeight,
    );
    expect(fit.gridScrolls, "the month grid must not scroll internally").toBe(0);

    // Trying to scroll the page is a no-op, so the chrome cannot move.
    const scrollY = await page.evaluate(() => {
      window.scrollTo(0, 10_000);
      return window.scrollY;
    });
    expect(scrollY).toBe(0);
    const after = await page.evaluate(() => ({
      headerTop: Math.round(document.querySelector("header")?.getBoundingClientRect().top ?? -1),
      railTop: (() => {
        const rail = document
          .querySelector('nav[aria-label="Primary navigation"]')
          ?.getBoundingClientRect();
        return rail ? Math.round(rail.top) : null;
      })(),
    }));
    expect(after.headerTop).toBe(fit.headerTop);
    expect(after.railTop).toBe(fit.railTop);
  });
}

test("week hours scroll inside the calendar panel, not the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(page.locator(".fc-daygrid-day").first()).toBeVisible();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const d = document.documentElement;
    const fc = document.querySelector(".fc");
    // 24h cannot fit 720px, so a descendant of the calendar must own the scroll.
    const inner = [...document.querySelectorAll(".fc *")].some((el) => {
      const s = getComputedStyle(el);
      return (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight - el.clientHeight > 1
      );
    });
    return {
      pageOverflow: d.scrollHeight - d.clientHeight,
      fcOverflow: fc ? fc.scrollHeight - fc.clientHeight : 0,
      inner,
    };
  });

  expect(result.pageOverflow, "the document must not scroll in week view").toBe(0);
  expect(result.fcOverflow, "the calendar frame itself must not grow").toBe(0);
  expect(result.inner, "the hours must scroll inside the panel").toBe(true);
});

test("a long settings page scrolls inside the shell, not the document", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const fit = await measureFit(page);
  expect(fit.pageOverflow).toBe(0);
  expect(fit.headerTop).toBe(0);
});
