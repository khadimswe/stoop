// The judge pass. A judge link (?judge=<code>) sets a signed httpOnly cookie, then redirects to the same
// URL without the code (proxy.ts). The pass unlocks server-paid draft video and nothing else: everything
// a judge needs works without it. JUDGE_CODE appears only in Devpost's testing instructions, and rotates
// by an env change: each cookie carries a keyed digest of the code it was issued under, so a new code
// ends every older pass. Pure functions over an explicit config, so tests never touch the real env.
import { randomHex, safeEqual, sign, signingSecret, verifySignature } from "../sign";

type Env = Readonly<Record<string, string | undefined>>;

export const JUDGE_PARAM = "judge";
/** The credential: httpOnly, read only by the render routes. */
export const JUDGE_COOKIE = "stoop_judge";
/** A hint for the page ("1"): readable by scripts so the static report can show the banner. Never a credential. */
export const JUDGE_HINT_COOKIE = "stoop_judge_ui";
export const JUDGE_CODE_MIN = 16;
/** Passes end the day after judging closes (Nov 2 to 16, 2026) unless JUDGE_PASS_UNTIL says otherwise. */
export const DEFAULT_PASS_UNTIL = "2026-11-17T00:00:00Z";

export interface JudgeConfig {
  code: string;
  secret: string;
  /** Epoch ms after which no pass is issued or accepted. */
  until: number;
}

/** The pass config, or null (the pass is off) without a 16+ character JUDGE_CODE and a signing secret. */
export function judgeConfig(env: Env = process.env): JudgeConfig | null {
  const code = env.JUDGE_CODE?.trim();
  const secret = signingSecret(env);
  if (!code || code.length < JUDGE_CODE_MIN || !secret) return null;
  const until = Date.parse(env.JUDGE_PASS_UNTIL?.trim() || DEFAULT_PASS_UNTIL);
  if (Number.isNaN(until)) throw new Error("JUDGE_PASS_UNTIL must be an ISO date, e.g. 2026-11-17T00:00:00Z.");
  return { code, secret, until };
}

export interface JudgePass {
  /** 24 hex: counts this pass's renders (keys.render.pass). */
  passId: string;
  /** Epoch seconds. */
  issuedAt: number;
}

const PASS = /^v1\.([0-9a-f]{24})\.(\d{1,12})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
/** Issued-at may run this far ahead of the server clock (another instance's skew). */
const CLOCK_SKEW_SECONDS = 300;

/** A keyed digest of the current code, so the cookie never carries anything a brute force could test. */
const codeVersion = (config: JudgeConfig) => sign(config.secret, "judge-code", config.code).slice(0, 16);

export function codeMatches(config: JudgeConfig | null, candidate: string | null | undefined): boolean {
  return Boolean(config && candidate && safeEqual(candidate.trim(), config.code));
}

/** A new pass and its cookie value "v1.<passId>.<iat>.<cv>.<mac>", or null once passes have ended. */
export function issuePass(config: JudgeConfig, now: number = Date.now(), passId: string = randomHex(12)): { pass: JudgePass; value: string } | null {
  if (now >= config.until) return null;
  const issuedAt = Math.floor(now / 1000);
  const body = `v1.${passId}.${issuedAt}.${codeVersion(config)}`;
  return { pass: { passId, issuedAt }, value: `${body}.${sign(config.secret, "judge-pass", body)}` };
}

/** The pass in a cookie value, or null: unsigned, issued under another code, from the future, or past the end date. */
export function verifyPass(config: JudgeConfig | null, value: string | null | undefined, now: number = Date.now()): JudgePass | null {
  if (!config || !value || now >= config.until) return null;
  const match = PASS.exec(value);
  if (!match) return null;
  const [, passId, iat, version, mac] = match;
  const body = `v1.${passId}.${iat}.${version}`;
  if (!verifySignature(config.secret, "judge-pass", body, mac)) return null;
  if (!safeEqual(version, codeVersion(config))) return null;
  const issuedAt = Number(iat);
  if (issuedAt > Math.floor(now / 1000) + CLOCK_SKEW_SECONDS) return null;
  return { passId, issuedAt };
}

/** Seconds the cookie should live: until the pass end date. */
export function passMaxAge(config: JudgeConfig, now: number = Date.now()): number {
  return Math.max(0, Math.floor((config.until - now) / 1000));
}

/** The same URL without the judge code, for the redirect. */
export function withoutJudgeParam(url: URL): URL {
  const next = new URL(url);
  next.searchParams.delete(JUDGE_PARAM);
  return next;
}
