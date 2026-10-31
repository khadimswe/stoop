// Who may see all of a live plan and change it. A live plan's id is also its public share id (the event
// page /e/<id> and the Facebook and WhatsApp links carry it), so the id alone opens only the public view:
// what the event page shows (publicPlanReport). The full report, the event stream and every write
// (logged results, marketing, posting to Meta) need the plan's owner:
// - a browser: the signed visitor cookie (lib/visitor-cookie.ts) it carried when it started the plan,
//   kept on the plan's meta as `owner`. The cookie is HttpOnly, SameSite=Lax and lasts 180 days, so the
//   phone or computer that made the plan keeps it; another device gets the public view;
// - an agent: the MCP token that started it (plan_store_event), sent as "Authorization: Bearer".
// Without STOOP_SIGNING_SECRET there are no signed cookies: in local dev only (never in a production
// build or on Vercel) the starter's salted IP stands in, which is weaker (anyone on the same network).
// A deploy without the secret has no owners: live plans there read and stay public-view only.
// Example plans ("ex-<slug>") stay public and read-only for everyone. Server-side jobs (the marketing
// job, started when a plan finishes) never come through here: they call the lib functions directly.
import { cookieVisitorOf } from "../http";
import { identify } from "../mcp/auth";
import { safeEqual, signingSecret } from "../sign";
import type { Store } from "../store/types";
import { tokenVisitorId, visitorId } from "../store/visitor";
import { planExampleSlug } from "./example-list";
import type { MarketingState } from "./posts-run";
import { PLAN_VERSION, type Concept, type Place, type PlanItem, type PlanReport, type Poster } from "./schema";

type ShoppingItem = NonNullable<PlanReport["plan"]>["shopping"][number];
import { getPlanMeta, livePlanIdSchema, type PlanMeta } from "./store";

type Env = Readonly<Record<string, string | undefined>>;

export interface OwnerDeps {
  env?: Env;
  now?: () => number;
}

export const NOT_OWNER_MESSAGE = "Only the phone or computer that started this plan can change it.";
export const NOT_OWNER_READ_MESSAGE = "This plan's details open on the phone or computer that started it.";

/** Whether this request comes from the plan's owner: its browser, or the MCP token that started it. */
export async function isOwnerOf(request: Request, meta: PlanMeta, store: Store, deps: OwnerDeps = {}): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (meta.visitor?.startsWith("t_") && request.headers.get("authorization")) {
    const caller = await identify(store, request.headers, deps.now?.());
    if (caller.status === "valid" && tokenVisitorId(caller.hash) === meta.visitor) return true;
  }
  const secret = signingSecret(env);
  if (secret) {
    const cookie = cookieVisitorOf(request, secret);
    return cookie !== null && meta.owner !== undefined && safeEqual(cookie, meta.owner);
  }
  // No signing secret, so no signed cookies: in local dev only, the starter's salted IP stands in. A
  // deploy (or `next start`) without the secret has no owners at all, so a shared carrier NAT or store
  // Wi-Fi never opens someone else's plan.
  if (!ipFallbackAllowed(env)) return false;
  return meta.visitor?.startsWith("v_") === true && (await visitorId(store, request.headers)) === meta.visitor;
}

/** The salted-IP stand-in is for local development only: never in a production build or on Vercel. */
export function ipFallbackAllowed(env: Env): boolean {
  return env.NODE_ENV !== "production" && !env.VERCEL && !env.VERCEL_ENV;
}

export type OwnerCheck = { kind: "example" } | { kind: "owner"; meta: PlanMeta } | { kind: "stranger"; meta: PlanMeta } | { kind: "missing" };

/** What this request is to the plan: an example (public, read-only), its owner, a stranger, or no such live plan. */
export async function checkPlanOwner(request: Request, planId: string, store: Store, deps: OwnerDeps = {}): Promise<OwnerCheck> {
  if (planExampleSlug(planId)) return { kind: "example" };
  const runId = livePlanIdSchema.safeParse(planId);
  if (!runId.success) return { kind: "missing" };
  const meta = await getPlanMeta(store, runId.data);
  if (!meta) return { kind: "missing" };
  return (await isOwnerOf(request, meta, store, deps)) ? { kind: "owner", meta } : { kind: "stranger", meta };
}

