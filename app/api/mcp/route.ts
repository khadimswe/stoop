// /api/mcp: Stoop's remote MCP server (Streamable HTTP, stateless), with score_brief and
// culture_brief. Send the MCP token as "Authorization: Bearer <token>" (get one at /mcp); listing tools
// needs none. Tools live in lib/mcp/server.ts; the guard, body cap and token check in lib/routes/mcp.ts.
import { connection } from "next/server";
import { mcpEndpoint } from "@/lib/mcp/endpoint";

/** culture_brief answers before its run, but the run goes on in `after()` inside this function, so it gets a run's time. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return mcpEndpoint.post(request);
}

/** Stateless Streamable HTTP has no stream to open: past the guard, the handler answers 405. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return mcpEndpoint.get(request);
}
