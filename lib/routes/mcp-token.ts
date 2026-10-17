// POST /api/mcp/token: a free MCP token for /api/mcp, from the /mcp page's form. In order: the browser
// guard (another site's request and what the bot check flags are refused) with a per-IP request limit,
// a JSON body under a small cap, the email normalized like the waitlist's, the honeypot (answered like a
// success; nothing is stored, counted or sent), then the issuing limits reserved before anything is
// issued (per IP per day, and overall per day; given back if issuing fails). The email joins the
// waitlist with source "mcp" through the waitlist module (its rules unchanged). Only the token's hash
// and its record are stored; the token itself is in this one response and in one email, and nowhere
// else: never logged, never stored.
import { z } from "zod";
import { mcpTokenRequestSchema } from "../api/requests";
import { mcpTokenResponseSchema } from "../api/responses";
import { judgingEndsAt, mcpCaps } from "../config";
import { sendMcpToken, type Mailer } from "../email";
import { apiError, BodyError, cookieHeader, json, readCookie, readJson } from "../http";
import { mcpTokenRecordSchema, newToken, redactTokens, tokenHash } from "../mcp/token";
import { DAILY_RULES, EVERYONE, hitRate, RATE_RULES, reserveEach } from "../rate-limit";
import { dayOf, keys, TTL } from "../store/keys";
import { saltedHash } from "../store/visitor";
import { joinWaitlist, newSignupToken, SIGNUP_COOKIE, SIGNUP_COOKIE_MAX_AGE, validSignupToken } from "../waitlist";
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

export function createMcpTokenPost(deps: McpTokenDeps) {
  return (request: Request) =>
    failSafe("POST /api/mcp/token", async () => {
      const guarded = await guard(request, deps, RATE_RULES.mcpToken);
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

      // Honeypot: answered like an issued token, so a bot learns nothing. The token was never stored, so it opens nothing.
      if (company) return json(mcpTokenResponseSchema.parse({ token: newToken(), expiresAt, emailed: mailer !== null }));

      const caps = mcpCaps(env);
      const day = dayOf(now);
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
        const existingSignup = validSignupToken(readCookie(request, SIGNUP_COOKIE));
        const signupToken = existingSignup ?? newSignupToken();
        const { entry } = await joinWaitlist(store, { email, sellsOn: null, consent, sourceReport: MCP_SOURCE }, { token: signupToken, now: new Date(now) });

        const token = newToken();
        const hash = tokenHash(token);
        const record = mcpTokenRecordSchema.parse({ email: await saltedHash(store, entry.email), issuedAt: new Date(now).toISOString(), expiresAt, revokedAt: null, label: token.slice(0, 8) });
        // Listed before it is written, so the revoke script can always find a token that exists.
        await store.append(keys.mcp.tokens, [hash], { ttlSeconds: TTL.mcpToken });
        if (!(await store.set(keys.mcp.token(hash), record, { ttlSeconds: TTL.mcpToken, ifAbsent: true }))) throw new Error("A new MCP token matched one already issued.");
        issued = true;

        // One email per token, within the day's email budget (shared with waitlist confirmations, for
        // Resend's daily quota). The token is issued by now, so nothing here may fail the answer that shows it.
        let emailed = false;
        try {
          if (mailer && (await hitRate(store, DAILY_RULES.confirmationEmails, EVERYONE, now)).ok) {
            const origin = new URL(request.url).origin;
            const outcome = await sendMcpToken(mailer, entry.email, token, { origin, expiresAt, calls: caps.perToken.calls, cultureBriefs: caps.perToken.cultureBriefs, idempotencyKey: `mcp-token-${hash.slice(0, 32)}` });
            emailed = outcome === "sent";
          }
        } catch (error) {
          console.warn(redactTokens(`MCP token email skipped: ${error instanceof Error ? error.message : String(error)}`));
        }
        const headers = existingSignup ? undefined : { "Set-Cookie": cookieHeader(request, SIGNUP_COOKIE, signupToken, SIGNUP_COOKIE_MAX_AGE) };
        return json(mcpTokenResponseSchema.parse({ token, expiresAt, emailed }), { headers });
      } finally {
        // Nothing was issued: the day's limits get their units back.
        if (!issued) await reserved.reservation.release().catch(() => undefined);
      }
    });
}
