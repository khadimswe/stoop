// The browser side of the waitlist: what the form posts to /api/waitlist and where a signup came
// from. Client-safe: it imports the API contract as types only (lib/api/responses pulls in the
// Report schema), so the form's bundle stays small.
import type { WaitlistRequest } from "./api/requests";

export class WaitlistPostError extends Error {
  constructor(readonly status: number) {
    super(`The waitlist answered ${status}.`);
    this.name = "WaitlistPostError";
  }
}

/** Posts a signup (or the same signup again with its product link) and returns the position. */
export async function postWaitlist(body: WaitlistRequest, fetchImpl: typeof fetch = fetch): Promise<{ position: number }> {
  const payload = Object.fromEntries(Object.entries({ ...body, email: body.email.trim() }).filter(([, value]) => value !== undefined && value !== ""));
  const response = await fetchImpl("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const json: unknown = await response.json().catch(() => null);
  const position = json && typeof json === "object" ? (json as { position?: unknown }).position : undefined;
  if (!response.ok || typeof position !== "number") throw new WaitlistPostError(response.status);
  return { position };
}

const SOURCE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Where a signup came from, by page: "home", an example slug, a run id, or a page name (the API keeps
 * only these, never free text, since the value lands in the CSV export).
 */
export function sourceFromPath(pathname: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "home";
  const [first, second] = parts;
  const candidate = (first === "examples" || first === "report" || first === "run") && second ? second : first;
  const value = candidate.toLowerCase();
  return SOURCE.test(value) ? value : undefined;
}
