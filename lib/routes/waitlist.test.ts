import { describe, expect, it, vi } from "vitest";
import { allowAll, type BotCheck } from "../bot-check";
import type { Mailer } from "../email";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { listEntries } from "../waitlist";
import { createWaitlistExport, createWaitlistPost, EXPORT_COLUMNS, tokenMatches, WAITLIST_MAX_BYTES } from "./waitlist";

function setup(options: { mailer?: Mailer | null; botCheck?: BotCheck; store?: () => MemoryStore } = {}) {
  const store = new MemoryStore();
  const deferred: (() => Promise<unknown>)[] = [];
  const post = createWaitlistPost({
    store: options.store ?? (() => store),
    botCheck: () => options.botCheck ?? allowAll,
    mailer: () => options.mailer ?? null,
    defer: (task) => deferred.push(task),
  });
  /** Runs what the route left for after the response, as after() would. */
  const flush = async () => {
    const outcomes = [];
    while (deferred.length) outcomes.push(await (deferred.shift() as () => Promise<unknown>)());
    return outcomes;
  };
  return { store, post, deferred, flush };
}

const body = (fields: Record<string, unknown>) => JSON.stringify({ email: "ana@shop.example", sellsOn: "shopify", consent: true, ...fields });
const send = (post: (r: Request) => Promise<Response>, payload: string, ip = "203.0.113.7", headers: Record<string, string> = {}) =>
  post(new Request("https://stoop.example/api/waitlist", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers }, body: payload }));
