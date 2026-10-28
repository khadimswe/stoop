// plan_store_event on Stoop's MCP server: it starts a plan through the same start as POST /api/plan.
import { createMcpHandler } from "mcp-handler";
import { describe, expect, it, vi } from "vitest";
import { allowAll } from "../bot-check";
import { storeToken } from "../mcp/fixture-token";
import { buildMcpServer, type McpDeps } from "../mcp/server";
import { createMcpPost } from "../routes/mcp";
import { MemoryStore } from "../store/memory";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import { startPlan, type PlanStartResponse } from "./runtime";

type RpcResult = { result?: { tools?: { name: string }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }; error?: { message: string } };

function setup(startPlanImpl: McpDeps["startPlan"]) {
  const store = new MemoryStore();
  const deps: McpDeps = {
    store: () => store,
    live: () => true,
    scoring: () => false,
    qloo: () => {
      throw new Error("no Qloo in this test");
    },
    runIntake: vi.fn(),
    startRun: vi.fn(),
    startPlan: startPlanImpl,
    env: {},
  };
  const handler = createMcpHandler(buildMcpServer(deps), { serverInfo: { name: "stoop", version: "0.1.0" } });
  const post = createMcpPost({ store: () => store, botCheck: () => allowAll, handler });
  let id = 0;
  return async (method: string, params: Record<string, unknown>): Promise<RpcResult> => {
    const { token } = await storeToken(store);
    const response = await post(
      new Request("https://stoop.example/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "x-forwarded-for": "203.0.113.7", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
      {},
    );
    const text = await response.text();
    const data = text.startsWith("event:") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
    return JSON.parse(data ?? "{}") as RpcResult;
  };
}

const inputs = PLAN_EXAMPLE_INPUTS["atlanta-west-end"];

describe("plan_store_event", () => {
  it("is listed when the runtime passes startPlan", async () => {
    const { result } = await setup(vi.fn())("tools/list", {});
    expect(result?.tools?.map((t) => t.name).sort()).toEqual(["culture_brief", "plan_store_event", "score_brief"]);
  });

  it("starts a plan and answers with absolute links", async () => {
    const live: PlanStartResponse = { mode: "live", id: "plan_0123456789abcdef01234567", eventsUrl: "/api/plan/plan_0123456789abcdef01234567/events", planUrl: "/plan/plan_0123456789abcdef01234567", joined: false };
    const start = vi.fn(async () => live);
    const { result } = await setup(start)("tools/call", { name: "plan_store_event", arguments: { inputs } });
    expect(start).toHaveBeenCalledWith({ inputs }, expect.objectContaining({ source: "mcp" }));
    expect(result?.structuredContent).toMatchObject({ mode: "live", planUrl: "https://stoop.example/plan/plan_0123456789abcdef01234567" });
    expect(result?.content?.[0]?.text).toContain("Started plan plan_0123456789abcdef01234567");
  });

  it("answers with an example plan while live plans are off", async () => {
    const { result } = await setup((input, ctx) => startPlan({ env: { STOOP_LIVE: "false" }, execute: async () => {} }, input, ctx))("tools/call", { name: "plan_store_event", arguments: { inputs } });
    expect(result?.structuredContent).toMatchObject({ mode: "example", slug: "atlanta-west-end", planUrl: "https://stoop.example/examples/stores/atlanta-west-end" });
  });
});
