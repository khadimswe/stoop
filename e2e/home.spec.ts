import { expect, test } from "@playwright/test";

test("home page leads with the Reality Gap until hero clips are approved", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Stop making ads for nobody." })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-hero-mode", "reality-gap");
  await expect(page.getByRole("region", { name: /Reality gap/ })).toBeVisible();
  await page.getByRole("link", { name: "See why it works" }).click();
  await expect(page.getByRole("complementary", { name: "Receipt: Music style" })).toBeInViewport();
});
