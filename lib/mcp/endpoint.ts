// Stoop's MCP endpoint bound to its real vendors, shared by /api/mcp (Bearer token) and
// /api/mcp/<token> (the path form), so both serve one handler with the same guards and caps.
// `server-only`: keys never reach a browser bundle.
import "server-only";
import { createMcpHandler } from "mcp-handler";
import { getBotCheck } from "../bot-check";
import { isLive } from "../config";
import { getQlooClient, qlooMode } from "../qloo/server";
import { createMcpGet, createMcpPost } from "../routes/mcp";
import { runIntake } from "../runtime/intake";
import { execute, liveModel } from "../runtime/server";
import { startRun } from "../runtime/start";
import { getStore } from "../store";
import { buildMcpServer, MCP_SERVER_INFO } from "./server";
import { execute as executePlan } from "../plan/server";
import { startPlan } from "../plan/runtime";

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
    startPlan: (input, ctx) => startPlan({ execute: executePlan }, input, ctx),
  }),
  // Stoop has no subscriptions, so no request may hold a function open with a listen stream.
  { serverInfo: MCP_SERVER_INFO, maxSubscriptions: 0 },
);

const routeDeps = { store: () => getStore(), botCheck: getBotCheck, handler };

export const mcpEndpoint = { post: createMcpPost(routeDeps), get: createMcpGet(routeDeps) };
