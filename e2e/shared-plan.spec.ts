import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { publicPlanReport } from "../lib/plan/owner";
import { planReportSchema, type PlanReport } from "../lib/plan/schema";

// A live plan opened in a browser that did not make it: the event stream answers 403 by design
// (lib/plan/owner.ts) and the plan route answers the public view. Every step says it is a shared plan
// and links to the public event page; nothing waits forever and nothing polls the drafts.

const ID = "plan_0123456789abcdef01234567";
const recorded = planReportSchema.parse(JSON.parse(readFileSync("data/plans/chicago-18th-street/plan.report.json", "utf8")));
const live: PlanReport = { ...recorded, meta: { ...recorded.meta, id: ID, kind: "live", provenance: "live" } };
const NOTICE = "You're viewing a shared plan.";

async function mockShared(page: Page) {
  const marketing: string[] = [];
  await page.route(`**/api/plan/${ID}/events`, (route) =>
    route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This plan's details open on the phone or computer that started it." } } }),
  );
  await page.route(`**/api/plan/${ID}`, (route) => route.fulfill({ json: { status: "done", id: ID, report: publicPlanReport(live), eventsUrl: null, owner: false } }));
  await page.route(`**/api/plan/${ID}/marketing`, (route) => {
    marketing.push(route.request().method());
    return route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "Not yours." } } });
  });
  return marketing;
}

test("a shared live plan says so on every step, with no dead jumps and no endless making", async ({ page }) => {
  const marketing = await mockShared(page);

  await page.goto(`/plan/${ID}`);
  const notice = page.getByRole("status").filter({ hasText: NOTICE });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("The full plan, poster and posts open on the phone or computer that made it.");
  await expect(notice.getByRole("link", { name: "Open the event page" })).toHaveAttribute("href", `/e/${ID}`);
  // Every jump chip lands on a section the page shows.
  const jumps = page.getByRole("navigation", { name: "Jump to" }).getByRole("link");
  const hrefs = await jumps.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) await expect(page.locator(href)).toHaveCount(1);
  expect(hrefs).not.toContain("#timeline");
  await expect(page.getByText(/0 steps/)).toHaveCount(0);
  await expect(page.getByText("How it was made")).toHaveCount(0);

  await page.goto(`/plan/${ID}/poster`);
  await expect(page.getByRole("status").filter({ hasText: NOTICE })).toBeVisible();
  await expect(page.getByText("Making your poster and posts")).toHaveCount(0);

  await page.goto(`/plan/${ID}/promote`);
  await expect(page.getByRole("status").filter({ hasText: NOTICE })).toBeVisible();
  await expect(page.getByText(/being written/i)).toHaveCount(0);
  // Long enough for the old poll (every 4 s) and its kick (after 12 s) to have shown up.
  await page.waitForTimeout(5_000);
  expect(marketing).toEqual([]);
});
