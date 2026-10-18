import { expect, test, type Page } from "@playwright/test";
import { MockLanguageModelV4 } from "ai/test";
import type { IntakeResponse, SearchResponse } from "../lib/api/responses";
import type { PageRead } from "../lib/intake/page";
import { createQlooClient } from "../lib/qloo/client";
import { FixtureCache, readFixtureFile } from "../lib/qloo/fixtures";
import { runIntake } from "../lib/runtime/intake";
import { searchSeeds } from "../lib/runtime/search";
import { MemoryStore } from "../lib/store/memory";
import type { VisitorId } from "../lib/store/visitor";

// /start against intercepted /api/intake, /api/search and /api/run. The intercepted answers are made
// by the real intake and search code over recorded Qloo responses (fixtures/), with Claude mocked,
// exactly as lib/runtime/intake.test.ts does: no hand-written Qloo data. Replay mode stays on, so
// the server itself answers "off" wherever a test does not intercept.

const LIVE = { STOOP_LIVE: "true" };
const RUN_ID = `run_${"d4".repeat(12)}`;
const DESCRIPTION = "A smoky, bright hot sauce made in small batches with fermented red chiles. Price: $14.";
const COPY =
  "Porchlight Pepper Co. makes small-batch hot sauce from fermented red chiles, garlic and a little fruit. Medium heat that builds slowly. Pour it on eggs, tacos and sandwiches at the coffee shop table or at home on a slow Sunday.";

const reply = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: { inputTokens: { total: 800, noCache: 800, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 300, text: 300, reasoning: undefined } },
  warnings: [],
});
const SEEDS_ANSWER = { suggestions: [{ name: "Tabasco", type: "brand" }, { name: "Chemex", type: "brand" }], categoryTerms: ["hot sauce"], instructionLikeText: false };
const READING_ANSWER = { ageBands: ["25_to_29", "30_to_34"], genderSkew: "balanced", place: null, tasteTags: [{ query: "coffee shop", kind: "place" }], addressesMinors: false, instructionLikeText: false };

const client = () => createQlooClient({ cache: new FixtureCache(["pool-resolve", "probe-search"].map((name) => readFixtureFile(`fixtures/${name}.json`)), { strict: true }) });
const ctx = (store: MemoryStore) => ({ store, visitor: "v_aaaaaaaaaaaaaaaaaaaaaaaa" as VisitorId, source: "web" as const });
const shopifyPage = (extra: Partial<PageRead> = {}): PageRead => ({
  url: "https://porchlight.example/products/red",
  source: "shopify",
  product: { name: "Red Fermented Hot Sauce", brand: "Porchlight Pepper Co.", price: "14.00", currency: "USD", description: DESCRIPTION, tags: [], images: [] },
  copy: COPY,
  flags: [],
  fetches: [],
  ...extra,
});

let fromLink: IntakeResponse;
let fromDescription: IntakeResponse;
let blockedLink: IntakeResponse;
let hotOnes: SearchResponse;

test.beforeAll(async () => {
  const store = new MemoryStore();
  let n = 0;
  const hex = () => String(++n).padStart(2, "0").repeat(12);
  fromLink = await runIntake(
    { client: client(), model: new MockLanguageModelV4({ doGenerate: [reply(READING_ANSWER), reply(SEEDS_ANSWER)] }), env: LIVE, read: async () => shopifyPage(), randomHex: hex },
    { url: "https://porchlight.example/products/red" },
    ctx(store),
  );
  fromDescription = await runIntake({ client: client(), model: new MockLanguageModelV4({ doGenerate: reply(SEEDS_ANSWER) }), env: LIVE, randomHex: hex }, { description: DESCRIPTION }, ctx(store));
  blockedLink = await runIntake(
    { client: client(), model: new MockLanguageModelV4({ doGenerate: reply(SEEDS_ANSWER) }), env: LIVE, read: async () => shopifyPage({ product: null, copy: "", blocked: { reason: "The site blocked the read." } }), randomHex: hex },
    { url: "https://porchlight.example/products/red", description: DESCRIPTION },
    ctx(store),
  );
  hotOnes = await searchSeeds({ client: client(), env: LIVE }, { intakeId: fromLink.intakeId, q: "Hot Ones", type: "tv_show" }, ctx(store));
});

