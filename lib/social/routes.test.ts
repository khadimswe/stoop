// The social routes with fake dependencies: a MemoryStore, the plan store, a fake Graph API and plain
// Requests. Covers the flag (404 while off), the OAuth start and callback, the Pages list, posting a
// live plan's poster now and scheduled to Facebook and Instagram, examples refused (403), captions
// passed through exactly, the posts guard again, limits, the trail, and no token in any response.
import { beforeEach, describe, expect, it } from "vitest";
import { reducePlan, type PlanEventInput } from "../plan/events";
import { composePosts } from "../plan/posts";
import { samplePlanReport } from "../plan/posts-fixture";
import { storePlanSource } from "../plan/posts-store";
import type { PlanReport, Poster, Posts } from "../plan/schema";
import { instagramCopy } from "../plan/share";
import { loadPlanEvents } from "../plan/store";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { FAKE_APP, FAKE_PAGE, FAKE_TOKENS, fakeMeta, graphError, type FakeAnswer } from "./fake-meta";
import type { MetaApp } from "./meta";
import { connectCallback, connectedPages, disconnect, META_POSTS_PER_SESSION_DAILY, postToMeta, posterJpeg, startConnect, type SocialDeps } from "./routes";
import { loadConnection, META_SESSION_COOKIE, META_STATE_COOKIE, mintSession, mintState, saveConnection, type MetaConnection } from "./session";
import { readSocialTrail } from "./trail";

const SECRET = "s".repeat(40);
const app: MetaApp = { ...FAKE_APP };
const RUN = "plan_000000000000000000000001";
const NOW = Date.parse("2026-10-28T15:00:00Z");
const UNTIL = Date.parse("2026-11-17T08:00:00Z");
const ORIGIN = "https://stoop.example";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ALL_TOKENS = Object.values(FAKE_TOKENS);

const openings = {
  facebook: "We're out front this Saturday with tacos from [[place-taqueria]]. Come say hi.",
  instagram: "Tacos from [[place-taqueria]] out front this Saturday.",
  hashtags: ["Testville", "ShopLocal"],
  whatsapp: "Out front Saturday with tacos from [[place-taqueria]].",
};

let store: MemoryStore;
let meta: ReturnType<typeof fakeMeta>;
let posts: Posts;

function deps(over: Partial<SocialDeps> = {}, answers: Record<string, FakeAnswer> = {}): SocialDeps {
  meta = fakeMeta(answers);
  return {
    enabled: true,
    app,
    secret: SECRET,
    until: UNTIL,
    store: () => store,
    source: (s) => storePlanSource(s, { now: () => new Date(NOW) }),
    fetch: meta.fetch,
    poster: async () => PNG,
    toJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    now: () => NOW,
    sleep: async () => {},
    ...over,
  };
}

/** A finished live plan with its poster and posts, as the pipeline and marketing job leave it. */
async function seedPlan(poster: Poster["status"] = "ready", withPosts = true): Promise<PlanReport> {
  const report = samplePlanReport();
  posts = { ...composePosts(openings, report), share: {} };
  const events: PlanEventInput[] = [{ type: "plan.started", runId: RUN, kind: "live", inputs: report.inputs }];
  for (const evidence of report.ledger) events.push({ type: "evidence.added", evidence });
  events.push({ type: "local.city", city: report.local.city! }, { type: "local.block", block: report.local.block! }, { type: "plan.ready", plan: report.plan! }, { type: "run.done" });
  events.push({ type: "poster.updated", poster: { status: poster, prompt: "art", promptHash: "a".repeat(64), alt: "Event poster" } });
  if (withPosts) events.push({ type: "posts.ready", posts });
  await storePlanSource(store).append(RUN, events);
  return report;
}