const refusal = (code: "invalid" | "not_found" | "failed", message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

/**
 * For a route that changes a live plan (or spends on it): null when the request may go on, else the
 * answer (403 for anyone but the owner, 503 when the store cannot say). Examples and ids that are not
 * live plans go on, so the handler gives its own answer (examples are read-only there, bad ids 400 or 404).
 */
export async function ownerRefusal(request: Request, planId: string, store: () => Store, deps: OwnerDeps = {}): Promise<Response | null> {
  if (planExampleSlug(planId) || !livePlanIdSchema.safeParse(planId).success) return null;
  let check: OwnerCheck;
  try {
    check = await checkPlanOwner(request, planId, store(), deps);
  } catch {
    return refusal("failed", "Saving is paused right now. Try again soon.", 503);
  }
  if (check.kind === "stranger") return refusal("invalid", NOT_OWNER_MESSAGE, 403);
  return null;
}

/** A write route behind the owner check: the handler runs only for the plan's owner (or an example, or a bad id). */
export async function ownerOnly(request: Request, planId: string, store: () => Store, handler: () => Promise<Response>, deps: OwnerDeps = {}): Promise<Response> {
  return (await ownerRefusal(request, planId, store, deps)) ?? handler();
}

// --- The public view -----------------------------------------------------------------------------

const REF = /\[\[[A-Za-z0-9-]+\]\]/g;

/** A poster as the public sees it: the image and its words, never the art prompt. */
export function publicPoster(poster: Poster): Poster {
  return { status: poster.status, prompt: "", promptHash: "", alt: poster.alt, ...(poster.url ? { url: poster.url } : {}), ...(poster.reason ? { reason: poster.reason } : {}) };
}

/**
 * What anyone with a live plan's link may read: exactly what the public event page (/e/<id>) shows (the
 * kept concept's title and hook, the day, time and place, the store's name and public phone, the
 * promos word for word, the poster, and what is at the table: the city's artists for its music line, the
 * places the food comes from, the prize wheel) and nothing private: no notes, budget, prices, store
 * number, logged results, posts drafts, A/B test, trace, cost, the other concepts, the rest of the
 * community, or any receipt beyond the few those table facts cite. It is still a valid PlanReport, so
 * the pages read it with the same parser. A hook that names a measured place keeps a masked token, so
 * the event page leaves it out exactly as it does today.
 */
export function publicPlanReport(report: PlanReport): PlanReport {
  const store = { ...report.inputs.store };
  delete store.storeNumber;
  const inputs = { ...report.inputs };
  delete inputs.notes;
  const kept = report.plan ? (report.plan.concepts.find((c) => c.id === report.plan?.conceptId) ?? report.plan.concepts.find((c) => c.kept) ?? null) : null;
  // What is at the table, as the event page says it: where the snacks come from (no prices), the wheel,
  // and the city's name for the music line (no artists).
  const placeById = new Map((report.local.block?.places ?? []).map((p) => [p.id, p]));
  const snacks: ShoppingItem[] = (report.plan?.shopping ?? []).filter((s) => s.from && placeById.has(s.from)).map((s) => ({ item: s.item, ...(s.qty ? { qty: s.qty } : {}), from: s.from, origin: s.origin, evidenceIds: s.evidenceIds }));
  const wheel = report.plan?.wheel;
  const shownIds = new Set([...snacks.map((s) => s.from!), ...(wheel?.slices.flatMap((s) => s.refs) ?? [])]);
  const places: Place[] = [...shownIds].flatMap((id) => (placeById.has(id) ? [placeById.get(id)!] : []));
  const city = report.local.city;
  // The music is a table fact too: the city's artists (the playlist plays them) with their receipts, and
  // the kept concept's own music line when it names only those artists.
  const artistIds = new Set(city?.artists.map((a) => a.id) ?? []);
  const keptMusic = kept?.items.find((i) => i.kind === "music" && i.refs.length > 0 && i.refs.every((id) => artistIds.has(id)));
  const musicLine: PlanItem[] = keptMusic ? [keptMusic] : city && kept?.items.some((i) => i.kind === "music") ? [{ kind: "music", text: `Music ${city.city} plays`, origin: "creative", refs: [], evidenceIds: [] }] : [];
  const cited = new Set([...snacks, ...places, ...(wheel?.slices ?? []), ...(city?.artists ?? []), ...musicLine].flatMap((x) => x.evidenceIds));
  const concept: Concept | null = kept
    ? {
        id: kept.id,
        title: kept.title,
        hook: kept.hook.replace(REF, "[[x]]"),
        // One line, so the concept stays valid: its own title, as the creative line it is.
        items: [{ kind: "theme", text: kept.title.replace(REF, "a local spot"), origin: "creative", refs: [], evidenceIds: [] }, ...musicLine],
        scores: [],
        total: 0,
        kept: true,
      }
    : null;
  return {
    version: PLAN_VERSION,
    meta: report.meta,
    inputs: { ...inputs, store, budgetUsd: 0 },
    ledger: report.ledger.filter((e) => cited.has(e.id)),
    local: {
      city: city ? { city: city.city, ageBands: city.ageBands, artists: city.artists, styles: [] } : null,
      block: report.local.block && places.length ? { radiusM: report.local.block.radiusM, places } : null,
      blockMusic: null,
      gaps: [],
    },
    plan: concept ? { conceptId: concept.id, concepts: [concept], runOfShow: [], shopping: snacks, checklist: [], estimatedCostUsd: 0, ...(wheel ? { wheel } : {}) } : null,
    baseline: null,
    comparison: null,
    poster: publicPoster(report.poster),
    posts: null,
    test: null,
    results: [],
    trace: [],
    stats: { stages: {} },
    partial: null,
    cost: null,
  };
}

/** GET /api/plan/<id>/marketing for anyone but the owner: the posters only, never the drafts. */
export function publicMarketingState(state: MarketingState): MarketingState {
  return {
    a: { conceptId: state.a.conceptId, poster: publicPoster(state.a.poster), posts: null },
    b: state.b ? { conceptId: state.b.conceptId, poster: publicPoster(state.b.poster), posts: null } : null,
  };
}
