import { expect, test, type Page } from "@playwright/test";

/**
 * A freshly loaded page hydrates the map before it applies deep-link state. On slow CI machines and
 * software-rendered browsers that can take 30 seconds or more, so checks right after a navigation wait longer
 * than the default 10 seconds. Faster machines finish immediately; the limit only matters when something is wrong.
 */
const DEEP_LINK_TIMEOUT = 60_000;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByText("DEMO DATA — NOT A REAL INCIDENT").first()).toBeVisible();
  await expect(page.getByText("Nigeria State Monitor", { exact: false }).first()).toBeVisible();
}

async function enableLite(page: Page) {
  const toggle = page.getByRole("switch", { name: "Low-bandwidth lite mode" });
  if (!(await toggle.isChecked())) await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('[data-testid^="state-path-"]')).toHaveCount(37, {
    timeout: 20_000,
  });
}

async function clearFilters(page: Page) {
  const chips = page.getByRole("button", { name: /^Remove filter / });
  while ((await chips.count()) > 0) {
    await chips.first().click();
  }
}

test.describe("desktop dashboard", () => {
  test.skip(({ isMobile }) => isMobile, "Desktop layout only");

  test("renders MapLibre, all 37 selectable states and clean console", async ({ page }) => {
    const errors = collectErrors(page);
    await openDashboard(page);

    const toggle = page.getByRole("switch", { name: "Low-bandwidth lite mode" });
    if (await toggle.isChecked()) await toggle.click();
    await expect(toggle).not.toBeChecked();

    await expect(page.locator(".maplibregl-map")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.locator(".nsm-state-label").first()).toBeVisible();
    await expect(page.locator(".nsm-cluster-marker, .nsm-event-marker").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Nigeria event map" })).toBeVisible();
    await expect(page.getByRole("region", { name: "National analytics" })).toBeVisible();

    await enableLite(page);
    const map = page.getByRole("region", { name: "Nigeria event map" });
    const lagos = map.locator('[data-testid="state-path-NG-LA"]');
    await expect(lagos).toBeVisible();
    await lagos.hover();
    await expect(map.getByText("State · NG-LA")).toBeVisible();
    await expect(map.getByText("Reported events", { exact: true })).toBeVisible();
    await expect(map.getByText("Click to filter by this state")).toBeVisible();
    await lagos.click();
    await expect(page).toHaveURL(/state=NG-LA/);
    await expect(page.getByRole("complementary", { name: "Lagos state brief" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove filter Lagos" })).toBeVisible();

    await page.getByRole("button", { name: "Clear Lagos state filter" }).click();
    await expect(page).not.toHaveURL(/state=NG-LA/);
    await expect(page.getByRole("complementary", { name: "National brief" })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("opens an event record with evidence, timeline and analysis", async ({ page }) => {
    const errors = collectErrors(page);
    await openDashboard(page);
    const wire = page.getByRole("complementary", { name: "Intelligence wire" });
    await wire.locator('[data-testid^="event-card-"] button').first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("DEMO DATA — NOT A REAL INCIDENT")).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /Sources/ })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /Timeline/ })).toBeVisible();
    await dialog.getByRole("tab", { name: /Sources/ }).click();
    await expect(dialog.getByText("No external link — fictional demo source").first()).toBeVisible();
    await dialog.getByRole("tab", { name: /Analysis/ }).click();
    await expect(dialog.getByText("Rule-based · not AI")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("filters, searches, directory, regional comparison and deep links work", async ({ page }) => {
    const errors = collectErrors(page);
    await openDashboard(page);

    await page.getByRole("button", { name: /data notes/i }).first().click();
    const methodology = page.getByRole("dialog", { name: "Data notes & methodology" });
    await expect(methodology.getByText("Implemented in Phases 2–5")).toBeVisible();
    await expect(methodology.getByRole("heading", { name: "Regional intelligence" })).toBeVisible();
    await methodology.getByRole("tab", { name: "Limitations" }).click();
    await expect(
      methodology.getByText(/Regional comparisons exclude national-scope records/),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(methodology).toBeHidden();

    await enableLite(page);

    const wire = page.getByRole("complementary", { name: "Intelligence wire" });
    await wire.getByRole("button", { name: /^Economy/ }).click();
    await expect(page).toHaveURL(/category=economy/);
    await expect(page.getByRole("button", { name: "Remove filter Economy" })).toBeVisible();
    const economyCards = wire.locator('[data-testid^="event-card-"]');
    const economyCount = await economyCards.count();
    expect(economyCount).toBeGreaterThan(0);
    expect(economyCount).toBeLessThan(74);
    for (let index = 0; index < economyCount; index += 1) {
      await expect(economyCards.nth(index).getByText("Economy", { exact: true })).toBeVisible();
    }
    await clearFilters(page);

    await page.getByRole("button", { name: "Search" }).click();
    const search = page.getByRole("dialog", { name: "Search Nigeria State Monitor" });
    const searchInput = search.getByRole("combobox", { name: "Search query" });
    await expect(searchInput).toBeFocused();
    await searchInput.fill("Lagos");
    await expect(search.getByRole("option").first()).toBeVisible({ timeout: 30_000 });
    await search.getByRole("option").filter({ hasText: "Lagos" }).first().click();
    await expect(page).toHaveURL(/state=NG-LA/);
    await expect(page.getByRole("complementary", { name: "Lagos state brief" })).toBeVisible();
    await page.getByRole("button", { name: "Open South West zone profile" }).click();
    const briefRegional = page.getByRole("dialog", { name: "Regional intelligence" });
    await expect(briefRegional.getByTestId("regional-profile-south-west")).toBeVisible();
    await expect(page).toHaveURL(/view=regions/);
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/view=regions/);
    await clearFilters(page);

    await page.getByRole("button", { name: "States" }).first().click();
    const directory = page.getByRole("dialog", { name: "State directory" });
    await expect(directory.getByText("State directory")).toBeVisible();
    await expect(directory.getByText(/37 of 37 first-order units/)).toBeVisible();
    await directory.getByRole("button").filter({ hasText: "NG-KN" }).click();
    await expect(page).toHaveURL(/state=NG-KN/);
    await expect(page.getByRole("complementary", { name: "Kano state brief" })).toBeVisible();
    await clearFilters(page);

    await page.getByRole("button", { name: "Regions" }).click();
    const regional = page.getByRole("dialog", { name: "Regional intelligence" });
    await expect(regional).toBeVisible();
    await expect(regional.locator('[data-testid^="regional-zone-"]')).toHaveCount(6);
    await regional.locator('[data-testid="regional-zone-north-east"]').click();
    await expect(page).toHaveURL(/view=regions/);
    await expect(page).toHaveURL(/region=north-east/);
    const profile = regional.getByTestId("regional-profile-north-east");
    await expect(profile).toBeVisible();
    await expect(profile.getByRole("heading", { name: "North East" })).toBeVisible();
    await expect(profile.getByRole("heading", { name: "Reported-volume trend" })).toBeVisible();
    await profile.getByRole("button", { name: /Filter dashboard to North East/ }).click();
    await expect(page).not.toHaveURL(/view=regions/);
    await expect(page).toHaveURL(/zone=north-east/);
    await expect(page.getByRole("button", { name: "Remove filter North East zone" })).toBeVisible();
    await clearFilters(page);

    await page.goto("/?view=regions&region=south-west&trend=30");
    const deepRegional = page.getByRole("dialog", { name: "Regional intelligence" });
    await expect(deepRegional.getByTestId("regional-profile-south-west")).toBeVisible({ timeout: DEEP_LINK_TIMEOUT });
    await expect(deepRegional.getByRole("button", { name: "30D" })).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: DEEP_LINK_TIMEOUT },
    );
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/view=regions/);

    await page.goto("/?state=NG-KD&category=security&window=7d");
    await expect(page.getByRole("complementary", { name: "Kaduna state brief" })).toBeVisible({ timeout: DEEP_LINK_TIMEOUT });
    await expect(page.getByRole("button", { name: "Remove filter Kaduna" })).toBeVisible({ timeout: DEEP_LINK_TIMEOUT });
    await expect(page.getByRole("button", { name: "Remove filter Security" })).toBeVisible({ timeout: DEEP_LINK_TIMEOUT });
    await expect(page.getByRole("button", { name: "Remove filter “Security”" })).toHaveCount(0, { timeout: DEEP_LINK_TIMEOUT });
    await expect(page.getByRole("button", { name: "Remove filter 7D" })).toHaveCount(0, { timeout: DEEP_LINK_TIMEOUT });

    expect(errors).toEqual([]);
  });
});

test.describe("mobile dashboard at 390px", () => {
  test("keeps all 37 states interactive and the four views usable", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);

    await expect(page.getByRole("navigation", { name: "Dashboard views" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Map" })).toBeVisible();
    await enableLite(page);

    await expect(page.locator('[data-testid^="state-path-"]')).toHaveCount(37);
    const lagos = page.locator('[data-testid="state-path-NG-LA"]');
    await lagos.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/state=NG-LA/);
    await expect(lagos).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Brief" }).click();
    await expect(page.getByRole("complementary", { name: "Lagos state brief" })).toBeVisible();
    await page.getByRole("button", { name: "Open South West zone profile" }).click();
    const briefRegional = page.getByRole("dialog", { name: "Regional intelligence" });
    await expect(briefRegional.getByTestId("regional-profile-south-west")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(briefRegional).toBeHidden();

    await page.getByRole("button", { name: "Stats" }).click();
    const analytics = page.getByRole("region", { name: "National analytics" });
    await expect(analytics).toBeVisible();
    await expect(analytics.getByText("Category mix")).toBeVisible();
    await expect(analytics.getByText("Reported volume by state")).toBeVisible();
    await expect(analytics.getByText("Evidence & coverage")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: /^Wire/ }).click();
    await expect(page.getByRole("complementary", { name: "Intelligence wire" })).toBeVisible();
    await expect(
      page
        .getByRole("complementary", { name: "Intelligence wire" })
        .locator('[data-testid^="event-card-"]')
        .first(),
    ).toBeVisible();

    await page.goto("/?view=regions&region=south-west");
    const regional = page.getByRole("dialog", { name: "Regional intelligence" });
    await expect(regional.getByTestId("regional-profile-south-west")).toBeVisible();
    await expect(regional.getByRole("heading", { name: "Zone comparison" })).toBeVisible();
    const regionalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(regionalOverflow).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /data notes/i }).first().click();
    const methodology = page.getByRole("dialog", { name: "Data notes & methodology" });
    await expect(methodology.getByRole("heading", { name: "Regional intelligence" })).toBeVisible();
    await methodology.getByRole("tab", { name: "Limitations" }).click();
    await expect(
      methodology.getByText(/Regional comparisons exclude national-scope records/),
    ).toBeVisible();
    const methodologyOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(methodologyOverflow).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(methodology).toBeHidden();

    expect(errors).toEqual([]);
  });
});
