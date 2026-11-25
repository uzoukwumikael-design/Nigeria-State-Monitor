import { defineConfig, devices } from "@playwright/test";

// Optional: point Playwright at a specific Chromium binary instead of an installed Chrome channel.
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
const channel = executablePath ? undefined : (process.env.PLAYWRIGHT_CHANNEL ?? "chrome");
const extraArgs = process.env.PLAYWRIGHT_LAUNCH_ARGS?.split(" ").filter(Boolean) ?? [];
const launchOptions = executablePath ? { executablePath, args: ["--no-sandbox", ...extraArgs] } : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    channel,
    launchOptions,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Playwright must exercise the compiled production build. Dev-mode route
    // compilation can take 30s+ on a cold cache and would masquerade as a
    // product timeout. `pretest:e2e` runs `npm run build` first.
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 180_000,
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        channel,
        launchOptions,
      },
    },
  ],
});
