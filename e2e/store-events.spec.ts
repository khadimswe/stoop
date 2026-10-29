import { expect, test, type Page } from "@playwright/test";

// The store-events floor against the recorded example stores (data/plans): the landing, the five
// steps (Block, Create, Event, Poster, Promote), a receipt, the judges' fold, My stores, the public
// event page and the new-store form.

const SLUG = "chicago-18th-street";
const EVENT = `/plan/ex-${SLUG}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    // Dev-only notices and the map's tile host (offline in CI) are not page errors.
    if (message.type() === "error" && !/instant-shell-url-data|encountered URL data|openfreemap|maplibre|Failed to load resource/i.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("landing to an example event to one receipt", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Give your block a reason to stop." })).toBeVisible();
  await expect(page.getByText("Khadim, sales floor, Metro by T-Mobile")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "See an example" }).click();
  await expect(page).toHaveURL(new RegExp(`${EVENT}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Fictional store. Not affiliated with or endorsed by T-Mobile.").first()).toBeVisible();
  for (const jump of ["Play", "Snacks", "Wheel", "Timeline"]) await expect(page.getByRole("navigation", { name: "Jump to" }).getByRole("link", { name: jump })).toBeVisible();

  const why = page.getByRole("button", { name: /Why Qloo picked this.*the playlist/ });
  await why.click();
  const receipt = page.getByRole("dialog", { name: /^Receipt:/ });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("Endpoint")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(receipt).toBeHidden();
  await expect(why).toBeFocused();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the five steps link forward and back", async ({ page }) => {
  await page.goto(`/s/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your block" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Places on the block" }).getByRole("listitem")).toHaveCount(5);
  // Once loading ends, the map stays on the page, or says it didn't load (the tile host is offline in CI).
  await expect(page.getByText("Loading the map...")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".maplibregl-canvas").or(page.getByText("The map didn't load. The list below has every place."))).toBeVisible();
  await page.getByRole("button", { name: /^Food \d+$/ }).click();
  await expect(page.getByRole("button", { name: /^Food \d+$/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Create an event" }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/new$`));
  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Budget" })).toHaveText("$50");
  await page.getByRole("button", { name: "Ten dollars more" }).click();
  await expect(page.getByRole("status", { name: "Budget" })).toHaveText("$60");
  await expect(page.getByRole("navigation", { name: "Steps" }).getByRole("link", { name: "Block" })).toHaveAttribute("href", `/s/${SLUG}`);

  await page.goto(`${EVENT}/poster`);
  await expect(page.getByRole("heading", { level: 1, name: "Poster" })).toBeVisible();
  await page.getByRole("radio", { name: "Wide 1.91:1" }).click();
  await expect(page.getByRole("img").first()).toHaveAttribute("src", /size=og/);
  await page.getByRole("link", { name: "Promote it" }).click();

  await expect(page).toHaveURL(new RegExp(`${EVENT}/promote$`));
  await expect(page.getByRole("heading", { level: 1, name: "Promote" })).toBeVisible();
  await expect(page.getByText("Nothing posts until you approve.")).toBeVisible();
  // Example stores always share in one tap (posting answers 403 for them).
  await expect(page.getByRole("button", { name: "Share the event" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Accounts" }).getByText("WhatsApp", { exact: true })).toBeVisible();
});

test("a filled form starts a plan, and a paused day opens an example with its message", async ({ page }) => {
  await page.route("**/api/plan", async (route) => {
    const { inputs } = route.request().postDataJSON() as { inputs: { store: { name: string }; offers: { text: string }[]; budgetUsd: number } };
    expect(inputs.store.name).toBe("18th Street Wireless");
    expect(inputs.budgetUsd).toBe(50);
    expect(inputs.offers.length).toBeGreaterThan(0);
    await route.fulfill({ json: { mode: "example", slug: SLUG, message: "Live plans are paused today. Here is an example store." } });
  });
  await page.goto(`/s/${SLUG}/new`);
  await page.getByRole("button", { name: "Plan my event" }).click();
  await expect(page).toHaveURL(new RegExp(`${EVENT}$`));
});

test("the judges' fold opens from a link, and never prints identity or genre tags", async ({ page }) => {
  await page.goto(`${EVENT}#compare`);
  await expect(page.locator("details#compare")).toHaveAttribute("open", "");
  await expect(page.getByText("lines cite Qloo")).toBeVisible();
  const made = page.locator("details#how-it-was-made");
  await made.locator(":scope > summary").click();
  await expect(made.getByRole("list", { name: "Agent steps" })).toBeVisible();
  const html = await page.content();
  for (const word of ["Gangsta Rap", "queer", "Drag Race", "drag queen", "christian"]) expect(html).not.toContain(word);
});

test("My stores lists every store's next event", async ({ page }) => {
  await page.goto("/stores");
  await expect(page.getByRole("heading", { level: 1, name: "My stores" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Stores" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Fictional stores. Not affiliated with or endorsed by T-Mobile.")).toBeVisible();
  await page.getByRole("tab", { name: "Past" }).click();
  await expect(page.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "New event" })).toHaveAttribute("href", "/start");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("the public event page shows the event and no internals", async ({ page }) => {
  await page.goto(`/e/ex-${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("$25/mo unlimited when you switch, taxes and fees included")).toBeVisible();
  await expect(page.getByRole("link", { name: /Get directions/ })).toBeVisible();
  await expect(page.getByText(/Why Qloo picked this|Endpoint/)).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`/api/plan/ex-${SLUG}/marketing/poster\\.png\\?size=og$`));
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("a new store needs its name and address before its block", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { level: 1, name: "Your store" })).toBeVisible();
  await page.getByRole("button", { name: "See my block" }).click();
  await expect(page.getByText("Enter the store's name.")).toBeVisible();
  await page.getByLabel("Name").fill("Corner Wireless");
  await expect(page.getByText("Enter the store's name.")).toHaveCount(0);
  await page.getByRole("button", { name: "See my block" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Find the store's address first.");
  // Never raw coordinates: the address is searched, or the browser's location is used.
  await expect(page.getByLabel(/latitude|longitude/i)).toHaveCount(0);
});

test("the judges' guide links to a receipt and the comparison", async ({ page }) => {
  await page.goto("/judges");
  await expect(page.getByRole("heading", { level: 1, name: "For judges" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open a receipt" })).toHaveAttribute("href", `${EVENT}#receipt-play`);
  await expect(page.getByRole("link", { name: "Open the comparison" })).toHaveAttribute("href", `${EVENT}#compare`);
  await page.getByRole("link", { name: "Open a receipt" }).click();
  await expect(page.getByRole("dialog", { name: /^Receipt:/ })).toBeVisible();
});
