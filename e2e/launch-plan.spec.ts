import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { EXAMPLES } from "../lib/demo/examples";
import type { Report } from "../lib/report/schema";
import { launchPlanView } from "../lib/report/view/launch";
import { launchSheetCsv, launchSheetMarkdown, planBudget, type BudgetInput } from "../lib/report/view/launch-sheet";

// The Launch plan on its review route, against the recorded runs. Expected values come from the same
// view model the page renders, built from the same JSON: nothing here is hand-written Qloo data.

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const LEAD = "food-hot-sauce";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Console errors, page errors and CSP violations. */
async function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => console.error(`CSP: ${event.violatedDirective} ${event.blockedURI}`));
  });
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

function splitOf(input: BudgetInput, cells: number) {
  const result = planBudget(input, cells);
  if (!result.ok) throw new Error("invalid budget");
  return result.split;
}

for (const { slug, brandName } of EXAMPLES) {
  test(`${slug}: the Control is the baseline cell, then each concept world, each with its creative and budget`, async ({ page }) => {
    const errors = await watchErrors(page);
    const view = launchPlanView(read(slug));
    await page.goto(`/launch-preview/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: brandName })).toBeVisible();
    const section = page.getByRole("region", { name: "Launch plan" });
    await expect(section.getByRole("heading", { level: 2, name: "Launch plan" })).toBeVisible();

    const cells = section.locator("[data-launch-cell]");
    await expect(cells).toHaveCount(view.cells.length);
    expect(await cells.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-launch-cell")))).toEqual(view.cells.map((c) => c.key));
    for (const cell of view.cells) {
      const card = section.locator(`[data-launch-cell="${cell.key}"]`);
      await expect(card.getByRole("heading", { level: 3 })).toHaveText(cell.kind === "control" ? "Control" : cell.label);
      await expect(card.getByText(cell.creative.title, { exact: true })).toBeVisible();
      await expect(card.getByText(cell.kind === "control" ? "Generic AI brief · not from Qloo" : "Culture-made", { exact: true })).toBeVisible();
      await expect(card.getByRole("link", { name: /See its prompts/ })).toHaveAttribute("href", `/examples/${slug}#${cell.creative.anchor}`);
      await expect(card.locator("[data-launch-budget]")).toContainText("$20");
      for (const option of [...cell.ageBands, ...cell.cities]) {
        if (option.receipt) await expect(card.getByRole("button", { name: new RegExp(`${escape(option.text)}.*opens its receipt`) })).toBeVisible();
        else await expect(card.getByText(option.text, { exact: true })).toBeVisible();
      }
    }
    // The Control's options say where they came from; a world's open receipts.
    await expect(section.locator('[data-launch-cell="control"]').getByText("From the generic brief, not from Qloo.")).toBeVisible();
    await expect(section.locator('[data-launch-cell="control"]').getByRole("button", { name: /opens its receipt/ })).toHaveCount(0);
    const world = view.cells[1];
    await expect(section.locator(`[data-launch-cell="${world.key}"]`).getByRole("button", { name: /opens its receipt/ })).toHaveCount(world.ageBands.length + world.cities.length);

    await expect(section.getByText("$20 a day per cell · $140 per cell over 7 days · $420 in total")).toBeVisible();
    await expect(section.getByText(/measuring that lift is our November pilot/)).toBeVisible();
    await expect(section.getByText(/Set it up in Ads Manager in about 10 minutes\./)).toBeVisible();
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test("the budget helper splits what you type, and the rule follows your target", async ({ page }) => {
  const errors = await watchErrors(page);
  await page.goto(`/launch-preview/${LEAD}`);
  const section = page.getByRole("region", { name: "Launch plan" });
  await section.getByLabel("Daily budget").fill("100");
  await expect(section.locator("[data-launch-split]")).toContainText("$33 a day per cell · $231 per cell over 7 days · $693 in total");
  await expect(section.getByText("$1 a day stays unspent, so every cell gets the same budget.")).toBeVisible();
  for (const budget of await section.locator("[data-launch-budget]").all()) await expect(budget).toContainText("$33");

  const rule = section.locator("[data-launch-rule]");
  await expect(rule).toContainText("Wait until the 7 test days are over.");
  await section.getByLabel("Target cost per result (optional)").fill("25");
  await expect(rule).toContainText("Wait until each cell has spent at least $75, 3 times your $25 target cost per result. At $33 a day per cell, that takes at least 3 days.");
  await section.getByLabel("Test days").fill("2");
  await expect(rule).toContainText("that takes at least 3 days, longer than your 2 days: run the test longer or raise the budget.");
  await expect(rule).toContainText("Keep the worlds whose cost per result beats the Control's.");
  await expect(rule).toContainText("Pause the rest, and move their budget to the best world.");
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("invalid numbers say what to fix, and the sheet waits for them", async ({ page }) => {
  await page.goto(`/launch-preview/${LEAD}`);
  const section = page.getByRole("region", { name: "Launch plan" });
  const daily = section.getByLabel("Daily budget");
  const days = section.getByLabel("Test days");
  const download = section.getByRole("button", { name: "Download launch sheet (CSV)" });

  await daily.fill("2");
  await expect(section.getByText("Use at least $3 a day, so each of the 3 cells gets $1.")).toBeVisible();
  await expect(daily).toHaveAttribute("aria-invalid", "true");
  await expect(daily).toHaveAccessibleDescription(/Use at least \$3 a day/);
  await expect(section.locator("[data-launch-split]")).toHaveText("Enter a daily budget and the test days to see the split.");
  await expect(section.locator("[data-launch-budget]")).toHaveCount(0);
  await expect(download).toBeDisabled();
  await expect(section.getByRole("button", { name: "Copy as Markdown" })).toBeDisabled();

  // An empty field only complains once you leave it.
  await daily.fill("");
  await expect(section.getByText("Enter a daily budget, like 60.")).toHaveCount(0);
  await daily.blur();
  await expect(section.getByText("Enter a daily budget, like 60.")).toBeVisible();

  await days.fill("1.5");
  await expect(section.getByText("Enter whole days, like 7.")).toBeVisible();
  await section.getByLabel("Target cost per result (optional)").fill("abc");
  await expect(section.getByText("Enter a dollar amount, like 25, or leave it empty.")).toBeVisible();

  await daily.fill("60");
  await days.fill("7");
  await section.getByLabel("Target cost per result (optional)").fill("");
  await expect(daily).not.toHaveAttribute("aria-invalid");
  await expect(download).toBeEnabled();
  await expect(section.locator("[data-launch-split]")).toContainText("$20 a day per cell");
});

test("the launch sheet downloads as a CSV with a BOM, one guarded row per cell", async ({ page }) => {
  await page.goto(`/launch-preview/${LEAD}`);
  const view = launchPlanView(read(LEAD));
  const section = page.getByRole("region", { name: "Launch plan" });
  await section.getByLabel("Daily budget").fill("90");
  await section.getByLabel("Test days").fill("10");
  const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("button", { name: "Download launch sheet (CSV)" }).click()]);
  expect(download.suggestedFilename()).toBe("porchlight-pepper-co-launch-sheet.csv");
  const text = readFileSync((await download.path())!, "utf8");
  const pageUrl = `${new URL(page.url()).origin}/examples/${LEAD}`;
  expect(text).toBe(launchSheetCsv(view, splitOf({ daily: "90", days: "10", target: "" }, view.cells.length), pageUrl));
  expect(text.startsWith("﻿")).toBe(true);
  const lines = text.slice(1).trimEnd().split("\r\n");
  expect(lines[0]).toBe("Campaign,Ad set name,Ad name,Daily budget (USD),Placements,Age bands,Cities,Audience options from,Hook,Prompt reference,What to watch,Qloo receipts");
  expect(lines).toHaveLength(view.cells.length + 1);
  expect(lines[1]).toContain("Control · generic AI brief");
  expect(lines[1]).toContain(",30,");
  expect(text).not.toMatch(/(^|,)[=+\-@]/m);
});

test("copy as Markdown puts the whole plan on the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only here");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/launch-preview/${LEAD}`);
  const view = launchPlanView(read(LEAD));
  const section = page.getByRole("region", { name: "Launch plan" });
  await section.getByLabel("Target cost per result (optional)").fill("30");
  await section.getByRole("button", { name: "Copy as Markdown" }).click();
  await expect(section.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const pageUrl = `${new URL(page.url()).origin}/examples/${LEAD}`;
  expect(copied).toBe(launchSheetMarkdown(view, splitOf({ daily: "60", days: "7", target: "30" }, view.cells.length), pageUrl));
  expect(copied).toContain("# Launch plan: Porchlight Pepper Co.");
  expect(copied).toContain("1. Wait until each cell has spent at least $90, 3 times your $30 target cost per result.");
});

test("a Qloo option opens its receipt, which closes with Esc and returns focus", async ({ page }) => {
  const errors = await watchErrors(page);
  await page.goto(`/launch-preview/${LEAD}`);
  const view = launchPlanView(read(LEAD));
  const world = view.cells[1];
  const card = page.locator(`[data-launch-cell="${world.key}"]`);

  const city = card.getByRole("button", { name: new RegExp(`${escape(world.cities[0].text)}.*opens its receipt`) });
  await city.click();
  const drawer = page.getByRole("dialog", { name: "Receipt: City" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(world.cities[0].receipt!.title)).toBeVisible();
  await expect(drawer.getByText("/v2/insights").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(city).toBeFocused();

  await card.getByRole("button", { name: new RegExp(`${escape(world.ageBands[0].text)}.*opens its receipt`) }).click();
  const age = page.getByRole("dialog", { name: "Receipt: Age band" });
  await expect(age.getByText("urn:demographics")).toBeVisible();
  await age.getByRole("button", { name: "Close receipt" }).click();
  await expect(age).toBeHidden();
  expect(errors).toEqual([]);
});

test("the preview is noindex and unknown examples are a 404", async ({ page }) => {
  await page.goto(`/launch-preview/${LEAD}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const response = await page.goto("/launch-preview/not-an-example");
  expect(response?.status()).toBe(404);
});
