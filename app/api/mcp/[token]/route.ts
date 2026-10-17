// /api/mcp/<token>: the same MCP server as /api/mcp, for clients that only take a URL. The token moves
// into the Authorization header and the handler is handed /api/mcp (lib/routes/mcp.ts), so it never
// sees a token in a URL. Prefer the Bearer header where a client allows it: hosting logs record paths.
import { connection } from "next/server";
import { mcpEndpoint } from "@/lib/mcp/endpoint";

export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/mcp/[token]">): Promise<Response> {
  const { token } = await ctx.params;
  return mcpEndpoint.post(request, { pathToken: token });
}

export async function GET(request: Request, ctx: RouteContext<"/api/mcp/[token]">): Promise<Response> {
  await connection();
  const { token } = await ctx.params;
  return mcpEndpoint.get(request, { pathToken: token });
}
