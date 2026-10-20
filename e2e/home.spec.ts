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
  // Until clips are approved, every screen shows its concept preview (never an empty "clip coming"
  // player), and the Control's says it is not from Qloo.
  await expect(page.getByText(/clip coming/i)).toHaveCount(0);
  const clips = screening.getByRole("region", { name: /^Screening Room clips/ });
  await expect(clips.getByText("Concept preview")).toHaveCount(3);
  await expect(clips.getByText("Shot 1 · Hook", { exact: false })).toHaveCount(3);
  await expect(clips.locator("figure").first().getByText("Not from Qloo")).toBeVisible();
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
  // One honest line, once on the landing, by the proof band: the brands are made up, the data is not.
  const note = "The example brands are fictional. Their audiences are measured from real Qloo data.";
  await expect(page.getByRole("region", { name: "Founders guess. AI briefs guess. Qloo measures." }).getByText(note)).toBeVisible();
  await expect(page.getByText(note)).toHaveCount(1);
  // Each brand link is a 44 px tap target, and each screen is as tall as its own Reality Check: no
  // empty dark block below the last line on the shorter cards.
  for (const link of await shelf.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const gaps = await shelf.locator("[data-surface='screen']").evaluateAll((screens) =>
    screens.map((screen) => screen.getBoundingClientRect().bottom - screen.lastElementChild!.getBoundingClientRect().bottom),
  );
  expect(gaps).toHaveLength(3);
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(24);
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

test("how it works is four numbered steps, with the lead example's real age skews", async ({ page }) => {
  await page.goto("/");
  const how = page.getByRole("region", { name: "From your link to the test, in four steps." });
  await expect(how.getByRole("heading", { level: 3 })).toHaveText([
    "Step 1: Read your site",
    "Step 2: Qloo measures the audience",
    "Step 3: Make the ads",
    "Step 4: Launch the test",
  ]);
  await expect(how.getByRole("img", { name: "Porchlight Pepper Co.'s age skews from Qloo: highest for 55 and older (skews +0.21)." })).toBeAttached();
  // The chart carries its receipt, and the launch checklist (a guardrail) is spoken, not decorative.
  await expect(how.getByText("/v2/insights · urn:demographics · 1 Qloo call")).toBeVisible();
  await expect(
    how.getByRole("img", { name: "Before you launch: a human review checklist, an AI disclosure note, and export to your video tool. Nothing auto-publishes." }),
  ).toBeAttached();
  // The nav's "How it works" still lands here.
  await expect(page.locator("#how")).toHaveAttribute("aria-labelledby", "how-title");
});

test("the agent demo sits right under the hero and replays the recorded run in a screen that never changes size", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main > section").nth(1)).toHaveAttribute("id", "agent-demo");
  const slot = page.getByRole("region", { name: "The agent at work · Porchlight Pepper Co." });
  await expect(slot.getByText("Replay of a recorded run · real Qloo data · Oct 16")).toBeVisible();
  // Screen readers get a plain summary of the run, with its own Reality Check.
  await expect(slot.getByText(/Qloo measured a taste neighborhood that skews 55 and older/)).toBeAttached();
  const screen = slot.locator("[data-slot='agent-demo']");
  const before = await screen.boundingBox();
  await slot.scrollIntoViewIfNeeded();
  // The player loads as its own chunk into the placeholder's exact shape.
  const player = slot.locator("[data-demo-beat]");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("data-demo-playing", "true");
  await page.waitForTimeout(400);
  const after = await screen.boundingBox();
  expect(after?.height).toBeCloseTo(before!.height, 0);
  await expect(slot.getByRole("button", { name: "Pause the replay" })).toBeVisible();
});

const FIGURES = ["55+", "#319 of 321", "0 of 19", "18 to 24"];

test("the proof stats count up once to the recorded values, without moving the layout, and open their receipts", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  const proof = page.getByRole("region", { name: "Founders guess. AI briefs guess. Qloo measures." });
  const figures = proof.locator("[data-count-up]");
  await expect(figures).toHaveCount(4);
  // Below the fold at load: a rank is wound back to its floor, out of sight, with the full value for
  // screen readers. An age band never counts: it shows only what Qloo measured, on every frame.
  await expect(figures.first().locator("[data-count-up-live]")).toHaveText("55+");
  await expect(figures.last().locator("[data-count-up-live]")).toHaveText("18 to 24");
  await expect(figures.nth(1).locator("[data-count-up-live]")).toHaveText("#1 of 321");
  await expect(figures.first().locator(".sr-only")).toHaveText("55+");
  for (const [i, value] of FIGURES.entries()) {
    const figure = figures.nth(i);
    const box = await figure.boundingBox();
    await figure.scrollIntoViewIfNeeded();
    await expect(figure.locator("[data-count-up-live]")).toHaveText(value);
    expect(await figure.boundingBox().then((b) => b?.height)).toBeCloseTo(box!.height, 0);
  }
  // Once: scrolling away and back does not count again (read once, no retrying until it settles).
  await page.evaluate(() => window.scrollTo(0, 0));
  await figures.nth(1).scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  expect(await figures.nth(1).locator("[data-count-up-live]").textContent()).toBe("#319 of 321");

  await proof.getByRole("button", { name: "See the receipt: Whisker & Brim, #319 of 321" }).click();
  const drawer = page.getByRole("dialog", { name: "Receipt: Generic choice: city" });
  await expect(drawer.getByText("Los Angeles, CA ranks #319 of 321 cities for this world").first()).toBeVisible();
  await expect(drawer.getByText("/v2/insights").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  expect(errors).toEqual([]);
});

test("below-the-fold sections rise in once as they scroll into view", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByRole("region", { name: "From your link to the test, in four steps." }).locator("ol > li");
  await expect(cards.first()).toHaveAttribute("data-reveal", "pending");
  await cards.first().scrollIntoViewIfNeeded();
  await expect(cards.first()).toHaveAttribute("data-reveal", "shown");
  await expect(cards.first()).toHaveCSS("opacity", "1");
  // The hero is never part of it, and nothing on screen at load is ever hidden.
  await expect(page.locator("section[aria-labelledby='hero-title'] [data-reveal]")).toHaveCount(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("every number shows its recorded value and nothing is hidden or moving", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-count-up-live]")).toHaveText(FIGURES);
    await expect(page.locator("[data-reveal='pending']")).toHaveCount(0);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the landing reads in full: the H1, the replay's frame, every number and every section", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Stop making ads for nobody." })).toBeVisible();
    await expect(page.getByText("Replay of a recorded run")).toBeVisible();
    await expect(page.locator("[data-count-up-live]")).toHaveText(FIGURES);
    await expect(page.locator("[data-reveal]").first()).toHaveAttribute("data-reveal", "idle");
    await expect(page.locator("[data-reveal='pending']")).toHaveCount(0);
  });
});

test("the whole landing scrolls without layout shift, sideways overflow or console errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) w.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
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
  // The whole form is on screen, its submit included, and the submit says what it does here.
  const submit = dialog.getByRole("button", { name: "Reserve", exact: true });
  await expect(submit).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("textbox", { name: "Email" })).toBeInViewport({ ratio: 1 });
  await expect.poll(() => dialog.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  await dialog.getByRole("textbox", { name: "Email" }).fill("reserve@stoop-test.example");
  await dialog.getByRole("checkbox").check();
  await submit.click();
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
  await expect(footer.getByRole("link", { name: "MIT license" })).toHaveAttribute("href", "https://github.com/khadimswe/stoop-public/blob/main/LICENSE");
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
