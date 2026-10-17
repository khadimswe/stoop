import { describe, expect, it, vi } from "vitest";
import { mcpTokenResponseSchema } from "../api/responses";
import { allowAll, type BotCheck } from "../bot-check";
import { DEFAULT_JUDGING_ENDS_AT } from "../config";
import type { EmailMessage, Mailer } from "../email";
import { identify, tokenLabel } from "../mcp/auth";
import { mcpTokenRecordSchema, tokenHash } from "../mcp/token";
import { DAILY_RULES, EVERYONE, hitRate } from "../rate-limit";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import type { Store } from "../store/types";
import { saltedHash, visitorId } from "../store/visitor";
import { listEntries } from "../waitlist";
import { createMcpTokenPost, MCP_TOKEN_MAX_BYTES } from "./mcp-token";

const NOW = Date.parse("2026-10-20T15:00:00.000Z");
const DAY = "2026-10-20";

function setup(options: { mailer?: Mailer | null; botCheck?: BotCheck; store?: Store; env?: Record<string, string> } = {}) {
  const store = (options.store ?? new MemoryStore()) as MemoryStore;
  const post = createMcpTokenPost({ store: () => store, botCheck: () => options.botCheck ?? allowAll, mailer: () => options.mailer ?? null, env: options.env ?? {}, now: () => NOW });
  return { store, post };
}

const ask = (post: (r: Request) => Promise<Response>, fields: Record<string, unknown> = {}, ip = "203.0.113.7", headers: Record<string, string> = {}) =>
  post(
    new Request("https://stoop.example/api/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
      body: JSON.stringify({ email: "Ana@Shop.example ", consent: true, ...fields }),
    }),
  );

function recordingMailer(fail = false): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      if (fail) throw new Error("Resend refused the email: validation_error");
    },
  };
}

