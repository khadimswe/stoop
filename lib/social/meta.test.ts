// The Meta adapter against a fake Graph API: the login URL, the token exchanges, the Pages list, a Page
// photo post now and scheduled, the Instagram two-step publish, and typed errors that never carry a
// response body.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FAKE_APP, FAKE_PAGE, FAKE_TOKENS, fakeMeta, graphError } from "./fake-meta";
import {
  AI_LABEL_NOTE,
  classifyMetaError,
  exchangeCode,
  GRAPH_VERSION,
  isPublicImageUrl,
  listPages,
  longLivedUserToken,
  META_SCOPES,
  metaApp,
  MetaError,
  NOT_PUBLIC_MESSAGE,
  oauthUrl,
  postPagePhoto,
  publishInstagramImage,
  type MetaApp,
} from "./meta";

const app: MetaApp = { ...FAKE_APP };
const NOW = Date.parse("2026-10-28T15:00:00Z");
const png = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), contentType: "image/png" as const, filename: "poster.png" };
const proof = (token: string) => createHmac("sha256", app.appSecret).update(token).digest("hex");

describe("the Meta app", () => {
  it("is off without both keys", () => {
    expect(metaApp({})).toBeNull();
    expect(metaApp({ META_APP_ID: "1234567890" })).toBeNull();
    expect(metaApp({ META_APP_ID: "not-a-number", META_APP_SECRET: app.appSecret })).toBeNull();
    expect(metaApp({ META_APP_ID: " 1234567890 ", META_APP_SECRET: app.appSecret })).toEqual(app);
    expect(metaApp({ META_APP_ID: "1234567890", META_APP_SECRET: app.appSecret, META_CONFIG_ID: "987654321" })?.configId).toBe("987654321");
  });
});

