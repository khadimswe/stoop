// POST /api/mcp/token: a free MCP token for /api/mcp, from the /mcp page's form. In order: the browser
// guard (another site's request and what the bot check flags are refused) with a per-IP request limit,
// a JSON body under a small cap, the email normalized like the waitlist's, the honeypot (answered like a
// success; nothing is stored, counted or sent), then the issuing limits reserved before anything is
// issued (3 per IP per day, 100 overall per day; given back if issuing fails). The email joins the
// waitlist with source "mcp" through the waitlist module (its rules unchanged). Only the token's hash
// and its record are stored, the record kept until judging ends and a little past it (tokenRecordTtl);
// the token itself is in this one response and in at most one email, and nowhere else: never logged,
// never stored, not even its first characters. Its label comes from the hash, and a log line that
// quotes a token shows that label instead (lib/mcp/token.ts redactTokens).
import { z } from "zod";
import { mcpTokenRequestSchema } from "../api/requests";
import { mcpTokenResponseSchema } from "../api/responses";
import { judgingEndsAt, mcpCaps, type McpCaps } from "../config";
import { sendMcpToken, type Mailer } from "../email";
import { apiError, BodyError, cookieHeader, json, readCookie, readJson } from "../http";
import { mcpTokenRecordSchema, newToken, redactTokens, tokenHash, tokenLabel, tokenRecordTtl } from "../mcp/token";
import { EVERYONE, RATE_RULES, reserveEach, ruleCounter, type Capped } from "../rate-limit";
import { DAY_SECONDS, dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { saltedHash, type SaltedHash } from "../store/visitor";
import { joinWaitlist, newSignupToken, normalizeEmail, SIGNUP_COOKIE, SIGNUP_COOKIE_MAX_AGE, validSignupToken } from "../waitlist";
import { failSafe, guard, type GuardDeps } from "./guard";

type Env = Readonly<Record<string, string | undefined>>;

/** A token request is an email, a checkbox and the honeypot. */
export const MCP_TOKEN_MAX_BYTES = 2_048;
/** Where a token signup lands in the waitlist export. */
export const MCP_SOURCE = "mcp";

export interface McpTokenDeps extends GuardDeps {
  /** Null without Resend keys: the token is still issued, and `emailed` is false. */
  mailer: () => Mailer | null;
  env?: Env;
}

/** Trims the email before the strict schema sees it, so a pasted trailing space is not an error. */
function trimEmail(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body) && typeof (body as { email?: unknown }).email === "string") {
    return { ...body, email: (body as { email: string }).email.trim() };
  }
  return body;
}

const issueText = (error: z.ZodError) =>
  error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ")
    .slice(0, 300);

/** The token-email counters: per address (salted hash) per day, then the token emails' own daily budget. */
function emailCounters(emailHash: SaltedHash, caps: McpCaps, now: number): Capped<"address" | "budget">[] {
  const budget = ruleCounter({ name: "daily-mcp-token-emails", limit: caps.tokenEmailsDaily, windowSeconds: DAY_SECONDS }, EVERYONE, now);
  return [
    { name: "address", key: keys.rate("mcp-token-email", emailHash, dayOf(now)), cap: caps.tokenEmailsPerAddressDaily, ttlSeconds: TTL.daily },
    { name: "budget", key: budget.key, cap: caps.tokenEmailsDaily, ttlSeconds: budget.ttlSeconds },
  ];
}

/** Whether a token email to this address would go out now. Only a read. */
async function emailRoom(store: Store, emailHash: SaltedHash, caps: McpCaps, now: number): Promise<boolean> {
  const used = await Promise.all(emailCounters(emailHash, caps, now).map(async (c) => ((await store.get<number>(c.key)) ?? 0) < c.cap));
  return used.every(Boolean);
}

