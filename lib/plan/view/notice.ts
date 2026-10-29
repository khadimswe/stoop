// The note an example plan carries when it stands in for the plan someone asked for: live plans are
// off (or busy, or used up for today), so "Plan my event" opened a recorded example instead. The
// Create step leaves it in sessionStorage (PLAN_NOTICE_KEY) and the example's Event page says so,
// plainly, with the way back. Pure; the browser wiring lives in components/stoop/floor/example-notice.tsx.

export interface PlanNotice {
  /** The server's own words ("Live plans are off right now. Here is a full example plan instead."). */
  message: string;
  /** The example that opened. */
  slug: string;
  /** The store the manager asked for, when the form had one. */
  from: { name: string; city: string } | null;
  /** Where "Back to your store" goes. */
  back: string;
}

/** Reads what the Create step left: the JSON note, or an older plain message (shown for any example). */
export function parsePlanNotice(raw: string | null): (Omit<PlanNotice, "slug"> & { slug: string | null }) | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PlanNotice>;
    if (typeof v.message === "string" && v.message.trim()) {
      const from = v.from && typeof v.from.name === "string" && typeof v.from.city === "string" ? { name: v.from.name, city: v.from.city } : null;
      return { message: v.message.trim(), slug: typeof v.slug === "string" ? v.slug : null, from, back: typeof v.back === "string" && v.back.startsWith("/") ? v.back : "/start" };
    }
  } catch {
    // A plain message, from before the note had a shape.
  }
  return raw.trim() && !raw.trim().startsWith("{") ? { message: raw.trim(), slug: null, from: null, back: "/start" } : null;
}

/** "Live plans are off right now." and the rest of the server's message, split at its first sentence. */
export function splitMessage(message: string): { title: string; rest: string | null } {
  const m = /^(.+?[.!])\s+(.+)$/.exec(message.trim());
  return m ? { title: m[1]!, rest: m[2]! } : { title: message.trim(), rest: null };
}

/**
 * The banner's words on the example's Event page: what happened (the server's first sentence), then
 * whose plan this is, so nobody mistakes an example store's plan for their own.
 */
export function noticeCopy(notice: Pick<PlanNotice, "message" | "from">, example: { storeName: string; cityLine: string }): { title: string; body: string } {
  const { title } = splitMessage(notice.message);
  const same = notice.from && notice.from.name.trim().toLowerCase() === example.storeName.trim().toLowerCase();
  if (same) return { title, body: `So this is the plan Stoop recorded for ${example.storeName}, an example store. Nothing new was planned.` };
  const yours = notice.from ? ` It was not planned for ${notice.from.name}.` : "";
  return { title, body: `So this is a full example plan for ${example.storeName}, a store in ${example.cityLine}.${yours}` };
}