/** Console errors, except the browser's own line for an API answer a test expects to fail. */
function consoleErrors(page: Page, allowed: RegExp[] = []) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !allowed.some((pattern) => pattern.test(message.text()))) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the link flow reads the page, shows the seeds with their origins, adds a Qloo match and starts once", async ({ page }) => {
  const errors = consoleErrors(page);
  const intakeBodies: unknown[] = [];
  const runBodies: unknown[] = [];
  await page.route("**/api/intake", async (route) => {
    intakeBodies.push(route.request().postDataJSON());
    await route.fulfill({ json: fromLink });
  });
  await page.route("**/api/search?*", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("intakeId")).toBe(fromLink.intakeId);
    return route.fulfill({ json: url.searchParams.get("type") === "tv_show" && /hot ones/i.test(url.searchParams.get("q") ?? "") ? hotOnes : { results: [], evidence: [] } });
  });
  await page.route("**/api/run", async (route) => {
    runBodies.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ json: { mode: "live", runId: RUN_ID, eventsUrl: `/api/run/${RUN_ID}/events`, reportUrl: `/report/${RUN_ID}`, joined: false } });
  });

  await page.goto("/start");
  await expect(page.getByRole("heading", { level: 1, name: "What are you selling?" })).toBeVisible();
  await expect(page.getByText("Reels + TikTok 9:16")).toBeVisible();
  await page.getByLabel("Store or product link").fill("porchlight.example/products/red");
  await page.getByRole("button", { name: "Read my page" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Here's what we found." })).toBeFocused();
  expect(intakeBodies).toEqual([{ url: "https://porchlight.example/products/red", region: "United States" }]);
  const card = page.getByRole("region", { name: "From your page" });
  await expect(card.getByText(fromLink.product.name)).toBeVisible();
  await expect(card.getByText("14.00 USD")).toBeVisible();
  await expect(card.getByText("Read from your site · not from Qloo")).toBeVisible();
  await expect(card.getByText(fromLink.site!.tags[0].name, { exact: false })).toBeVisible();

  // Every proposed seed shows with its origin; the receipts open from the seed card.
  const seeds = page.getByRole("list", { name: "Seeds" });
  for (const seed of fromLink.seeds) await expect(seeds.getByText(seed.ref.name, { exact: true })).toBeVisible();
  expect(fromLink.seeds.map((s) => s.origin).sort()).toEqual(["qloo", "suggested"]);
  await expect(seeds.getByText("Qloo tag from your page")).toHaveCount(1);
  await expect(seeds.getByText("Suggested by Stoop and confirmed in Qloo")).toHaveCount(1);
  await expect(page.getByText("Suggestions are checked in Qloo before you see them. Anything Qloo can't match is dropped.")).toBeVisible();
  await page.getByRole("button", { name: "See the receipts" }).click();
  await expect(page.getByRole("dialog", { name: "Receipt: Seeds" }).getByText("/search").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // A "You" seed from Qloo autocomplete.
  await page.getByLabel("What to add").selectOption("tv_show");
  await page.getByLabel("Add a brand, show, artist or creator").fill("Hot Ones");
  await expect(page.getByText(`${hotOnes.results.length} Qloo ${hotOnes.results.length === 1 ? "match" : "matches"}`)).toBeVisible();
  // Qloo has more than one show by that name; the first is added, and only it reads "added".
  await page.getByRole("button", { name: "Add Hot Ones (tv show)", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Hot Ones (tv show) added", exact: true })).toBeDisabled();
  await expect(seeds.getByText("Added by you")).toHaveCount(1);
  const suggested = fromLink.seeds.find((s) => s.origin === "suggested")!;
  await page.getByRole("button", { name: `Remove ${suggested.ref.name}` }).click();
  await expect(seeds.getByText(suggested.ref.name, { exact: true })).toHaveCount(0);

  await page.getByLabel("Who do you think buys it?").fill("Home cooks in their 30s");
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);

  await page.getByRole("button", { name: "Map my audience" }).dblclick();
  await page.waitForURL(`**/run/${RUN_ID}`);
  expect(runBodies).toHaveLength(1);
  const tag = fromLink.seeds.find((s) => s.origin === "qloo")!;
  expect(runBodies[0]).toEqual({ intakeId: fromLink.intakeId, seedIds: [tag.ref.id, hotOnes.results.find((r) => r.ref.name === "Hot Ones")!.ref.id], statedCustomer: "Home cooks in their 30s", region: "United States" });
});

test("the description flow works without a website", async ({ page }) => {
  const errors = consoleErrors(page);
  const bodies: unknown[] = [];
  await page.route("**/api/intake", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: fromDescription });
  });
  await page.goto("/start");
  await page.getByRole("button", { name: "No website? Describe it instead" }).click();
  await expect(page.getByLabel("Describe your product")).toBeFocused();
  await page.getByLabel("Describe your product").fill(DESCRIPTION);
  await page.getByRole("button", { name: "Region: United States" }).click();
  await page.getByLabel("Region", { exact: true }).fill("Louisiana");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Here's what we found." })).toBeVisible();
  expect(bodies).toEqual([{ description: DESCRIPTION, region: "Louisiana" }]);
  await expect(page.getByRole("region", { name: "From your description" }).getByText("Louisiana")).toBeVisible();
  await expect(page.getByText("Your site speaks to")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit description" }).click();
  await expect(page.getByLabel("Describe your product")).toHaveValue(DESCRIPTION);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("a page that can't be read asks for a description and keeps the link", async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route("**/api/intake", async (route) => {
    const body = route.request().postDataJSON() as { description?: string };
    bodies.push(body);
    if (!body.description) return route.fulfill({ status: 422, json: { error: { code: "invalid", message: "Stoop could not read that page. Add a short description of the product." } } });
    await route.fulfill({ json: blockedLink });
  });
  await page.goto("/start");
  await page.getByLabel("Store or product link").fill("https://porchlight.example/products/red");
  await page.getByRole("button", { name: "Read my page" }).click();
  await expect(page.getByText("Stoop could not read that page. Add a short description of the product.")).toBeVisible();
  await page.getByLabel("Describe your product").fill(DESCRIPTION);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("region", { name: "From your description" })).toBeVisible();
  await expect(page.getByText(blockedLink.notes[0])).toBeVisible();
  expect(bodies[1]).toEqual({ url: "https://porchlight.example/products/red", description: DESCRIPTION, region: "United States" });
});