/** A connected browser: its stored tokens and its session cookie. */
async function connect(over: Partial<MetaConnection> = {}): Promise<string> {
  const session = mintSession(SECRET);
  const connection: MetaConnection = {
    v: 1,
    user: { token: FAKE_TOKENS.user, expiresAt: null },
    pages: [{ id: FAKE_PAGE.id, name: FAKE_PAGE.name, token: FAKE_TOKENS.page, canPost: true, instagram: { id: FAKE_PAGE.instagram.id, username: FAKE_PAGE.instagram.username } }],
    connectedAt: new Date(NOW).toISOString(),
    ...over,
  };
  await saveConnection(store, SECRET, session.id, connection, 3600);
  return `${META_SESSION_COOKIE}=${session.value}`;
}

const postRequest = (body: unknown, cookieHeader: string | null, origin = ORIGIN, id = RUN) =>
  new Request(`${origin}/api/plan/${id}/social/post`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    body: JSON.stringify(body),
  });

async function noTokens(response: Response) {
  const text = await response.clone().text();
  const headers = JSON.stringify([...response.headers]);
  for (const token of [...ALL_TOKENS, app.appSecret]) {
    expect(text).not.toContain(token);
    expect(headers).not.toContain(token);
  }
  return text;
}

beforeEach(() => {
  store = new MemoryStore();
});

describe("ENABLE_META_POSTING off, or no app keys", () => {
  it("answers 404 on every route", async () => {
    await seedPlan();
    const cookie = await connect();
    for (const d of [deps({ enabled: false }), deps({ app: null }), deps({ secret: null }), deps({ now: () => UNTIL + 1 })]) {
      expect((await startConnect(new Request(`${ORIGIN}/api/social/meta/start`), d)).status).toBe(404);
      expect((await connectCallback(new Request(`${ORIGIN}/api/social/meta/callback?code=x&state=y`), d)).status).toBe(404);
      expect((await connectedPages(new Request(`${ORIGIN}/api/social/meta/pages`, { headers: { cookie } }), d)).status).toBe(404);
      expect((await disconnect(new Request(`${ORIGIN}/api/social/meta/disconnect`, { method: "POST", headers: { cookie } }), d)).status).toBe(404);
      expect((await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, d)).status).toBe(404);
      expect((await posterJpeg(RUN, d)).status).toBe(404);
    }
    expect(meta.calls).toHaveLength(0);
  });
});

