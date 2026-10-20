import { defineConfig, devices } from "@playwright/test";
import { E2E_DATA_FILES, missingDataMessage, missingFiles } from "./lib/recorded-data";

// The end-to-end tests walk the stored examples and replay recorded Qloo answers. Without them (the
// public mirror leaves them out) stop here with one message, before any server starts.
const missing = missingFiles(E2E_DATA_FILES);
if (missing.length > 0) {
  console.error(missingDataMessage("npm run e2e", missing));
  process.exit(1);
}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // iPhone-size, the width the report is designed at. Chromium with touch, so no WebKit install.
    {
      name: "phone-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
