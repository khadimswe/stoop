import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The example report's smaller promises: receipt deep links, the provenance badge on tap, the section
// nav on phones, 44 px receipt targets that never overlap, the setting city's scope, the cut card's own
// hook, the Prompts menu clear of the header, the replay link, and the video line's draft length. The
// render routes are answered here, so nothing reaches fal. Names come from the recorded report, so no
// Qloo data is written in this file.

const URL = "/examples/food-hot-sauce";
type Access = { video: "judge" | "byok" | "budget-used" | "off"; rendersLeft: number | null; byok: boolean; draftSeconds?: number };

const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as {
  meta: { id: string };
  worlds: { segmentId: string; label: string; settingCity: { label: string; audienceRank: number } | null; pack: { concept: { title: string } } }[];
};
const [TOP, SECOND] = report.worlds;

async function setup(page: Page, access: (segment: string) => Access = () => ({ video: "off", rendersLeft: null, byok: false })) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/render/access?*", (route) => route.fulfill({ json: access(new globalThis.URL(route.request().url()).searchParams.get("segment") ?? "") }));
  return errors;
}

const isPhone = (page: Page) => page.viewportSize()!.width < 640;

test("a #receipt-music link lands on the Screening Room with the music style receipt open and focused", async ({ page }) => {
  const errors = await setup(page);
  await page.goto(`${URL}#receipt-music`);
  const drawer = page.getByRole("dialog", { name: "Receipt: Music style" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("/v2/insights").first()).toBeVisible();
  expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // Focus returns to the chip it opened from, in the Screening Room's first world row.
  const chip = page.locator("#screening").getByRole("button", { name: /Music style/ }).first();
  await expect(chip).toBeFocused();
  await expect(chip).toBeInViewport();
  expect(errors).toEqual([]);
});

test("the generic #receipt-<cue> form opens other cues and facts, and an unknown one still lands on the room", async ({ page }) => {
  await setup(page);
  await page.goto(`${URL}#receipt-wardrobe`);
  await expect(page.getByRole("dialog", { name: "Receipt: Wardrobe" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`${URL}#receipt-setting-city`);
  await expect(page.getByRole("dialog", { name: "Receipt: Setting city" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`${URL}#receipt-nothing-here`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Screening Room" })).toBeInViewport();
});

test("the recorded badge explains itself on tap, not only on hover", async ({ page }) => {
  await setup(page);
  await page.goto(URL);
  const badge = page.locator("main header").getByRole("button", { name: /Recorded Qloo/ });
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  if (isPhone(page)) await badge.tap();
  else await badge.click();
  await expect(badge).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Real Qloo responses, saved so this loads instantly. Nothing here is made up.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(badge).toHaveAttribute("aria-expanded", "false");
});

test("an example links to its agent replay", async ({ page }) => {
  await setup(page);
  await page.goto(URL);
  await expect(page.getByRole("link", { name: "Watch the agent build this" })).toHaveAttribute("href", `/run/${report.meta.id}`);
});

test("the section nav fits on phones with short labels, keeps full names, and shows the current one", async ({ page }) => {
  await setup(page);
  await page.goto(URL);
  const nav = page.getByRole("navigation", { name: "Report sections" });
  const names = ["Screening Room", "Campaign Kit", "Launch plan", "Why it works"];
  for (const name of names) await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(nav.getByRole("link")).toHaveText(isPhone(page) ? ["Screening", "Kit", "Launch", "Why"] : names, { useInnerText: true });
  // Every link sits inside the nav's row on screen, and the current one is in view.
  const row = nav.getByRole("list");
  for (const name of names) {
    await nav.getByRole("link", { name }).click();
    const link = nav.getByRole("link", { name });
    await expect(link).toHaveAttribute("aria-current", "location");
    const [r, l] = [(await row.boundingBox())!, (await link.boundingBox())!];
    expect(l.x).toBeGreaterThanOrEqual(r.x - 1);
    expect(l.x + l.width).toBeLessThanOrEqual(r.x + r.width + 1);
  }
});

test("receipt triggers have 44 px tap targets on phones, and no two overlap", async ({ page }) => {
  test.skip(!isPhone(page), "tap targets are measured on phones (390 and 412 px)");
  await setup(page);
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  const problems = await page.evaluate(() => {
    const triggers = [...document.querySelectorAll<HTMLElement>("main button")].filter((b) => /open(s)? (its )?receipt|opens the receipt for|what this means/.test(b.textContent ?? ""));
    const out: string[] = [];
    let checked = 0;
    for (const button of triggers) {
      if (button.closest("[hidden], details:not([open])") || button.getClientRects().length === 0) continue;
      button.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = button.getClientRects()[0];
      if (rect.width === 0) continue;
      checked += 1;
      // The tap area: the button itself or its ::after hit area, whichever is taller, at least 44 px.
      const after = parseFloat(getComputedStyle(button, "::after").height) || 0;
      if (Math.max(rect.height, after) < 44) out.push(`${(button.textContent ?? "").trim().slice(0, 60)}: only ${Math.max(rect.height, after)} px tall`);
      // Each edge of that area belongs to this trigger, not a neighbor (sampled 1 px inside, clear of sub-pixel rounding).
      // Mid-width: a pill's rounded corners are not part of its tap area, its middle always is.
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const points: [number, number, string][] = [
        [cx, cy - 21, "top"],
        [cx, cy + 21, "bottom"],
        [rect.left + 1, cy, "left"],
        [rect.right - 1, cy, "right"],
      ];
      for (const [x, y, side] of points) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !button.contains(hit)) out.push(`${(button.textContent ?? "").trim().slice(0, 60)}: ${side} edge goes to ${hit ? `${hit.tagName} "${(hit.textContent ?? "").trim().slice(0, 40)}"` : "nothing"}`);
      }
    }
    return { checked, out };
  });
  expect(problems.checked).toBeGreaterThan(40);
  expect(problems.out).toEqual([]);
});

test("the setting city says it is the whole neighborhood's pick, in the Screening Room and the theater", async ({ page }) => {
  await setup(page);
  await page.goto(URL);
  const city = TOP.settingCity!;
  const note = city.audienceRank === 1 ? "Setting: the whole taste neighborhood's top city" : `Setting: the whole taste neighborhood's #${city.audienceRank} city`;
  const row = page.locator("#screening li").filter({ has: page.getByRole("heading", { level: 3, name: TOP.label }) });
  await expect(row.getByRole("button", { name: new RegExp(`^set in ${city.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toBeVisible();
  await expect(row.getByText(note, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Open ${TOP.label}: why this ad` }).click();
  await expect(page.getByRole("dialog", { name: TOP.label }).getByText(note, { exact: true })).toBeVisible();
});

test("the TikTok cut shows its own hook and whole script lines", async ({ page }) => {
  await setup(page);
  await page.goto(URL);
  const cut = page.getByRole("article", { name: `TikTok cut: ${TOP.pack.concept.title}` });
  await expect(cut.getByText(/^Hook:/)).toBeVisible();
  await expect(cut.getByText(/^Hook:/)).not.toContainText("Show the product working in the first second.");
  await expect(cut.getByRole("list", { name: "TikTok script, first lines" }).getByRole("listitem").first()).toContainText(/^1\. 0 to 3 s, hook:/);
  await cut.getByText("The whole script").click();
  await expect(cut.getByText(/Disclosure \(FTC\)/)).toBeVisible();
});

test("the Kit's Prompts menu never opens over the site header", async ({ page }) => {
  await setup(page);
  await page.goto(URL);
  const trigger = page.getByRole("button", { name: `Prompts for ${TOP.pack.concept.title}` });
  await trigger.scrollIntoViewIfNeeded();
  // Bring the trigger near the bottom of the screen, so the menu has to open upward toward the header.
  await trigger.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - (window.innerHeight - 130)));
  await trigger.click();
  const menu = page.getByRole("dialog", { name: `Prompts for ${TOP.pack.concept.title}` });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const header = (await page.locator("body > header, header").first().boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
});

test("the video line says the draft length the access answer gives", async ({ page }) => {
  await setup(page, () => ({ video: "judge", rendersLeft: 2, byok: true, draftSeconds: 8 }));
  await page.goto(URL);
  await expect(page.locator(`[data-output="${TOP.segmentId}"]`).getByText(/2 drafts left on your judge pass · 8 s, 480p/)).toBeVisible();
});

test("the judge banner's drafts left follow a draft rendered in any world", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "stoop_judge_ui", value: "1", url: baseURL ?? "http://localhost:3000" }]);
  let left = 3;
  await setup(page, () => ({ video: "judge", rendersLeft: left, byok: true }));
  await page.route("**/api/render", async (route) => {
    const { target } = route.request().postDataJSON();
    left -= 1;
    await route.fulfill({ json: { job: { id: "rj_000000000000000000000002", target, status: "done", videoUrl: "https://stoop-e2e.public.blob.vercel-storage.com/drafts/draft-2.webm", reason: null, cached: true } } });
  });
  await page.route("https://stoop-e2e.public.blob.vercel-storage.com/**", (route) => route.fulfill({ body: readFileSync(new globalThis.URL("./fixtures/draft.webm", import.meta.url)), contentType: "video/webm" }));
  await page.goto(URL);
  const banner = page.getByRole("complementary", { name: "Judge pass" });
  await expect(banner).toContainText("3 drafts left");
  // A draft in the second world, not the banner's own top world.
  await page.locator(`[data-output="${SECOND.segmentId}"]`).getByRole("button", { name: "Render draft video" }).click();
  await expect(banner).toContainText("2 drafts left");
});
