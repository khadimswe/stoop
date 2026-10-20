import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Report } from "../lib/report/schema";

// The landing's agent demo, on its review route: a replay of the lead example's recorded run.
// `?speed=` (review route only) plays it faster, so a run through all seven beats takes seconds.

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

async function openDemo(page: Page, speed: number) {
  await page.goto(`/demo-preview?speed=${speed}`);
  const region = page.getByRole("region", { name: "Agent demo: a replay of a recorded Stoop run" });
  await region.scrollIntoViewIfNeeded();
  const player = page.locator("[data-demo-beat]");
  await expect(player).toBeVisible();
  return { region, player };
}

const beatOf = (page: Page) => page.locator("[data-demo-beat]").getAttribute("data-demo-beat");
const stepsOf = async (page: Page) => Number(await page.locator("[data-demo-beat]").getAttribute("data-demo-steps"));

test("autoplays the recorded run from the composer to the launch plan", async ({ page }) => {
  const errors = consoleErrors(page);
  const { region, player } = await openDemo(page, 6);
  await expect(region.getByText("Replay of a recorded run · real Qloo data · Oct 16")).toBeVisible();
  // A plain summary for screen readers, with the run's own Reality Check.
  await expect(region.locator("p.sr-only")).toContainText(measured);
  await expect(player).toHaveAttribute("data-demo-mode", "autoplay");

  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        seen.add((await beatOf(page)) ?? "");
        return seen.has("launch");
      },
      { timeout: 20_000, intervals: [50] },
    )
    .toBe(true);
  for (const beat of ["trace", "reality", "worlds", "storyboard", "launch"]) expect(seen).toContain(beat);
  await expect(region.getByRole("link", { name: "Open the full report", exact: true })).toHaveAttribute("href", "/examples/food-hot-sauce");
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("pause holds the frame, play resumes it, and replay starts over", async ({ page }) => {
  const errors = consoleErrors(page);
  const { region, player } = await openDemo(page, 2);
  await expect.poll(() => stepsOf(page), { timeout: 20_000 }).toBeGreaterThan(4);
  await region.getByRole("button", { name: "Pause the replay" }).click();
  await expect(player).toHaveAttribute("data-demo-playing", "false");
  const held = await stepsOf(page);
  await page.waitForTimeout(1_200);
  expect(await stepsOf(page)).toBe(held);
  expect(await beatOf(page)).toBe("trace");

  await region.getByRole("button", { name: "Play the replay" }).click();
  await expect(player).toHaveAttribute("data-demo-playing", "true");
  await expect.poll(() => stepsOf(page)).toBeGreaterThan(held);

  await region.getByRole("button", { name: "Replay from the start" }).click();
  await expect(player).toHaveAttribute("data-demo-beat", "composer");
  await expect(player).toHaveAttribute("data-demo-steps", "0");
  expect(errors).toEqual([]);
});

test("stops while off screen or in a hidden tab", async ({ page }) => {
  const { player } = await openDemo(page, 2);
  await expect(player).toHaveAttribute("data-demo-playing", "true");

  // Push the demo far below the fold: it stops, and starts again once it is back.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.id = "spacer";
    spacer.style.height = "4000px";
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
    const { region, player } = await openDemo(page, 1);
    await expect(player).toHaveAttribute("data-demo-mode", "steps");
    await expect(player).toHaveAttribute("data-demo-playing", "false");
    await expect(player).toHaveAttribute("data-demo-beat", "launch");
    await expect(region.getByRole("link", { name: "Open the full report", exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "Pause the replay" })).toHaveCount(0);

    const step = region.getByRole("button", { name: "Step through" });
    for (const beat of ["composer", "seeds", "trace", "reality", "worlds", "storyboard", "launch"]) {
      await step.click();
      await expect(player).toHaveAttribute("data-demo-beat", beat);
    }
    // The end state of each beat: the whole trace has arrived.
    await step.click();
    await step.click();
    await step.click();
    await expect(player).toHaveAttribute("data-demo-steps", String(report.trace.length));
    await expect(player).toHaveAttribute("data-demo-playing", "false");
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
