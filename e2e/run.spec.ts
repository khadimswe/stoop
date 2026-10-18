import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { RunEvent } from "../lib/events";
import type { Report } from "../lib/report/schema";

// /run/[id]. In replay mode the lead example's recorded run streams from the real server
// (/api/run/example-food-hot-sauce/events). Live-only states (stopped, resumed, failed) intercept the
// events route with the same recorded events, re-labeled as a live run.

const recorded = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.events.json", "utf8")) as RunEvent[];
const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;
const STEPS = report.trace.length;
const RUN_ID = `run_${"e5".repeat(12)}`;

const asLive = (events: readonly RunEvent[], attempt = 1): RunEvent[] =>
  events.map((e) => ({ ...(e.type === "run.started" ? { ...e, runId: RUN_ID, kind: "live" as const } : e), ...(attempt > 1 ? { attempt } : {}) }));
const sse = (events: readonly RunEvent[], status: { status: string; attempt: number; resumable: boolean }) =>
  [
    "retry: 3000\n\n",
    ...events.map((e) => `id: ${e.attempt ?? 1}:${e.seq}\nevent: run\ndata: ${JSON.stringify(e)}\n\n`),
    `event: status\ndata: ${JSON.stringify(status)}\n\n`,
  ].join("");
const SSE = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" };

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

test("the lead example's recorded run streams end to end in replay mode", async ({ page }) => {
  const errors = consoleErrors(page);
  await page.goto("/run/example-food-hot-sauce");
  await expect(page.getByRole("heading", { level: 1, name: "Building your Campaign Kit" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Progress" }).getByRole("listitem")).toHaveCount(7);
  await expect(page.getByText("Recorded Qloo")).toBeVisible();
  // Results fill in as they arrive: the Reality Check, then each world.
  await expect(page.getByText(report.audience.gap!.lines.find((l) => l.kind === "measured")!.text)).toBeVisible();
  await expect(page.getByRole("heading", { name: report.worlds[0].label })).toBeVisible();

  const open = page.getByRole("link", { name: "Open the full report" });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await expect(open).toHaveAttribute("href", "/examples/food-hot-sauce");
  await expect(page.getByRole("heading", { level: 1, name: "Your Campaign Kit is ready" })).toBeVisible();
  await expect(page.locator("[data-run-status]")).toHaveText(/Recorded run · \d+ Qloo answers replayed · no live calls/);
  await expect(page.locator('[data-status="done"]')).toHaveCount(7);
  await expect(page.locator("[data-trace-step]")).toHaveCount(STEPS);
  await expect(page.getByText(report.worlds[0].concepts!.best.concept.hook)).toBeVisible();
  await expect(page.getByText(report.comparison!.headline)).toBeVisible();

  // A decision's reason opens from its "Why".
  await page.getByText("Show", { exact: false }).filter({ hasText: "earlier steps" }).click();
  const decision = report.trace.find((s) => s.kind === "decision" && s.reason)!;
  const row = page.locator("[data-trace-step=decision]").filter({ hasText: decision.label }).first();
  await row.getByText("Why", { exact: true }).click();
  await expect(row.getByText(decision.reason!)).toBeVisible();

  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("a reload mid-stream resumes from the last event, without duplicates", async ({ page }) => {
  const errors = consoleErrors(page);
  await page.goto("/run/example-food-hot-sauce");
  await expect.poll(() => page.locator("[data-trace-step]").count(), { timeout: 15_000 }).toBeGreaterThan(10);
  const resumed = page.waitForRequest((request) => /\/api\/run\/example-food-hot-sauce\/events\?lastEventId=1%3A\d+/.test(request.url()));
  await page.reload();
  await resumed;
  await expect(page.getByRole("link", { name: "Open the full report" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-trace-step]")).toHaveCount(STEPS);
  expect(errors).toEqual([]);
});

test("a stopped run offers Resume, which follows the next attempt to the end", async ({ page }) => {
  const errors = consoleErrors(page);
  let calls = 0;
  let resumes = 0;
  await page.route(`**/api/run/${RUN_ID}/events*`, (route) => {
    calls++;
    const body = calls === 1 ? sse(asLive(recorded.slice(0, 60)), { status: "stopped", attempt: 1, resumable: true }) : sse(asLive(recorded, 2), { status: "done", attempt: 2, resumable: false });
    return route.fulfill({ status: 200, headers: SSE, body });
  });
  await page.route(`**/api/run/${RUN_ID}/resume`, (route) => {
    resumes++;
    return route.fulfill({ json: { mode: "live", runId: RUN_ID, eventsUrl: `/api/run/${RUN_ID}/events`, reportUrl: `/report/${RUN_ID}`, joined: false } });
  });
  await page.goto(`/run/${RUN_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "This run stopped" })).toBeVisible();
  await expect(page.locator('[data-status="stopped"], [data-status="current"]').first()).toBeVisible();
  const resume = page.getByRole("button", { name: "Resume" });
  await resume.dblclick();
  await expect(page.getByRole("heading", { level: 1, name: "Your Campaign Kit is ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your report" })).toHaveAttribute("href", `/report/${RUN_ID}`);
  await expect(page.locator("[data-trace-step]")).toHaveCount(STEPS);
  expect(resumes).toBe(1);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("a failed run keeps what it measured and offers the examples", async ({ page }) => {
  const prefix = asLive(recorded.slice(0, 40));
  const failed: RunEvent = { seq: prefix.at(-1)!.seq + 1, at: prefix.at(-1)!.at, type: "run.failed", stage: "segments", message: "The run hit its time limit." };
  await page.route(`**/api/run/${RUN_ID}/events*`, (route) => route.fulfill({ status: 200, headers: SSE, body: sse([...prefix, failed], { status: "failed", attempt: 1, resumable: false }) }));
  await page.goto(`/run/${RUN_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "This run stopped early" })).toBeVisible();
  await expect(page.getByText("The run hit its time limit.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Porchlight Pepper Co. example report" })).toHaveAttribute("href", "/examples/food-hot-sauce");
  await expect(page.getByText(report.audience.gap!.lines[0].text)).toBeVisible();
});

test("an unknown run says it has expired and points to the examples, never a blank page", async ({ page }) => {
  // The server answers 404 for the events; the browser logs those loads itself.
  const errors = consoleErrors(page, [/status of 404/, /EventSource/]);
  await page.goto(`/run/run_${"0".repeat(24)}`);
  await expect(page.getByRole("heading", { level: 1, name: "That run has expired" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a new run" })).toHaveAttribute("href", "/start");
  await expect(page.getByRole("link", { name: "Lowlight Candle Co. example report" })).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("a malformed run id is a not-found page", async ({ page }) => {
  await page.goto("/run/not-a-run");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
