import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { allowAll, type BotCheck } from "../bot-check";
import { callerOf, tokenLabel } from "../mcp/auth";
import { storeToken } from "../mcp/fixture-token";
import { newToken, tokenHash } from "../mcp/token";
import { RATE_RULES } from "../rate-limit";
import { MemoryStore } from "../store/memory";
import { createMcpGet, createMcpPost, MCP_MAX_BYTES } from "./mcp";

function setup(botCheck: BotCheck = allowAll) {
  const store = new MemoryStore();
  const handler = vi.fn(async (request: Request) => Response.json({ seen: await request.text() }));
  return { handler, post: createMcpPost({ store: () => store, botCheck: () => botCheck, handler }) };
}

const rpc = (body: string, ip = "203.0.113.7") => new Request("https://stoop.example/api/mcp", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body });
const withBearer = (request: Request, token: string) => {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request.url, { method: request.method, headers, body: "{}" });
};

describe("POST /api/mcp", () => {
  it("hands the request on with its body intact", async () => {
    const { post, handler } = setup();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const response = await post(rpc(body));
    expect(await response.json()).toEqual({ seen: body });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("counts requests without a valid token per IP, 600 per 10 minutes, and never against the token holders behind that IP", async () => {
    const store = new MemoryStore();
    const handler = vi.fn(async () => Response.json({}));
    const post = createMcpPost({ store: () => store, botCheck: () => allowAll, handler });
    for (let i = 0; i < RATE_RULES.mcp.limit; i++) expect((await post(rpc("{}"))).status).toBe(200);
    const limited = await post(rpc("{}"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    // A wrong token is no way around it.
    expect((await post(withBearer(rpc("{}"), newToken()))).status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(RATE_RULES.mcp.limit);
    // A valid token behind the same shared IP counts its own requests.
    const { token } = await storeToken(store);
    expect((await post(withBearer(rpc("{}"), token))).status).toBe(200);
    expect((await post(rpc("{}", "198.51.100.2"))).status).toBe(200);
  });

  it("counts a valid token's requests per token: one token across IPs shares its limit, two tokens behind one IP each have their own", async () => {
    const store = new MemoryStore();
    const post = createMcpPost({ store: () => store, botCheck: () => allowAll, handler: async () => Response.json({}) });
    const a = await storeToken(store);
    const b = await storeToken(store);
    for (let i = 0; i < RATE_RULES.mcpCaller.limit; i++) expect((await post(withBearer(rpc("{}", i % 2 ? "203.0.113.7" : "198.51.100.2"), a.token))).status).toBe(200);
    expect((await post(withBearer(rpc("{}", "192.0.2.9"), a.token))).status).toBe(429);
    expect((await post(withBearer(rpc("{}", "203.0.113.7"), b.token))).status).toBe(200);
    // Unauthenticated traffic from that IP was never counted.
    expect((await post(rpc("{}", "203.0.113.7"))).status).toBe(200);
  });

  it("refuses a body over the cap without reading it into the handler", async () => {
    const { post, handler } = setup();
    const response = await post(rpc("x".repeat(MCP_MAX_BYTES + 1)));
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("moves a path token into the Authorization header and hands the handler /api/mcp, with no token in any URL", async () => {
    const store = new MemoryStore();
    const { token, hash } = await storeToken(store);
    const seen: Request[] = [];
    const handler = vi.fn(async (request: Request) => {
      seen.push(request);
      return Response.json({ ok: true });
    });
    const post = createMcpPost({ store: () => store, botCheck: () => allowAll, handler });
    const request = new Request(`https://stoop.example/api/mcp/${token}?again=${token}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer something-else" }, body: "{}" });
    expect((await post(request, { pathToken: token })).status).toBe(200);
    const forwarded = seen[0] as Request & { auth?: AuthInfo };
    expect(forwarded.url).toBe("https://stoop.example/api/mcp");
    expect(forwarded.url).not.toContain(token);
    expect(forwarded.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(callerOf(forwarded.auth)).toEqual({ status: "valid", hash, label: tokenLabel(hash) });
    // AuthInfo carries the hash and a hash-derived label: no run of the token's own characters.
    expect(JSON.stringify(forwarded.auth)).not.toContain(token.slice(4, 12));
    // A segment that is no token is never copied into a header: it is refused as unknown.
    await post(new Request("https://stoop.example/api/mcp/bad%0Avalue", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { pathToken: "bad\nvalue" });
    expect(seen[1].headers.get("authorization")).toBe("Bearer not-a-token");
    expect(callerOf((seen[1] as Request & { auth?: AuthInfo }).auth)).toEqual({ status: "unknown" });
  });

  it("identifies callers by the Bearer token: valid, missing, unknown, revoked or expired", async () => {
    const store = new MemoryStore();
    const valid = await storeToken(store);
    const revoked = await storeToken(store, { revokedAt: "2026-10-18T00:00:00.000Z" });
    const expired = await storeToken(store, { expiresAt: "2026-10-01T00:00:00.000Z" });
    const seen: (AuthInfo | undefined)[] = [];
    const post = createMcpPost({ store: () => store, botCheck: () => allowAll, handler: async (r) => (seen.push((r as Request & { auth?: AuthInfo }).auth), Response.json({})) });
    const send = (authorization?: string) => post(new Request("https://stoop.example/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: "{}" }));
    for (const header of [`Bearer ${valid.token}`, undefined, `Bearer ${newToken()}`, `Basic ${valid.token}`, `Bearer ${revoked.token}`, `Bearer ${expired.token}`]) await send(header);
    expect(seen.map((a) => callerOf(a).status)).toEqual(["valid", "missing", "unknown", "unknown", "revoked", "expired"]);
  });

  it("refuses a token as expired once JUDGING_ENDS_AT, as set now, has passed, whatever its stored expiry", async () => {
    const store = new MemoryStore();
    // Stored with an expiry far ahead, as if issued under a later end date.
    const { token } = await storeToken(store, { expiresAt: "2099-01-01T00:00:00.000Z" });
    const seen: (AuthInfo | undefined)[] = [];
    const post = createMcpPost({ store: () => store, botCheck: () => allowAll, handler: async (r) => (seen.push((r as Request & { auth?: AuthInfo }).auth), Response.json({})) });
    const send = () => post(new Request("https://stoop.example/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" }));
    try {
      vi.stubEnv("JUDGING_ENDS_AT", "2026-01-01T00:00:00Z");
      await send();
    } finally {
      vi.unstubAllEnvs();
    }
    await send();
    expect(seen.map((a) => callerOf(a).status)).toEqual(["expired", "valid"]);
  });

  it("guards GET too: the bot check and the per-IP limit run before the handler", async () => {
    const store = new MemoryStore();
    const handler = vi.fn(async () => new Response(null, { status: 405 }));
    const get = createMcpGet({ store: () => store, botCheck: () => allowAll, handler });
    const request = (ip = "203.0.113.7") => new Request("https://stoop.example/api/mcp", { method: "GET", headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < RATE_RULES.mcp.limit; i++) expect((await get(request())).status).toBe(405);
    expect((await get(request())).status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(RATE_RULES.mcp.limit);
    const blocked = createMcpGet({ store: () => store, botCheck: () => ({ name: "test", check: async () => ({ bot: true }) }), handler });
    expect((await blocked(request("198.51.100.2"))).status).toBe(403);
    expect(handler).toHaveBeenCalledTimes(RATE_RULES.mcp.limit);
  });

  it("never logs a full token: a path token or an error quoting one is redacted", async () => {
    const token = newToken();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const noStore = createMcpPost({
        store: () => {
          throw new Error("No shared store is configured");
        },
        botCheck: () => allowAll,
        handler: async () => Response.json({}),
      });
      const down = await noStore(new Request(`https://stoop.example/api/mcp/${token}`, { method: "POST", body: "{}" }), { pathToken: token });
      expect(down.status).toBe(503);
      // Percent-encoded, as a client may send it (Next decodes the segment before it is used).
      const encoded = await noStore(new Request(`https://stoop.example/api/mcp/stp%5F${token.slice(4)}`, { method: "POST", body: "{}" }), { pathToken: token });
      expect(encoded.status).toBe(503);
      const store = new MemoryStore();
      const throwing = createMcpPost({
        store: () => store,
        botCheck: () => allowAll,
        handler: async (r) => {
          throw new Error(`could not serve ${r.headers.get("authorization")} for ${token}`);
        },
      });
      const failed = await throwing(new Request(`https://stoop.example/api/mcp/${token}`, { method: "POST", body: "{}" }), { pathToken: token });
      expect(failed.status).toBe(500);
      expect(await failed.text()).not.toContain(token);
      const logged = errors.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
      // Named by its label, from the hash: no character of the token past its prefix is logged.
      expect(logged).toContain(`[token ${tokenLabel(tokenHash(token))}]`);
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(token.slice(0, 8));
      expect(logged).not.toContain(token.slice(8));
    } finally {
      errors.mockRestore();
    }
  });

  it("asks the bot check as an agent route", async () => {
    const check = vi.fn<BotCheck["check"]>(async (_request, { kind }) => ({ bot: kind === "browser" }));
    const { post, handler } = setup({ name: "test", check });
    expect((await post(rpc("{}"))).status).toBe(200);
    expect(check).toHaveBeenCalledWith(expect.any(Request), { kind: "agent" });
    const blocked = setup({ name: "test", check: async () => ({ bot: true }) });
    expect((await blocked.post(rpc("{}"))).status).toBe(403);
    expect(blocked.handler).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });
});
