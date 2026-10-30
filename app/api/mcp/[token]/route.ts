// /api/mcp/<token>: the same MCP server as /api/mcp, for clients that only take a URL. The token moves
// into the Authorization header and the handler is handed /api/mcp (lib/routes/mcp.ts), so it never
// sees a token in a URL. Prefer the Bearer header where a client allows it: hosting logs record paths.
// Setup rule: no trailing slash. Next answers /api/mcp/<token>/ with a 308 to the address without it,
// and that redirect's Location header repeats the token; changing that would change routing for every
// page, so the setup text (the email, the refusal messages, the /mcp page) says "no slash after it".
import { connection } from "next/server";
import { mcpEndpoint } from "@/lib/mcp/endpoint";

export async function POST(request: Request, ctx: RouteContext<"/api/mcp/[token]">): Promise<Response> {
  const { token } = await ctx.params;
  return mcpEndpoint.post(request, { pathToken: token });
}

export async function GET(request: Request, ctx: RouteContext<"/api/mcp/[token]">): Promise<Response> {
  await connection();
  const { token } = await ctx.params;
  return mcpEndpoint.get(request, { pathToken: token });
}
