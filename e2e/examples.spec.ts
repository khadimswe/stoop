import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// The lead example report, top half: header, Reality Check, Your ad, Output, Screening Room and the
// judge banner. Every test answers the render routes itself (GET /api/render/access per world, POST
// /api/render, GET /api/render/[jobId]), so nothing reaches fal or spends a cap. Draft videos come from
// a public Blob host, which the site's CSP allows for media, and every test fails on any console error,
// a CSP violation included.

const URL = "/examples/food-hot-sauce";
const REPORT = "example-food-hot-sauce";
const TOP = "seg-55-and-older";
const SECOND = "seg-35-to-44";
// No example clip is approved yet, so the at-cap line names only what is really there.
const BUDGET_USED = "Render budget used. Here's the storyboard.";
const PASS_SPENT = "Judge pass active. Its draft renders are used.";
const DRAFT = readFileSync(new globalThis.URL("./fixtures/draft.webm", import.meta.url));
const VIDEO_URL = (n: number) => `https://stoop-e2e.public.blob.vercel-storage.com/drafts/draft-${n}.webm`;
// The top world's label (Qloo-measured genres) and its first music source (an artist Qloo returned),
// read from the recorded report, so no Qloo data is written here.
const { TOP_LABEL, TOP_ARTIST } = (() => {
  const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as {
    worlds: { segmentId: string; label: string; culture: { field: string; sources: { kind: string; name: string }[] }[] | null }[];
  };
  const world = report.worlds.find((w) => w.segmentId === TOP);
  const source = world?.culture?.find((f) => f.field === "music")?.sources.find((s) => s.kind === "entity");
  if (!world || !source) throw new Error("The recorded lead report has no music artist in its top world.");
  return { TOP_LABEL: world.label, TOP_ARTIST: source.name };
})();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Access = { video: "judge" | "byok" | "budget-used" | "off"; rendersLeft: number | null; byok: boolean };
const ACCESS: Record<Access["video"], Access> = {
  judge: { video: "judge", rendersLeft: 3, byok: true },
  byok: { video: "byok", rendersLeft: null, byok: true },
  "budget-used": { video: "budget-used", rendersLeft: 0, byok: false },
  off: { video: "off", rendersLeft: null, byok: false },
};

/** Console errors and CSP violations of the current test's page; checked after every test. */
let errors: string[] = [];

/** Answers the access route (per world when given a function) and records console errors and CSP violations. */
async function setup(page: Page, access: Access | ((segment: string) => Access) = ACCESS.off) {
  errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("__cspViolation", (text: string) => errors.push(`CSP: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __cspViolation: (text: string) => void }).__cspViolation(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.route("**/api/render/access?*", (route) => {
    const segment = new globalThis.URL(route.request().url()).searchParams.get("segment") ?? "";
    return route.fulfill({ json: typeof access === "function" ? access(segment) : access });
  });
  return errors;
}

/** Chromium logs a non-2xx fetch as "Failed to load resource"; a test that answers one on purpose allows exactly that status. */
function allowStatus(status: number) {
  errors = errors.filter((e) => !e.startsWith(`Failed to load resource: the server responded with a status of ${status} `));
}

test.afterEach(() => {
  expect(errors).toEqual([]);
  errors = [];
});

async function judgeHint(context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([{ name: "stoop_judge_ui", value: "1", url: baseURL ?? "http://localhost:3000" }]);
}

const output = (page: Page, key: string) => page.locator(`[data-output="${key}"]`);

test.describe("the lead example report", () => {
  test("opens on the Reality Check, then Your ad, Output and the Screening Room, with no overflow", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    const order = await page.locator("[data-report-section]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-report-section")));
    expect(order.slice(0, 4)).toEqual(["reality", "your-ad", "output", "screening"]);

    // Beat 1 is above the fold, on phones too: the measured line starts inside the first screen.
    const measured = page.getByText(/^Qloo measured a taste neighborhood that skews 55 and older/);
    await expect(measured).toBeVisible();
    const box = await measured.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y).toBeLessThan(viewport.height);
    await expect(page.getByText("You said 25 to 40.")).toBeVisible();
    await expect(page.getByText("A generic AI brief assumed 25 to 44, in Austin and Portland.")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("the judge path: the music-style cue opens its receipt, which closes back to the chip", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    const chip = page.locator("#your-ad").getByRole("button", { name: /Music style/ });
    await chip.click();
    const drawer = page.getByRole("dialog", { name: "Receipt: Music style" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("/v2/insights").first()).toBeVisible();
    await expect(drawer.getByText(new RegExp(`^${escapeRegExp(TOP_ARTIST)} \\(artist\\): #\\d+ in its Qloo response, beats \\d+ of \\d+ reference artists$`))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test("Your ad copies the prompt and the script", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only here");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await setup(page);
    await page.goto(URL);
    const ad = page.locator("#your-ad");
    await expect(ad.getByText("“It takes a moment to find you.”").first()).toBeVisible();
    await ad.getByRole("button", { name: "Copy prompt" }).click();
    await expect(ad.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^GLOBAL STYLE/);
    await ad.getByRole("button", { name: "Copy script" }).click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).length).toBeGreaterThan(40);
  });
});

