import { describe, expect, it, vi } from "vitest";
import { mcpTokenRequestSchema } from "../api/requests";
import { API_ERROR_CODES, mcpTokenResponseSchema } from "../api/responses";
import { TOKEN_PATTERN } from "../mcp/token";
import {
  claudeCodeCommand,
  expiryText,
  headerConfig,
  mcpPathUrl,
  mcpUrl,
  postMcpToken,
  TOKEN_PLACEHOLDER,
  TOKEN_SHAPE,
  tokenErrorCopy,
} from "./mcp-token";

const TOKEN = `stp_${"a".repeat(43)}`;
const answer = { token: TOKEN, expiresAt: "2026-11-17T08:00:00.000Z", emailed: true };

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("postMcpToken", () => {
  it("keeps the token shape in step with the server's", () => {
    expect(TOKEN_SHAPE.source).toBe(TOKEN_PATTERN.source);
    expect(mcpTokenResponseSchema.parse(answer)).toEqual(answer);
  });

  it("posts a body the route accepts and returns the token once", async () => {
    const fetchImpl = fakeFetch(200, answer);
    const result = await postMcpToken({ email: "  founder@brand.com ", consent: false }, fetchImpl);
    expect(result).toEqual({ ok: true, token: answer });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/mcp/token");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ email: "founder@brand.com", consent: false });
    expect(mcpTokenRequestSchema.parse(body)).toEqual(body);
  });

  it("sends a filled honeypot along, so the server can drop it", async () => {
    const fetchImpl = fakeFetch(200, answer);
    await postMcpToken({ email: "a@b.co", consent: true, company: "Acme" }, fetchImpl);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ email: "a@b.co", consent: true, company: "Acme" });
  });

  it("reads each API error code, and falls back on the status", async () => {
    for (const code of API_ERROR_CODES) {
      expect(await postMcpToken({ email: "a@b.co", consent: false }, fakeFetch(400, { error: { code, message: "x" } }))).toEqual({ ok: false, code, message: "x" });
    }
    expect(await postMcpToken({ email: "a@b.co", consent: false }, fakeFetch(429, {}))).toEqual({ ok: false, code: "rate_limited" });
    expect(await postMcpToken({ email: "a@b.co", consent: false }, fakeFetch(404, "nope"))).toEqual({ ok: false, code: "not_found" });
    expect(await postMcpToken({ email: "a@b.co", consent: false }, fakeFetch(500, null))).toEqual({ ok: false, code: "failed" });
  });

  it("never shows a malformed token", async () => {
    const result = await postMcpToken({ email: "a@b.co", consent: false }, fakeFetch(200, { ...answer, token: "stp_short" }));
    expect(result).toEqual({ ok: false, code: "failed" });
  });

  it("calls a dropped connection a network error instead of throwing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await postMcpToken({ email: "a@b.co", consent: false }, fetchImpl)).toEqual({ ok: false, code: "network" });
  });

  it("has plain words for every failure, with the limits spelled out", () => {
    for (const code of [...API_ERROR_CODES, "network"] as const) expect(tokenErrorCopy(code).length).toBeGreaterThan(10);
    // The route's own words win for the limits and for closed tokens; the page's words cover the rest.
    const limit = "That's 3 tokens from here today. Use one you already have, or try again tomorrow.";
    expect(tokenErrorCopy("rate_limited", limit)).toBe(limit);
    expect(tokenErrorCopy("daily_cap", "Today's MCP tokens are all handed out. Try again tomorrow (UTC).")).toContain("Try again tomorrow (UTC)");
    expect(tokenErrorCopy("off", "MCP tokens closed when judging ended.")).toBe("MCP tokens closed when judging ended.");
    expect(tokenErrorCopy("invalid", "email: Invalid email address")).toBe("Check the email address and try again.");
    expect(tokenErrorCopy("daily_cap")).toBe("Today's tokens are all handed out. Try again tomorrow.");
  });
});

describe("setup snippets", () => {
  const origin = "https://stoop.example";

  it("says when a token stops working, in Eastern time", () => {
    expect(expiryText("2026-11-17T08:00:00Z")).toBe("Nov 17, 2026, 3 AM Eastern");
  });

  it("puts the token in a header for Claude Code, with a placeholder by default", () => {
    expect(mcpUrl(origin)).toBe("https://stoop.example/api/mcp");
    expect(claudeCodeCommand(origin)).toBe(`claude mcp add --transport http stoop https://stoop.example/api/mcp --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`);
    expect(JSON.parse(headerConfig(origin))).toEqual({
      mcpServers: { stoop: { type: "http", url: "https://stoop.example/api/mcp", headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` } } },
    });
  });

  it("puts the token in the path only for URL-only clients", () => {
    expect(mcpPathUrl(origin)).toBe(`https://stoop.example/api/mcp/${TOKEN_PLACEHOLDER}`);
  });
});
