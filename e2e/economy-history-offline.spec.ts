import { expect, test, type Page } from "@playwright/test";

async function enableLite(page: Page) {
  const toggle = page.getByRole("switch", { name: "Low-bandwidth lite mode" });
  if (!(await toggle.isChecked())) await toggle.click();
  await expect(toggle).toBeChecked();
}

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByText("DEMO DATA — NOT A REAL INCIDENT").first()).toBeVisible();
  await enableLite(page);
}

// Synthetic test payload shaped like /api/economy/indicators. Not Nigerian statistics.
function indicator(code: string, shortName: string, dataStatus: "official" | "modelled") {
  const obs = (year: number, value: number) => ({
    year,
    value,
    referencePeriodStart: `${year}-01-01`,
    referencePeriodEnd: `${year}-12-31`,
  });
  return {
    code,
    name: `${shortName} (test series)`,
    shortName,
    description: "Synthetic test series.",
    unit: "% per year",
    currency: null,
    dataStatus,
    decimals: 1,
    display: "percent",
    latest: obs(2001, 3),
    previous: obs(2000, 1),
    change: 2,
    observationCount: 2,
    firstYear: 2000,
    sourceLastUpdated: "2000-01-02",
    sourceUrl: `https://data.worldbank.org/indicator/${code}?locations=NG`,
    error: null,
  };
}

test.describe("navigation sections", () => {
  test.skip(({ isMobile }) => isMobile, "Desktop navigation bar");

  test("category tabs filter the feed and show the active section", async ({ page }) => {
    await openDashboard(page);
    const nav = page.getByRole("navigation", { name: "Primary" });
    const cards = page.locator('[data-testid^="event-card-"]');
    const all = await cards.count();

    await nav.getByRole("button", { name: "Security" }).click();
    await expect(nav.getByRole("button", { name: "Security" })).toHaveAttribute("aria-current", "page");
    await expect.poll(async () => cards.count()).toBeLessThan(all);
    expect(await cards.count()).toBeGreaterThan(0);

    await nav.getByRole("button", { name: "Overview" }).click();
    await expect.poll(async () => cards.count()).toBe(all);
  });
});

test.describe("historical intelligence", () => {
  test("shows coverage honestly and flags ranges outside held records", async ({ page, isMobile }) => {
    await openDashboard(page);
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation menu" }).click();
      await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "History" }).click();
    } else {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "History" }).click();
    }
    const dialog = page.getByRole("dialog", { name: /Historical intelligence/ });
    const coverage = dialog.getByTestId("history-coverage");
    await expect(coverage).toContainText(/demo snapshot/i);
    await expect(dialog.getByText("Demo data").first()).toBeVisible();

    await dialog.getByLabel("Start date").fill("2026-03-01");
    await dialog.getByLabel("End date").fill("2026-03-10");
    await dialog.getByRole("button", { name: "Apply dates" }).click();
    await expect(coverage).toContainText(/unobserved, not quiet/);

    await dialog.getByLabel("Start date").fill("2026-12-01");
    await expect(dialog.getByRole("alert")).toContainText(/start date must not be after the end date/i);
    await expect(dialog.getByRole("button", { name: "Apply dates" })).toBeDisabled();
  });
});