test.describe("the Output section", () => {
  test("shows one line each, in order, for every world and the Control", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    for (const key of [TOP, SECOND, "control"]) {
      const card = output(page, key);
      await expect(card.locator("dt")).toHaveText(["Storyboard", "Video", "Export", "In your Claude"]);
      await expect(card.getByRole("link", { name: "Use Stoop inside your Claude" })).toHaveAttribute("href", "/mcp");
      await expect(card.getByRole("button", { name: "Copy Higgsfield prompt" })).toBeVisible();
      await expect(card.getByText(/^Shot list: \d shots$/)).toBeVisible();
      // Collapsed: the full board, the scene prompts and the pack wait behind their buttons.
      for (const name of [/^Full board, /, /scene prompts \(\d\), /, /^Production Pack, /]) {
        await expect(card.getByRole("button", { name })).toHaveAttribute("aria-expanded", "false");
      }
      await expect(card.getByRole("button", { name: "Copy scene 1" })).toBeHidden();
    }
    await expect(output(page, "control").getByText("LLM-only brief · not from Qloo")).toBeVisible();
    await expect(page.getByText("Clip coming")).toHaveCount(0);
  });

  test("each expander opens today's full content in place and keeps focus on its button", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    const top = output(page, TOP);
    // The full board: the shot list is the concept preview, never a "clip coming" tile, and it lists every shot (5 here).
    const board = top.getByRole("button", { name: `Full board, ${TOP_LABEL}` });
    await board.click();
    await expect(board).toHaveAttribute("aria-expanded", "true");
    await expect(board).toBeFocused();
    const shotList = top.getByRole("region", { name: `Shot list, ${TOP_LABEL}`, exact: true });
    await expect(shotList).toBeVisible();
    await expect(shotList.getByRole("listitem").filter({ hasText: /^Shot \d · / })).toHaveCount(5);
    // The per-scene prompts, by keyboard.
    const scenes = top.getByRole("button", { name: new RegExp(`scene prompts \\(5\\), ${escapeRegExp(TOP_LABEL)}$`) });
    await scenes.focus();
    await page.keyboard.press("Enter");
    await expect(scenes).toHaveAttribute("aria-expanded", "true");
    await expect(top.getByRole("button", { name: "Copy scene 1" })).toBeVisible();
    // The rest of the Production Pack.
    await top.getByRole("button", { name: `Production Pack, ${TOP_LABEL}` }).click();
    await expect(top.getByRole("button", { name: "Copy product_sheet.png" })).toBeVisible();
    await expect(top.getByRole("button", { name: "Copy Director's Guide" })).toBeVisible();
    await expect(top.getByText("AI disclosure:")).toBeVisible();
    // And they close again.
    await board.click();
    await expect(shotList).toBeHidden();
  });

  test("puts the Screening Room within a short scroll of the Reality Check", async ({ page }) => {
    await setup(page);
    // Desktop is measured on a 1440 x 900 screen; phones at their own size.
    const desktop = page.viewportSize()!.width >= 1024;
    if (desktop) await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    const viewport = page.viewportSize()!;
    const realityBottom = await page.locator("#reality").evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
    const screeningTop = await page.locator("#screening").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const screens = (screeningTop - realityBottom) / viewport.height;
    // About 1.5 screens on desktop and 3 on a phone, counted from the end of the Reality Check.
    expect(screens).toBeLessThan(desktop ? 1.55 : 3.05);
  });

  test("off: no render control, a quiet line pointing to the prompts", async ({ page }) => {
    await setup(page, ACCESS.off);
    await page.goto(URL);
    const video = output(page, TOP).locator("dd").nth(1);
    await expect(video).toHaveText(/Stoop is the brain, you bring your own camera\./);
    await expect(video.getByRole("button")).toHaveCount(0);
    await expect(video.getByRole("link")).toHaveCount(0);
  });

  test("a failing access answer reads as off, quietly", async ({ page }) => {
    await setup(page);
    // Registered last, so it answers first: a page that is not the access JSON.
    await page.route("**/api/render/access?*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html>oops</html>" }));
    await page.goto(URL);
    await expect(output(page, TOP).locator("dd").nth(1)).toHaveText(/Stoop is the brain/);
  });

  test("byok: a plain link to /byok in a new tab, with this report and world", async ({ page }) => {
    await setup(page, ACCESS.byok);
    await page.goto(URL);
    for (const key of [TOP, "control"]) {
      const link = output(page, key).getByRole("link", { name: /Render with your fal key/ });
      await expect(link).toHaveAttribute("href", `/byok?reportId=${REPORT}&segment=${key}`);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener");
    }
  });

  test("budget used: says so plainly, naming only what is there", async ({ page }) => {
    await setup(page, ACCESS["budget-used"]);
    await page.goto(URL);
    await expect(output(page, TOP).getByText(BUDGET_USED, { exact: true })).toBeVisible();
    await expect(page.getByText(/example clip/)).toHaveCount(0);
    await expect(output(page, TOP).getByRole("button", { name: "Render draft video" })).toHaveCount(0);
  });

  test("an ended pass: the start answers off, and the refreshed line offers BYOK", async ({ page }) => {
    let asks = 0;
    // The first answer still says judge; once the start is refused, the access route says byok.
    await setup(page, (segment) => (segment === TOP && asks++ > 0 ? ACCESS.byok : ACCESS.judge));
    await page.route("**/api/render", (route) => route.fulfill({ status: 403, json: { error: { code: "off", message: "Drafts paid by Stoop need a judge pass." } } }));
    await page.goto(URL);
    const card = output(page, TOP);
    await card.getByRole("button", { name: "Render draft video" }).click();
    await expect(card.getByRole("link", { name: /Render with your fal key/ })).toBeVisible();
    await expect(card.getByRole("button", { name: "Render draft video" })).toHaveCount(0);
    allowStatus(403);
  });

  test("busy: says when to try again and offers no retry", async ({ page }) => {
    await setup(page, ACCESS.judge);
    const message = "An earlier try at this exact draft may still be rendering on fal. It can be tried again in about two hours.";
    await page.route("**/api/render", (route) => route.fulfill({ status: 409, json: { error: { code: "busy", message } } }));
    await page.goto(URL);
    const card = output(page, TOP);
    await card.getByRole("button", { name: "Render draft video" }).click();
    await expect(card.getByText(message)).toBeVisible();
    await expect(card.getByRole("button", { name: "Try the draft again" })).toHaveCount(0);
    allowStatus(409);
  });

  test("judge: renders a draft, polls it and plays it labeled as an AI-generated draft", async ({ page }) => {
    await setup(page, ACCESS.judge);
    let polls = 0;
    await page.route("**/api/render", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ target: { reportId: REPORT, segment: TOP } });
      await route.fulfill({ status: 202, json: { job: { id: "rj_0123456789abcdef01234567", target: { reportId: REPORT, segment: TOP }, status: "queued", videoUrl: null, reason: null, cached: false } } });
    });
    await page.route("**/api/render/rj_*", (route) => {
      polls += 1;
      const done = polls > 1;
      return route.fulfill({
        json: { job: { id: "rj_0123456789abcdef01234567", target: { reportId: REPORT, segment: TOP }, status: done ? "done" : "rendering", videoUrl: done ? VIDEO_URL(1) : null, reason: null, cached: false } },
      });
    });
    await page.route("https://stoop-e2e.public.blob.vercel-storage.com/**", (route) => route.fulfill({ body: DRAFT, contentType: "video/webm" }));
    await page.goto(URL);
    const card = output(page, TOP);
    await expect(card.getByText("3 drafts left on your judge pass", { exact: false })).toBeVisible();
    await card.getByRole("button", { name: "Render draft video" }).click();
    await expect(card.getByRole("status").filter({ hasText: "Rendering a 15 s draft" })).toBeVisible();
    await expect(card.getByText("AI-generated draft", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/AI-generated draft, 480p/)).toBeVisible();
    await expect(card.locator("video")).toHaveAttribute("src", VIDEO_URL(1));
    await expect(card.locator("video")).toHaveAttribute("preload", "none");
  });

  test("one clip plays at a time", async ({ page }) => {
    await setup(page, ACCESS.judge);
    await page.route("**/api/render", async (route) => {
      const { target } = route.request().postDataJSON();
      const id = target.segment === TOP ? "rj_000000000000000000000001" : "rj_000000000000000000000002";
      const n = target.segment === TOP ? 1 : 2;
      await route.fulfill({ json: { job: { id, target, status: "done", videoUrl: VIDEO_URL(n), reason: null, cached: true } } });
    });
    await page.route("https://stoop-e2e.public.blob.vercel-storage.com/**", (route) => route.fulfill({ body: DRAFT, contentType: "video/webm" }));
    await page.goto(URL);
    await output(page, TOP).getByRole("button", { name: "Render draft video" }).click();
    await output(page, SECOND).getByRole("button", { name: "Render draft video" }).click();
    const first = output(page, TOP).locator("video");
    const second = output(page, SECOND).locator("video");
    await output(page, TOP).getByRole("button", { name: "Tap to play AI-generated draft" }).click();
    await expect.poll(() => first.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await output(page, SECOND).getByRole("button", { name: "Tap to play AI-generated draft" }).click();
    await expect.poll(() => second.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await expect.poll(() => first.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  });
});

test.describe("the Screening Room", () => {
  test("pins the Control once, then one row per world, each with a concept preview", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    const room = page.locator("#screening");
    await expect(room.getByRole("heading", { name: "Control · shown once" })).toBeVisible();
    await expect(room.getByRole("heading", { level: 3, name: TOP_LABEL })).toBeVisible();
    await expect(room.getByText("Concept preview", { exact: false })).toHaveCount(3);
    await expect(room.getByRole("button", { name: /^skews \+0\.21/ })).toBeVisible();
  });

  test("the theater opens with why this ad, copies the prompt that made it, and closes back to its trigger", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    const trigger = page.getByRole("button", { name: `Open ${TOP_LABEL}: why this ad` });
    await trigger.click();
    const theater = page.getByRole("dialog", { name: TOP_LABEL });
    await expect(theater).toBeVisible();
    await expect(theater.getByText("Why this ad")).toBeVisible();
    await expect(theater.getByRole("button", { name: "Copy the prompt that made this" })).toBeVisible();
    // The facts name what they measure and open the same receipts as the row.
    const fact = theater.getByRole("button", { name: /^55 and older skews \+0\.21/ });
    await fact.click();
    const receipt = page.getByRole("dialog", { name: "Receipt: Age skew" });
    await expect(receipt).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(receipt).toBeHidden();
    await expect(fact).toBeFocused();
    const shots = theater.getByRole("region", { name: "Shot by shot" });
    await expect(shots.getByText(/^Shot 1 · Hook · 0 to 3 s$/)).toBeVisible();
    await expect(shots.getByText("Camera: Slow push-in").first()).toBeVisible();
    await expect(shots.getByRole("list", { name: "What shot 1 carries" }).getByRole("button", { name: /Music style/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(theater).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a receipt opened inside the theater owns Escape at once, so Escape closes only the receipt", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    await page.getByRole("button", { name: `Open ${TOP_LABEL}: why this ad` }).click();
    const theater = page.getByRole("dialog", { name: TOP_LABEL });
    await expect(theater).toBeVisible();
    const fact = theater.getByRole("button", { name: /^55 and older skews \+0\.21/ });
    // Opens the receipt and presses Escape before the browser runs another task, the worst case for a
    // fast key press or a busy phone: the receipt must already be the layer that takes Escape.
    const pressed = await fact.evaluate(async (button: HTMLElement) => {
      button.click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      const focused = document.activeElement;
      const receiptHasFocus = focused?.closest('[role="dialog"]')?.querySelector("h2")?.textContent === "Receipt: Age skew";
      focused?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return receiptHasFocus;
    });
    expect(pressed).toBe(true);
    await expect(page.getByRole("dialog", { name: "Receipt: Age skew" })).toBeHidden();
    await expect(theater.getByRole("region", { name: "Shot by shot" })).toBeVisible();
    await expect(fact).toBeFocused();
  });

  test("the Control's theater is labeled not from Qloo", async ({ page }) => {
    await setup(page);
    await page.goto(URL);
    await page.getByRole("button", { name: "Open the Control: why this ad" }).click();
    const theater = page.getByRole("dialog", { name: "Control" });
    await expect(theater.getByText("The LLM-only brief, not from Qloo:")).toBeVisible();
    await theater.getByRole("button", { name: "Close" }).click();
    await expect(theater).toBeHidden();
  });
});

test.describe("the judge banner", () => {
  test("renders nothing without a pass", async ({ page }) => {
    await setup(page, ACCESS.judge);
    await page.goto(URL);
    await expect(page.getByRole("heading", { level: 2, name: "Reality Check" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Judge pass" })).toHaveCount(0);
  });

  test("with a pass and judge access, says renders are unlocked above the Reality Check", async ({ page, context, baseURL }) => {
    await judgeHint(context, baseURL);
    await setup(page, ACCESS.judge);
    await page.goto(URL);
    const banner = page.getByRole("complementary", { name: "Judge pass" });
    await expect(banner).toContainText("Judge pass active: video renders unlocked");
    await expect(banner.getByRole("link", { name: "Try it with your link" })).toHaveAttribute("href", "/start");
    const bannerBox = await banner.boundingBox();
    const realityBox = await page.locator("#reality").boundingBox();
    expect(bannerBox!.y).toBeLessThan(realityBox!.y);
    // The brick sticky bar stays the one filled primary.
    await expect(page.getByRole("link", { name: "Make this for my product" })).toBeVisible();
  });

  test("with a pass and a spent budget, says so plainly and claims nothing", async ({ page, context, baseURL }) => {
    await judgeHint(context, baseURL);
    await setup(page, ACCESS["budget-used"]);
    await page.goto(URL);
    const banner = page.getByRole("complementary", { name: "Judge pass" });
    await expect(banner).toContainText(PASS_SPENT);
    await expect(banner).not.toContainText("unlocked");
    await expect(banner).not.toContainText(/storyboard|clip/);
  });

  test("with a pass the server no longer honors, shows nothing but keeps its place", async ({ page, context, baseURL }) => {
    await judgeHint(context, baseURL);
    await setup(page, ACCESS.byok);
    await page.goto(URL);
    await expect(output(page, TOP).getByRole("link", { name: /Render with your fal key/ })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Judge pass" })).toHaveCount(0);
    // The strip's space stays (no jump below it), invisible to everyone.
    const held = page.locator("main aside[aria-hidden='true']");
    await expect(held).toHaveCSS("visibility", "hidden");
    expect((await held.boundingBox())!.height).toBeGreaterThan(40);
  });
});
