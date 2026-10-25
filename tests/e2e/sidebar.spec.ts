import { expect, test, type Page } from "@playwright/test";
import { ANDREW, loadFixtures, signIn } from "./helpers";

const fixtures = loadFixtures();

test.beforeEach(async ({ page }) => {
  await signIn(page, ANDREW, fixtures.password);
});

/** The one "New" menu replaced the old standalone "New calendar" button. */
async function openNewMenu(page: Page) {
  await page.getByRole("button", { name: "New", exact: true }).click();
}

async function createRoot(
  page: Page,
  kind: "calendar" | "list",
  name: string,
  owner?: string,
) {
  await openNewMenu(page);
  await page.getByRole("menuitem", { name: kind === "list" ? "New list" : "New calendar" }).click();
  await page.getByLabel("Name").fill(name);
  if (owner) {
    await page.getByLabel("Belongs to").selectOption({ label: owner });
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("checkbox", { name })).toBeVisible();
}

/** The row element that owns a checkbox: the CollectionRow `li`. */
function rowOf(page: Page, name: string) {
  return page.getByRole("checkbox", { name }).locator("..");
}

/**
 * A field inside the open CollectionDialog. Scoping to the dialog and matching
 * exactly keeps tree rows (for example the "Private notes" calendar) out of a
 * label lookup: `getByLabel` is a case-insensitive substring match by default.
 */
function inDialog(page: Page, label: string) {
  return page.getByRole("dialog").getByLabel(label, { exact: true });
}

