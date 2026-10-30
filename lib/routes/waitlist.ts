// POST /api/waitlist and GET /api/waitlist/export.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { waitlistRequestSchema } from "../api/requests";
import { waitlistResponseSchema } from "../api/responses";
import { toCsv } from "../csv";
import { type Mailer, sendConfirmation, signupKindOf } from "../email";
import { sha256 } from "../hash";
import { saltedHash } from "../store/visitor";
import { apiError, BodyError, cookieHeader, json, readCookie, readJson } from "../http";
import { DAILY_RULES, EVERYONE, hitRate, RATE_RULES } from "../rate-limit";
import { joinWaitlist, listEntries, newSignupToken, nextPosition, SIGNUP_COOKIE, SIGNUP_COOKIE_MAX_AGE, validSignupToken, type WaitlistEntry } from "../waitlist";
import { failSafe, guard, type GuardDeps } from "./guard";

/** A signup is a few short fields; anything bigger is not one. */
export const WAITLIST_MAX_BYTES = 4_096;

export interface WaitlistDeps extends GuardDeps {
  mailer: () => Mailer | null;
  /** Runs work after the response is sent (after() in the route). */
  defer: (task: () => Promise<unknown>) => void;
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

export function createWaitlistPost(deps: WaitlistDeps) {
  return (request: Request) =>
    failSafe("POST /api/waitlist", async () => {
      const guarded = await guard(request, deps, RATE_RULES.waitlist);
      if (!guarded.ok) return guarded.response;
      const { store } = guarded;

      let body: unknown;
      try {
        body = await readJson(request, WAITLIST_MAX_BYTES);
      } catch (error) {
        if (error instanceof BodyError) return apiError("invalid", error.message, error.status);
        throw error;
      }
      const parsed = waitlistRequestSchema.safeParse(trimEmail(body));
      if (!parsed.success) return apiError("invalid", issueText(parsed.error), 400);
      const { company, ...signup } = parsed.data;

      // Honeypot: answered like a signup, so a bot learns nothing, and nothing is stored or sent.
      if (company) return json(waitlistResponseSchema.parse({ position: await nextPosition(store) }));

      // The browser's signup token: only it may rewrite the entries it created (lib/waitlist.ts).
      const existingToken = validSignupToken(readCookie(request, SIGNUP_COOKIE));
      const token = existingToken ?? newSignupToken();
      const { entry, created } = await joinWaitlist(store, signup, { token, ...(deps.now ? { now: new Date(deps.now()) } : {}) });

      // The confirmation goes to a first signup only, so repeat posts can never be used to mail someone,
      // and within a global daily cap. Consent covers emails beyond it (lib/api/requests.ts).
      const mailer = deps.mailer();
      if (created && mailer && (await hitRate(store, DAILY_RULES.confirmationEmails, EVERYONE, deps.now?.())).ok) {
        const key = `waitlist-confirm-${await saltedHash(store, entry.email)}`;
        deps.defer(() => sendConfirmation(mailer, entry.email, entry.position, key, signupKindOf(entry.sourceReport)));
      }
      const headers = existingToken ? undefined : { "Set-Cookie": cookieHeader(request, SIGNUP_COOKIE, token, SIGNUP_COOKIE_MAX_AGE) };
      return json(waitlistResponseSchema.parse({ position: entry.position }), { headers });
    });
}

// --- The founder's export ------------------------------------------------------------------------

export interface ExportDeps extends GuardDeps {
  /** WAITLIST_EXPORT_TOKEN; without one (or with one too short to be safe) the route does not exist (404). */
  token: () => string | undefined;
}

/** A shorter WAITLIST_EXPORT_TOKEN counts as not configured. */
export const EXPORT_TOKEN_MIN = 32;

/** Constant time, and the lengths stay hidden: both sides are hashed to 32 bytes first. */
export function tokenMatches(given: string, expected: string): boolean {
  const digest = (value: string) => Buffer.from(sha256(value), "hex");
  return timingSafeEqual(digest(given), digest(expected));
}

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  return match ? match[1] : null;
}

export const EXPORT_COLUMNS = ["position", "email", "sells_on", "plan", "consent", "product_link", "source", "created_at", "updated_at"] as const;

export function waitlistCsv(entries: readonly WaitlistEntry[]): string {
  return toCsv([
    EXPORT_COLUMNS,
    ...entries.map((e) => [e.position, e.email, e.sellsOn, e.plan, e.consent, e.productLink, e.sourceReport, e.createdAt, e.updatedAt]),
  ]);
}

export function createWaitlistExport(deps: ExportDeps) {
  return (request: Request) =>
    failSafe("GET /api/waitlist/export", async () => {
      const expected = deps.token()?.trim();
      if (!expected || expected.length < EXPORT_TOKEN_MIN) return apiError("not_found", "Not found.", 404);
      // The founder fetches this with curl, not from a Stoop page, so a browser-only bot check must let it by.
      const guarded = await guard(request, deps, RATE_RULES.waitlistExport, "agent");
      if (!guarded.ok) return guarded.response;
      const given = bearer(request);
      if (!given || !tokenMatches(given, expected)) {
        return apiError("invalid", "Missing or wrong export token.", 401, { "WWW-Authenticate": 'Bearer realm="waitlist-export"' });
      }
      const entries = await listEntries(guarded.store);
      const day = new Date(deps.now?.() ?? Date.now()).toISOString().slice(0, 10);
      return new Response(waitlistCsv(entries), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="stoop-waitlist-${day}.csv"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
}
