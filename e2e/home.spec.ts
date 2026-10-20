import { expect, test, type Page } from "@playwright/test";

/** Console errors and uncaught exceptions, collected for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("the hero leads with the lead example's Reality Check until the hero clips are approved", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Stop making ads for nobody." })).toBeVisible();
  await expect(page.getByText("Data, not stereotypes.").first()).toBeVisible();
  await expect(page.getByText("Ads are free to make now. Knowing who they're for isn't.")).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-hero-mode", "reality-check");
  // No blind test without approved clips, and never a fake player.
  await expect(page.getByRole("group", { name: /Blind test/ })).toHaveCount(0);

  const card = page.getByRole("region", { name: "Reality Check · Porchlight Pepper Co." });
  await expect(card).toBeVisible();
  await expect(card.getByText(/^This brand said: “Home cooks/)).toBeVisible();
  await expect(card.getByText(/^Qloo measured a taste neighborhood that skews 55 and older/)).toBeVisible();
  await expect(card.getByText("A generic AI brief assumed 25 to 44, in Austin and Portland.")).toBeVisible();
  await expect(card.getByText("Generic AI brief · not from Qloo")).toBeVisible();

  // Beats 2 and 3: "See why it works" lands on the Screening Room with the music style receipt open.
  await page.getByRole("link", { name: "See why it works" }).click();
  await expect(page.getByRole("region", { name: "Same product. Same video model. Only the brief changed." })).toBeInViewport();
  await expect(page.getByRole("complementary", { name: "Receipt: Music style" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the H1 is the largest paint", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const lcp = await page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        let last: string | null = null;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { element?: Element | null })[]) last = entry.element?.tagName ?? null;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => resolve(last), 500);
      }),
  );
  expect(lcp).toBe("H1");
});

test("each concept world's cues switch the open receipt, and the full receipt opens in a drawer", async ({ page }) => {
  await page.goto("/");
  const screening = page.getByRole("region", { name: "Same product. Same video model. Only the brief changed." });
  const music = screening.getByRole("button", { name: /^Music style receipt/ }).first();
  await expect(music).toHaveAttribute("aria-pressed", "true");
  await screening.getByRole("button", { name: /^Setting receipt/ }).first().click();
  await expect(page.getByRole("complementary", { name: "Receipt: Setting" })).toBeVisible();
  await expect(music).toHaveAttribute("aria-pressed", "false");

  const full = page.getByRole("button", { name: /^See the full receipt/ });
  await full.click();
  const drawer = page.getByRole("dialog", { name: "Receipt: Setting" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("/v2/insights").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(full).toBeFocused();

  // Each world's age skew and setting city open their own receipts.
  await screening.getByRole("button", { name: /^set in Slidell, LA/ }).click();
  await expect(page.getByRole("dialog", { name: "Receipt: Setting city" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(screening.getByRole("button", { name: /^skews \+0\.21/ })).toBeVisible();
});

test("the shelf shows the three examples with their recorded Reality Check lines", async ({ page }) => {
  await page.goto("/");
  const shelf = page.getByRole("region", { name: "Three brands. Three taste neighborhoods." });
  for (const [brand, slug] of [
    ["Porchlight Pepper Co.", "food-hot-sauce"],
    ["Lowlight Candle Co.", "home-candles"],
    ["Whisker & Brim", "pets-outfits"],
  ]) {
    await expect(shelf.getByRole("link", { name: brand })).toHaveAttribute("href", `/examples/${slug}`);
  }
  await expect(shelf.getByText(/^Qloo measured a taste neighborhood/)).toHaveCount(3);
  // Whisker & Brim's age is a near tie, and it says so.
  await expect(shelf.getByText(/^Near tie on age/)).toBeVisible();
});

test("the three ways row sits below the shelf, one line each", async ({ page }) => {
  await page.goto("/");
  const row = page.getByRole("region", { name: "Three ways to use it" });
  await expect(row.getByRole("heading", { level: 3 })).toHaveText(["In the browser", "In your Claude", "Export to your video tool"]);
  await expect(row.getByRole("link", { name: /Set it up/ })).toHaveAttribute("href", "/mcp");
  await expect(row.getByRole("link", { name: /Try it free/ })).toHaveAttribute("href", "/start");
  const [shelfBottom, rowTop] = await Promise.all([
    page.getByRole("region", { name: "Example reports" }).evaluate((n) => n.getBoundingClientRect().bottom + window.scrollY),
    row.evaluate((n) => n.getBoundingClientRect().top + window.scrollY),
  ]);
  expect(rowTop).toBeGreaterThan(shelfBottom);
});

test("how it works replays the recorded trace, with real call counts", async ({ page }) => {
  await page.goto("/");
  const how = page.getByRole("region", { name: "Watch the agent build this." });
  await expect(how.getByText("Stoop is the brain, you bring your own camera.")).toBeVisible();
  const steps = how.locator("ol > li");
  await expect(steps).toHaveCount(5);
  await expect(how.getByText("Reality Check", { exact: true })).toBeVisible();
  await expect(how.getByText(/Qloo calls, all replayed from the recording · zero live calls$/)).toBeVisible();
});

test("pricing's Reserve opens the waitlist and tags the plan", async ({ page }) => {
  let body: unknown = null;
  await page.route("**/api/waitlist", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ position: 7 }) });
  });
  await page.goto("/");
  const pricing = page.getByRole("region", { name: "Free in beta. $49 per campaign after." });
  for (const plan of ["Free", "Campaign", "Founder", "Studio"]) await expect(pricing.getByRole("heading", { name: plan, exact: true })).toBeVisible();
  await expect(pricing.getByText("$399")).toBeVisible();
  await expect(pricing.getByText(/Precision mode comes with the Shopify app/)).toBeVisible();

  await expect(pricing.getByRole("button", { name: /^Reserve/ })).toHaveCount(4);
  await pricing.getByRole("button", { name: "Reserve Campaign" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Reserve Campaign")).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Email" }).fill("reserve@stoop-test.example");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Get my free brief" }).click();
  await expect(dialog.getByText("You're #7.")).toBeVisible();
  expect(body).toMatchObject({ email: "reserve@stoop-test.example", plan: "campaign", consent: true, sourceReport: "home" });
});

test("nothing pops up on its own, and the footer says what Stoop measures", async ({ page }) => {
  await page.goto("/");
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(1500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText("Without store data, Stoop measures your product's taste neighborhood. Precision mode (roadmap) adds real order data.")).toBeVisible();
  await expect(footer.getByRole("link", { name: "MIT license" })).toHaveAttribute("href", /\/LICENSE$/);
  await expect(footer.getByRole("link", { name: "For judges" })).toHaveAttribute("href", "/judges");
  await expect(footer.getByRole("link", { name: "Use Stoop in Claude" })).toHaveAttribute("href", "/mcp");
});

test("the PWA manifest and icons are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const json = (await manifest.json()) as { name: string; theme_color: string; icons: { src: string; purpose?: string }[] };
  expect(json).toMatchObject({ name: "Stoop", theme_color: "#fbf5ec", display: "standalone" });
  expect(json.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icon of json.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});
