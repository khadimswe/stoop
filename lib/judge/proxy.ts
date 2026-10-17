// What proxy.ts does with a judge link (?judge=<code>), as a plain function over a Web Request so tests
// run it without Next. Every answer is the same 303 to the same URL without the code, so the code never
// stays in the address bar, the history or a Referer. Only a right code, under the attempt limit and
// before judging ends, also sets the pass (httpOnly) and its hint (readable by the page's script):
// a still-valid pass is kept, so reopening the link never resets a judge's render count.
//
// Wrong codes are counted per IP per hour, best effort: the store gets a short time to answer and the
// proxy goes on without it otherwise (the code's randomness is the real defense, and a page load must
// never hang on the store). Past the limit even the right code gets no cookie for the rest of the hour.
import { keys } from "../store/keys";
import type { Store } from "../store/types";
import { visitorId } from "../store/visitor";
import {
  codeMatches,
  issuePass,
  JUDGE_CODE_ATTEMPTS_PER_HOUR,
  JUDGE_COOKIE,
  JUDGE_COOKIE_OPTIONS,
  JUDGE_HINT_COOKIE,
  JUDGE_HINT_COOKIE_OPTIONS,
  JUDGE_PARAM,
  passMaxAge,
  verifyPass,
  withoutJudgeParam,
  type JudgeConfig,
} from "./pass";

/** How long the proxy waits on the store for the attempt count, each way. */
export const STORE_TIMEOUT_MS = 300;
const ATTEMPT_WINDOW_SECONDS = 60 * 60;

export interface JudgeProxyDeps {
  /** Null keeps the pass off: every judge link just loses its code. */
  config: JudgeConfig | null;
  /** The store for the wrong-code count; one that throws or stalls is skipped. */
  store: () => Store;
  now?: () => number;
  storeTimeoutMs?: number;
}

type CookieOptions = { readonly httpOnly: boolean; readonly sameSite: "lax"; readonly path: string };

/** One cookie from the Cookie header (lib/http.ts readCookie pulls the API schemas in, which the proxy bundle does not need). */
function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** A Set-Cookie value. SameSite is always Lax (never None); Secure on https. */
export function judgeCookie(name: string, value: string, maxAgeSeconds: number, options: CookieOptions, secure: boolean): string {
  return `${name}=${value}; Path=${options.path}; Max-Age=${maxAgeSeconds}; SameSite=Lax${options.httpOnly ? "; HttpOnly" : ""}${secure ? "; Secure" : ""}`;
}

/** The work's answer, or null when it throws or takes longer than `ms` (it may still finish later, unseen). */
async function within<T>(ms: number, work: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface Attempts {
  /** True when this IP has used up its wrong codes for the hour. */
  over: boolean;
  /** Counts one wrong code (best effort). */
  miss(): Promise<void>;
}

const OPEN: Attempts = { over: false, miss: async () => {} };

async function attempts(deps: JudgeProxyDeps, headers: Headers, now: number): Promise<Attempts> {
  let store: Store;
  try {
    store = deps.store();
  } catch {
    return OPEN;
  }
  const ms = deps.storeTimeoutMs ?? STORE_TIMEOUT_MS;
  const hour = new Date(now).toISOString().slice(0, 13);
  const read = await within(ms, async () => {
    const key = keys.rate("judge-code", await visitorId(store, headers), hour);
    return { key, used: (await store.get<number>(key)) ?? 0 };
  });
  if (!read) return OPEN;
  return {
    over: read.used >= JUDGE_CODE_ATTEMPTS_PER_HOUR,
    miss: async () => {
      await within(ms, () => store.incr(read.key, { ttlSeconds: ATTEMPT_WINDOW_SECONDS + 60 }));
    },
  };
}

export async function judgeProxy(request: Request, deps: JudgeProxyDeps): Promise<Response> {
  const now = deps.now?.() ?? Date.now();
  const url = new URL(request.url);
  // Absolute: Next's proxy adapter resolves the Location itself and makes it relative for the same host.
  // No fragment: browsers never send one, and they carry their own over to a redirect without one.
  const target = withoutJudgeParam(url);
  target.hash = "";
  // Never a path that starts with "//": Next shortens a same-host Location to its path, and
  // "//evil.example/x" would then send the visitor to another host (an open redirect).
  target.pathname = target.pathname.replace(/\/{2,}/g, "/");
  const headers = new Headers({ Location: target.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const redirect = () => new Response(null, { status: 303, headers });

  const { config } = deps;
  const code = url.searchParams.get(JUDGE_PARAM);
  if (!config || !code) return redirect();
  const limit = await attempts(deps, request.headers, now);
  if (limit.over) return redirect();
  if (!codeMatches(config, code)) {
    await limit.miss();
    return redirect();
  }

  const existing = readCookie(request, JUDGE_COOKIE);
  const value = existing && verifyPass(config, existing, now) ? existing : (issuePass(config, now)?.value ?? null);
  // Past the end of judging no pass is issued, so the link only loses its code.
  if (!value) return redirect();
  const maxAge = passMaxAge(config, now);
  const secure = url.protocol === "https:";
  headers.append("Set-Cookie", judgeCookie(JUDGE_COOKIE, value, maxAge, JUDGE_COOKIE_OPTIONS, secure));
  headers.append("Set-Cookie", judgeCookie(JUDGE_HINT_COOKIE, "1", maxAge, JUDGE_HINT_COOKIE_OPTIONS, secure));
  return redirect();
}
