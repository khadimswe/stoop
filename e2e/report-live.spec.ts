import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

// The live report, /report/<id>, against intercepted API routes: the report route, the run's event
// stream (served from the recorded run, data/runs/food-hot-sauce/run.events.json), frames, revise and
// resume. No live Qloo, Claude or fal calls. The recorded run is re-labeled as a live run; its Qloo data
// is untouched. After-run events (frames, a revision) are assembled from the same recorded run.

const RUN = "run_0123456789abcdef01234567";
const EVENTS_URL = `/api/run/${RUN}/events`;
const BRAND = "Porchlight Pepper Co.";

type Json = Record<string, unknown>;
const recordedReport = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Json & {
  meta: Json;
  worlds: (Json & { segmentId: string; label: string; brief: Json & { music: Json }; culture: (Json & { field: string })[]; pack: Json & { concept: { scenes: unknown[] } } })[];
  inputs: Json;
  ledger: unknown[];
  audience: Json;
  trace: unknown[];
};
const recordedEvents = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.events.json", "utf8")) as (Json & { seq: number; type: string })[];

const liveReport = { ...recordedReport, meta: { ...recordedReport.meta, id: RUN, kind: "live", provenance: "live" } };
const liveEvents = recordedEvents.map((event) => (event.type === "run.started" ? { ...event, runId: RUN, kind: "live" } : event));
const lastSeq = liveEvents.at(-1)!.seq;
const [world, otherWorld] = recordedReport.worlds;

// A 1x1 PNG for the frame URLs, so no image request leaves the test.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const hex = (c: string) => c.repeat(64);

const sse = (events: Json[], statuses: { before?: string; after?: string } = {}) =>
  [
    "retry: 400\n\n",
    statuses.before ? `event: status\ndata: ${JSON.stringify({ status: statuses.before, attempt: 1, resumable: false })}\n\n` : "",
    ...events.map((event) => `id: 1:${event.seq}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`),
    statuses.after ? `event: status\ndata: ${JSON.stringify({ status: statuses.after, attempt: 1, resumable: false })}\n\n` : "",
  ].join("");

const at = (seq: number) => ({ seq, at: "2026-10-16T20:05:00.000Z" });

/** The after-run events a storyboard job writes: rendering, its critique decisions, then the frames. */
function framesEvents(from: number): Json[] {
  const segmentId = world.segmentId;
  const scenes = world.pack.concept.scenes.length;
  const frame = (scene: number, attempt: 1 | 2) => ({ scene, url: `https://frames.test/${segmentId}-${scene}-${attempt}.png`, promptHash: hex("3"), modelId: "fal-ai/nano-banana-2/edit", attempt });
  return [
    { ...at(from), type: "world.frames", segmentId, frames: { revisionId: null, status: "rendering", reason: null, frames: [], critiques: [] } },
    { ...at(from + 1), type: "trace.step", step: { stage: "frames", kind: "decision", label: "Frame 2: product hidden", reason: "Before: the bottle sits behind a plate. After: the bottle in hand at the table.", segmentId } },
    {
      ...at(from + 2),
      type: "world.frames",
      segmentId,
      frames: {
        revisionId: null,
        status: "done",
        reason: null,
        frames: [frame(0, 1), frame(1, 1), frame(1, 2), frame(2, 1), frame(scenes - 1, 1)],
        critiques: [{ scene: 1, issues: ["product hidden"], rewrite: "The bottle in hand at the table." }],
      },
    },
  ];
}

const NOTE = "Less classic rock, more porch.";
const REVISION_ID = "rev-0123456789ab";

/** A "Not this vibe" revision of the first world's music, assembled from the two recorded worlds. */
function revisionEvents(from: number): Json[] {
  const music = otherWorld.culture.find((f) => f.field === "music")!;
  const revision = {
    id: REVISION_ID,
    field: "music",
    reason: NOTE,
    excluded: [],
    changes: [{ slot: "music", before: world.brief.music, after: otherWorld.brief.music }],
    brief: { ...world.brief, music: otherWorld.brief.music },
    culture: world.culture.map((f) => (f.field === "music" ? music : f)),
    richSlots: world.richSlots,
    concepts: world.concepts,
    pack: world.pack,
    kit: world.kit,
    evidenceIds: [],
  };
  return [
    { ...at(from), type: "trace.step", step: { stage: "revise", kind: "decision", label: "Revising 55 and older: not this music", reason: "Writing a different take from the same Qloo candidates.", segmentId: world.segmentId } },
    { ...at(from + 1), type: "world.revised", segmentId: world.segmentId, revision },
  ];
}

