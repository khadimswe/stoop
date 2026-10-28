import { expect, test, type Page } from "@playwright/test";

// The store-events flow against the recorded example stores (data/plans): the landing, an example
// plan and one receipt, the store form's checks, the public event page and My stores.

const EXAMPLE = "/examples/stores/chicago-18th-street";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    // Dev-only Next.js notices about instant navigation are not page errors.
    if (message.type() === "error" && !/instant-shell-url-data|encountered URL data/.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("landing to an example plan to one receipt", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Give your block a reason to stop." })).toBeVisible();
  await expect(page.getByText("The marketing team your store never had. Event, poster and posts, planned from your city and your block.")).toBeVisible();
  await expect(page.getByText("Same table, different block. Stoop plans for the block you're on.")).toBeVisible();
  await expect(page.getByText("Khadim, sales floor, Metro by T-Mobile")).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan an event" }).first()).toHaveAttribute("href", "/start");
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole("link", { name: /18th Street Wireless, Chicago/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`${EXAMPLE}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Fictional store. Not affiliated with or endorsed by T-Mobile.").first()).toBeVisible();
  // One glance: four tiles, then the sections behind tabs.
  await expect(page.getByRole("list", { name: "What to do" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("navigation", { name: "Sections of this plan" })).toBeVisible();

  const why = page.getByRole("button", { name: /Why Qloo picked this/ }).first();
  await why.click();
  const receipt = page.getByRole("dialog", { name: /^Receipt:/ });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("Endpoint")).toBeVisible();
  await expect(receipt.getByText("/v2/insights").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(receipt).toBeHidden();
  await expect(why).toBeFocused();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the plan keeps the run of show, the comparison and the trace one tap away", async ({ page }) => {
  await page.goto(EXAMPLE);
  const compare = page.locator("details", { has: page.getByText("Compare with a generic AI plan") });
  await expect(compare).not.toHaveAttribute("open", "");
  await compare.locator("summary").click();
  await expect(compare.getByRole("table", { name: /line by line/ })).toBeVisible();
  await expect(compare.getByText(/^Cliché:/).first()).toBeVisible();
  const made = page.locator("details#how-it-was-made");
  await made.locator("> summary").click();
  await expect(made.getByRole("list", { name: "Agent steps" })).toBeVisible();
});

test("the store form says what's missing and opens More options for its errors", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { level: 1, name: "Plan an event" })).toBeVisible();
  await expect(page.getByLabel("Budget ($)")).toHaveValue("50");
  await page.getByRole("button", { name: "Plan my event" }).click();
  await expect(page.getByText("Enter the store name.")).toBeVisible();
  await expect(page.getByText("Tap Use my location, or type the coordinates.")).toBeVisible();
  await expect(page.getByLabel("Store name")).toBeFocused();
  await expect(page.getByLabel("Store name")).toHaveAttribute("aria-invalid", "true");

  // Up to 8 promos.
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Add a promo" }).click();
  await expect(page.getByLabel("Promo 8")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a promo" })).toHaveCount(0);

  // An error inside More options opens it.
  await page.getByText("More options").click();
  for (const label of ["25 to 29", "30 to 34"]) await page.getByLabel(label).uncheck();
  await page.getByText("More options").click();
  await page.getByRole("button", { name: "Plan my event" }).click();
  await expect(page.getByText("Pick at least one age band.")).toBeVisible();
});

test("a filled form starts a plan, and a paused day goes to an example with its message", async ({ page }) => {
  await page.route("**/api/plan", async (route) => {
    const { inputs } = route.request().postDataJSON() as { inputs: { store: { name: string; point: { lat: number } }; offers: { text: string }[] } };
    expect(inputs.store.name).toBe("Corner Wireless");
    expect(inputs.store.point.lat).toBeCloseTo(41.8576);
    expect(inputs.offers).toEqual([{ text: "Free tablet with a new line" }]);
    await route.fulfill({ json: { mode: "example", slug: "chicago-18th-street", message: "Live plans are paused today. Here is an example store." } });
  });
  await page.goto("/start");
  await page.getByLabel("Store name").fill("Corner Wireless");
  await page.getByLabel("Street address").fill("1800 W 18th St");
  await page.getByLabel("City").fill("Chicago");
  await page.getByLabel("State").fill("IL");
  await page.getByLabel("Latitude").first().fill("41.8576");
  await page.getByLabel("Longitude").first().fill("-87.6566");
  await page.getByLabel("Promo 1").fill("Free tablet with a new line");
  await page.getByRole("button", { name: "Plan my event" }).click();
  await expect(page).toHaveURL(new RegExp(`${EXAMPLE}$`));
  await expect(page.getByRole("status").filter({ hasText: "Live plans are paused today." })).toBeVisible();
});

test("the public event page shows the event and no internals", async ({ page }) => {
  await page.goto("/e/ex-chicago-18th-street");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("$25/mo unlimited when you switch, taxes and fees included")).toBeVisible();
  await expect(page.getByRole("link", { name: /Get directions/ })).toBeVisible();
  await expect(page.getByText(/Why Qloo picked this|Endpoint/)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/api\/plan\/ex-chicago-18th-street\/marketing\/poster\.png\?size=og$/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("the judges' guide walks one store and says what Qloo decides", async ({ page }) => {
  await page.goto("/judges");
  await expect(page.getByRole("heading", { level: 1, name: "For judges" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the example store" })).toHaveAttribute("href", EXAMPLE);
  await expect(page.getByRole("region", { name: "What Qloo decides" }).getByRole("table")).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/judge=|your customers|\d+% (lift|more|better|higher)/i);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("My stores switches the view, not the data", async ({ page }) => {
  await page.goto("/stores");
  await expect(page.getByRole("heading", { level: 1, name: "My stores" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open plan/ })).toHaveCount(3);
  await page.getByRole("button", { name: "District" }).click();
  await expect(page.getByRole("table", { name: /next event/ })).toBeVisible();
  await page.getByRole("button", { name: "Store", exact: true }).click();
  await expect(page.getByRole("link", { name: /Open plan/ })).toHaveCount(1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
