// HMAC signing for the small values Stoop hands to browsers: the judge pass, the visitor cookie and the
// Meta connection (its OAuth state and session cookie; its stored tokens are encrypted under a subkey).
// One secret, STOOP_SIGNING_SECRET (32 or more characters), with a subkey per purpose, so a value
// signed for one purpose never verifies for another. Server only (node:crypto); proxy.ts runs on Node.
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Readonly<Record<string, string | undefined>>;

export const SIGNING_SECRET_MIN = 32;

export type SigningPurpose = "judge-pass" | "judge-code" | "visitor" | "meta-state" | "meta-session";
/** Keys that only encrypt, never sign: sign() and verifySignature() do not take them. */
export type KeyPurpose = "meta-token";

/** The signing secret, or null when it is unset or too short (signed features then stay off). */
export function signingSecret(env: Env = process.env): string | null {
  const secret = env.STOOP_SIGNING_SECRET?.trim();
  return secret && secret.length >= SIGNING_SECRET_MIN ? secret : null;
}

/** The purpose's own 32-byte key. "meta-token" is the AES key for stored Meta tokens (lib/social/session.ts). */
export function subkey(secret: string, purpose: SigningPurpose | KeyPurpose): Buffer {
  return createHmac("sha256", secret).update(`stoop:${purpose}`).digest();
}

/** A base64url HMAC-SHA256 of `message` under the purpose's subkey. */
export function sign(secret: string, purpose: SigningPurpose, message: string): string {
  return createHmac("sha256", subkey(secret, purpose)).update(message).digest("base64url");
}

export function verifySignature(secret: string, purpose: SigningPurpose, message: string, mac: string): boolean {
  return safeEqual(sign(secret, purpose, message), mac);
}

/** Compares two strings in time that depends only on the longer one's length, never on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  const length = Math.max(x.length, y.length, 1);
  const left = Buffer.alloc(length);
  const right = Buffer.alloc(length);
  x.copy(left);
  y.copy(right);
  return timingSafeEqual(left, right) && x.length === y.length;
}

/** Random lowercase hex, for ids carried in signed values. */
export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
