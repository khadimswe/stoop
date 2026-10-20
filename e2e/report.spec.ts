import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const SECTIONS = ["reality", "your-ad", "output", "screening", "kit", "launch", "why"];
const TITLES = ["Reality Check", "Your ad", "Output", "Screening Room", "Campaign Kit", "Launch plan", "Why it works"];

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

// --- Campaign Kit, Why it works and the section nav, on the lead example ------------------------------

const lead = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as {
  worlds: { segmentId: string; label: string; pack: { concept: { title: string } }; kit: { ugc: { platform: string; tool: string; script: string }[] } }[];
  control: { fits: { line: string }[] };
};

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /Content Security Policy/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

test("the Campaign Kit groups cards by world, copies scripts and lists every model's prompts", async ({ page, context }) => {
  const errors = watchConsole(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/examples/food-hot-sauce");
  const kit = page.locator("#kit");
  await expect(kit.getByRole("heading", { level: 2, name: "Campaign Kit" })).toBeVisible();
  for (const world of lead.worlds) await expect(kit.getByRole("heading", { level: 3, name: world.label })).toBeVisible();

  const [first] = lead.worlds;
  const kept = kit.getByRole("article", { name: `Kept concept: ${first.pack.concept.title}` });
  await kept.getByRole("button", { name: "Copy script" }).click();
  await expect(kept.getByRole("button", { name: "Copied" })).toBeVisible();
  const script = first.kit.ugc.find((s) => s.platform === "meta" && s.tool === "creator")!.script;
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(script);

  await kept.getByRole("button", { name: `Prompts for ${first.pack.concept.title}` }).click();
  const menu = page.getByRole("dialog", { name: `Prompts for ${first.pack.concept.title}` });
  for (const name of ["Seedance 2.5", "Veo 3.1", "Kling 3.0", "Runway Gen-4.5", "Arcads", "Creatify"]) await expect(menu.getByRole("button", { name: `Copy ${name}` })).toBeVisible();
  await menu.getByRole("button", { name: "Copy Veo 3.1" }).click();
  await expect(menu.getByRole("button", { name: "Copied: Veo 3.1" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  const download = page.waitForEvent("download");
  await kit.getByRole("button", { name: "Meta + TikTok ad plan (CSV)" }).click();
  expect((await download).suggestedFilename()).toBe("porchlight-pepper-co-ad-plan.csv");

  // Examples never offer the after-run actions, and nothing sends a kit anywhere.
  await expect(page.getByRole("button", { name: /Not this vibe|Storyboards/ })).toHaveCount(0);
  await expect(page.getByText(/Send to a creator/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Why it works opens a receipt from every kind of number, and scores the generic brief honestly", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/examples/food-hot-sauce");
  const why = page.locator("#why");
  await expect(why.getByRole("heading", { level: 3, name: "Qloo measured from these seeds" })).toBeVisible();

  const skew = why.getByRole("button", { name: /^skews [+-]\d\.\d\d/ }).first();
  await skew.click();
  const receipt = page.getByRole("dialog", { name: "Receipt: Age and gender skew" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("/v2/insights").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(receipt).toBeHidden();
  await expect(skew).toBeFocused();

  const brief = why.locator(`#brief-${lead.worlds[0].segmentId}`);
  await expect(brief.getByText("Rich Qloo signal").first()).toBeVisible();
  await brief.getByRole("button", { name: /opens the receipt for Music feel/ }).first().click();
  const music = page.getByRole("dialog", { name: "Receipt: Music feel" });
  await expect(music.getByText("Qloo pick 1")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(why.getByText("Cliche flagged").first()).toBeVisible();
  await why.getByRole("button", { name: lead.control.fits[0].line }).first().click();
  await expect(page.getByRole("dialog", { name: "Receipt: Generic brief vs Qloo" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(why.getByText(/unsupported/i)).toHaveCount(0);
  await expect(why.getByText(/% of/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the section nav marks the section in view and never scrolls the page sideways", async ({ page }) => {
  await page.goto("/examples/food-hot-sauce");
  const nav = page.getByRole("navigation", { name: "Report sections" });
  await nav.getByRole("link", { name: "Campaign Kit" }).click();
  await expect(nav.getByRole("link", { name: "Campaign Kit" })).toHaveAttribute("aria-current", "location");
  await nav.getByRole("link", { name: "Launch plan" }).click();
  await expect(nav.getByRole("link", { name: "Launch plan" })).toHaveAttribute("aria-current", "location");
  await nav.getByRole("link", { name: "Why it works" }).click();
  await expect(nav.getByRole("link", { name: "Why it works" })).toHaveAttribute("aria-current", "location");
  await expect(nav.getByRole("link", { name: "Campaign Kit" })).not.toHaveAttribute("aria-current", "location");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