describe("the login dialog", () => {
  it("asks for exactly the posting permissions, with the code flow and the state", () => {
    const url = new URL(oauthUrl(app, "https://stoop.example/api/social/meta/callback", "STATE"));
    expect(`${url.origin}${url.pathname}`).toBe(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    expect(url.searchParams.get("client_id")).toBe(app.appId);
    expect(url.searchParams.get("redirect_uri")).toBe("https://stoop.example/api/social/meta/callback");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")?.split(",")).toEqual(["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"]);
    expect(META_SCOPES).toHaveLength(6);
    expect(url.toString()).not.toContain(app.appSecret);
  });

  it("uses a Login for Business configuration in place of scope when one is set", () => {
    const url = new URL(oauthUrl({ ...app, configId: "987654321" }, "https://stoop.example/cb", "S"));
    expect(url.searchParams.get("config_id")).toBe("987654321");
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("tokens", () => {
  it("swaps the code for a short-lived token, then a long-lived one", async () => {
    const meta = fakeMeta();
    const call = { fetch: meta.fetch, app };
    const short = await exchangeCode(call, "CODE123", "https://stoop.example/api/social/meta/callback", NOW);
    expect(short).toEqual({ token: FAKE_TOKENS.short, expiresAt: NOW + 3_600_000 });
    expect(meta.calls[0]).toMatchObject({ method: "GET", path: "oauth/access_token", query: { client_id: app.appId, client_secret: app.appSecret, redirect_uri: "https://stoop.example/api/social/meta/callback", code: "CODE123" } });
    const long = await longLivedUserToken(call, short.token, NOW);
    expect(long).toEqual({ token: FAKE_TOKENS.user, expiresAt: NOW + 5_184_000_000 });
    expect(meta.calls[1]?.query).toMatchObject({ grant_type: "fb_exchange_token", client_id: app.appId, fb_exchange_token: FAKE_TOKENS.short });
  });

  it("refuses an empty code without calling Meta", async () => {
    const meta = fakeMeta();
    await expect(exchangeCode({ fetch: meta.fetch, app }, "", "https://stoop.example/cb")).rejects.toMatchObject({ kind: "invalid" });
    expect(meta.calls).toHaveLength(0);
  });
});

describe("the Pages list", () => {
  it("lists Pages with their tokens, whether the person can post, and the linked Instagram account", async () => {
    const meta = fakeMeta();
    const pages = await listPages({ fetch: meta.fetch, app }, FAKE_TOKENS.user);
    expect(pages).toEqual([
      { id: FAKE_PAGE.id, name: FAKE_PAGE.name, token: FAKE_TOKENS.page, canPost: true, instagram: { id: FAKE_PAGE.instagram.id, username: FAKE_PAGE.instagram.username } },
      { id: "222", name: "A Page I only read", token: FAKE_TOKENS.otherPage, canPost: false, instagram: null },
    ]);
    const call = meta.calls[0]!;
    expect(call.path).toBe("me/accounts");
    expect(call.query.fields).toBe("id,name,access_token,tasks,instagram_business_account{id,username}");
    expect(call.query.appsecret_proof).toBe(proof(FAKE_TOKENS.user));
  });

  it("lists the Pages without Instagram when the Instagram permissions were not granted", async () => {
    let first = true;
    const meta = fakeMeta({
      "GET me/accounts": () => {
        if (first) {
          first = false;
          return graphError(10, 403);
        }
        return { body: { data: [{ id: "111", name: "Corner", access_token: FAKE_TOKENS.page }] } };
      },
    });
    const pages = await listPages({ fetch: meta.fetch, app }, FAKE_TOKENS.user);
    expect(pages).toEqual([{ id: "111", name: "Corner", token: FAKE_TOKENS.page, canPost: true, instagram: null }]);
    expect(meta.calls[1]?.query.fields).toBe("id,name,access_token,tasks");
  });
});

describe("a Page photo post", () => {
  it("uploads the poster with the caption exactly as given, published now, the token in the body only", async () => {
    const meta = fakeMeta();
    const caption = "Tacos out front Saturday!\n\nWhen: Saturday, November 7, 12 to 4 pm\nOffer: $25/mo unlimited";
    const result = await postPagePhoto({ fetch: meta.fetch, app }, { id: FAKE_PAGE.id, token: FAKE_TOKENS.page }, { caption, image: png, scheduleAt: null }, NOW);
    expect(result).toEqual({ photoId: "900", postId: "111_900" });
    const call = meta.calls[0]!;
    expect(call).toMatchObject({ method: "POST", path: "111/photos", query: {} });
    expect(call.body).toEqual({ caption, published: "true", access_token: FAKE_TOKENS.page, appsecret_proof: proof(FAKE_TOKENS.page) });
    expect(call.file).toEqual({ type: "image/png", size: png.bytes.length, name: "poster.png" });
    expect(meta.urls[0]).not.toContain(FAKE_TOKENS.page);
  });

  it("schedules it unpublished with a publish time in seconds", async () => {
    const meta = fakeMeta();
    const at = new Date(NOW + 2 * 24 * 60 * 60_000);
    await postPagePhoto({ fetch: meta.fetch, app }, { id: FAKE_PAGE.id, token: FAKE_TOKENS.page }, { caption: "Hi", image: png, scheduleAt: at }, NOW);
    expect(meta.calls[0]?.body).toMatchObject({ published: "false", scheduled_publish_time: String(Math.floor(at.getTime() / 1000)) });
  });

  it("refuses a time outside 10 minutes to 30 days without calling Meta", async () => {
    const meta = fakeMeta();
    const post = (ms: number) => postPagePhoto({ fetch: meta.fetch, app }, { id: FAKE_PAGE.id, token: FAKE_TOKENS.page }, { caption: "Hi", image: png, scheduleAt: new Date(NOW + ms) }, NOW);
    await expect(post(5 * 60_000)).rejects.toMatchObject({ kind: "schedule" });
    await expect(post(31 * 24 * 60 * 60_000)).rejects.toMatchObject({ kind: "schedule" });
    expect(meta.calls).toHaveLength(0);
  });
});

describe("the Instagram publish", () => {
  const account = { igUserId: FAKE_PAGE.instagram.id, tokens: [FAKE_TOKENS.page, FAKE_TOKENS.user] };
  const post = { imageUrl: "https://stoop.example/api/plan/plan_1/social/poster.jpg", caption: "Out front Saturday.\n\n#Testville #ShopLocal", aiGenerated: true };

  it("makes a container from the public image, checks it, then publishes it", async () => {
    const meta = fakeMeta();
    const result = await publishInstagramImage({ fetch: meta.fetch, app }, account, post, { sleep: async () => {} });
    expect(result).toEqual({ mediaId: "777", permalink: "https://www.instagram.com/p/abc123/", note: null });
    expect(meta.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${FAKE_PAGE.instagram.id}/media`, "GET 555", `POST ${FAKE_PAGE.instagram.id}/media_publish`, "GET 777"]);
    expect(meta.calls[0]?.body).toMatchObject({ image_url: post.imageUrl, caption: post.caption, is_ai_generated: "true", access_token: FAKE_TOKENS.page });
    expect(meta.calls[2]?.body).toMatchObject({ creation_id: "555" });
  });

  it("waits while the container is in progress", async () => {
    let checks = 0;
    const meta = fakeMeta({ "GET 555": () => ({ body: { status_code: ++checks < 3 ? "IN_PROGRESS" : "FINISHED" } }) });
    const waits: number[] = [];
    await publishInstagramImage({ fetch: meta.fetch, app }, account, post, { sleep: async (ms) => void waits.push(ms) });
    expect(checks).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("stops when Instagram could not read the image", async () => {
    const meta = fakeMeta({ "GET 555": { body: { status_code: "ERROR" } } });
    await expect(publishInstagramImage({ fetch: meta.fetch, app }, account, post, { sleep: async () => {} })).rejects.toMatchObject({ kind: "image" });
    expect(meta.calls.some((c) => c.path.endsWith("media_publish"))).toBe(false);
  });

  it("never sends a localhost or private image URL, and says why", async () => {
    const meta = fakeMeta();
    for (const imageUrl of ["http://localhost:3000/api/plan/p/social/poster.jpg", "https://127.0.0.1/p.jpg", "https://10.0.0.5/p.jpg", "http://stoop.example/p.jpg"]) {
      await expect(publishInstagramImage({ fetch: meta.fetch, app }, account, { ...post, imageUrl })).rejects.toMatchObject({ kind: "image", message: NOT_PUBLIC_MESSAGE });
    }
    expect(meta.calls).toHaveLength(0);
    expect(isPublicImageUrl("https://stoop.example/x.jpg")).toBe(true);
  });

  it("tries the user token when Meta refuses the Page token", async () => {
    const meta = fakeMeta({ [`POST ${FAKE_PAGE.instagram.id}/media`]: (call) => (call.body.access_token === FAKE_TOKENS.page ? graphError(190, 400) : { body: { id: "555" } }) });
    await publishInstagramImage({ fetch: meta.fetch, app }, account, post, { sleep: async () => {} });
    expect(meta.calls[1]?.body.access_token).toBe(FAKE_TOKENS.user);
    expect(meta.calls.at(-2)?.body.access_token).toBe(FAKE_TOKENS.user);
  });

  it("publishes without the AI label where the API does not take it, and says to add it", async () => {
    const meta = fakeMeta({ [`POST ${FAKE_PAGE.instagram.id}/media`]: (call) => (call.body.is_ai_generated ? { status: 400, body: { error: { code: 100, message: "Invalid parameter" } } } : { body: { id: "555" } }) });
    const result = await publishInstagramImage({ fetch: meta.fetch, app }, account, post, { sleep: async () => {} });
    expect(result.note).toBe(AI_LABEL_NOTE);
  });

  it("never cuts a caption that is too long for Instagram", async () => {
    const meta = fakeMeta();
    await expect(publishInstagramImage({ fetch: meta.fetch, app }, account, { ...post, caption: "a".repeat(2201) })).rejects.toMatchObject({ kind: "invalid" });
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
    await expect(publishInstagramImage({ fetch: meta.fetch, app }, account, { ...post, caption: `Hi ${tags}` })).rejects.toMatchObject({ kind: "invalid" });
    expect(meta.calls).toHaveLength(0);
  });
});

describe("errors", () => {
  it("are typed by what the manager can do", () => {
    expect(classifyMetaError(400, 190, null)).toBe("auth");
    expect(classifyMetaError(403, 200, null)).toBe("permission");
    expect(classifyMetaError(403, 10, null)).toBe("permission");
    expect(classifyMetaError(400, 4, null)).toBe("rate_limited");
    expect(classifyMetaError(400, 368, null)).toBe("rate_limited");
    expect(classifyMetaError(400, 9004, null)).toBe("image");
    expect(classifyMetaError(400, 100, 2207052)).toBe("image");
    expect(classifyMetaError(500, null, null)).toBe("unavailable");
    expect(classifyMetaError(400, 100, null)).toBe("invalid");
  });

  it("carry Meta's codes and Stoop's words, never the response body", async () => {
    const meta = fakeMeta({ [`POST ${FAKE_PAGE.id}/photos`]: graphError(190) });
    const error = await postPagePhoto({ fetch: meta.fetch, app }, { id: FAKE_PAGE.id, token: FAKE_TOKENS.page }, { caption: "Hi", image: png, scheduleAt: null }, NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaError);
    expect(error).toMatchObject({ kind: "auth", code: 190 });
    expect(String((error as Error).message)).not.toContain(FAKE_TOKENS.page);
    expect(JSON.stringify(error)).not.toContain(FAKE_TOKENS.page);
  });

  it("turn a network failure into unavailable", async () => {
    const fetch = async () => {
      throw new TypeError(`fetch failed for ${FAKE_TOKENS.page}`);
    };
    await expect(listPages({ fetch, app }, FAKE_TOKENS.user)).rejects.toMatchObject({ kind: "unavailable", message: "Facebook did not answer. Try again in a moment." });
  });
});
