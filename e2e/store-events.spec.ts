import { expect, test, type Page } from "@playwright/test";
import { andList, recordedNames } from "../lib/testing/recorded-names";

// The store-events floor against the recorded example stores (data/plans): the landing, the five
// steps (Community, Create, Event, Poster, Promote), a receipt, the judges' fold, My stores, the public
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
  await expect(page.getByRole("heading", { level: 1, name: /^The music they\s+love\./ })).toBeVisible();
  // His name closes the story band right after the hero.
  await expect(page.getByText("Khadim, sales floor, Metro by T-Mobile")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "See a real plan" }).click();
  await expect(page).toHaveURL(new RegExp(`${EVENT}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Fictional store. Not affiliated with or endorsed by T-Mobile.").first()).toBeVisible();
  for (const jump of ["Play", "Snacks", "Wheel", "Timeline"]) await expect(page.getByRole("navigation", { name: "Jump to" }).getByRole("link", { name: jump })).toBeVisible();

  const why = page.getByRole("button", { name: /Why Qloo picked this.*the playlist/ });
  await why.click();
  const receipt = page.getByRole("dialog", { name: /^Receipt:/ });
  await expect(receipt).toBeVisible();
  // The dialog (or the phone's sheet) has taken focus once it is ready for Escape.
  await expect(receipt.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(receipt).toBeHidden();
  await expect(why).toBeFocused();
  // The exact request sits one tap away, under the receipt's technical details.
  await why.click();
  await receipt.getByText("Technical details").click();
  await expect(receipt.getByText("Endpoint")).toBeVisible();
  await receipt.getByRole("button", { name: "Close" }).click();
  await expect(receipt).toBeHidden();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the five steps link forward and back", async ({ page }) => {
  await page.goto(`/s/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your community" })).toBeVisible();
  // The current step's name stays whole, even on a phone.
  const steps = page.getByRole("navigation", { name: "Steps" });
  const current = steps.locator('[aria-current="step"]');
  await expect(current).toContainText("Community");
  expect(await current.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // An example store's plan is complete: every other step is a link from step 1.
  for (const [name, href] of [
    ["Create", `/s/${SLUG}/new`],
    ["Event", EVENT],
    ["Poster", `${EVENT}/poster`],
    ["Promote", `${EVENT}/promote`],
  ] as const)
    await expect(steps.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
  await expect(page.getByRole("link", { name: "See this store's event" })).toHaveAttribute("href", EVENT);
  await expect(page.getByRole("list", { name: "Places in your community" }).getByRole("listitem")).toHaveCount(5);
  // Once loading ends, the map stays on the page, or says it didn't load (the tile host is offline in CI).
  await expect(page.getByText("Loading the map...").filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".maplibregl-canvas").or(page.getByText("The map didn't load. The list below has every place.")).first()).toBeVisible();
  await page.getByRole("button", { name: /^Food \d+$/ }).click();
  await expect(page.getByRole("button", { name: /^Food \d+$/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: /Create an event/ }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/new$`));
  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  const budget = page.getByLabel("Budget in dollars");
  await expect(budget).toHaveValue("50");
  await page.getByRole("button", { name: "Ten dollars more" }).click();
  await page.getByRole("button", { name: "Ten dollars more" }).click();
  await expect(budget).toHaveValue("70");
  await budget.fill("5");
  await budget.blur();
  await expect(budget).toHaveValue("10");
  await expect(page.getByRole("button", { name: "Ten dollars less" })).toBeDisabled();
  await expect(page.getByRole("navigation", { name: "Steps" }).getByRole("link", { name: /Community/ })).toHaveAttribute("href", `/s/${SLUG}`);

  await page.goto(`${EVENT}/poster`);
  await expect(page.getByRole("heading", { level: 1, name: "Poster" })).toBeVisible();
  // The poster shows as a sized WebP; the full PNG is only for Download.
  await expect(page.getByRole("img").first()).toHaveAttribute("src", /size=medium/);
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("href", /marketing\/poster\.png$/);
  await page.getByRole("radio", { name: "Wide 1.91:1" }).click();
  await expect(page.getByRole("img").first()).toHaveAttribute("src", /size=og/);
  await page.getByRole("link", { name: "Promote it" }).click();

  await expect(page).toHaveURL(new RegExp(`${EVENT}/promote$`));
  await expect(page.getByRole("heading", { level: 1, name: "Promote" })).toBeVisible();
  await expect(page.getByText("Nothing posts until you approve.")).toBeVisible();
  // Example stores always share in one tap (posting answers 403 for them).
  await expect(page.getByRole("button", { name: "Share the event" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Accounts" }).getByText("WhatsApp", { exact: true })).toBeVisible();
  // One timeline, one schedule: the announcement now, then a reminder at each time, each with its own words.
  const timeline = page.getByRole("group", { name: "Posts and when to share them" });
  for (const name of ["Now · Announce", "7 pm · Evening before", "9 am · Morning of", "11 am · An hour before"]) await expect(timeline.getByText(name)).toBeVisible();
  await expect(timeline.getByText("Tomorrow, 12 to 4 pm: our table is out front.")).toBeVisible();
  await timeline.getByRole("group", { name: "Channel for the evening-before reminder" }).getByRole("button", { name: "WhatsApp", exact: true }).click();
  await expect(timeline.getByRole("link", { name: /Send on WhatsApp: the evening-before reminder/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=Tomorrow/);
  await expect(timeline.getByText("Ready to share").first()).toBeVisible();
  // Remind me saves one calendar file with an alert at each post time.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Remind me at each post time" }).click();
  expect((await download).suggestedFilename()).toBe("post-reminders.ics");
  // An edit that empties a post is refused in plain words, and that post can't be copied.
  await timeline.getByRole("button", { name: "Edit the Facebook text of the morning-of reminder" }).click();
  await timeline.getByRole("textbox", { name: "Facebook text of the morning-of reminder" }).fill("");
  await expect(timeline.getByRole("alert")).toHaveText("A post can't be empty. Write something, or tap Reset.");
  await expect(timeline.getByRole("button", { name: "Copy the Facebook text of the morning-of reminder" })).toBeDisabled();
});

/** Records what the page copies, keeps share links from leaving the test, and (optionally) takes the share sheet away. */
async function watchSharing(page: Page, { noShareSheet = false } = {}) {
  await page.addInitScript((noSheet: boolean) => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void w.__copied.push(text) } });
    if (noSheet) Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
  }, noShareSheet);
  await page.context().route(/^https:\/\/(www\.facebook\.com|wa\.me)\//, (route) => route.fulfill({ body: "ok", contentType: "text/plain" }));
  return () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? null);
}

/** Taps a link that opens a new tab, and closes the tab. */
async function tapOut(page: Page, link: ReturnType<Page["getByRole"]>) {
  const popup = page.waitForEvent("popup");
  await link.click();
  await (await popup).close();
}

test("Promote sends exactly what each channel shows, edits included, and keeps edits through a reload", async ({ page }) => {
  const copied = await watchSharing(page);
  await page.goto(`${EVENT}/promote`);
  const post = page.getByRole("group", { name: "Posts and when to share them" }).getByRole("listitem").filter({ hasText: "Now · Announce" });
  // A channel's button, before and after it is used (", copied" or ", shared" is added to its name).
  const channel = (name: string) => post.getByRole("group", { name: "Channel for the announcement" }).getByRole("button", { name: new RegExp(`^${name}(, (copied|shared))?$`) });
  const shown = (name: string) => post.locator(`[data-post-text="${name}"]`).textContent();

  // Facebook: Copy and Share on Facebook both copy exactly the words shown.
  await expect(channel("Facebook")).toHaveAttribute("aria-pressed", "true");
  const facebook = await shown("facebook");
  expect(facebook).toMatch(/^Cold Saturday\?/);
  await post.getByRole("button", { name: "Copy the Facebook text of the announcement" }).click();
  expect(await copied()).toBe(facebook);
  await tapOut(page, post.getByRole("link", { name: /^Share on Facebook: the announcement/ }));
  expect(await copied()).toBe(facebook);
  await expect(post.getByText("Shared on Facebook")).toBeVisible();

  // Instagram: its own caption, hashtags included, is what Copy caption copies.
  await channel("Instagram").click();
  const instagram = await shown("instagram");
  expect(instagram).toMatch(/\n\n#Chicago /);
  expect(instagram).not.toBe(facebook);
  await post.getByRole("button", { name: "Copy caption: the Instagram text of the announcement" }).click();
  expect(await copied()).toBe(instagram);

  // WhatsApp: the message shown, event link included, is exactly the message WhatsApp opens with.
  await channel("WhatsApp").click();
  const whatsapp = await shown("whatsapp");
  expect(whatsapp).toMatch(/^Hi neighbor!/);
  expect(whatsapp!.endsWith(`/e/ex-${SLUG}`)).toBe(true);
  const href = await post.getByRole("link", { name: /^Send on WhatsApp: the announcement/ }).getAttribute("href");
  expect(new URL(href!).searchParams.get("text")).toBe(whatsapp);
  await post.getByRole("button", { name: "Copy the WhatsApp text of the announcement" }).click();
  expect(await copied()).toBe(whatsapp);

  // An edit changes that channel only, and what goes out is the edit.
  await channel("Instagram").click();
  await post.getByRole("button", { name: "Edit the Instagram text of the announcement" }).click();
  const box = post.getByRole("textbox", { name: "Instagram text of the announcement" });
  await box.fill("See it at www.example.com");
  await expect(post.getByRole("alert")).toContainText("is a link");
  await expect(post.getByRole("button", { name: /^Copy caption/ })).toBeDisabled();
  const edit = "Warm drinks at our table today.\n\n#Chicago";
  await box.fill(edit);
  await expect(post.getByRole("alert")).toHaveCount(0);
  await post.getByRole("button", { name: "Done editing the Instagram text of the announcement" }).click();
  expect(await shown("instagram")).toBe(edit);
  await post.getByRole("button", { name: /^Copy caption/ }).click();
  expect(await copied()).toBe(edit);
  await channel("Facebook").click();
  expect(await shown("facebook")).toBe(facebook);

  // A reload keeps the edit (in this tab only), and Reset brings the draft back.
  await page.reload();
  await channel("Instagram").click();
  expect(await shown("instagram")).toBe(edit);
  await post.getByRole("button", { name: "Reset the Instagram text of the announcement" }).click();
  expect(await shown("instagram")).toBe(instagram);
});

test("Share the event without a share sheet opens a menu, and marks only the channel used", async ({ page }) => {
  await watchSharing(page, { noShareSheet: true });
  await page.goto(`${EVENT}/promote`);
  const post = page.getByRole("group", { name: "Posts and when to share them" }).getByRole("listitem").filter({ hasText: "Now · Announce" });
  await expect(post.getByText("Ready to share")).toBeVisible();
  const share = page.getByRole("button", { name: "Share the event" }).filter({ visible: true });
  await share.click();
  await expect(share).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("group", { name: "Share the announcement on" }).filter({ visible: true });
  await expect(menu.getByRole("button", { name: "Copy link" })).toBeVisible();
  // Nothing is marked until a channel is picked.
  await expect(post.getByText("Ready to share")).toBeVisible();
  const whatsapp = menu.getByRole("link", { name: /^WhatsApp/ });
  const href = await whatsapp.getAttribute("href");
  await tapOut(page, whatsapp);
  await expect(menu).toHaveCount(0);
  await expect(post.getByText("Shared on WhatsApp")).toBeVisible();
  // The announcement now shows its WhatsApp words: exactly the message that opened.
  await expect(post.getByRole("group", { name: "Channel for the announcement" }).getByRole("button", { name: /^WhatsApp/ })).toHaveAttribute("aria-pressed", "true");
  expect(new URL(href!).searchParams.get("text")).toBe(await post.locator('[data-post-text="whatsapp"]').textContent());
});

test("every listed place has a pin with the same number once the map loads, and a pin picks its row", async ({ page }) => {
  await page.goto(`/s/${SLUG}`);
  await expect(page.getByText("Loading the map...").filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });
  test.skip(await page.getByText("The map didn't load. The list below has every place.").first().isVisible(), "The map's tile host is offline");
  await page.getByRole("button", { name: /^See all \d+$/ }).click();
  const list = page.getByRole("list", { name: "Places in your community" });
  const listed = (await list.locator('[aria-label^="Pin "]').allTextContents()).map(Number).sort((a, b) => a - b);
  expect(listed.length).toBeGreaterThan(5);
  await expect(page.locator("[data-pin]")).toHaveCount(listed.length);
  const pinned = (await page.locator("[data-pin]").evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.pin)))).sort((a, b) => a - b);
  expect(pinned).toEqual(listed);
  await page.locator('[data-pin="3"]').click();
  await expect(page.locator('[data-pin="3"]')).toHaveAttribute("data-picked", "true");
  await expect(page.locator('[data-callout="3"]')).toBeVisible();
  await expect(list.getByRole("button", { pressed: true })).toHaveCount(1);
});

test("a filled form starts a plan, and a paused day opens an example that says so", async ({ page }) => {
  await page.route("**/api/plan", async (route) => {
    const { inputs } = route.request().postDataJSON() as { inputs: { store: { name: string }; offers: { text: string }[]; budgetUsd: number } };
    expect(inputs.store.name).toBe("18th Street Wireless");
    expect(inputs.budgetUsd).toBe(50);
    expect(inputs.offers.length).toBeGreaterThan(0);
    await route.fulfill({ json: { mode: "example", slug: SLUG, message: "Live plans are paused today. Here is an example store." } });
  });
  await page.goto(`/s/${SLUG}/new`);
  await page.getByRole("button", { name: "Plan my event" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${EVENT}$`));
  const note = page.getByRole("status").filter({ hasText: "Live plans are paused today." });
  await expect(note).toBeVisible();
  await expect(note.getByRole("link", { name: "Back to your store" })).toHaveAttribute("href", `/s/${SLUG}`);
  await note.getByRole("button", { name: "Dismiss this note" }).click();
  await expect(note).toHaveCount(0);
});

test("the judges' fold opens from a link, and never prints identity or genre tags", async ({ page }) => {
  await page.goto(`${EVENT}#compare`);
  await expect(page.locator("details#compare")).toHaveAttribute("open", "");
  const compare = page.locator("details#compare");
  await expect(compare.getByText("Stoop plan lines with a Qloo receipt")).toBeVisible();
  // The landing's own rows: what the generic plan picked, by name, and the landing's wording for Qloo's check.
  const generic = andList(recordedNames("chicago-18th-street").genericArtists);
  await expect(compare.getByText(`${generic}: famous, but none of the 3 make Qloo's own top 20`, { exact: false }).first()).toBeVisible();
  await expect(compare.getByText("Cinnamon sugar pastries from “a nearby bakery”")).toBeVisible();
  await expect(compare.getByText(/median/)).toHaveCount(0);
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
  await expect(page.getByRole("link", { name: "New event for 18th Street Wireless" })).toHaveAttribute("href", `/s/${SLUG}/new`);
  await page.getByRole("tab", { name: "Upcoming" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await expect(page.getByText(/Log how an event went/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add a store" })).toHaveAttribute("href", "/start");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("the public event page shows the event and what is at the table, and no internals", async ({ page }) => {
  await page.goto(`/e/ex-${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("$25/mo unlimited when you switch, taxes and fees included").first()).toBeVisible();
  const table = page.getByRole("region", { name: "At the table" });
  await expect(table.getByText(/^Snacks and drinks from /)).toBeVisible();
  await expect(table.getByText(/Spin the prize wheel/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Get directions/ })).toBeVisible();
  await expect(page.getByText(/Why Qloo picked this|Endpoint/)).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`/api/plan/ex-${SLUG}/marketing/poster\\.png\\?size=og$`));
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("a new store needs its name, a picked address and a real phone number before its community", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { level: 1, name: "Your store" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveAttribute("placeholder", /^e\.g\. /);
  const go = page.getByRole("button", { name: "See my community" }).first();
  await go.click();
  await expect(page.getByText("Enter the store's name.")).toBeVisible();
  await page.getByLabel("Name").fill("Corner Wireless");
  await expect(page.getByText("Enter the store's name.")).toHaveCount(0);
  await page.getByLabel("Phone").fill("call me maybe");
  await go.click();
  await expect(page.getByText(/Use digits only/)).toBeVisible();
  await page.getByLabel("Phone").fill("(312) 555-0142");
  await expect(page.getByText(/Use digits only/)).toHaveCount(0);
  await go.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Find the store's address first.");
  // Never raw coordinates: the address is searched, or the browser's location is used.
  await expect(page.getByLabel(/latitude|longitude/i)).toHaveCount(0);
});

test("a new store round-trips through a stand-in example: Back, the way back and a reload all find the store and the form ready", async ({ page }) => {
  const errors = watchErrors(page);
  // Live maps and plans are off: the block and the plan answer with the nearest example (Atlanta).
  await page.route("**/api/geocode?**", (route) =>
    route.fulfill({ json: { hits: [{ address: "1100 Ponce de Leon Ave NE", city: "Atlanta", region: "GA", lat: 33.7745, lon: -84.3533, label: "1100 Ponce de Leon Ave NE, Atlanta, GA" }] } }),
  );
  await page.route("**/api/plan/block", (route) => route.fulfill({ json: { mode: "example", slug: "atlanta-west-end", message: "Live maps are off right now. Here's an example community to look around." } }));
  await page.route("**/api/plan", (route) => route.fulfill({ json: { mode: "example", slug: "atlanta-west-end", message: "Live plans are off right now. Here is a full example plan instead." } }));
  const promo = "Free phone when you switch (select models)";
  const plan = page.getByRole("button", { name: "Plan my event" }).first();
  const steps = page.getByRole("navigation", { name: "Steps" }).filter({ visible: true });

  await page.goto("/start");
  await page.getByLabel("Name").fill("Corner Wireless");
  await page.getByLabel("Street address, city and state").fill("1100 Ponce de Leon Ave NE, Atlanta, GA");
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("list", { name: "Matches" }).getByRole("button").first().click();
  // The picked address shows (with Change) before the next tap, so a slow runner never taps too early.
  await expect(page.getByRole("button", { name: "Change" })).toBeVisible();
  // Typed again once the page is interactive: on a slow runner the first fill can land before hydration and be reset.
  await page.getByLabel("Name").fill("Corner Wireless");
  await page.getByRole("button", { name: "See my community" }).first().click();

  // The Community step with live maps off: the store's own spot, the note once, the nearest example.
  await expect(page.getByRole("heading", { level: 1, name: "Your community" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("group", { name: /^Map of where Corner Wireless is/ })).toBeVisible();
  await expect(page.getByText("Live maps are off right now.")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /See West End Wireless's community/ })).toHaveAttribute("href", "/s/atlanta-west-end");
  await steps.getByRole("button", { name: /Create/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  await page.getByRole("textbox", { name: "Promo 1" }).fill(promo);
  await plan.click();

  // The stand-in says whose plan it is, and that the steps above are the example store's.
  await expect(page).toHaveURL(/\/plan\/ex-atlanta-west-end$/);
  const note = page.getByRole("status").filter({ hasText: "Live plans are off right now." });
  await expect(note).toContainText("It was not planned for Corner Wireless.");
  await expect(note).toContainText("The steps above (Community, Create, Poster and Promote) open West End Wireless's pages.");
  await note.getByRole("link", { name: "Back to your store" }).click();

  // The way back finds the form as it was, ready to send again.
  await expect(page).toHaveURL(/\/start\?resume=1$/);
  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Promo 1" })).toHaveValue(promo);
  await expect(plan).toBeEnabled();
  await expect(plan).toHaveText("Plan my event");

  // Again, then dismiss the note: a quiet bar keeps the way back on every page of the example store.
  await plan.click();
  await expect(page).toHaveURL(/\/plan\/ex-atlanta-west-end$/);
  await page.getByRole("button", { name: "Dismiss this note" }).click();
  // A phone keeps a bar over the page; from 1024 px the way back sits in the sticky header.
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  const back = wide ? page.getByRole("banner").getByRole("link", { name: /Back to your store/ }) : page.getByRole("region", { name: "Example store" }).getByRole("link", { name: "Back to your store" });
  if (wide) await expect(back).toHaveAttribute("title", "West End Wireless is an example store. Your store: Corner Wireless.");
  else await expect(page.getByRole("region", { name: "Example store" })).toContainText("West End Wireless is an example store. Your store: Corner Wireless.");
  await steps.getByRole("link", { name: /Community/ }).click();
  await expect(page).toHaveURL(/\/s\/atlanta-west-end$/);
  await expect(back).toHaveAttribute("href", "/start?resume=1");

  // The browser's Back, twice: the form is ready, never stuck on "Planning...".
  await page.goBack();
  await expect(page).toHaveURL(/\/plan\/ex-atlanta-west-end$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/start\?resume=1$/);
  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  await expect(plan).toBeEnabled();
  await expect(plan).toHaveText("Plan my event");

  // A reload keeps the store and the draft.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Corner Wireless").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Promo 1" })).toHaveValue(promo);
  await expect(plan).toBeEnabled();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("stoop:start") ?? "null") as { name: string; place: { city: string } | null });
  expect(saved).toMatchObject({ name: "Corner Wireless", place: { city: "Atlanta" } });

  // The done Community step opens in place, without asking again.
  await steps.getByRole("button", { name: /Community/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your community" })).toBeVisible();
  await expect(page.getByRole("link", { name: /See West End Wireless's community/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("an example store's form starts from what its plan was recorded with, the day included", async ({ page }) => {
  let sent: { date: string; budgetUsd: number; setting: string; location?: { name: string } } | null = null;
  await page.route("**/api/plan", async (route) => {
    sent = (route.request().postDataJSON() as { inputs: NonNullable<typeof sent> }).inputs;
    await route.fulfill({ json: { mode: "example", slug: "houston-east-end", message: "Live plans are off right now. Here is a full example plan instead." } });
  });
  await page.goto("/s/houston-east-end/new");
  // Recorded Nov 21; while that day is ahead the form shows it, else the next Saturday.
  const recordedAhead = await page.evaluate(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    d.setDate(d.getDate() + 28);
    const last = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return "2026-11-21" >= today && "2026-11-21" <= last;
  });
  if (recordedAhead) await expect(page.getByRole("button", { name: /^Day/ })).toContainText("Sat, Nov 21");
  await expect(page.getByLabel("Budget in dollars")).toHaveValue("50");
  await expect(page.getByRole("button", { name: /^Setup/ })).toContainText("A fall community fair on Navigation Blvd");
  await page.getByRole("button", { name: "Plan my event" }).first().click();
  await expect(page).toHaveURL(/\/plan\/ex-houston-east-end$/);
  expect(sent).toMatchObject({ budgetUsd: 50, setting: "community_event", location: { name: "a fall community fair on Navigation Blvd" } });
  if (recordedAhead) expect(sent!.date).toBe("2026-11-21");
});

test("the judges' guide links to a receipt and the comparison", async ({ page }) => {
  await page.goto("/judges");
  await expect(page.getByRole("heading", { level: 1, name: "For judges" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open a receipt" })).toHaveAttribute("href", `${EVENT}#receipt-play`);
  await expect(page.getByRole("link", { name: "Open the comparison" })).toHaveAttribute("href", `${EVENT}#compare`);
  await page.getByRole("link", { name: "Open a receipt" }).click();
  await expect(page.getByRole("dialog", { name: /^Receipt:/ })).toBeVisible();
});