async function openVisibilityMenu(page: Page, name: string) {
  await page.getByRole("button", { name: `Options for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Visibility" }).click();
}

async function chooseVisibility(
  page: Page,
  name: string,
  value: "Shared" | "View only" | "Private",
) {
  await openVisibilityMenu(page, name);
  await page.getByRole("menuitemradio", { name: value }).click();
}

test("the sidebar shows the household groups", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Collection tree" });
  await expect(nav.getByText("Shared", { exact: true })).toBeVisible();
  await expect(nav.getByText("Andrew", { exact: true })).toBeVisible();
  await expect(nav.getByText("Partner", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "School" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Math" })).toBeVisible();
});

test("the lazily-created Inbox is an ordinary private list row", async ({ page }) => {
  // GET /api/collections creates the caller's private Inbox on first load, so
  // the tree must render it like any other list — no calendar swatch, with the
  // owner's private lock.
  const inbox = page.getByRole("checkbox", { name: "Inbox" });
  await expect(inbox).toBeVisible();
  const row = rowOf(page, "Inbox");
  await expect(row.getByTestId("collection-kind-list")).toBeVisible();
  await expect(row.getByTestId("collection-kind-calendar")).toHaveCount(0);
  // The lock is an SVG with role="img"; its accessible name comes from the
  // <title> element, so the test reads that title.
  await expect(row.locator("svg title")).toHaveText("Private");
});

test("a parent calendar row previews its children's shades", async ({ page }) => {
  const strip = page.getByTestId("shade-strip-school");
  await expect(strip).toBeVisible();
  await expect(strip.locator("span")).toHaveCount(3);

  // Calendar rows keep the hue swatch, not the list glyph.
  const row = rowOf(page, "School");
  await expect(row.getByTestId("collection-kind-calendar")).toBeVisible();
  await expect(row.getByTestId("collection-kind-list")).toHaveCount(0);
});

test("toggling a calendar persists across a reload", async ({ page }) => {
  const school = page.getByRole("checkbox", { name: "School" });
  await expect(school).toBeChecked();
  await school.click();
  await expect(school).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "School" })).not.toBeChecked();
});

test("adding a sub-calendar appends it under its parent", async ({ page }) => {
  await page.getByRole("button", { name: "Options for School" }).click();
  await page.getByRole("menuitem", { name: "Add sub-calendar" }).click();
  // The child inherits its parent's visibility and cannot change it.
  await expect(inDialog(page, "View only")).toBeDisabled();
  await page.getByLabel("Name").fill("Chemistry");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("checkbox", { name: "Chemistry" })).toBeVisible();
  await expect(rowOf(page, "Chemistry").getByTestId("collection-kind-calendar")).toBeVisible();
});

test("a calendar created as mine is saved with an owner", async ({ page }) => {
  await createRoot(page, "calendar", "Personal", "Andrew");
  await expect(page.getByRole("checkbox", { name: "Personal" })).toBeVisible();
});

test("calendar settings can mark a calendar view-only", async ({ page }) => {
  await createRoot(page, "calendar", "Private notes", "Andrew");

  await page.getByRole("button", { name: "Options for Private notes" }).click();
  await page.getByRole("menuitem", { name: "Calendar settings" }).click();
  await inDialog(page, "View only").check();
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Options for Private notes" }).click();
  await page.getByRole("menuitem", { name: "Calendar settings" }).click();
  await expect(inDialog(page, "View only")).toBeChecked();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("a person pill hides only that person's calendars", async ({ page }) => {
  await expect(page.getByRole("checkbox", { name: "Health" })).toBeVisible();
  await page.getByRole("button", { name: /^Andrew$/ }).click();
  const school = page.getByRole("checkbox", { name: "School" });
  await expect(school).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Health" })).toBeChecked();
});

test("long calendar names truncate inside the nav", async ({ page }) => {
  const long = "Community volunteering and neighbourhood outreach";
  await createRoot(page, "calendar", long);
  const row = page.getByRole("checkbox", { name: long });
  await expect(row).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Collection tree" });
  expect(await nav.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test("the nav panel scrolls instead of pushing the page wide", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Collection tree" });
  const overflow = await nav.evaluate((el) => getComputedStyle(el).overflowY);
  expect(["auto", "scroll"]).toContain(overflow);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});

test("folding a parent hides its sub-calendars and remembers the fold", async ({ page }) => {
  const math = page.getByRole("checkbox", { name: "Math", includeHidden: true });
  await expect(math).toBeVisible();

  await page.getByRole("button", { name: "Collapse School" }).click();
  await expect(page.getByRole("button", { name: "Expand School" })).toBeVisible();
  // Folded, not deleted: the rows stay in the sidebar's accessibility-hidden list.
  await expect(math).toHaveCount(1);
  await expect(math).toBeHidden();
  // Folding is display-only: neither the parent nor the child's checkbox changes.
  await expect(page.getByRole("checkbox", { name: "School" })).toBeChecked();
  await expect(math).toBeChecked();

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand School" })).toBeVisible();
  await expect(math).toBeHidden();

  await page.getByRole("button", { name: "Expand School" }).click();
  await expect(math).toBeVisible();
  await expect(math).toBeChecked();
});

test("folding a group hides the whole group and remembers the fold", async ({ page }) => {
  const school = page.getByRole("checkbox", { name: "School", includeHidden: true });
  const work = page.getByRole("checkbox", { name: "Work", includeHidden: true });

  await page.getByRole("button", { name: "Collapse Andrew" }).click();
  await expect(page.getByRole("button", { name: "Expand Andrew" })).toBeVisible();
  await expect(school).toBeHidden();
  await expect(work).toBeHidden();
  // Other people's groups are untouched.
  await expect(page.getByRole("checkbox", { name: "Household" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand Andrew" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Household" })).toBeVisible();

  await page.getByRole("button", { name: "Expand Andrew" }).click();
  await expect(page.getByRole("checkbox", { name: "School" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "School" })).toBeChecked();
});

test("adding a sub-calendar opens a folded parent", async ({ page }) => {
  await page.getByRole("button", { name: "Collapse Work" }).click();
  await expect(page.getByRole("checkbox", { name: "On-call", includeHidden: true })).toBeHidden();

  await page.getByRole("button", { name: "Options for Work" }).click();
  await page.getByRole("menuitem", { name: "Add sub-calendar" }).click();
  await page.getByLabel("Name").fill("Sprint");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: "Collapse Work" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Sprint" })).toBeVisible();
});

test("a new root calendar opens its folded group", async ({ page }) => {
  await page.getByRole("button", { name: "Collapse Shared" }).click();
  await expect(page.getByRole("checkbox", { name: "Household", includeHidden: true })).toBeHidden();

  await createRoot(page, "calendar", "Garden");

  await expect(page.getByRole("button", { name: "Collapse Shared" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Garden" })).toBeVisible();
});

test("creating a list from the New menu shows a list glyph and can be renamed", async ({
  page,
}) => {
  await createRoot(page, "list", "Errands");

  const row = rowOf(page, "Errands");
  await expect(row.getByTestId("collection-kind-list")).toBeVisible();
  await expect(row.getByTestId("collection-kind-calendar")).toHaveCount(0);
  // The list row keeps the checkbox and the fold/visibility behaviour.
  await expect(page.getByRole("checkbox", { name: "Errands" })).toBeChecked();

  await page.getByRole("button", { name: "Options for Errands" }).click();
  await page.getByRole("menuitem", { name: "List settings" }).click();
  await page.getByLabel("Name").fill("Errands & chores");
  await page.getByRole("button", { name: "Save" }).click();

  const renamed = page.getByRole("checkbox", { name: "Errands & chores" });
  await expect(renamed).toBeVisible();
  await expect(rowOf(page, "Errands & chores").getByTestId("collection-kind-list")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Errands", exact: true })).toHaveCount(0);
});

test("a list can have sub-lists, which inherit its kind", async ({ page }) => {
  await createRoot(page, "list", "Work list");
  await page.getByRole("button", { name: "Options for Work list" }).click();
  await page.getByRole("menuitem", { name: "Add sub-list" }).click();
  await page.getByLabel("Name").fill("Client A");
  await page.getByRole("button", { name: "Save" }).click();

  const child = rowOf(page, "Client A");
  await expect(page.getByRole("checkbox", { name: "Client A" })).toBeVisible();
  await expect(child.getByTestId("collection-kind-list")).toBeVisible();
  // A child's visibility submenu opens on the inherited value, disabled.
  await openVisibilityMenu(page, "Client A");
  await expect(page.getByRole("menuitemradio", { name: "Shared" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "Private" })).toBeDisabled();
});

test("a root can be made private and back to shared", async ({ page }) => {
  await createRoot(page, "calendar", "Secret plans", "Andrew");

  // Private: the row stays visible to its owner and grows the lock.
  await chooseVisibility(page, "Secret plans", "Private");
  const row = rowOf(page, "Secret plans");
  await expect(page.getByRole("checkbox", { name: "Secret plans" })).toBeVisible();
  await expect(row.locator("svg title")).toHaveText("Private");

  // Renaming a private row must not silently downgrade it to shared.
  await page.getByRole("button", { name: "Options for Secret plans" }).click();
  await page.getByRole("menuitem", { name: "Calendar settings" }).click();
  await expect(inDialog(page, "Private")).toBeChecked();
  await page.getByLabel("Name").fill("Secret plans v2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("checkbox", { name: "Secret plans v2" })).toBeVisible();
  await expect(rowOf(page, "Secret plans v2").locator("svg title")).toHaveText("Private");

  // A sub-calendar inherits the private value and cannot change it.
  await page.getByRole("button", { name: "Options for Secret plans v2" }).click();
  await page.getByRole("menuitem", { name: "Add sub-calendar" }).click();
  await expect(inDialog(page, "Private")).toBeChecked();
  await expect(inDialog(page, "Private")).toBeDisabled();
  await page.getByLabel("Name").fill("Partner surprise");
  await page.getByRole("button", { name: "Save" }).click();
  const child = rowOf(page, "Partner surprise");
  await expect(child.locator("svg title")).toHaveText("Private");
  await openVisibilityMenu(page, "Partner surprise");
  await expect(page.getByRole("menuitemradio", { name: "Private" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "Private" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Back to Shared: both the root and its child lose the lock.
  await chooseVisibility(page, "Secret plans v2", "Shared");
  await expect(rowOf(page, "Secret plans v2").locator("svg title")).toHaveCount(0);
  await expect(rowOf(page, "Partner surprise").locator("svg title")).toHaveCount(0);

  await openVisibilityMenu(page, "Secret plans v2");
  await expect(page.getByRole("menuitemradio", { name: "Shared" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "Private" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});
