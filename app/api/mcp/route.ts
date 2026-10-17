// /api/mcp: Stoop's remote MCP server (Streamable HTTP, stateless), with score_brief and
// culture_brief. Tools live in lib/mcp/server.ts; the per-IP limit and body cap in lib/routes/mcp.ts.
import { createMcpHandler } from "mcp-handler";
import { connection } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { isLive } from "@/lib/config";
import { buildMcpServer, MCP_SERVER_INFO, pendingRuntime } from "@/lib/mcp/server";
import { getQlooClient, qlooMode } from "@/lib/qloo/server";
import { createMcpPost } from "@/lib/routes/mcp";
import { getStore } from "@/lib/store";

const handler = createMcpHandler(
  buildMcpServer({
    store: () => getStore(),
    live: () => isLive(),
    // Fixtures mode replays recorded responses only, so scoring can run there with STOOP_LIVE off.
    scoring: () => isLive() || qlooMode() === "fixtures",
    qloo: getQlooClient,
    // Until the runtime's RunIntake and StartRun are wired here, culture_brief answers with the lead
    // example's replay and makes no call.
    runIntake: pendingRuntime.runIntake,
    startRun: pendingRuntime.startRun,
  }),
  // Stoop has no subscriptions, so no request may hold a function open with a listen stream.
  { serverInfo: MCP_SERVER_INFO, maxSubscriptions: 0 },
);

/** score_brief is the longest call (up to 27 paced Qloo calls); culture_brief returns before its run. */
export const maxDuration = 60;

const post = createMcpPost({ store: () => getStore(), botCheck: getBotCheck, handler });

export async function POST(request: Request): Promise<Response> {
  return post(request);
}

/** Stateless Streamable HTTP has no stream to open: the handler answers 405. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return handler(request);
}
