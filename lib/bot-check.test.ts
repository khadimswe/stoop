import { afterEach, describe, expect, it } from "vitest";
import { allowAll, getBotCheck, setBotCheck, type BotCheck } from "./bot-check";

afterEach(() => setBotCheck(null));

describe("bot check", () => {
  it("allows every request by default, for browser and agent routes", async () => {
    expect(getBotCheck()).toBe(allowAll);
    const request = new Request("https://stoop.example/api/waitlist", { method: "POST" });
    expect(await getBotCheck().check(request, { kind: "browser" })).toEqual({ bot: false });
    expect(await getBotCheck().check(request, { kind: "agent" })).toEqual({ bot: false });
  });

  it("can be swapped, and restored to the default", async () => {
    const blockBrowsers: BotCheck = { name: "test", check: async (_request, { kind }) => ({ bot: kind === "browser" }) };
    setBotCheck(blockBrowsers);
    expect(getBotCheck().name).toBe("test");
    setBotCheck(null);
    expect(getBotCheck()).toBe(allowAll);
  });
});
