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
  const read = () =>
    page.evaluate(() => {
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
  // The first paint still reflows: the web font swaps in and FullCalendar
  // re-measures the panel it was handed, which moves the toolbar/grid boundary by
  // tens of pixels at short viewports. Sampling until two consecutive reads agree
  // (rather than a fixed wait) keeps the assertions off a transient frame — a
  // fixed 250 ms measured the pre-settle layout and failed by 2–53 px depending
  // on the runner's font metrics.
  let previous = await read();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await page.waitForTimeout(100);
    const current = await read();
    if (JSON.stringify(current) === JSON.stringify(previous)) {
      return current;
    }
    previous = current;
  }
  return previous;
}

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

for (const viewport of VIEWPORTS) {
  test(`the page never scrolls at ${viewport.name} and the whole month fits`, async ({ page }) => {
    // Phones deliberately land on the agenda (`auto` default view). This spec
    // measures the month grid, and switching views after hydration is racy at
    // phone widths under load: the toolbar's Month control appears late, the
    // click can land on the old view, and the grid is then measured mid-swap.
    // Seed the per-device stored view the app already honours (`readLastView`)
    // and reload straight into the month instead — the same state a user who
    // picked Month has on their next visit.
    await page.addInitScript(
      (key: string) => window.localStorage.setItem(key, "dayGridMonth"),
      `nailong.lastView.${fixtures.users.andrew}`,
    );
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".fc-daygrid-day").first()).toBeVisible({ timeout: 20_000 });

    const fit = await measureFit(page);

    // The document is locked to the viewport in both axes.
    expect(fit.pageOverflow, "the document must not overflow vertically").toBe(0);
    expect(fit.horizontalOverflow, "the document must not overflow horizontally").toBeLessThanOrEqual(1);

    // The month grid is shown whole instead of being clipped or made scrollable.
    // A two-pixel tolerance covers row-height rounding only: `expandRows` splits
    // the panel into six `28.59px` rows, so at a 390px viewport the rounded bottom
    // of the last row lands on 392 while the document does not scroll and the
    // grid is not internally scrollable (both asserted below). A real overflow is
    // tens of pixels, not two.
    expect(fit.lastCellBottom, "the grid must render day cells").not.toBeNull();
    expect(fit.lastCellBottom!, "the last week row must be on screen").toBeLessThanOrEqual(
      fit.innerHeight + 2,
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
