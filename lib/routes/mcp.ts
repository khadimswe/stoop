// POST /api/mcp: the bot check (agent kind: MCP clients are software, never asked to prove they are
// browsers), a per-IP limit on every JSON-RPC request, and a body cap, then the MCP handler. Each
// tool adds its own tighter per-visitor limit (lib/mcp/server.ts).
import { apiError, BodyError, readBody } from "../http";
import { RATE_RULES } from "../rate-limit";
import { failSafe, guard, type GuardDeps } from "./guard";

/** The largest tool call is a culture_brief with a 2,000-character description. */
export const MCP_MAX_BYTES = 32_768;

export interface McpRouteDeps extends GuardDeps {
  handler: (request: Request) => Promise<Response>;
}

/** The body, read once under the cap, handed on in a fresh Request with the same URL and headers. */
async function capped(request: Request): Promise<Request> {
  const body = await readBody(request, MCP_MAX_BYTES);
  return new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal });
}

export function createMcpPost(deps: McpRouteDeps) {
  return (request: Request) =>
    failSafe("POST /api/mcp", async () => {
      const guarded = await guard(request, deps, RATE_RULES.mcp, "agent");
      if (!guarded.ok) return guarded.response;
      let forwarded: Request;
      try {
        forwarded = await capped(request);
      } catch (error) {
        if (error instanceof BodyError) return apiError("invalid", error.message, error.status);
        throw error;
      }
      return deps.handler(forwarded);
    });
}