describe("connecting", () => {
  it("starts with a redirect to Facebook carrying a signed state, and a state cookie", async () => {
    const response = await startConnect(new Request(`${ORIGIN}/api/social/meta/start?return=${encodeURIComponent("/plan/plan_1?tab=post")}`), deps());
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://www.facebook.com");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/social/meta/callback`);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^${META_STATE_COOKIE}=[0-9a-f]{32}; Path=/api/social/meta; Max-Age=600; HttpOnly; SameSite=Lax; Secure$`));
  });

  it("stores the tokens sealed under a new session cookie and goes back to the page", async () => {
    const { state, nonce } = mintState(SECRET, "/plan/plan_1", NOW);
    const response = await connectCallback(new Request(`${ORIGIN}/api/social/meta/callback?code=CODE123&state=${encodeURIComponent(state)}`, { headers: { cookie: `${META_STATE_COOKIE}=${nonce}` } }), deps());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/plan/plan_1?meta=connected`);
    await noTokens(response);
    const session = response.headers.getSetCookie().find((c) => c.startsWith(`${META_SESSION_COOKIE}=`))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Path=/api;");
    expect(session).toContain(`Max-Age=${Math.floor((UNTIL - NOW) / 1000)}`);
    const id = session.split("=")[1]!.split(".")[0]!;
    const stored = await loadConnection(store, SECRET, id);
    expect(stored?.user.token).toBe(FAKE_TOKENS.user);
    expect(stored?.pages.map((p) => p.id)).toEqual(["111", "222"]);
    expect(JSON.stringify(await store.get(keys.social.metaSession(id)))).not.toContain(FAKE_TOKENS.page);
    // The code was exchanged with the same redirect URI the dialog used.
    expect(meta.calls[0]?.query.redirect_uri).toBe(`${ORIGIN}/api/social/meta/callback`);
  });

  it("refuses a state without this browser's cookie, and says when the manager said no", async () => {
    const { state, nonce } = mintState(SECRET, "/plan/plan_1", NOW);
    const forged = await connectCallback(new Request(`${ORIGIN}/api/social/meta/callback?code=C&state=${encodeURIComponent(state)}`), deps());
    expect(forged.headers.get("location")).toBe(`${ORIGIN}/?meta=expired`);
    expect(meta.calls).toHaveLength(0);
    const denied = await connectCallback(new Request(`${ORIGIN}/api/social/meta/callback?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { cookie: `${META_STATE_COOKIE}=${nonce}` } }), deps());
    expect(denied.headers.get("location")).toBe(`${ORIGIN}/plan/plan_1?meta=denied`);
  });

  it("goes back with meta=failed when Meta refuses the code", async () => {
    const { state, nonce } = mintState(SECRET, "/", NOW);
    const response = await connectCallback(new Request(`${ORIGIN}/api/social/meta/callback?code=C&state=${encodeURIComponent(state)}`, { headers: { cookie: `${META_STATE_COOKIE}=${nonce}` } }), deps({}, { "GET oauth/access_token": graphError(100) }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?meta=failed`);
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${META_SESSION_COOKIE}=`))).toBe(false);
  });

  it("lists Page names, ids and Instagram, never a token", async () => {
    const cookie = await connect();
    const response = await connectedPages(new Request(`${ORIGIN}/api/social/meta/pages`, { headers: { cookie } }), deps());
    const text = await noTokens(response);
    expect(JSON.parse(text)).toEqual({ connected: true, pages: [{ id: "111", name: FAKE_PAGE.name, canPost: true, instagram: { username: "cornerwireless" } }] });
    const none = await connectedPages(new Request(`${ORIGIN}/api/social/meta/pages`), deps());
    expect(await none.json()).toEqual({ connected: false, pages: [] });
  });

  it("disconnects: the stored tokens are gone and the cookie is cleared", async () => {
    const cookie = await connect();
    const response = await disconnect(new Request(`${ORIGIN}/api/social/meta/disconnect`, { method: "POST", headers: { cookie, "sec-fetch-site": "same-origin" } }), deps());
    expect(response.headers.get("set-cookie")).toContain(`${META_SESSION_COOKIE}=; Path=/api; Max-Age=0`);
    const id = cookie.split("=")[1]!.split(".")[0]!;
    expect(await store.get(keys.social.metaSession(id))).toBeNull();
  });
});

