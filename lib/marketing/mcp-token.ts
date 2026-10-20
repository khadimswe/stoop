// The browser side of /mcp's token form: what it posts to /api/mcp/token, how it reads the answer and
// what it says when something goes wrong. Client-safe: the API contract comes in as types only
// (lib/api/responses pulls in the Report schema, lib/mcp/token pulls in node:crypto).
import type { McpTokenRequest } from "../api/requests";
import type { ApiError, McpTokenResponse } from "../api/responses";

/** Same shape as lib/mcp/token.ts TOKEN_PATTERN ("stp_" plus 43 base64url characters); a test keeps them equal. */
export const TOKEN_SHAPE = /^stp_[A-Za-z0-9_-]{43}$/;

/** The copy shown in place of a real token in every setup snippet. */
export const TOKEN_PLACEHOLDER = "stp_your_token_here";

export type McpTokenResult =
  | { ok: true; token: McpTokenResponse }
  /** `message` is the route's own plain-words reason, when it sent one (lib/routes/mcp-token.ts). */
  | { ok: false; code: ApiError["error"]["code"] | "network"; message?: string };

function isTokenResponse(value: unknown): value is McpTokenResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.token === "string" && TOKEN_SHAPE.test(v.token) && typeof v.expiresAt === "string" && !Number.isNaN(Date.parse(v.expiresAt)) && typeof v.emailed === "boolean";
}

const CODES = new Set(["invalid", "not_found", "rate_limited", "daily_cap", "busy", "off", "bot", "failed"]);

function errorCode(value: unknown, status: number): Exclude<McpTokenResult, { ok: true }>["code"] {
  const code = value && typeof value === "object" ? (value as { error?: { code?: unknown } }).error?.code : undefined;
  if (typeof code === "string" && CODES.has(code)) return code as ApiError["error"]["code"];
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  return "failed";
}

/** Posts the form and reads the answer. Never throws: a dropped connection is `network`. */
export async function postMcpToken(body: McpTokenRequest, fetchImpl: typeof fetch = fetch): Promise<McpTokenResult> {
  const payload: McpTokenRequest = { email: body.email.trim(), consent: body.consent, ...(body.company ? { company: body.company } : {}) };
  let response: Response;
  try {
    response = await fetchImpl("/api/mcp/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    return { ok: false, code: "network" };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok && isTokenResponse(json)) return { ok: true, token: json };
  const message = json && typeof json === "object" ? (json as { error?: { message?: unknown } }).error?.message : undefined;
  return { ok: false, code: errorCode(json, response.status), ...(typeof message === "string" && message.trim() ? { message: message.trim().slice(0, 300) } : {}) };
}

/** The codes whose server message is the plain answer: the limit and when it resets, or why tokens are closed. */
const SERVER_WORDS = new Set(["rate_limited", "daily_cap", "off"]);

/**
 * Plain words for a failure. For the limits and for closed tokens, the route's own message says it
 * best ("That's 3 tokens from here today. ..."); everything else gets this page's words.
 */
export function tokenErrorCopy(code: Exclude<McpTokenResult, { ok: true }>["code"], serverMessage?: string): string {
  if (serverMessage && SERVER_WORDS.has(code)) return serverMessage;
  switch (code) {
    case "invalid":
      return "Check the email address and try again.";
    case "rate_limited":
      return "Too many token requests from here. Use a token you already have, or try again later.";
    case "daily_cap":
      return "Today's tokens are all handed out. Try again tomorrow.";
    case "off":
      return "Tokens are closed right now. The examples work without one.";
    case "not_found":
      return "Tokens aren't available right now. The examples work without one.";
    case "bot":
      return "We couldn't check this request. Reload the page and try again.";
    case "busy":
      return "Stoop is busy right now. Try again in a minute.";
    case "network":
      return "Couldn't reach Stoop. Check your connection and try again.";
    case "failed":
      return "That didn't go through. Try again in a moment.";
  }
}

const EASTERN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  timeZone: "America/New_York",
});

/** "Nov 17, 2026, 3 AM Eastern": when the token stops working, in the time zone judging runs in. */
export function expiryText(iso: string): string {
  return `${EASTERN.format(new Date(iso))} Eastern`;
}

/** The MCP endpoint, for the Bearer header form (recommended). */
export const mcpUrl = (origin: string) => `${origin}/api/mcp`;

/** The path form, for clients that only take a URL. Hosting logs record paths: the token is capped, expiring and revocable. */
export const mcpPathUrl = (origin: string, token: string = TOKEN_PLACEHOLDER) => `${origin}/api/mcp/${token}`;

/** Claude Code: one command, the token in a header. */
export function claudeCodeCommand(origin: string, token: string = TOKEN_PLACEHOLDER): string {
  return `claude mcp add --transport http stoop ${mcpUrl(origin)} --header "Authorization: Bearer ${token}"`;
}

/** Clients that read a JSON config with headers. */
export function headerConfig(origin: string, token: string = TOKEN_PLACEHOLDER): string {
  return JSON.stringify({ mcpServers: { stoop: { type: "http", url: mcpUrl(origin), headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}
