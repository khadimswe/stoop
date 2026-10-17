import { describe, expect, it, vi } from "vitest";
import { allowAll, type BotCheck } from "../bot-check";
import { MemoryStore } from "../store/memory";
import { createMcpPost, MCP_MAX_BYTES } from "./mcp";

function setup(botCheck: BotCheck = allowAll) {
  const store = new MemoryStore();
  const handler = vi.fn(async (request: Request) => Response.json({ seen: await request.text() }));
  return { handler, post: createMcpPost({ store: () => store, botCheck: () => botCheck, handler }) };
}

const rpc = (body: string, ip = "203.0.113.7") => new Request("https://stoop.example/api/mcp", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body });

describe("POST /api/mcp", () => {
  it("hands the request on with its body intact", async () => {
    const { post, handler } = setup();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const response = await post(rpc(body));
    expect(await response.json()).toEqual({ seen: body });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("limits every visitor to 120 requests per 10 minutes", async () => {
    const { post, handler } = setup();
    for (let i = 0; i < 120; i++) expect((await post(rpc("{}"))).status).toBe(200);
    const limited = await post(rpc("{}"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(handler).toHaveBeenCalledTimes(120);
    expect((await post(rpc("{}", "198.51.100.2"))).status).toBe(200);
  });

  it("refuses a body over the cap without reading it into the handler", async () => {
    const { post, handler } = setup();
    const response = await post(rpc("x".repeat(MCP_MAX_BYTES + 1)));
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("asks the bot check as an agent route", async () => {
    const check = vi.fn<BotCheck["check"]>(async (_request, { kind }) => ({ bot: kind === "browser" }));
    const { post, handler } = setup({ name: "test", check });
    expect((await post(rpc("{}"))).status).toBe(200);
    expect(check).toHaveBeenCalledWith(expect.any(Request), { kind: "agent" });
    const blocked = setup({ name: "test", check: async () => ({ bot: true }) });
    expect((await blocked.post(rpc("{}"))).status).toBe(403);
    expect(blocked.handler).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });
});
