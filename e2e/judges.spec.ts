import { expect, test } from "@playwright/test";

test("the judge's guide follows the three beats and links to the lead example", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/ads/judges");
  await expect(page.getByRole("heading", { level: 1, name: "For judges" })).toBeVisible();
  await expect(page.getByText("Without store data, Stoop measures your product's taste neighborhood. Precision mode (roadmap) adds real order data.").first()).toBeVisible();

  const path = page.getByRole("region", { name: "The 90-second path" });
  await expect(path.getByRole("heading", { level: 3 })).toHaveText([/The Reality Check/, /The Screening Room/, /One receipt/, /Try it free/]);
  await expect(path.getByRole("link", { name: "Open the report" })).toHaveAttribute("href", "/examples/food-hot-sauce");
  await expect(path.getByRole("link", { name: "Go to the Screening Room" })).toHaveAttribute("href", "/examples/food-hot-sauce#screening");
  await expect(path.getByRole("link", { name: "Open a receipt" })).toHaveAttribute("href", "/examples/food-hot-sauce#receipt-music");
  await expect(path.getByRole("link", { name: "Try it free" })).toHaveAttribute("href", "/ads/start");

  // What Qloo decides, with a code link per call.
  const decides = page.getByRole("region", { name: "What Qloo decides" });
  await expect(decides.getByRole("table")).toBeVisible();
  await expect(decides.getByRole("link", { name: /lib\/stages\/check\.ts/ })).toHaveAttribute("href", "https://github.com/khadimswe/stoop/blob/main/lib/stages/check.ts");

  // The scoreboard reads the check's own lines for every example.
  const scoreboard = page.getByRole("region", { name: "The generic brief, scored by Qloo" });
  await expect(scoreboard.getByRole("heading", { level: 3 })).toHaveText(["Porchlight Pepper Co.", "Lowlight Candle Co.", "Whisker & Brim"]);
  await expect(scoreboard.getByText(/checkable LLM-only choices miss what Qloo measured for this world/).first()).toBeVisible();
  // Every world's scored lines carry their receipt.
  await expect(scoreboard.getByRole("button", { name: /^See the receipts/ })).toHaveCount(6);
  await scoreboard.getByRole("button", { name: /^See the receipts/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Receipt: With vs without" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { name: "Stoop is the brain, you bring your own camera." })).toBeVisible();
  await expect(page.getByText("Stoop's MCP plus your own Higgsfield MCP")).toBeVisible();
  await expect(page.getByText(/^Precision mode: connect your Shopify store so real order locations and best-sellers sharpen Qloo's picture\. Aggregated, no customer\s+PII\.$/)).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the guide never shows a judge code, a performance claim or banned wording", async ({ page }) => {
  await page.goto("/ads/judges");
  const text = await page.locator("body").innerText();
  const html = await page.content();
  expect(html).not.toMatch(/judge=/i);
  expect(text).not.toMatch(/andromeda|real buyers|really buys|measures your buyers|find my buyers/i);
  expect(text).not.toMatch(/\d+% (lift|more|better|higher)/i);
  // No em dashes anywhere on the page.
  expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
});

// --- The store-events guide at /judges --------------------------------------------------------------

const EVENT = "/plan/ex-chicago-18th-street";

test("the store-events guide walks the landing, the real table and the event in six steps and links each to its proof", async ({ page }) => {
  await page.goto("/judges");
  await expect(page.getByRole("heading", { level: 1, name: "For judges" })).toBeVisible();
  const path = page.getByRole("region", { name: "The path, in 6 steps" });
  await expect(path.getByRole("heading", { level: 3 })).toHaveText(["Same table. Different community.", "One event and its receipts", "The generic AI plan beside it", "The first real table", "Take it to where people go", "Try your own store"]);
  await expect(path.getByRole("link", { name: "See the three stores" })).toHaveAttribute("href", "/#examples");
  await expect(path.getByRole("link", { name: "Open a receipt" })).toHaveAttribute("href", `${EVENT}#receipt-play`);
  await expect(path.getByRole("link", { name: "Open the comparison" })).toHaveAttribute("href", `${EVENT}#compare`);
  await expect(path.getByRole("link", { name: "See the real table" })).toHaveAttribute("href", "/#real-table");
  await expect(path.getByRole("link", { name: "Open the drafts" })).toHaveAttribute("href", "/plan/ex-houston-east-end#get-the-ok");
  await expect(path.getByRole("link", { name: "Plan an event" })).toHaveAttribute("href", "/start");
  // It says plainly what happens when live plans are off.
  await expect(path.getByText(/When live plans are off, Stoop says so plainly and opens the closest example store instead/)).toBeVisible();
  // The comparison step says what Qloo found, from the recorded run, in plain words.
  await expect(path.getByText(/none of its 3 artists make Qloo's own top 20 for Chicago adults 25 to 34\.$/)).toBeVisible();

  const decides = page.getByRole("region", { name: "What Qloo decides" });
  for (const file of ["requests", "taste", "block-music", "baseline"]) {
    await expect(decides.getByRole("link", { name: `lib/plan/${file}.ts` })).toHaveAttribute("href", `https://github.com/khadimswe/stoop/blob/main/lib/plan/${file}.ts`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the store-events guide never says block or snacks, claims a lift or shows a judge code", async ({ page }) => {
  await page.goto("/judges");
  // Code paths (lib/plan/block-music.ts) are file names, not words people read.
  const text = (await page.locator("main").innerText()).replace(/lib\/plan\/[a-z-]+\.ts/g, "");
  expect(text).not.toMatch(/\bblock\b/i);
  expect(text).not.toMatch(/\bsnacks?\b/i);
  expect(text).not.toMatch(/first product: ads/i);
  expect(text).not.toMatch(/median|checkable|rubric/i);
  expect(text).not.toMatch(/your customers/i);
  expect(text).not.toMatch(/\d+% (lift|more|better|higher)/i);
  expect(await page.content()).not.toMatch(/judge=/i);
  expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
});