interface Mock {
  report: () => { status: number; body: unknown };
  /** Events for the first stream request (no Last-Event-ID). */
  first: () => string;
  /** Queued after-run event text, served once to the next reconnect. */
  queued: string[];
  posts: { url: string; body: unknown }[];
}

async function mockApi(page: Page, mock: Mock) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://frames.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(`**/api/report/${RUN}`, (route) => {
    const { status, body } = mock.report();
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  // The first request replays the run from seq 0; every later one is a reconnect (the browser's own,
  // whose Last-Event-ID header interception does not show, or the page's, with ?lastEventId=), which
  // gets what was queued since, or 204 (nothing new on an ended run), which tells EventSource to stop.
  let streams = 0;
  await page.route(`**${EVENTS_URL}**`, (route: Route) => {
    streams += 1;
    if (streams === 1 && !new URL(route.request().url()).searchParams.get("lastEventId")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: mock.first() });
    const next = mock.queued.shift();
    return next ? route.fulfill({ status: 200, contentType: "text/event-stream", body: next }) : route.fulfill({ status: 204, body: "" });
  });
  return errors;
}

function postRoute(page: Page, mock: Mock, pattern: string, answer: (body: unknown) => { status: number; body: unknown; queue?: string }) {
  return page.route(pattern, (route) => {
    const body = route.request().postDataJSON() as unknown;
    mock.posts.push({ url: route.request().url(), body });
    const reply = answer(body);
    if (reply.queue) mock.queued.push(reply.queue);
    return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
}

const doneMock = (): Mock => ({
  report: () => ({ status: 200, body: { status: "done", report: liveReport, eventsUrl: EVENTS_URL } }),
  first: () => sse(liveEvents, { after: "done" }),
  queued: [],
  posts: [],
});

test("a run still going shows its progress and links to its live trace", async ({ page }) => {
  const mock: Mock = {
    report: () => ({ status: 200, body: { status: "running", runId: RUN, eventsUrl: EVENTS_URL, resumable: false } }),
    first: () => sse(liveEvents.slice(0, 40), { before: "running" }),
    queued: [],
    posts: [],
  };
  const errors = await mockApi(page, mock);
  await page.goto(`/report/${RUN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your run is still going" })).toBeVisible();
  await expect(page.getByText(/steps so far/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch the agent work" })).toHaveAttribute("href", `/run/${RUN}`);
  expect(errors).toEqual([]);
});

test("a stopped run offers Resume, and the resumed run opens as its report", async ({ page }) => {
  let resumed = false;
  const mock: Mock = {
    report: () => ({ status: 200, body: { status: "running", runId: RUN, eventsUrl: EVENTS_URL, resumable: true } }),
    first: () => sse(liveEvents, { before: "running", after: "done" }),
    queued: [],
    posts: [],
  };
  await mockApi(page, mock);
  await postRoute(page, mock, `**/api/run/${RUN}/resume`, () => {
    resumed = true;
    return { status: 200, body: { mode: "live", runId: RUN, eventsUrl: EVENTS_URL, reportUrl: `/report/${RUN}`, joined: false } };
  });
  await page.goto(`/report/${RUN}`);
  await expect(page.getByRole("heading", { name: "This run stopped before it finished" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { level: 1, name: BRAND })).toBeVisible();
  expect(resumed).toBe(true);
  await expect(page.getByRole("heading", { level: 2, name: "Campaign Kit" })).toBeVisible();
});

test("a resume answered with an example says so plainly", async ({ page }) => {
  const mock: Mock = {
    report: () => ({ status: 200, body: { status: "running", runId: RUN, eventsUrl: EVENTS_URL, resumable: true } }),
    first: () => "",
    queued: [],
    posts: [],
  };
  await mockApi(page, mock);
  await postRoute(page, mock, `**/api/run/${RUN}/resume`, () => ({
    status: 200,
    body: { mode: "example", slug: "food-hot-sauce", reason: "replay", message: "Live runs are off right now. Here's an example run instead." },
  }));
  await page.goto(`/report/${RUN}`);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Live runs are off right now. Here's an example run instead.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See the example run" })).toHaveAttribute("href", "/examples/food-hot-sauce");
});

test("a run that failed before measuring says what happened and points to the examples", async ({ page }) => {
  const failed = {
    ...liveReport,
    meta: { ...liveReport.meta, provenance: "partial" },
    audience: { proof: null, gap: null, segments: null },
    worlds: [],
    control: null,
    comparison: null,
    trace: [],
    stats: { stages: {} },
    partial: { stage: "prove", reason: "Qloo did not answer in time." },
  };
  const mock: Mock = { report: () => ({ status: 200, body: { status: "done", report: failed, eventsUrl: null } }), first: () => "", queued: [], posts: [] };
  const errors = await mockApi(page, mock);
  await page.goto(`/report/${RUN}`);
  await expect(page.getByRole("heading", { name: "This run didn't finish" })).toBeVisible();
  await expect(page.getByText("Qloo did not answer in time.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See an example report" })).toHaveAttribute("href", "/examples/food-hot-sauce");
  expect(errors).toEqual([]);
});

test("an expired report points to the examples, never a blank page", async ({ page }) => {
  const mock: Mock = { report: () => ({ status: 404, body: { error: { code: "not_found", message: "That report has expired." } } }), first: () => "", queued: [], posts: [] };
  await mockApi(page, mock);
  await page.goto(`/report/${RUN}`);
  await expect(page.getByRole("heading", { name: "This report is not here" })).toBeVisible();
  await expect(page.getByText("That report has expired.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See an example report" })).toBeVisible();
});

test("a finished run renders the full report with the live sticky action", async ({ page }) => {
  const mock = doneMock();
  const errors = await mockApi(page, mock);
  await page.goto(`/report/${RUN}`);
  await expect(page.getByRole("heading", { level: 1, name: BRAND })).toBeVisible();
  const order = await page.locator("[data-report-section]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-report-section")));
  expect(order).toEqual(["reality", "your-ad", "output", "screening", "kit", "why"]);
  await expect(page.getByRole("button", { name: "Email me this kit" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Make this for my product" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Storyboards" })).toHaveCount(recordedReport.worlds.length);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("storyboards render on demand, with the critique as agent decisions", async ({ page }) => {
  const mock = doneMock();
  await mockApi(page, mock);
  await postRoute(page, mock, `**/api/frames/${RUN}`, () => ({ status: 202, body: { status: "rendering", message: null }, queue: sse(framesEvents(lastSeq + 1), { after: "done" }) }));
  await page.goto(`/report/${RUN}`);
  const kit = page.locator(`section[aria-labelledby="kit-${world.segmentId}"]`);
  await kit.getByRole("button", { name: "Storyboards" }).click();
  await expect(kit.getByRole("list", { name: "Storyboard frames" }).getByRole("img")).toHaveCount(4);
  await expect(kit.getByText("Frame 2: product hidden")).toBeVisible();
  await expect(kit.getByText(/After: the bottle in hand at the table\./)).toBeVisible();
  expect(mock.posts).toEqual([{ url: expect.stringContaining(`/api/frames/${RUN}`), body: { segmentId: world.segmentId } }]);
});

test("paused storyboards and capped revisions read as plain notes", async ({ page }) => {
  const mock = doneMock();
  await mockApi(page, mock);
  await postRoute(page, mock, `**/api/frames/${RUN}`, () => ({ status: 200, body: { status: "paused", message: "Storyboards paused today." } }));
  await postRoute(page, mock, "**/api/revise", () => ({ status: 200, body: { status: "capped", revisionId: null, eventsUrl: EVENTS_URL, message: "This run has used its 3 revisions." } }));
  await page.goto(`/report/${RUN}`);
  const kit = page.locator(`section[aria-labelledby="kit-${world.segmentId}"]`);
  await kit.getByRole("button", { name: "Storyboards" }).click();
  await expect(kit.getByText("Storyboards paused today.")).toBeVisible();
  const brief = page.locator(`#brief-${world.segmentId}`);
  await brief.getByRole("button", { name: "Not this vibe: Music feel" }).click();
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  await expect(brief.getByText("This run has used its 3 revisions.")).toBeVisible();
});

test("Not this vibe revises a cue and shows the diff, with the old receipt kept", async ({ page }) => {
  const mock = doneMock();
  await mockApi(page, mock);
  await postRoute(page, mock, "**/api/revise", () => ({
    status: 202,
    body: { status: "revising", revisionId: REVISION_ID, eventsUrl: EVENTS_URL, message: null },
    queue: sse(revisionEvents(lastSeq + 1), { after: "done" }),
  }));
  await page.goto(`/report/${RUN}`);
  const brief = page.locator(`#brief-${world.segmentId}`);
  await brief.getByRole("button", { name: "Not this vibe: Music feel" }).click();
  await page.getByLabel("What feels off? (optional)").fill(NOTE);
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  await expect(brief.getByText("What changed")).toBeVisible();
  await expect(brief.getByText(NOTE)).toBeVisible();
  const oldMusic = world.brief.music.text as string;
  await expect(brief.getByText(oldMusic).first()).toBeVisible();
  await brief.getByRole("button", { name: /\(Qloo receipt\)/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Receipt: Was: Music feel" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(mock.posts).toEqual([{ url: expect.stringContaining("/api/revise"), body: { runId: RUN, segmentId: world.segmentId, field: "music", exclude: [], reason: NOTE } }]);
});
