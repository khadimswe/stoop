import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Report } from "../lib/report/schema";

// The landing's agent demo: a replay of the lead example's recorded run. Playwright's clock drives the replay
// (it runs on requestAnimationFrame), so a whole loop takes no real time and nothing is test-only in
// the player.

const DEMO_PATH = "/";
const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;
const measured = report.audience.gap!.lines.find((line) => line.kind === "measured")!.text;

function consoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Opens the page on a fake clock and brings the whole demo on screen (it loads as it nears the viewport). */
async function openDemo(page: Page, { clock = true } = {}) {
  if (clock) await page.clock.install();
  await page.goto(DEMO_PATH);
  const slot = page.getByRole("region", { name: "The agent at work · Porchlight Pepper Co." });
  await slot.scrollIntoViewIfNeeded();
  const player = slot.locator("[data-demo-beat]");
  await player.waitFor();
  await player.evaluate((node) => node.scrollIntoView({ block: "end" }));
  await expect(player).toBeVisible();
  return { slot, player, open: slot.getByRole("link", { name: "Open the full report", exact: true }) };
}

const beatOf = (page: Page) => page.locator("#agent-demo [data-demo-beat]").getAttribute("data-demo-beat");
const stepsOf = async (page: Page) => Number(await page.locator("#agent-demo [data-demo-beat]").getAttribute("data-demo-steps"));

/** Advances the replay in small slices until `done`, at most `limit` ms of replay time. */
async function playUntil(page: Page, done: () => Promise<boolean>, limit = 60_000) {
  for (let t = 0; t < limit; t += 250) {
    if (await done()) return;
    await page.clock.runFor(250);
  }
  throw new Error("The replay never got there.");
}

test("autoplays the recorded run from the composer to the launch plan", async ({ page }) => {
  const errors = consoleErrors(page);
  const { slot, player, open } = await openDemo(page);
  await expect(slot.getByText("Replay of a recorded run · real Qloo data · Oct 16")).toBeVisible();
  // A plain summary for screen readers, with the run's own Reality Check.
  await expect(slot.locator("p.sr-only")).toContainText(measured);
  await expect(player).toHaveAttribute("data-demo-mode", "autoplay");
  await expect(player).toHaveAttribute("data-demo-playing", "true");
  expect(await beatOf(page)).toBe("composer");

  const seen = new Set<string>();
  await playUntil(page, async () => {
    seen.add((await beatOf(page)) ?? "");
    return open.isVisible();
  });
  expect([...seen]).toEqual(["composer", "seeds", "trace", "reality", "worlds", "storyboard", "launch"]);
  await expect(open).toHaveAttribute("href", "/examples/food-hot-sauce");
  await expect(player).toHaveAttribute("data-demo-steps", String(report.trace.length));
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("pause holds the frame, play resumes it, and replay starts over", async ({ page }) => {
  const errors = consoleErrors(page);
  const { slot, player } = await openDemo(page);
  await playUntil(page, async () => (await stepsOf(page)) > 4);
  await slot.getByRole("button", { name: "Pause the replay" }).click();
  await expect(player).toHaveAttribute("data-demo-playing", "false");
  const held = await stepsOf(page);
  await page.clock.runFor(5_000);
  expect(await stepsOf(page)).toBe(held);
  expect(await beatOf(page)).toBe("trace");

  await slot.getByRole("button", { name: "Play the replay" }).click();
  await expect(player).toHaveAttribute("data-demo-playing", "true");
  await playUntil(page, async () => (await stepsOf(page)) > held, 5_000);

  await slot.getByRole("button", { name: "Replay from the start" }).click();
  await expect(player).toHaveAttribute("data-demo-beat", "composer");
  await expect(player).toHaveAttribute("data-demo-steps", "0");
  expect(errors).toEqual([]);
});

test("holds on the last beat while the pointer is on Open the full report", async ({ page }) => {
  const { player, open } = await openDemo(page);
  await playUntil(page, () => open.isVisible());
  await open.hover();
  await expect(player).toHaveAttribute("data-demo-playing", "false");
  await page.clock.runFor(10_000);
  await expect(player).toHaveAttribute("data-demo-beat", "launch");
  await expect(open).toBeVisible();
});

test("stops while off screen or in a hidden tab", async ({ page }) => {
  const { player } = await openDemo(page, { clock: false });
  await expect(player).toHaveAttribute("data-demo-playing", "true");

  // Push the demo far below the fold: it stops, and starts again once it is back.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "6000px";
    document.querySelector("main")!.prepend(spacer);
    window.scrollTo(0, 0);
  });
  await expect(player).toHaveAttribute("data-demo-playing", "false");
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-demo-playing", "true");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(player).toHaveAttribute("data-demo-playing", "false");
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("never autoplays: it shows the end of the run and steps through the beats", async ({ page }) => {
    const errors = consoleErrors(page);
    const { slot, player, open } = await openDemo(page, { clock: false });
    await expect(player).toHaveAttribute("data-demo-mode", "steps");
    await expect(player).toHaveAttribute("data-demo-playing", "false");
    await expect(player).toHaveAttribute("data-demo-beat", "launch");
    await expect(open).toBeVisible();
    await expect(slot.getByRole("button", { name: "Pause the replay" })).toHaveCount(0);

    const step = slot.getByRole("button", { name: "Step through" });
    for (const beat of ["composer", "seeds", "trace", "reality", "worlds", "storyboard", "launch"]) {
      await step.click();
      await expect(player).toHaveAttribute("data-demo-beat", beat);
    }
    // Each beat shows its end: the whole trace has arrived.
    await step.click();
    await step.click();
    await step.click();
    await expect(player).toHaveAttribute("data-demo-steps", String(report.trace.length));
    await expect(player).toHaveAttribute("data-demo-playing", "false");
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
