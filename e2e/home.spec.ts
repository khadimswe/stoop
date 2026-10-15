import { expect, test } from "@playwright/test";

test("home page renders the pitch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stoop" })).toBeVisible();
  await expect(page.getByText("Knowing who they're for isn't.")).toBeVisible();
});
