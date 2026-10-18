// Who is calling /api/mcp: the MCP token in "Authorization: Bearer <token>" (the path form,
// /api/mcp/<token>, is moved into that header by lib/routes/mcp.ts), looked up by its hash. Every
// request is identified, but only tools/call needs a valid token: initialize and tools/list stay open
// so clients can discover the tools, and each tool refuses a missing, unknown, revoked or expired
// token with a clear message and the link to get one (lib/mcp/server.ts).
//
// The verdict travels to the tools as the request's AuthInfo (mcp-handler hands `request.auth` to
// ctx.http.authInfo). It carries the token's hash and label, never the token.
import type { AuthInfo } from "@modelcontextprotocol/server";
import { keys } from "../store/keys";
import type { Store } from "../store/types";
import { isTokenShaped, mcpTokenRecordSchema, tokenActive, tokenHash } from "./token";

/**
 * A token's label for the founder's listing and the AuthInfo clientId: "stp_" plus the first 4 hex of
 * its hash, so not one character of the token itself is kept in the store or passed along.
 */
export const tokenLabel = (hash: string) => `stp_${hash.slice(0, 4)}`;

export type CallerStatus = "missing" | "unknown" | "revoked" | "expired" | "valid";

export type Caller = { status: "valid"; hash: string; label: string } | { status: Exclude<CallerStatus, "valid"> };

/** The bearer token in an Authorization header, or null. */
export function bearerToken(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.get("authorization") ?? "");
  return match ? match[1] : null;
}

/**
 * Looks the request's token up by its hash. Anything sent that is not a token Stoop issued (another
 * scheme, a malformed or unknown token, a record that no longer parses) is "unknown".
 */
export async function identify(store: Store, headers: Headers, now: number = Date.now()): Promise<Caller> {
  if (!headers.get("authorization")) return { status: "missing" };
  const token = bearerToken(headers);
  if (!token || !isTokenShaped(token)) return { status: "unknown" };
  const hash = tokenHash(token);
  const record = mcpTokenRecordSchema.safeParse(await store.get<unknown>(keys.mcp.token(hash)));
  if (!record.success) return { status: "unknown" };
  if (record.data.revokedAt !== null) return { status: "revoked" };
  if (!tokenActive(record.data, now)) return { status: "expired" };
  return { status: "valid", hash, label: record.data.label };
}

const CALLER = "stoopCaller";

/** The verdict as mcp-handler's AuthInfo. `token` holds the hash (or the status), never the token itself. */
export function toAuthInfo(caller: Caller): AuthInfo {
  return {
    token: caller.status === "valid" ? caller.hash : caller.status,
    clientId: caller.status === "valid" ? caller.label : caller.status,
    scopes: caller.status === "valid" ? ["tools"] : [],
    extra: { [CALLER]: caller },
  };
}

function isCaller(value: unknown): value is Caller {
  if (!value || typeof value !== "object") return false;
  const { status, hash, label } = value as Record<string, unknown>;
  if (status === "valid") return typeof hash === "string" && typeof label === "string";
  return status === "missing" || status === "unknown" || status === "revoked" || status === "expired";
}

/** The verdict a tool sees; a request that never went through identify() counts as missing a token. */
export function callerOf(info: AuthInfo | undefined): Caller {
  const caller = info?.extra?.[CALLER];
  return isCaller(caller) ? caller : { status: "missing" };
}

/** The page that hands out tokens, and explains how to add one. */
export const tokenPage = (origin: string) => `${origin}/mcp`;

/** What a tool answers to a caller without a valid token: what is wrong and where to get one. */
export function tokenRefusal(status: Exclude<CallerStatus, "valid">, origin: string): string {
  const page = tokenPage(origin);
  switch (status) {
    case "missing":
      return `Stoop's tools need a free MCP token. Get one at ${page}, then send it as "Authorization: Bearer <token>" (or, if your client only takes a URL, add your token after /api/mcp/ with no slash after it).`;
    case "unknown":
      return `Stoop does not recognize this MCP token. Check that it was copied whole, or get a new one at ${page}.`;
    case "revoked":
      return `This Stoop MCP token was revoked. Get a new one at ${page}.`;
    case "expired":
      return `This Stoop MCP token has expired: tokens work until judging ends. See ${page}.`;
  }
}
