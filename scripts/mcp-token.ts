// The founder's MCP token tools, on the real store (getStore: Upstash with its keys set). Prints labels,
// dates and statuses only: the store keeps no full token, and nothing here prints a hash, an email or a
// value from the env.
//
//   npm run mcp:token -- list
//   npm run mcp:token -- revoke <label-prefix>      e.g. stp_AbCd (from the listing)
//   npm run mcp:token -- revoke-email <email>       every token issued to that address
import { listTokens, MIN_LABEL_PREFIX, revokeByEmail, revokeByLabel, type TokenListing } from "../lib/mcp/admin";
import { getStore } from "../lib/store";
import { loadLocalEnv } from "./env";

loadLocalEnv();

const USAGE = ["Usage:", "  npm run mcp:token -- list", "  npm run mcp:token -- revoke <label-prefix>", "  npm run mcp:token -- revoke-email <email>"].join("\n");

const row = (t: TokenListing) => `${t.label}...  ${t.status.padEnd(7)}  issued ${t.issuedAt}  expires ${t.expiresAt}${t.revokedAt ? `  revoked ${t.revokedAt}` : ""}`;

async function main() {
  const [command, arg] = process.argv.slice(2);
  const store = getStore();
  if (store.kind !== "upstash") console.warn("No Upstash keys are set, so this reads an empty in-memory store. Set the store's keys to manage real tokens.");
  switch (command) {
    case "list": {
      const tokens = await listTokens(store);
      if (tokens.length === 0) console.log("No MCP tokens issued.");
      for (const t of tokens) console.log(row(t));
      const active = tokens.filter((t) => t.status === "active").length;
      if (tokens.length) console.log(`${tokens.length} issued, ${active} active.`);
      return;
    }
    case "revoke": {
      if (!arg) break;
      const result = await revokeByLabel(store, arg);
      if (result.outcome === "too-short") console.log(`Give a label prefix of at least ${MIN_LABEL_PREFIX} characters, starting with stp_.`);
      else if (result.outcome === "none") console.log("No token has that label.");
      else if (result.outcome === "ambiguous") {
        console.log("That prefix matches more than one token. Give a longer one:");
        for (const t of result.matches) console.log(row(t));
      } else if (result.revoked.length === 0) console.log("That token was already revoked.");
      else for (const t of result.revoked) console.log(`Revoked ${t.label}...`);
      if (result.outcome !== "revoked") process.exitCode = 1;
      return;
    }
    case "revoke-email": {
      if (!arg) break;
      const revoked = await revokeByEmail(store, arg);
      console.log(revoked.length ? `Revoked ${revoked.length} ${revoked.length === 1 ? "token" : "tokens"} for that email: ${revoked.map((t) => `${t.label}...`).join(", ")}` : "No token to revoke for that email.");
      return;
    }
  }
  console.log(USAGE);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`mcp-token stopped: ${error instanceof Error ? error.name : "error"}`);
  process.exitCode = 1;
});