test("validation is inline and plain, and nothing is sent until it passes", async ({ page }) => {
  let sent = 0;
  await page.route("**/api/intake", (route) => {
    sent++;
    return route.fulfill({ json: fromLink });
  });
  await page.goto("/start");
  await page.getByRole("button", { name: "Read my page" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Paste a store or product link.");
  await expect(page.getByLabel("Store or product link")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Store or product link").fill("not a link");
  await page.getByRole("button", { name: "Read my page" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("doesn't look like a link");
  await page.getByRole("button", { name: "No website? Describe it instead" }).click();
  await page.getByLabel("Describe your product").fill("Hot sauce");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("20 characters or more");
  expect(sent).toBe(0);
});

test("with live runs off, the composer says so and offers an example run", async ({ page }) => {
  // Not intercepted: the server is in replay mode and answers "off".
  const errors = consoleErrors(page, [/status of 503/]);
  await page.goto("/start");
  await page.getByLabel("Store or product link").fill("porchlight.example/products/red");
  await page.getByRole("button", { name: "Read my page" }).click();
  await expect(page.getByText("Live runs are off right now.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch an example run" })).toHaveAttribute("href", "/run/example-food-hot-sauce?why=replay");
  expect(errors).toEqual([]);
});

test("a start that becomes an example replay says why, plainly, and opens the replay", async ({ page }) => {
  await page.route("**/api/intake", (route) => route.fulfill({ json: fromDescription }));
  await page.route("**/api/run", (route) => route.fulfill({ json: { mode: "example", slug: "food-hot-sauce", reason: "busy", message: "Two live runs are going right now." } }));
  await page.goto("/start");
  await page.getByRole("button", { name: "No website? Describe it instead" }).click();
  await page.getByLabel("Describe your product").fill(DESCRIPTION);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Map my audience" }).click();
  await page.waitForURL("**/run/example-food-hot-sauce?why=busy");
  await expect(page.getByText("Two live runs are going right now, so here is a recorded example run while you wait.")).toBeVisible();
  await expect(page.getByText("Recorded Qloo")).toBeVisible();
});

test("the example chips open the three recorded runs", async ({ page }) => {
  await page.goto("/start");
  const chips = page.getByRole("list", { name: "Try an example" }).getByRole("link");
  await expect(chips).toHaveCount(3);
  for (const [i, slug] of ["food-hot-sauce", "home-candles", "pets-outfits"].entries()) await expect(chips.nth(i)).toHaveAttribute("href", `/run/example-${slug}`);
  await noHorizontalScroll(page);
});
