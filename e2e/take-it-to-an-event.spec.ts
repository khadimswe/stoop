import { expect, test, type Page } from "@playwright/test";

// "Take it to an event": "Plan it here" on a community place opens the Create step set to that place,
// and a plan away from the store gets "Get the OK" drafts on its Event step (owner and examples only).

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

test("Plan it here on a community park opens the Create step set to that place", async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  let sent: { setting: string; location?: { name: string; point: { lat: number; lon: number } } } | null = null;
  await page.route("**/api/plan", async (route) => {
    sent = (route.request().postDataJSON() as { inputs: NonNullable<typeof sent> }).inputs;
    await route.fulfill({ json: { mode: "example", slug: "chicago-18th-street", message: "Live plans are off right now. Here is a full example plan instead." } });
  });
  await page.goto("/s/chicago-18th-street");
  await expect(page.getByRole("heading", { level: 1, name: "Your community" })).toBeVisible();
  await page.getByRole("button", { name: /^Parks \d+$/ }).click();
  await expect(page.getByText("Plan at your door, or take the table to one of these.")).toBeVisible();
  const list = page.getByRole("list", { name: "Places in your community" });
  // Food spots never offer it; parks and venues do.
  await page.getByRole("button", { name: /^Food \d+$/ }).click();
  await expect(list.getByRole("link", { name: /^Plan it here/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Parks \d+$/ }).click();
  const plan = list.getByRole("link", { name: /^Plan it here/ }).first();
  const name = ((await plan.textContent()) ?? "").replace(/^Plan it here:\s*/, "").trim();
  expect(name.length).toBeGreaterThan(0);
  await expect(plan).toHaveAttribute("href", /^\/s\/chicago-18th-street\/new\?at=/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await plan.click();

  await expect(page).toHaveURL(/\/s\/chicago-18th-street\/new\?at=/);
  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  const where = page.getByRole("listitem").filter({ hasText: /^Where/ }).first();
  await expect(where).toContainText(name);
  await expect(page.getByRole("button", { name: /^Setup/ })).toContainText(`A fair or community event: ${name}`);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Plan my event" }).first().click();
  await expect(page).toHaveURL(/\/plan\/ex-chicago-18th-street$/);
  expect(sent).toMatchObject({ setting: "community_event", location: { name } });
  expect(sent!.location!.point.lat).toBeCloseTo(41.85, 0);

  // "Plan at your door" puts the table back at the store.
  await page.goto("/s/chicago-18th-street/new?at=not-a-place");
  await expect(page.getByRole("heading", { level: 1, name: "New event" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Setup/ })).toContainText("Sidewalk table");
  await expect(page.getByRole("button", { name: "Plan at your door" })).toHaveCount(0);
  await page.goto("/s/houston-east-end/new");
  await page.getByRole("button", { name: "Plan at your door" }).click();
  await expect(page.getByRole("button", { name: /^Setup/ })).toContainText("Sidewalk table");
  expect(errors).toEqual([]);
});

test("the Houston example's Event step has Get the OK drafts; a plan at the store and the public page do not", async ({ page }) => {
  // Three pages, each compiled on first visit in dev.
  test.slow();
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void w.__copied.push(text) } });
  });
  await page.goto("/plan/ex-houston-east-end");
  const card = page.locator("#get-the-ok");
  await expect(card.getByRole("heading", { name: "Get the OK" })).toBeVisible();
  const drafts = card.getByRole("list", { name: "Drafts to send" });
  await expect(drafts.getByText("To your district manager", { exact: true })).toBeVisible();
  await expect(drafts.getByText("To the organizer", { exact: true })).toBeVisible();

  const managerEmail = drafts.getByRole("link", { name: "Email the draft to your district manager" });
  const href = (await managerEmail.getAttribute("href")) ?? "";
  expect(href.startsWith("mailto:?subject=")).toBe(true);
  const mail = new URL(href);
  expect(mail.searchParams.get("subject")).toBe("Table request: A fall community fair on Navigation Blvd, Sat, Nov 21");
  const body = mail.searchParams.get("body") ?? "";
  expect(body).toContain("Cost: about $50 of a $50 budget");
  expect(body).toContain("/e/ex-houston-east-end");
  expect(body).toMatch(/Need your OK (by Saturday, Nov 14|as soon as you can)\./);

  const organizer = new URL((await drafts.getByRole("link", { name: "Email the draft to the organizer" }).getAttribute("href")) ?? "");
  expect(organizer.searchParams.get("body")).toContain("Is there a vendor fee?");
  expect(organizer.searchParams.get("body")).not.toMatch(/\$\s?\d/);

  await drafts.getByRole("button", { name: "Copy the draft to the organizer" }).click();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? "");
  expect(copied).toContain("May we have a small table at a fall community fair on Navigation Blvd");
  await drafts.getByText("Read the draft", { exact: false }).first().click();
  await expect(drafts.getByText("Need your OK", { exact: false })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // A table at the store needs no OK, and the public event page never shows the drafts.
  await page.goto("/plan/ex-chicago-18th-street");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get the OK" })).toHaveCount(0);
  await page.goto("/e/ex-houston-east-end");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Get the OK")).toHaveCount(0);
  await expect(page.getByText("district manager")).toHaveCount(0);
  expect(errors).toEqual([]);
});
