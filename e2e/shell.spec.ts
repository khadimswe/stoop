import { expect, test } from "@playwright/test";

// Every page renders exactly one header: the marketing pill or the app bar.
const PAGES = [
  { path: "/", h1: "Stop making ads for nobody." },
  { path: "/judges", h1: "For judges" },
  { path: "/mcp", h1: "Use Stoop inside your Claude" },
  { path: "/start", h1: "What are you selling?" },
  { path: "/run/run_0123456789abcdef01234567", h1: "Building your Campaign Kit" },
  { path: "/report/run_0123456789abcdef01234567", h1: "Your report" },
];

for (const { path, h1 } of PAGES) {
  test(`${path} has one header and its h1`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Get a free brief" })).toHaveCount(1);
  });
}

for (const path of ["/report/not-a-run", "/examples/not-an-example", "/no-such-page"]) {
  test(`${path} shows the not-found page under one header`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
  });
}
