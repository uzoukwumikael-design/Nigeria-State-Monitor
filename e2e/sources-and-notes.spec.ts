import { expect, test, type Page } from "@playwright/test";

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByText("DEMO DATA — NOT A REAL INCIDENT").first()).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Low-bandwidth lite mode" });
  if (!(await toggle.isChecked())) await toggle.click();
  await expect(toggle).toBeChecked();
}

test.describe("sources panel and data notes (demo build)", () => {
  test.skip(({ isMobile }) => isMobile, "Desktop navigation bar");

  test("the Sources tab lists every registered source with evidence labels and is honest without a database", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Sources" }).click();
    const dialog = page.getByRole("dialog", { name: /News sources/ });
    const list = dialog.getByRole("list", { name: "Registered news sources" });
    await expect(list).toBeVisible();
    expect(await list.getByRole("listitem").count()).toBeGreaterThanOrEqual(27);
    await expect(dialog).toContainText(/No database is connected/i);
    await expect(dialog).toContainText(/verified/i);
    await expect(dialog).toContainText(/directory only/i);
    await expect(list.getByTestId("source-punch")).toContainText(/unknown/i);
    await expect(list.getByTestId("source-nimet-alerts")).toBeVisible();
  });

  test("Data notes still shows the detailed demo document in the demo build", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Data notes" }).click();
    const dialog = page.getByRole("dialog", { name: "Data notes & methodology" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/fictional/i);
  });

  test("no event screen carries a 'not reviewed' banner", async ({ page }) => {
    await openDashboard(page);
    await page.locator('[data-testid^="event-card-"]').first().click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/not reviewed by a person/i);
  });
});