/** The signup cookie a response set, as the browser would send it back. */
const cookieOf = (response: Response) => ({ cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" });

describe("POST /api/waitlist", () => {
  it("signs up with a real position and a signup cookie, and a repeat from that browser keeps it and updates it", async () => {
    const { post, store } = setup();
    const first = await send(post, body({ plan: "founder" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ position: 1 });
    expect(first.headers.get("set-cookie")).toMatch(/^stoop_signup=[0-9a-f]{32}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
    expect(await (await send(post, body({ email: "ben@shop.example" }), "198.51.100.2")).json()).toEqual({ position: 2 });
    // The success screen's product link posts the same email again, with the cookie: same position, link saved.
    const again = await send(post, body({ email: " ANA@shop.example", productLink: "https://shop.example/products/sauce", sourceReport: "home", plan: "studio" }), "203.0.113.7", cookieOf(first));
    expect(await again.json()).toEqual({ position: 1 });
    expect(again.headers.get("set-cookie")).toBeNull();
    const [ana] = await listEntries(store);
    expect(ana).toMatchObject({ position: 1, productLink: "https://shop.example/products/sauce", sourceReport: "home", plan: "studio" });
  });

  it("lets a post without that cookie fill only empty fields of someone else's entry", async () => {
    const { post, store } = setup();
    await send(post, body({ plan: "founder" }));
    await send(post, body({ plan: "studio", consent: false, productLink: "https://elsewhere.example/p" }), "198.51.100.2");
    const [ana] = await listEntries(store);
    expect(ana).toMatchObject({ plan: "founder", consent: true, productLink: "https://elsewhere.example/p" });
  });

  it("answers a filled honeypot like a signup, and stores and sends nothing", async () => {
    const send_ = vi.fn<Mailer["send"]>(async () => {});
    const { post, store, deferred } = setup({ mailer: { send: send_ } });
    await send(post, body({ email: "real@shop.example" }), "198.51.100.2");
    const bot = await send(post, body({ email: "bot@spam.example", company: "Acme" }));
    expect(bot.status).toBe(200);
    expect(await bot.json()).toEqual({ position: 2 });
    expect(await store.get(keys.waitlist.position)).toBe(1);
    expect((await listEntries(store)).map((e) => e.email)).toEqual(["real@shop.example"]);
    expect(deferred).toHaveLength(1); // only the real signup's email
  });

  it("sends the confirmation once, after the response, only for a first signup", async () => {
    const sent = vi.fn<Mailer["send"]>(async () => {});
    const { post, flush } = setup({ mailer: { send: sent } });
    await send(post, body({}));
    expect(sent).not.toHaveBeenCalled();
    expect(await flush()).toEqual(["sent"]);
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@shop.example", subject: "You're on the Stoop waitlist", idempotencyKey: expect.stringMatching(/^waitlist-confirm-[0-9a-f]{32}$/) }));
    await send(post, body({ productLink: "https://shop.example/p" }));
    expect(await flush()).toEqual([]);
    // Consent covers emails beyond the confirmation, so a first signup without it is still confirmed.
    await send(post, body({ email: "quiet@shop.example", consent: false }), "198.51.100.2");
    expect(await flush()).toEqual(["sent"]);
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("stops confirmations at the daily cap, and keeps signing people up", async () => {
    const sent = vi.fn<Mailer["send"]>(async () => {});
    const { post, flush, store } = setup({ mailer: { send: sent } });
    for (let i = 0; i < 101; i++) expect((await send(post, body({ email: `p${i}@shop.example` }), `10.0.${Math.floor(i / 8)}.${i % 8}`)).status).toBe(200);
    expect(await flush()).toHaveLength(100);
    expect(sent).toHaveBeenCalledTimes(100);
    expect(await listEntries(store)).toHaveLength(101);
  });

  it("skips the email without Resend keys, and still signs up", async () => {
    const { post, flush, store } = setup({ mailer: null });
    expect((await send(post, body({}))).status).toBe(200);
    expect(await flush()).toEqual([]);
    expect(await listEntries(store)).toHaveLength(1);
  });

  it("keeps the signup when the email fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { post, flush, store } = setup({ mailer: { send: async () => Promise.reject(new Error("Resend refused the email: rate_limit_exceeded")) } });
    const response = await send(post, body({}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ position: 1 });
    expect(await flush()).toEqual(["failed"]);
    expect(await listEntries(store)).toHaveLength(1);
    warn.mockRestore();
  });

  it("rejects bad input with the API's error shape", async () => {
    const { post, store } = setup();
    const cases: [string, number][] = [
      ["not json", 400],
      [body({ email: "not-an-email" }), 400],
      [body({ sellsOn: "etsy" }), 400],
      [body({ consent: "yes" }), 400],
      [body({ plan: "enterprise" }), 400],
      [body({ sourceReport: "Free text with spaces" }), 400],
      [body({ productLink: "javascript:alert(1)" }), 400],
      [body({ extra: "field" }), 400],
      [JSON.stringify({ sellsOn: "shopify", consent: true }), 400],
      [body({ company: "x".repeat(WAITLIST_MAX_BYTES) }), 413],
    ];
    for (const [index, [payload, status]] of cases.entries()) {
      const response = await send(post, payload, `192.0.2.${index + 1}`);
      expect(response.status, payload.slice(0, 60)).toBe(status);
      const json = (await response.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("invalid");
      expect(json.error.message.length).toBeGreaterThan(0);
    }
    expect(await store.get(keys.waitlist.position)).toBeNull();
  });

  it("takes only JSON from Stoop's own pages: another site's form or fetch is refused", async () => {
    const { post, store } = setup();
    const form = await post(new Request("https://stoop.example/api/waitlist", { method: "POST", headers: { "content-type": "text/plain" }, body: body({}) }));
    expect(form.status).toBe(415);
    expect((await send(post, body({}), "198.51.100.3", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send(post, body({}), "198.51.100.4", { "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect(await listEntries(store)).toHaveLength(1);
  });

  it("limits each visitor to 8 posts an hour", async () => {
    const { post } = setup();
    for (let i = 0; i < 8; i++) expect((await send(post, body({ email: `a${i}@shop.example` }))).status).toBe(200);
    const limited = await send(post, body({ email: "late@shop.example" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect((await send(post, body({ email: "other@shop.example" }), "198.51.100.9")).status).toBe(200);
  });

  it("refuses a request the bot check flags, and fails closed without a shared store", async () => {
    const flagged = setup({ botCheck: { name: "test", check: async () => ({ bot: true }) } });
    expect((await send(flagged.post, body({}))).status).toBe(403);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const noStore = setup({
      store: () => {
        throw new Error("No shared store is configured");
      },
    });
    const response = await send(noStore.post, body({}));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("failed");
    error.mockRestore();
  });
});

describe("GET /api/waitlist/export", () => {
  const TOKEN = "export-token-0123456789abcdef0123456789";

  async function seeded() {
    const { post, store } = setup();
    await send(post, body({ sourceReport: "home" }));
    // A valid address can still start with a formula character.
    await send(post, body({ email: "-2+3@evil.example", sellsOn: null, productLink: "https://shop.example/a,b" }), "198.51.100.2");
    return store;
  }
  const exporter = (store: MemoryStore, token: string | undefined) => createWaitlistExport({ store: () => store, botCheck: () => allowAll, token: () => token, now: () => Date.parse("2026-10-17T12:00:00Z") });
  const get = (handler: (r: Request) => Promise<Response>, authorization?: string) =>
    handler(new Request("https://stoop.example/api/waitlist/export", { headers: { "x-forwarded-for": "203.0.113.7", ...(authorization ? { authorization } : {}) } }));

  it("does not exist without a configured token", async () => {
    const store = await seeded();
    expect((await get(exporter(store, undefined), `Bearer ${TOKEN}`)).status).toBe(404);
    expect((await get(exporter(store, "  "), `Bearer ${TOKEN}`)).status).toBe(404);
    // A token too short to be safe counts as not configured.
    expect((await get(exporter(store, "short-token"), "Bearer short-token")).status).toBe(404);
  });

  it("refuses a missing or wrong token", async () => {
    const handler = exporter(await seeded(), TOKEN);
    for (const auth of [undefined, `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, TOKEN, "Bearer "]) {
      const response = await get(handler, auth);
      expect(response.status, String(auth)).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    }
  });

  it("returns every entry as a guarded CSV for the right token", async () => {
    const response = await get(exporter(await seeded(), TOKEN), `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="stoop-waitlist-2026-10-17.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    const lines = (await response.text()).split("\r\n");
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(","));
    expect(lines[1]).toMatch(/^1,ana@shop\.example,shopify,,true,,home,2026-/);
    expect(lines[2]).toMatch(/^2,"'-2\+3@evil\.example",,,true,"https:\/\/shop\.example\/a,b",,/);
    expect(lines.at(-1)).toBe("");
  });

  it("compares tokens in constant time, whatever their lengths", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches("short", TOKEN)).toBe(false);
    expect(tokenMatches(`${TOKEN}${TOKEN}`, TOKEN)).toBe(false);
  });
});