describe("posting a plan", () => {
  it("never posts an example plan", async () => {
    const cookie = await connect();
    const response = await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie, ORIGIN, "ex-chicago-18th-street"), "ex-chicago-18th-street", deps());
    expect(response.status).toBe(403);
    expect(meta.calls).toHaveLength(0);
  });

  it("needs a connection, one of its Pages, and a plan with its poster and posts", async () => {
    await seedPlan("queued");
    expect((await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, null), RUN, deps())).status).toBe(401);
    const cookie = await connect();
    expect((await postToMeta(postRequest({ pageId: "999", channels: ["facebook"], when: "now" }, cookie), RUN, deps())).status).toBe(404);
    expect((await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, deps())).status).toBe(409);
    expect((await postToMeta(postRequest({ pageId: "111", channels: [], when: "now" }, cookie), RUN, deps())).status).toBe(400);
    expect(meta.calls).toHaveLength(0);
  });

  it("posts the poster to Facebook now with the approved caption, exactly, and records it on the plan", async () => {
    await seedPlan();
    const cookie = await connect();
    const response = await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, deps());
    expect(response.status).toBe(200);
    const body = JSON.parse(await noTokens(response));
    expect(body.results).toEqual([{ channel: "facebook", status: "posted", message: "Posted to Facebook at 10:00 am on Wed, Oct 28", link: "https://www.facebook.com/111_900", error: null }]);
    const call = meta.calls.find((c) => c.path === "111/photos")!;
    expect(call.body.caption).toBe(posts.facebook.text);
    expect(call.body.published).toBe("true");
    expect(call.file).toMatchObject({ type: "image/png", size: PNG.length });
    const trail = readSocialTrail(reducePlan(await loadPlanEvents(store, RUN)).report.trace);
    expect(trail).toEqual([{ channel: "facebook", status: "posted", label: "Posted to Facebook at 10:00 am on Wed, Oct 28" }]);
  });

  it("never posts twice on a double tap", async () => {
    await seedPlan();
    const cookie = await connect();
    const d = deps();
    await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, d);
    const again = await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, d);
    expect((await again.json()).results[0]).toMatchObject({ status: "skipped" });
    expect(meta.calls.filter((c) => c.path === "111/photos")).toHaveLength(1);
  });

  it("schedules the Facebook post, and says Instagram cannot be scheduled through the API", async () => {
    await seedPlan();
    const cookie = await connect();
    const when = "2026-11-07T01:00:00.000Z";
    const response = await postToMeta(postRequest({ pageId: "111", channels: ["facebook", "instagram"], when }, cookie), RUN, deps());
    const body = await response.json();
    expect(body.results[0]).toMatchObject({ channel: "facebook", status: "scheduled", message: "Scheduled on Facebook for 7:00 pm on Fri, Nov 6", link: null });
    expect(body.results[1]).toMatchObject({ channel: "instagram", status: "skipped", error: "schedule" });
    const call = meta.calls.find((c) => c.path === "111/photos")!;
    expect(call.body).toMatchObject({ published: "false", scheduled_publish_time: String(Date.parse(when) / 1000) });
    expect(meta.calls.some((c) => c.path.includes("/media"))).toBe(false);
  });

  it("refuses a schedule Meta would refuse", async () => {
    await seedPlan();
    const cookie = await connect();
    const response = await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: new Date(NOW + 5 * 60_000).toISOString() }, cookie), RUN, deps());
    expect(response.status).toBe(400);
    expect(meta.calls).toHaveLength(0);
  });

  it("publishes to Instagram in two steps from the public JPEG, with the approved caption and hashtags", async () => {
    await seedPlan();
    const cookie = await connect();
    const response = await postToMeta(postRequest({ pageId: "111", channels: ["instagram"], when: "now" }, cookie), RUN, deps());
    const body = JSON.parse(await noTokens(response));
    expect(body.results[0]).toMatchObject({ channel: "instagram", status: "posted", link: "https://www.instagram.com/p/abc123/" });
    const create = meta.calls.find((c) => c.path === `${FAKE_PAGE.instagram.id}/media`)!;
    expect(create.body.image_url).toBe(`${ORIGIN}/api/plan/${RUN}/social/poster.jpg`);
    expect(create.body.caption).toBe(instagramCopy(posts));
    expect(create.body.is_ai_generated).toBe("true");
    expect(meta.calls.some((c) => c.path === `${FAKE_PAGE.instagram.id}/media_publish` && c.body.creation_id === "555")).toBe(true);
  });

  it("does not label plain-background posters as AI art", async () => {
    await seedPlan("skipped");
    const cookie = await connect();
    await postToMeta(postRequest({ pageId: "111", channels: ["instagram"], when: "now" }, cookie), RUN, deps());
    expect(meta.calls.find((c) => c.path.endsWith("/media"))?.body.is_ai_generated).toBeUndefined();
  });

  it("says plainly that Instagram cannot reach a localhost poster, and still posts to Facebook", async () => {
    await seedPlan();
    const cookie = await connect();
    const response = await postToMeta(postRequest({ pageId: "111", channels: ["facebook", "instagram"], when: "now" }, cookie, "http://localhost:3000"), RUN, deps());
    const body = await response.json();
    expect(body.results[0]).toMatchObject({ channel: "facebook", status: "posted" });
    expect(body.results[1]).toMatchObject({ channel: "instagram", status: "failed", error: "image" });
    expect(body.results[1].message).toContain("not public");
  });

  it("skips Instagram on a Page without a linked account", async () => {
    await seedPlan();
    const cookie = await connect({ pages: [{ id: "111", name: "Corner", token: FAKE_TOKENS.page, canPost: true, instagram: null }] });
    const body = await (await postToMeta(postRequest({ pageId: "111", channels: ["instagram"], when: "now" }, cookie), RUN, deps())).json();
    expect(body.results[0]).toMatchObject({ status: "skipped", error: "not_linked" });
  });

  it("refuses drafts that no longer pass the posts guard, and posts nothing", async () => {
    await seedPlan();
    const cookie = await connect();
    // A draft changed after approval (as if the stored posts were edited by hand).
    await storePlanSource(store).append(RUN, [{ type: "posts.ready", posts: { ...posts, facebook: { text: `${posts.facebook.text}\nBest deals in town, guaranteed.` } } }]);
    const response = await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, deps());
    expect(response.status).toBe(422);
    expect(meta.calls).toHaveLength(0);
  });

  it("reports Meta's refusal in plain words, frees the slot for a retry, and writes no trail", async () => {
    await seedPlan();
    const cookie = await connect();
    const failing = deps({}, { "POST 111/photos": graphError(200, 403) });
    const body = JSON.parse(await noTokens(await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, failing)));
    expect(body.results[0]).toMatchObject({ status: "failed", error: "permission" });
    expect(readSocialTrail(reducePlan(await loadPlanEvents(store, RUN)).report.trace)).toEqual([]);
    const retry = await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, deps());
    expect((await retry.json()).results[0].status).toBe("posted");
  });

  it("holds the slot when Meta gave no clear answer, so a second tap cannot post twice", async () => {
    await seedPlan();
    const cookie = await connect();
    const unclear = deps({}, { "POST 111/photos": { status: 503, body: { error: { code: 2, message: "Service temporarily unavailable" } } } });
    const first = (await (await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, unclear)).json()).results[0];
    expect(first).toMatchObject({ status: "failed", error: "unavailable" });
    expect(first.message).toContain("Check the Page first");
    const again = deps();
    const second = (await (await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: "now" }, cookie), RUN, again)).json()).results[0];
    expect(second.status).toBe("skipped");
    expect(meta.calls).toHaveLength(0);
  });

  it("limits posts per Page per day, even across new connections", async () => {
    await seedPlan();
    const d = deps();
    const day = Date.parse("2026-11-01T15:00:00Z");
    for (let i = 0; i < 12; i++) {
      // A fresh connection every time, as if the manager kept reconnecting.
      const cookie = await connect();
      const status = (await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: new Date(day + i * 3_600_000).toISOString() }, cookie), RUN, d)).status;
      expect(status).toBe(i < 10 ? 200 : 429);
    }
  });

  it("limits posts per connection per day", async () => {
    await seedPlan();
    const cookie = await connect();
    const d = deps();
    const day = Date.parse("2026-11-01T15:00:00Z");
    for (let i = 0; i < META_POSTS_PER_SESSION_DAILY; i++) {
      const when = new Date(day + i * 3_600_000).toISOString();
      expect((await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when }, cookie), RUN, d)).status).toBe(200);
    }
    const over = await postToMeta(postRequest({ pageId: "111", channels: ["facebook"], when: new Date(day + 20 * 3_600_000).toISOString() }, cookie), RUN, d);
    expect(over.status).toBe(429);
  });

  it("refuses another site's request", async () => {
    await seedPlan();
    const cookie = await connect();
    const request = new Request(`${ORIGIN}/api/plan/${RUN}/social/post`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site", cookie }, body: JSON.stringify({ pageId: "111", channels: ["facebook"], when: "now" }) });
    expect((await postToMeta(request, RUN, deps())).status).toBe(403);
    expect(meta.calls).toHaveLength(0);
  });
});

describe("the Instagram JPEG", () => {
  it("serves a live plan's poster as a JPEG, and nothing for examples", async () => {
    const response = await posterJpeg(RUN, deps());
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect((await posterJpeg("ex-chicago-18th-street", deps())).status).toBe(404);
    expect((await posterJpeg(RUN, deps({ poster: async () => null }))).status).toBe(404);
  });
});
