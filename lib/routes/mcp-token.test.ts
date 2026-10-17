import { describe, expect, it, vi } from "vitest";
import { mcpTokenResponseSchema } from "../api/responses";
import { allowAll, type BotCheck } from "../bot-check";
import { DEFAULT_JUDGING_ENDS_AT } from "../config";
import type { EmailMessage, Mailer } from "../email";
import { identify } from "../mcp/auth";
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
    expect(record).toEqual({ email: await saltedHash(store, "ana@shop.example"), issuedAt: new Date(NOW).toISOString(), expiresAt: body.expiresAt, revokedAt: null, label: body.token.slice(0, 8) });
    // Nothing in the store holds the token itself.
    expect(JSON.stringify(record)).not.toContain(body.token.slice(8));
    expect(await store.range(keys.mcp.tokens, 0, -1)).toEqual([hash]);
    expect(await identify(store, new Headers({ authorization: `Bearer ${body.token}` }), NOW)).toEqual({ status: "valid", hash, label: body.token.slice(0, 8) });
    const [entry] = await listEntries(store);
    expect(entry).toMatchObject({ email: "ana@shop.example", sourceReport: "mcp", consent: true, sellsOn: null });
    expect(response.headers.get("set-cookie")).toMatch(/^stoop_signup=[0-9a-f]{32}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a filled honeypot like a success, and stores, counts and sends nothing", async () => {
    const mailer = recordingMailer();
    const { post, store } = setup({ mailer });
    const response = await ask(post, { company: "Acme" });
    expect(response.status).toBe(200);
    const body = mcpTokenResponseSchema.parse(await response.json());
    expect(body.emailed).toBe(true);
    expect(await identify(store, new Headers({ authorization: `Bearer ${body.token}` }), NOW)).toEqual({ status: "unknown" });
    expect(await store.range(keys.mcp.tokens, 0, -1)).toEqual([]);
    expect(await listEntries(store)).toEqual([]);
    expect(await store.get(keys.daily("mcp-tokens", DAY))).toBeNull();
    expect(mailer.sent).toHaveLength(0);
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

  it("issues at most 50 tokens a day overall", async () => {
    const { post, store } = setup();
    await store.incr(keys.daily("mcp-tokens", DAY), { by: 48 });
    const answers = await Promise.all(Array.from({ length: 5 }, (_, i) => ask(post, { email: `user${i}@shop.example` }, `198.51.100.${i + 1}`)));
    expect(answers.filter((a) => a.status === 200)).toHaveLength(2);
    const refused = answers.filter((a) => a.status === 429);
    expect(refused).toHaveLength(3);
    expect(await refused[0].json()).toMatchObject({ error: { code: "daily_cap" } });
    expect(await store.get(keys.daily("mcp-tokens", DAY))).toBe(50);
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
    expect(message.text).toContain(body.token);
    expect(message.text).toContain(`--header "Authorization: Bearer ${body.token}"`);
    expect(message.text).toContain(`https://stoop.example/api/mcp/${body.token}`);
    expect(message.idempotencyKey).toMatch(/^mcp-token-[0-9a-f]{32}$/);
    expect(message.idempotencyKey).not.toContain(body.token.slice(4));
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

      const mailer = recordingMailer();
      const budget = setup({ mailer });
      await hitRate(budget.store, DAILY_RULES.confirmationEmails, EVERYONE, NOW, DAILY_RULES.confirmationEmails.limit);
      expect(mcpTokenResponseSchema.parse(await (await ask(budget.post)).json()).emailed).toBe(false);
      expect(mailer.sent).toHaveLength(0);
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
