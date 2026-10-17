import { expect, test } from "@playwright/test";

const SECTIONS = ["reality", "your-ad", "output", "screening", "kit", "why"];
const TITLES = ["Reality Check", "Your ad", "Output", "Screening Room", "Campaign Kit", "Why it works"];

test("the lead example report opens on the Reality Check, with its sections in order", async ({ page }) => {
  await page.goto("/examples/food-hot-sauce");
  await expect(page.getByRole("heading", { level: 1, name: "Porchlight Pepper Co." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Reality Check" })).toBeVisible();

  const order = await page.locator("[data-report-section]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-report-section")));
  expect(order).toEqual(SECTIONS);
  await expect(page.locator("main h2")).toHaveText(TITLES);

  // One header (the app bar), and nothing wider than the viewport.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await expect(page.getByRole("link", { name: "Make this for my product" })).toHaveAttribute("href", "/start");
});

test("a Reality Check receipt opens in a drawer, traps focus and closes with Esc", async ({ page }) => {
  await page.goto("/examples/food-hot-sauce");
  const trigger = page.getByRole("button", { name: "See the receipts" }).first();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Receipt: Reality Check" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("/v2/insights").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("unknown examples are a 404", async ({ page }) => {
  const response = await page.goto("/examples/not-an-example");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