export function createMcpTokenPost(deps: McpTokenDeps) {
  return (request: Request) =>
    failSafe("POST /api/mcp/token", async () => {
      const guarded = await guard(request, deps, RATE_RULES.mcpTokenIssue);
      if (!guarded.ok) return guarded.response;
      const { store, visitor } = guarded;

      let body: unknown;
      try {
        body = await readJson(request, MCP_TOKEN_MAX_BYTES);
      } catch (error) {
        if (error instanceof BodyError) return apiError("invalid", error.message, error.status);
        throw error;
      }
      const parsed = mcpTokenRequestSchema.safeParse(trimEmail(body));
      if (!parsed.success) return apiError("invalid", issueText(parsed.error), 400);
      const { email, consent, company } = parsed.data;

      const env = deps.env ?? process.env;
      const now = deps.now?.() ?? Date.now();
      const endsAt = judgingEndsAt(env);
      if (now >= endsAt) return apiError("off", "MCP tokens closed when judging ended.", 410);
      const expiresAt = new Date(endsAt).toISOString();
      const mailer = deps.mailer();
      const caps = mcpCaps(env);
      const day = dayOf(now);
      // The browser's signup token: a first visit gets one, as on the waitlist (honeypot hits too, so they look the same).
      const existingSignup = validSignupToken(readCookie(request, SIGNUP_COOKIE));
      const signupToken = existingSignup ?? newSignupToken();
      const headers = existingSignup ? undefined : { "Set-Cookie": cookieHeader(request, SIGNUP_COOKIE, signupToken, SIGNUP_COOKIE_MAX_AGE) };

      // Honeypot: answered like an issued token, with the same `emailed` a real one would get and the
      // same cookie, so a bot learns nothing. The token was never stored, so it opens nothing.
      if (company) {
        const emailed = mailer !== null && (await emailRoom(store, await saltedHash(store, normalizeEmail(email)), caps, now));
        return json(mcpTokenResponseSchema.parse({ token: newToken(), expiresAt, emailed }), { headers });
      }

      const reserved = await reserveEach(store, [
        { name: "ip", key: keys.rate("mcp-token-issue", visitor, day), cap: caps.issue.perIpDaily, ttlSeconds: TTL.daily },
        { name: "daily", key: keys.daily("mcp-tokens", day), cap: caps.issue.daily, ttlSeconds: TTL.daily },
      ]);
      if (!reserved.ok) {
        return reserved.full === "ip"
          ? apiError("rate_limited", `That's ${caps.issue.perIpDaily} tokens from here today. Use one you already have, or try again tomorrow.`, 429)
          : apiError("daily_cap", "Today's MCP tokens are all handed out. Try again tomorrow (UTC).", 429);
      }

      let issued = false;
      try {
        // The waitlist entry, under the browser's signup cookie as the waitlist route does it.
        const { entry } = await joinWaitlist(store, { email, sellsOn: null, consent, sourceReport: MCP_SOURCE }, { token: signupToken, now: new Date(now) });
        const emailHash = await saltedHash(store, entry.email);

        const token = newToken();
        const hash = tokenHash(token);
        // The label comes from the hash, so no character of the token is kept anywhere.
        const record = mcpTokenRecordSchema.parse({ email: emailHash, issuedAt: new Date(now).toISOString(), expiresAt, revokedAt: null, label: tokenLabel(hash) });
        // Kept until judging ends (JUDGING_ENDS_AT, however far off) and a little past it.
        const ttlSeconds = tokenRecordTtl(endsAt, now);
        // Listed before it is written, so the revoke script can always find a token that exists.
        await store.append(keys.mcp.tokens, [hash], { ttlSeconds });
        if (!(await store.set(keys.mcp.token(hash), record, { ttlSeconds, ifAbsent: true }))) throw new Error("A new MCP token matched one already issued.");
        issued = true;

        // One email per token, at most 2 a day to one address and within the token emails' own daily
        // budget; past either, the token still shows on screen and no email goes out. The token is issued
        // by now, so nothing here may fail the answer that shows it.
        let emailed = false;
        try {
          const room = mailer ? await reserveEach(store, emailCounters(emailHash, caps, now)) : null;
          if (mailer && room?.ok) {
            const origin = new URL(request.url).origin;
            const outcome = await sendMcpToken(mailer, entry.email, token, { origin, expiresAt, calls: caps.perToken.calls, cultureBriefs: caps.perToken.cultureBriefs, idempotencyKey: `mcp-token-${hash.slice(0, 32)}` });
            emailed = outcome === "sent";
          }
        } catch (error) {
          console.warn(redactTokens(`MCP token email skipped: ${error instanceof Error ? error.message : String(error)}`));
        }
        return json(mcpTokenResponseSchema.parse({ token, expiresAt, emailed }), { headers });
      } finally {
        // Nothing was issued: the day's limits get their units back.
        if (!issued) await reserved.reservation.release().catch(() => undefined);
      }
    });
}
