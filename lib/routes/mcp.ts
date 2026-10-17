// /api/mcp and /api/mcp/<token>: the bot check (agent kind: MCP clients are software, never asked to
// prove they are browsers), a per-IP limit on every request, GET and POST alike, and a body cap. Then
// who is calling: the token in "Authorization: Bearer", looked up by its hash (lib/mcp/auth.ts), handed
// to the MCP handler as the request's AuthInfo. Each tool decides what needs a token (tools/call does;
// initialize and tools/list do not) and adds its own tighter limits (lib/mcp/server.ts).
//
// The path form is for clients that only take a URL: its token moves into the Authorization header and
// the handler is handed /api/mcp, with no query, so no token is ever in a URL past this point. Logs
// redact token-shaped text (lib/routes/guard.ts), but hosting logs still record the path, which is why
// Bearer is the recommended form and every token is capped, expiring and revocable.
import type { AuthInfo } from "@modelcontextprotocol/server";
import { apiError, BodyError, readBody } from "../http";
import { identify, toAuthInfo } from "../mcp/auth";
import { isTokenShaped } from "../mcp/token";
import { RATE_RULES } from "../rate-limit";
import { failSafe, guard, type GuardDeps } from "./guard";

/** The largest tool call is a culture_brief with a 2,000-character description. */
export const MCP_MAX_BYTES = 32_768;
/** Where the MCP handler always sees a request arrive. */
export const MCP_PATH = "/api/mcp";
/** What the path form sends when its segment is not token-shaped: refused as an unknown token, and never copied into a header. */
const NOT_A_TOKEN = "not-a-token";

export interface McpRouteDeps extends GuardDeps {
  handler: (request: Request) => Promise<Response>;
}

export interface McpRouteOptions {
  /** The path form's segment (/api/mcp/<token>). */
  pathToken?: string;
}

/** The URL the handler sees: /api/mcp on the same origin, with no query. */
function forwardedUrl(request: Request): string {
  const url = new URL(request.url);
  url.pathname = MCP_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** The headers the handler sees: the path form's token in Authorization (it replaces any sent). */
function forwardedHeaders(request: Request, pathToken: string | undefined): Headers {
  const headers = new Headers(request.headers);
  if (pathToken !== undefined) headers.set("authorization", `Bearer ${isTokenShaped(pathToken) ? pathToken : NOT_A_TOKEN}`);
  return headers;
}

async function serve(request: Request, deps: McpRouteDeps, options: McpRouteOptions): Promise<Response> {
  const guarded = await guard(request, deps, RATE_RULES.mcp, "agent");
  if (!guarded.ok) return guarded.response;
  let body: Uint8Array<ArrayBuffer> | null = null;
  if (request.method === "POST") {
    try {
      // Read once under the cap (a missing or false content-length cannot get around it).
      body = await readBody(request, MCP_MAX_BYTES);
    } catch (error) {
      if (error instanceof BodyError) return apiError("invalid", error.message, error.status);
      throw error;
    }
  }
  const headers = forwardedHeaders(request, options.pathToken);
  const forwarded: Request & { auth?: AuthInfo } = new Request(forwardedUrl(request), { method: request.method, headers, body, signal: request.signal });
  // mcp-handler hands `request.auth` to every tool as ctx.http.authInfo.
  forwarded.auth = toAuthInfo(await identify(guarded.store, headers, deps.now?.()));
  return deps.handler(forwarded);
}

/** POST: every JSON-RPC message (initialize, tools/list, tools/call). */
export function createMcpPost(deps: McpRouteDeps) {
  return (request: Request, options: McpRouteOptions = {}) => failSafe("POST /api/mcp", () => serve(request, deps, options));
}

/** GET: stateless Streamable HTTP opens no stream, so the handler answers 405, but only past the same guard. */
export function createMcpGet(deps: McpRouteDeps) {
  return (request: Request, options: McpRouteOptions = {}) => failSafe("GET /api/mcp", () => serve(request, deps, options));
}
