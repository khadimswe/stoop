// The bot check every public write route calls (the waitlist, votes, MCP, and lane A's /api/run). It
// sits behind this interface so a vendor (Vercel BotID) stays optional and Stoop can leave Vercel
// (the portability rule). The default allows everything: with it, the rate limits, the daily caps and
// the live-run admission limit still protect every route.
//
// Why there is no BotID adapter yet: BotID cannot be switched on from the server alone. Enabling it
// takes four changes, each outside this module:
// 1. the `botid` dependency;
// 2. `withBotId(nextConfig)` in next.config.ts (it adds the challenge proxy rewrites);
// 3. `initBotId({ protect: [{ path: "/api/waitlist", method: "POST" }, ...] })` in
//    instrumentation-client.ts, listing every browser route it guards;
// 4. an adapter here that calls `checkBotId()` from "botid/server", picked by a switch such as
//    BOT_CHECK=botid, and only for `kind: "browser"` requests.
// MCP clients are agents, not browsers, so they can never pass BotID: /api/mcp calls the check with
// `kind: "agent"`, which a BotID adapter must allow, and relies on its rate limits instead.

export type BotCheckKind = "browser" | "agent";

export interface BotVerdict {
  bot: boolean;
}

export interface BotCheck {
  readonly name: string;
  /**
   * Judges one request. `browser` routes are called from Stoop's own pages; `agent` routes (MCP) are
   * called by other software on purpose, so a browser-proof check must let them through.
   */
  check(request: Request, options: { kind: BotCheckKind }): Promise<BotVerdict>;
}

/** The default: no vendor, every request allowed. */
export const allowAll: BotCheck = {
  name: "none",
  async check() {
    return { bot: false };
  },
};

let current: BotCheck = allowAll;

export function getBotCheck(): BotCheck {
  return current;
}

/** Tests (and a future adapter switch) swap the check; null restores the default. */
export function setBotCheck(check: BotCheck | null): void {
  current = check ?? allowAll;
}
