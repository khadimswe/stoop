import { expect, test, type Page } from "@playwright/test";
import { askAges } from "../lib/plan/ages";
import { createQlooClient } from "../lib/qloo/client";
import { FixtureCache, findFixture, readFixtureFile, recorded } from "../lib/qloo/fixtures";

// "Who loves these spots" on an example store's Community step. The route is mocked: when it fails
// or answers empty, the page is exactly as before (no card, no error); with an answer, the card
// shows. The answer is built from a recorded Qloo demographics response (fixtures/), never by hand.

const SLUG = "chicago-18th-street";
const ROUTE = `**/api/plan/ex-${SLUG}/ages`;
const SHOTS = process.env.AGES_SHOTS_DIR;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/instant-shell-url-data|encountered URL data|openfreemap|maplibre|Failed to load resource/i.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function recordedAnswer() {
  const file = findFixture("kids-probe-2");
  if (!file) return null;
  const fixture = readFixtureFile(file);
  const ids = String(recorded(fixture, "demographics-kids-titles").params["signal.interests.entities"]).split(",");
  return askAges(createQlooClient({ cache: new FixtureCache([fixture], { strict: true }) }), ids, { runId: "ages_e2e" });
}

async function communityLoaded(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Your community" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Places in your community" }).getByRole("listitem")).toHaveCount(5);
}

for (const [name, reply] of [
  ["a 500", { status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "failed", message: "Something went wrong." } }) }],
  ["an empty body", { status: 200, contentType: "application/json", body: "" }],
  ["a 204", { status: 204, body: "" }],
] as const) {
  test(`the Community step is unchanged when the ages route answers ${name}`, async ({ page }) => {
    const errors = watchErrors(page);
    let asked = false;
    await page.route(ROUTE, (route) => {
      asked = true;
      return route.fulfill(reply);
    });
    await page.goto(`/s/${SLUG}`);
    await communityLoaded(page);
    await expect.poll(() => asked).toBe(true);
    await expect(page.getByRole("heading", { name: "Who loves these spots" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("the Community step shows who loves these spots, with its receipt", async ({ page }, info) => {
  const answer = await recordedAnswer();
  test.skip(!answer, "needs the recorded Qloo fixtures");
  const errors = watchErrors(page);
  await page.route(ROUTE, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }));
  await page.goto(`/s/${SLUG}`);
  await communityLoaded(page);
  const card = page.locator("#who-loves-these-spots");
  await expect(card.getByRole("heading", { name: "Who loves these spots" })).toBeVisible();
  await expect(card).toContainText(`People who love the spots near your store skew ${answer!.top} (Qloo)`);
  const bands = card.getByRole("list", { name: /Age skew by adult band/ }).getByRole("listitem");
  await expect(bands).toHaveCount(answer!.bands.length);
  await expect(bands.first()).toContainText("18 to 24");
  await expect(card).not.toContainText("%");
  await expect(card).not.toContainText(/younger|customers/i);
  if (SHOTS) {
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/community-ages-${info.project.name}.png`, fullPage: true });
  }
  await card.getByRole("button", { name: /Why Qloo picked this/ }).click();
  const receipt = page.getByRole("dialog");
  await expect(receipt).toContainText("Who loves these spots");
  await expect(receipt).toContainText("urn:demographics");
  expect(errors).toEqual([]);
});

test("the card at 1440 and 390", async ({ page }) => {
  test.skip(!SHOTS, "screenshots only on request (AGES_SHOTS_DIR)");
  const answer = await recordedAnswer();
  test.skip(!answer, "needs the recorded Qloo fixtures");
  await page.route(ROUTE, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto(`/s/${SLUG}`);
    const card = page.locator("#who-loves-these-spots");
    await expect(card.getByRole("heading", { name: "Who loves these spots" })).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/community-ages-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});