describe("POST /api/mcp/token", () => {
  it("issues a token once, stores only its hash and record, and adds the email to the waitlist", async () => {
    const { post, store } = setup();
    const response = await ask(post);
    expect(response.status).toBe(200);
    const body = mcpTokenResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ expiresAt: new Date(DEFAULT_JUDGING_ENDS_AT).toISOString(), emailed: false });
    const hash = tokenHash(body.token);
    const record = mcpTokenRecordSchema.parse(await store.get(keys.mcp.token(hash)));
    expect(record).toEqual({ email: await saltedHash(store, "ana@shop.example"), issuedAt: new Date(NOW).toISOString(), expiresAt: body.expiresAt, revokedAt: null, label: tokenLabel(hash) });
    // Nothing in the store holds the token, not even its first characters.
    expect(JSON.stringify(record)).not.toContain(body.token.slice(4, 12));
    expect(await store.range(keys.mcp.tokens, 0, -1)).toEqual([hash]);
    expect(await identify(store, new Headers({ authorization: `Bearer ${body.token}` }), NOW)).toEqual({ status: "valid", hash, label: tokenLabel(hash) });
    const [entry] = await listEntries(store);
    expect(entry).toMatchObject({ email: "ana@shop.example", sourceReport: "mcp", consent: true, sellsOn: null });
    expect(response.headers.get("set-cookie")).toMatch(/^stoop_signup=[0-9a-f]{32}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a filled honeypot like a success, with the same emailed value and cookie, and stores, counts and sends nothing", async () => {
    const mailer = recordingMailer();
    const { post, store } = setup({ mailer });
    const response = await ask(post, { company: "Acme" });
    expect(response.status).toBe(200);
    const body = mcpTokenResponseSchema.parse(await response.json());
    expect(body.emailed).toBe(true);
    // A first visit gets the signup cookie, as a real one does.
    expect(response.headers.get("set-cookie")).toMatch(/^stoop_signup=[0-9a-f]{32}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
    expect(await identify(store, new Headers({ authorization: `Bearer ${body.token}` }), NOW)).toEqual({ status: "unknown" });
    expect(await store.range(keys.mcp.tokens, 0, -1)).toEqual([]);
    expect(await listEntries(store)).toEqual([]);
    expect(await store.get(keys.daily("mcp-tokens", DAY))).toBeNull();
    expect(mailer.sent).toHaveLength(0);
    // Where a real request would get no email (the address had its 2 today), the honeypot says the same.
    await store.incr(keys.rate("mcp-token-email", await saltedHash(store, "ana@shop.example"), DAY), { by: 2 });
    expect(mcpTokenResponseSchema.parse(await (await ask(post, { company: "Acme" })).json()).emailed).toBe(false);
    expect(mcpTokenResponseSchema.parse(await (await ask(post, {}, "198.51.100.9")).json()).emailed).toBe(false);
  });

  it("issues 3 tokens per IP a day, even when requests arrive at once", async () => {
    const { post, store } = setup();
    const answers = await Promise.all(Array.from({ length: 6 }, (_, i) => ask(post, { email: `user${i}@shop.example` })));
    expect(answers.filter((a) => a.status === 200)).toHaveLength(3);
    const refused = answers.filter((a) => a.status === 429);
    expect(refused).toHaveLength(3);
    expect(await refused[0].json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(await store.range(keys.mcp.tokens, 0, -1)).toHaveLength(3);
    expect(await store.get(keys.daily("mcp-tokens", DAY))).toBe(3);
    // Another IP still gets one.
    expect((await ask(post, {}, "198.51.100.2")).status).toBe(200);
  });

  it("issues at most 100 tokens a day overall", async () => {
    const { post, store } = setup();
    await store.incr(keys.daily("mcp-tokens", DAY), { by: 98 });
    const answers = await Promise.all(Array.from({ length: 5 }, (_, i) => ask(post, { email: `user${i}@shop.example` }, `198.51.100.${i + 1}`)));
    expect(answers.filter((a) => a.status === 200)).toHaveLength(2);
    const refused = answers.filter((a) => a.status === 429);
    expect(refused).toHaveLength(3);
    expect(await refused[0].json()).toMatchObject({ error: { code: "daily_cap" } });
    expect(await store.get(keys.daily("mcp-tokens", DAY))).toBe(100);
    // The refused requests gave their per-IP units back: only the 2 issued are counted.
    const perIp = await Promise.all([1, 2, 3, 4, 5].map(async (n) => (await store.get<number>(keys.rate("mcp-token-issue", await visitorId(store, new Headers({ "x-forwarded-for": `198.51.100.${n}` })), DAY))) ?? 0));
    expect(perIp.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("emails the token once, with how to add it, and says so", async () => {
    const mailer = recordingMailer();
    const { post } = setup({ mailer });
    const body = mcpTokenResponseSchema.parse(await (await ask(post)).json());
    expect(body.emailed).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    expect(message.to).toBe("ana@shop.example");
    // The token once, as plain text on its own line, and never inside a URL.
    expect(message.text.split(body.token)).toHaveLength(2);
    expect(message.text.split("\n")).toContain(body.token);
    expect(message.text).not.toMatch(new RegExp(`https?://\\S*${body.token}`));
    expect(message.text).not.toContain(`/api/mcp/${body.token}`);
    expect(message.text).toContain("Authorization: Bearer <your token>");
    expect(message.text).toContain("add your token after /api/mcp/");
    expect(message.text).toContain("https://stoop.example/api/mcp.");
    expect(message.idempotencyKey).toMatch(/^mcp-token-[0-9a-f]{32}$/);
    expect(message.idempotencyKey).not.toContain(body.token.slice(4));
  });

  it("emails one address at most twice a day; past that the token still shows on screen", async () => {
    const mailer = recordingMailer();
    const { post, store } = setup({ mailer });
    const answers = [];
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) answers.push(mcpTokenResponseSchema.parse(await (await ask(post, {}, ip)).json()));
    expect(answers.map((a) => a.emailed)).toEqual([true, true, false]);
    expect(mailer.sent).toHaveLength(2);
    // The third token was still issued.
    expect(await identify(store, new Headers({ authorization: `Bearer ${answers[2].token}` }), NOW)).toMatchObject({ status: "valid" });
    // Another address is not affected.
    expect(mcpTokenResponseSchema.parse(await (await ask(post, { email: "ben@shop.example" }, "198.51.100.4")).json()).emailed).toBe(true);
  });

  it("still issues the token when the email fails or the day's email budget is spent, and logs neither the token nor the address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = setup({ mailer: recordingMailer(true) });
      const failed = await ask(failing.post);
      expect(failed.status).toBe(200);
      const body = mcpTokenResponseSchema.parse(await failed.json());
      expect(body.emailed).toBe(false);
      expect(await identify(failing.store, new Headers({ authorization: `Bearer ${body.token}` }), NOW)).toMatchObject({ status: "valid" });
      const logged = [...warn.mock.calls, ...error.mock.calls].map((args) => args.map(String).join(" ")).join("\n");
      expect(logged).toContain("MCP token email failed");
      expect(logged).not.toContain(body.token);
      expect(logged).not.toContain("ana@shop.example");

      // Token emails have their own daily budget: spent waitlist confirmations do not stop them, a spent token budget does.
      const mailer = recordingMailer();
      const budget = setup({ mailer });
      await hitRate(budget.store, DAILY_RULES.confirmationEmails, EVERYONE, NOW, DAILY_RULES.confirmationEmails.limit);
      expect(mcpTokenResponseSchema.parse(await (await ask(budget.post)).json()).emailed).toBe(true);
      await hitRate(budget.store, { name: "daily-mcp-token-emails", limit: 50, windowSeconds: 24 * 60 * 60 }, EVERYONE, NOW, 49);
      expect(mcpTokenResponseSchema.parse(await (await ask(budget.post, { email: "ben@shop.example" }, "198.51.100.2")).json()).emailed).toBe(false);
      expect(mailer.sent).toHaveLength(1);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("gives the day's limits back when issuing fails, and logs no token", async () => {
    const memory = new MemoryStore();
    // A store that loses the token record's write.
    const broken = new Proxy(memory, {
      get(target, prop, receiver) {
        if (prop === "set") return (key: string, ...rest: unknown[]) => (key.startsWith("mcp:token:") ? Promise.reject(new Error("write lost")) : (target.set as (...a: unknown[]) => Promise<boolean>).call(target, key, ...rest));
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { post } = setup({ store: broken });
      const response = await ask(post);
      expect(response.status).toBe(500);
      expect(await memory.get(keys.daily("mcp-tokens", DAY))).toBe(0);
      expect(String(error.mock.calls[0]?.[0])).toContain("POST /api/mcp/token failed");
    } finally {
      error.mockRestore();
    }
  });

  it("closes when judging ends", async () => {
    const { post, store } = setup({ env: { JUDGING_ENDS_AT: "2026-10-20T00:00:00Z" } });
    const response = await ask(post);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "off" } });
    expect(await store.range(keys.mcp.tokens, 0, -1)).toEqual([]);
  });

  it("checks what was sent, and refuses another site's request", async () => {
    const { post } = setup();
    expect((await ask(post, { email: "not an email" })).status).toBe(400);
    expect((await ask(post, { extra: true })).status).toBe(400);
    expect((await post(new Request("https://stoop.example/api/mcp/token", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }))).status).toBe(415);
    expect((await post(new Request("https://stoop.example/api/mcp/token", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(MCP_TOKEN_MAX_BYTES + 1) }))).status).toBe(413);
    expect((await ask(post, {}, "203.0.113.7", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    const bots = setup({ botCheck: { name: "test", check: async () => ({ bot: true }) } });
    expect((await ask(bots.post)).status).toBe(403);
  });
});
