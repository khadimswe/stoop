import { expect, test } from "@playwright/test";

// Every page renders exactly one header: the marketing pill or the app bar.
const PAGES = [
  { path: "/", h1: "Give your block a reason to stop." },
  { path: "/judges", h1: "For judges" },
  { path: "/mcp", h1: "Use Stoop inside your Claude" },
  { path: "/ads", h1: "Stop making ads for nobody." },
  { path: "/ads/start", h1: "What are you selling?" },
  // No such run on the server: the live trace says so instead of a blank page.
  { path: "/run/run_0123456789abcdef01234567", h1: "That run has expired" },
  { path: "/report/run_0123456789abcdef01234567", h1: "Your report" },
];

for (const { path, h1 } of PAGES) {
  test(`${path} has one header and its h1`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Plan an event" }).first()).toBeVisible();
  });
}

for (const path of ["/report/not-a-run", "/examples/not-an-example", "/no-such-page"]) {
  test(`${path} shows the not-found page under one header`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
  });
}

test("robots.txt disallows only the API, so crawlers can read the private pages' noindex", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const lines = (await response.text()).split("\n").map((line) => line.trim());
  expect(lines).toContain("Allow: /");
  expect(lines.filter((line) => line.startsWith("Disallow:"))).toEqual(["Disallow: /api/"]);
});

for (const path of ["/report/run_0123456789abcdef01234567", "/run/run_0123456789abcdef01234567"]) {
  test(`${path} asks search engines not to index or follow it`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });
}
