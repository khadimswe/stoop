// Small constants for the marketing pages, in a plain module so server and client files can share them.

/** The public repository (the code links on /judges and the footer's license). */
export const REPO_URL = "https://github.com/khadimswe/stoop";

/** A link to one file in the repository, for the "What Qloo decides" map. */
export const codeUrl = (path: string) => `${REPO_URL}/blob/main/${path}`;

/**
 * The site's own origin for copyable setup snippets, before the browser can say. Pages render the
 * real origin once they hydrate (window.location.origin).
 */
export function siteOrigin(configured: string | undefined): string {
  const value = configured?.trim().replace(/\/+$/, "");
  return value && /^https?:\/\/[^\s/]+$/.test(value) ? value : "https://stoop.example";
}