test.describe("economic intelligence", () => {
  // Request mocking cannot see traffic that a service worker handles, so keep it out of these tests.
  test.use({ serviceWorkers: "block" });

  async function openEconomy(page: Page, isMobile: boolean) {
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation menu" }).click();
      await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Economy" }).click();
    } else {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Economy" }).click();
    }
    return page.getByRole("dialog", { name: /Economic intelligence/ });
  }

  test("renders indicators with reference year, status and source", async ({ page, isMobile }) => {
    await page.route("**/api/economy/indicators", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            indicators: [
              indicator("FP.CPI.TOTL.ZG", "Inflation (CPI)", "official"),
              indicator("SL.UEM.TOTL.ZS", "Unemployment", "modelled"),
            ],
            retrievedAt: "2000-01-03T00:00:00.000Z",
            stale: false,
            source: { name: "World Bank", dataset: "World Development Indicators (WDI)", licence: "CC BY 4.0", url: "https://data.worldbank.org/country/nigeria" },
          },
        }),
      }),
    );
    await page.route("**/api/economy/trends**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { code: "FP.CPI.TOTL.ZG", name: "x", unit: "u", observations: [{ year: 2000, value: 1 }, { year: 2001, value: 3 }], sourceLastUpdated: null, stale: false, error: null },
        }),
      }),
    );
    await openDashboard(page);
    const dialog = await openEconomy(page, isMobile);
    const card = dialog.getByTestId("indicator-FP.CPI.TOTL.ZG");
    await expect(card).toContainText(/reference year 2001/i);
    await expect(card).toContainText(/\+2\.0 pp vs 2000/);
    await expect(dialog.getByTestId("indicator-SL.UEM.TOTL.ZS")).toContainText(/modelled/i);
    await expect(dialog.getByText(/CC BY 4\.0/).first()).toBeVisible();
    await expect(dialog.getByText(/not economic statistics/i)).toBeVisible();
  });

  test("shows no figures when the source is unavailable", async ({ page, isMobile }) => {
    await page.route("**/api/economy/indicators", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Economic indicators could not be retrieved." } }),
      }),
    );
    await openDashboard(page);
    const dialog = await openEconomy(page, isMobile);
    await expect(dialog.getByRole("alert")).toContainText(/unavailable/i);
    await expect(dialog.getByRole("alert")).toContainText(/No figures are shown/);
    await expect(dialog.getByRole("list", { name: "National economic indicators" })).toHaveCount(0);
  });
});

test.describe("offline support", () => {
  test.skip(({ isMobile }) => isMobile, "Service worker flow is exercised on desktop");

  test("a first-time visitor can go offline and still see clearly labelled saved data", async ({ page, context }) => {
    // Many sequential steps (install, precache, offline reload); allow more than the 60s default.
    test.setTimeout(150_000);
    await openDashboard(page);
    const nav = page.getByRole("navigation", { name: "Primary" });
    // Open History once online so its API response is saved too.
    await nav.getByRole("button", { name: "History" }).click();
    await expect(page.getByTestId("history-coverage")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => {
      const names = await caches.keys();
      const pages = names.find((name) => name.startsWith("nsm-sw-pages"));
      const statics = names.find((name) => name.startsWith("nsm-sw-static"));
      if (!pages || !statics) return false;
      return (await (await caches.open(pages)).keys()).length > 0 && (await (await caches.open(statics)).keys()).length > 3;
    });

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    // The offline fallback page also says "Nigeria State Monitor", so require the real dashboard.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator('[data-testid^="event-card-"]').first()).toBeVisible();
    const banner = page.getByTestId("connectivity-banner");
    await expect(banner).toContainText(/You are offline/);
    await enableLite(page); // lite mode is per page load; keep the map cheap

    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "History" }).click();
    await expect(page.getByTestId("history-coverage")).toBeVisible();
    await page.keyboard.press("Escape");

    await context.setOffline(false);
    await expect(banner).toHaveCount(0);
  });
});

test.describe("offline deep links", () => {
  test.skip(({ isMobile }) => isMobile, "Service worker flow is exercised on desktop");

  test("a deep link opened offline keeps its own state, not the saved page's", async ({ page, context }) => {
    test.setTimeout(120_000);
    await openDashboard(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => {
      const names = await caches.keys();
      const pages = names.find((name) => name.startsWith("nsm-sw-pages"));
      const statics = names.find((name) => name.startsWith("nsm-sw-static"));
      if (!pages || !statics) return false;
      return (await (await caches.open(pages)).keys()).length > 0 && (await (await caches.open(statics)).keys()).length > 3;
    });

    await context.setOffline(true);
    // This exact URL was never visited, so the worker can only offer the saved "/" page.
    await page.goto("/?state=NG-KD&category=security", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("complementary", { name: "Kaduna state brief" })).toBeVisible();
    await expect(page).toHaveURL(/state=NG-KD/);
    await expect(page).toHaveURL(/category=security/);
    await expect(page.getByTestId("connectivity-banner")).toContainText(/You are offline/);
    await context.setOffline(false);
  });
});

test.describe("phone layout", () => {
  test.skip(({ isMobile }) => !isMobile, "Phone layout only");

  test("fits a 390px screen and offers every section in the menu", async ({ page }) => {
    await openDashboard(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const menu = page.getByRole("navigation", { name: "Sections" });
    for (const label of ["Overview", "Security", "Politics", "Infrastructure", "Economy", "Regions", "History", "States"]) {
      await expect(menu.getByRole("button", { name: label })).toBeVisible();
    }
  });
});
