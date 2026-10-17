// /api/mcp: Stoop's remote MCP server (Streamable HTTP, stateless), with score_brief and
// culture_brief. Tools live in lib/mcp/server.ts; the per-IP limit and body cap in lib/routes/mcp.ts.
import { createMcpHandler } from "mcp-handler";
import { connection } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { isLive } from "@/lib/config";
import { buildMcpServer, MCP_SERVER_INFO } from "@/lib/mcp/server";
import { getQlooClient, qlooMode } from "@/lib/qloo/server";
import { createMcpPost } from "@/lib/routes/mcp";
import { runIntake } from "@/lib/runtime/intake";
import { execute, liveModel } from "@/lib/runtime/server";
import { startRun } from "@/lib/runtime/start";
import { getStore } from "@/lib/store";

const handler = createMcpHandler(
  buildMcpServer({
    store: () => getStore(),
    live: () => isLive(),
    // Fixtures mode replays recorded responses only, so scoring can run there with STOOP_LIVE off.
    scoring: () => isLive() || qlooMode() === "fixtures",
    qloo: getQlooClient,
    // The same intake and start as the web flow: the same caps, admission and guardrails.
    runIntake: (input, ctx) => runIntake({ client: getQlooClient(), model: liveModel() }, input, ctx),
    startRun: (input, ctx) => startRun({ execute }, input, ctx),
  }),
  // Stoop has no subscriptions, so no request may hold a function open with a listen stream.
  { serverInfo: MCP_SERVER_INFO, maxSubscriptions: 0 },
);

/** culture_brief answers before its run, but the run goes on in `after()` inside this function, so it gets a run's time. */
export const maxDuration = 300;

const post = createMcpPost({ store: () => getStore(), botCheck: getBotCheck, handler });

export async function POST(request: Request): Promise<Response> {
  return post(request);
}

/** Stateless Streamable HTTP has no stream to open: the handler answers 405. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return handler(request);
}
