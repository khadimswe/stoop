// Small constants for the marketing pages, in a plain module so server and client files can share them.

/** The public repository (the code links on /judges and the footer's license). */
export const REPO_URL = "https://github.com/khadimswe/stoop";

/** A link to one file in the repository, for the "What Qloo decides" map. */
export const codeUrl = (path: string) => `${REPO_URL}/blob/main/${path}`;

const ORIGIN = /^https?:\/\/[^\s/]+$/;
const clean = (value: string | undefined) => value?.trim().replace(/\/+$/, "") || undefined;

/**
 * The absolute base for metadata (OG and icon URLs): NEXT_PUBLIC_APP_URL, else the Vercel production
 * domain, else this deployment's own domain, so shared links never point at localhost on Vercel.
 * Hosts without a scheme (Vercel's variables) get https.
 */
export function metadataOrigin(env: { app?: string; production?: string; deployment?: string }): URL {
  const app = clean(env.app);
  if (app && ORIGIN.test(app)) return new URL(app);
  for (const host of [clean(env.production), clean(env.deployment)]) {
    if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) return new URL(`https://${host}`);
  }
  return new URL("http://localhost:3000");
}

/**
 * The site's own origin for copyable setup snippets, before the browser can say. Pages render the
 * real origin once they hydrate (window.location.origin).
 */
export function siteOrigin(configured: string | undefined): string {
  const value = configured?.trim().replace(/\/+$/, "");
  return value && /^https?:\/\/[^\s/]+$/.test(value) ? value : "https://stoop.example";
}
