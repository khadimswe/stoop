import { expect, test } from "@playwright/test";

// The header waitlist pill left the navigation with the store-events pivot (the ad flow lives at /ads).
test.skip("the header's waitlist signs up, then saves the product link on the same entry", async ({ page }) => {
  // A visitor of its own (the per-visitor limit counts by IP), and an email of its own.
  const id = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto("/ads");

  await page.getByRole("button", { name: "Get a free brief" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Email" }).fill(`e2e-${id}@stoop-test.example`);
  await dialog.locator("label").filter({ hasText: "Shopify" }).click();
  await dialog.getByRole("checkbox", { name: /Email me my free brief/ }).check();

  const signup = page.waitForResponse((r) => r.url().endsWith("/api/waitlist") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Get my free brief" }).click();
  const first = await signup;
  expect(first.status()).toBe(200);
  const { position } = (await first.json()) as { position: number };
  await expect(dialog.getByText(`You're #${position}.`)).toBeVisible();
  expect(first.request().postDataJSON()).toMatchObject({ email: `e2e-${id}@stoop-test.example`, sellsOn: "shopify", consent: true, sourceReport: "home" });

  const link = page.waitForResponse((r) => r.url().endsWith("/api/waitlist") && r.request().method() === "POST");
  await dialog.getByRole("textbox", { name: "Product link" }).fill("https://shop.example/products/sauce");
  await dialog.getByRole("button", { name: "Send" }).click();
  const second = await link;
  expect(await second.json()).toEqual({ position });
  expect(second.request().postDataJSON()).toMatchObject({ productLink: "https://shop.example/products/sauce" });
  await expect(dialog.getByText("Got it. We'll email your free Culture Brief.")).toBeVisible();
});
