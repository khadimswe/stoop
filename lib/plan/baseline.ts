// The generic plan: the same inputs to the same model, with no Qloo. It is a fair, good-faith best
// effort: Claude may use everything it knows about the city. Its lines are all creative (nothing has
// a receipt), its cliches are flagged by a fixed list, and the real artists and food brands it leans
// on are kept apart for scoring only. Qloo then checks its artists: each is resolved with /search
// (accepted only by Stoop's match rules) and scored in ONE call with the city signal next to Qloo's
// own city artists, so their affinities compare. With fewer than 5 of Qloo's own picks in that call
// there is no median, and the picks are unverifiable.
import { z } from "zod";
import { askOnce, cachedInstructions } from "../agent/ask";
import { stripEmDashes } from "../guardrails";
import { ENDPOINTS } from "../qloo/constants";
import { matchResult, normalizeName } from "../qloo/match";
import { insightsEntitiesResponse, searchResponse, slimEntitiesBody } from "../qloo/types";
import { claudeTimeout, planQloo, type PlanEnv } from "./env";
import { textIssues, type GuardContext } from "./guard";
import { gapText, recoverable } from "./local";
import { inputsText, PLAN_RULES, PLANNER_ROLE } from "./prompt";
import { pickSearchParams, scoreArtistsParams } from "./requests";
import { refsIn } from "./refs";
import { ITEM_KINDS, type Baseline, type Block, type BlockMusic, type CityTaste, type Comparison, type Concept, type Plan, type PlanInputs, type PlanItem } from "./schema";
import { isChain } from "./taste";

export const BASELINE_TIMEOUT_MS = 90_000;
/** Named picks resolved per plan (PLAN_BUDGET.planResolve). */
export const MAX_PICKS = 3;
/** No median below this many of Qloo's own picks (Stoop's rule). */
export const MIN_MEDIAN_N = 5;

const llmBaseline = z.object({
  items: z.array(z.object({ kind: z.enum(ITEM_KINDS), text: z.string().describe("One concrete line, at most 200 characters, with no artist or business names") })).describe("6 to 9 lines: a theme, the music, the food, an activity, a giveaway, the setup, the signage, the timing"),
  picks: z.object({
    artists: z.array(z.string()).describe("Up to 3 real music artists the playlist leans on. Scoring only, never shown in the plan."),
    places: z.array(z.string()).describe("Every real business, venue or park your lines name, by its name. Empty if none."),
  }),
});
type LlmBaseline = z.infer<typeof llmBaseline>;

const TASK = [
  "Task:",
  "Plan the best event you can for this store's table or booth, using your own knowledge of the city and of what makes people stop.",
  "The store runs events for walk-ins and sign-ups: one line turns a stop into a walk-in with the manager's promo. Fit the day, and do what the manager's notes ask.",
  "Food: snacks and drinks, not catering. Giveaways: small gift cards in a free drawing work well. Proven tactics (the promo sign, a prize wheel, a free drawing) are welcome.",
  "Write 6 to 9 short, concrete lines: a theme, the music, the food, an activity, a giveaway, the setup, the signage, the timing.",
  "Describe music by style, never by an artist's name; put the real artists the playlist leans on in picks (kept for scoring only).",
  "You may name real places near the store (a food spot, a venue, a park) if you know them; list every place you name in picks.places.",
  "If the manager gave offers, one signage line quotes one of them exactly. If not, no line mentions a price or a deal.",
].join("\n");

export function baselineInstructions(): string {
  return [PLANNER_ROLE, PLAN_RULES, TASK].join("\n\n");
}

/**
 * Cliches: choices with no local signal behind them, matched case-insensitively on the generic plan's
 * lines. A store's proven tactics (the promo sign, a prize wheel, a free gift-card drawing) are not
 * cliches: both plans may use them, and the difference Stoop shows is local grounding.
 */
export const CLICHES: readonly { pattern: RegExp; text: string; why: string }[] = [
  { pattern: /\bballoons?\b/i, text: "Balloons", why: "Every store's table has balloons; they say nothing about this community." },
  { pattern: /\bDJs?\b/i, text: "A DJ", why: "A hired DJ spends the budget on a set that could play anywhere." },
  { pattern: /\b(top[- ]40|top hits|popular (music|songs|hits)|chart(-topping)? hits|today's hits|upbeat (music|playlist|tunes|songs)|crowd[- ]pleas\w*)\b/i, text: "A playlist of popular hits", why: "Popular hits are the same in every city; nothing ties them to what this city plays." },
  { pattern: /\bpizzas?\b/i, text: "Pizza", why: "The default snack, not food from this community." },
  { pattern: /\b(grand opening|customer appreciation)\b/i, text: "A stock event name", why: "\"Customer appreciation\" is what every store calls it." },
  { pattern: /\b(inflatable|tube man|air dancer|wacky waving)\b/i, text: "An inflatable tube man", why: "Every phone store's sidewalk has one." },
  { pattern: /\b(chips|cookies|candy|bottled water|soda)\b/i, text: "Generic store-bought snacks", why: "Snacks any table sets out, with nothing from the spots near the store." },
  { pattern: /\bphoto (booth|backdrop|op)\b|\bselfie (station|wall)\b/i, text: "A photo backdrop", why: "A generic prop with no tie to this community." },
  { pattern: /\b(swag|branded (merch|giveaways?)|tote bags?|keychains?|pens)\b/i, text: "Branded swag", why: "Giveaways people leave behind; nothing local about them." },
];

/** The cliches a Stoop plan itself must avoid: decor and sound with no local signal (snacks are judged by the founder's budget rule instead). */
const AVOIDED = new Set(["Balloons", "A DJ", "A playlist of popular hits", "An inflatable tube man"]);

/** The no-signal cliche in a line of a Stoop plan, or null. */
export function clicheIn(text: string): { text: string; why: string } | null {
  const hit = CLICHES.find((c) => AVOIDED.has(c.text) && c.pattern.test(text));
  return hit ? { text: hit.text, why: hit.why } : null;
}

export interface BaselineDraft {
  items: PlanItem[];
  cliches: Baseline["cliches"];
  picks: { artists: string[]; places: string[] };
}

/** Flags each cliche once, with the first line it appears in. */
export function flagCliches(items: readonly Pick<PlanItem, "text">[]): Baseline["cliches"] {
  const out: Baseline["cliches"] = [];
  for (const cliche of CLICHES) if (items.some((item) => cliche.pattern.test(item.text))) out.push({ text: cliche.text, why: cliche.why });
  return out;
}

const names = (list: readonly string[], max: number) => [...new Set(list.map((n) => n.trim()).filter((n) => n.length > 1 && n.length <= 80))].slice(0, max);

export function checkBaseline(raw: LlmBaseline, guard: GuardContext): { draft: BaselineDraft; issues: string[] } {
  const answer = stripEmDashes(raw);
  const issues: string[] = [];
  const items: PlanItem[] = [];
  const picks = { artists: names(answer.picks.artists, 3), places: names(answer.picks.places, 6) };
  // The artists it leans on are for scoring only, like Stoop's Control brief; places it may name.
  const banned = [...picks.artists];
  answer.items.slice(0, 10).forEach((item, i) => {
    const text = item.text.trim();
    const problems = textIssues(text, { ...guard, known: new Set(), names: banned });
    if (!text || text.length > 240) problems.push("must be 1 to 240 characters.");
    if (problems.length) issues.push(...problems.map((p) => `items.${i + 1}: ${p}`));
    else items.push({ kind: item.kind, text, origin: "creative", refs: [], evidenceIds: [] });
  });
  if (items.length < 4) issues.push("items: needs at least 4 lines that pass the checks.");
  return { draft: { items, cliches: flagCliches(items), picks }, issues };
}

/** The generic plan's Claude call, with one repair. Started next to the city stage; it needs no Qloo. Null when nothing usable came back. */
export async function writeBaseline(env: Pick<PlanEnv, "model" | "abortSignal" | "timeoutMs" | "deadlineAt" | "now">, inputs: PlanInputs, guard: GuardContext): Promise<{ draft: BaselineDraft | null; notes: string[] }> {
  const instructions = cachedInstructions(baselineInstructions());
  const prompt = [inputsText(inputs), "Plan the event."].join("\n\n");
  let ask = prompt;
  const notes: string[] = [];
  let best: BaselineDraft | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const timeoutMs = claudeTimeout(env, BASELINE_TIMEOUT_MS);
    if (timeoutMs === null) {
      notes.push("not enough time was left in the run for another try");
      break;
    }
    const reply = await askOnce(env.model, { instructions, prompt: ask, schema: llmBaseline, name: "generic_event_plan", description: "An event plan with no Qloo data.", timeoutMs, ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}) });
    const parsed = reply.failure ? null : llmBaseline.safeParse(reply.output);
    if (!parsed?.success) {
      notes.push(reply.failure ?? "the answer did not match the plan format");
      continue;
    }
    const { draft, issues } = checkBaseline(parsed.data, guard);
    if (draft.items.length >= 4) best = draft;
    if (issues.length === 0) break;
    notes.push(`${issues.length} ${issues.length === 1 ? "line" : "lines"} failed the checks: ${issues.slice(0, 3).join(" ")}`);
    ask = [prompt, `Your previous answer failed these checks:\n${issues.map((i) => `- ${i}`).join("\n")}`, "Fix every issue and return the whole plan again.", `Previous answer (JSON):\n${JSON.stringify(parsed.data)}`].join("\n\n");
  }
  return { draft: best, notes };
}

export interface PickCheck {
  check: NonNullable<Baseline["check"]>;
  /** One line per pick, for the trace and the comparison. */
  lines: string[];
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * Qloo's check of the generic plan's picks. Artists resolve with /search and are scored against the
 * city in one call with Qloo's own city artists; food brands have no city reference in this run, so
 * they count as unverifiable, as does any pick that does not resolve.
 */
export async function checkPicks(env: PlanEnv, inputs: PlanInputs, city: CityTaste | null, picks: Pick<BaselineDraft["picks"], "artists">, cityQuery: string = inputs.store.city): Promise<PickCheck | null> {
  const named = picks.artists.map((name) => ({ name, type: "artist" as const })).slice(0, MAX_PICKS);
  if (named.length === 0) return null;
  const evidenceIds: string[] = [];
  const resolved: { name: string; id: string; qlooName: string }[] = [];
  let unverifiable = 0;
  for (const pick of named) {
    try {
      const result = await planQloo(env, "baseline", `Resolving the generic plan's "${pick.name}" to a Qloo artist`, { endpoint: ENDPOINTS.search, params: pickSearchParams(pick.name, pick.type), schema: searchResponse, slim: slimEntitiesBody, onNotFound: [], budgetRow: "planResolve" });
      evidenceIds.push(result.evidence.id);
      const match = matchResult(pick.name, result.data);
      if (match && !resolved.some((r) => r.id === match.result.id)) resolved.push({ name: pick.name, id: match.result.id, qlooName: match.result.name });
      else unverifiable++;
    } catch (error) {
      if (!recoverable(error)) throw error;
      unverifiable++;
    }
  }
  const own = (city?.artists ?? []).map((a) => a.id).filter((id) => !resolved.some((r) => r.id === id));
  const lines: string[] = [];
  if (resolved.length === 0) return { check: { checkable: 0, belowMedian: 0, unverifiable, evidenceIds }, lines: ["None of the generic plan's artists resolved in Qloo, so none could be checked."] };
  if (own.length < MIN_MEDIAN_N) {
    return { check: { checkable: 0, belowMedian: 0, unverifiable: unverifiable + resolved.length, evidenceIds }, lines: [`Qloo returned fewer than ${MIN_MEDIAN_N} of its own artists for ${inputs.store.city}, so there is no median: the generic picks are unverifiable.`] };
  }
  let scored;
  try {
    scored = await planQloo(env, "baseline", `Scoring the generic plan's artists against ${inputs.store.city} with Qloo's own`, { endpoint: ENDPOINTS.insights, params: scoreArtistsParams(inputs, [...own, ...resolved.map((r) => r.id)], cityQuery), schema: insightsEntitiesResponse, slim: slimEntitiesBody, budgetRow: "planScoring" }, "One call, one signal: the only fair way to compare affinities.");
  } catch (error) {
    if (!recoverable(error)) throw error;
    env.sink.emit({ type: "local.gap", text: gapText(error, "the generic plan's artists") });
    return { check: { checkable: 0, belowMedian: 0, unverifiable: unverifiable + resolved.length, evidenceIds }, lines: ["Qloo could not score the generic plan's artists, so they are unverifiable."] };
  }
  evidenceIds.push(scored.evidence.id);
  const affinity = new Map(scored.data.map((e) => [e.id, e.affinity]));
  const ownScores = own.map((id) => affinity.get(id)).filter((v): v is number => typeof v === "number");
  if (ownScores.length < MIN_MEDIAN_N) {
    return { check: { checkable: 0, belowMedian: 0, unverifiable: unverifiable + resolved.length, evidenceIds }, lines: [`Qloo scored fewer than ${MIN_MEDIAN_N} of its own artists in that call, so there is no median: the generic picks are unverifiable.`] };
  }
  const mid = median(ownScores);
  let below = 0;
  for (const pick of resolved) {
    const score = affinity.get(pick.id);
    if (typeof score !== "number") {
      below++;
      lines.push(`${pick.qlooName}: no measurable affinity for adults in ${inputs.store.city} at these ages.`);
    } else {
      const beats = ownScores.filter((s) => score > s).length;
      if (score < mid) below++;
      lines.push(`${pick.qlooName}: beats ${beats} of ${ownScores.length} of Qloo's own ${inputs.store.city} artists${score < mid ? ", below their median" : ""}.`);
    }
  }
  return { check: { checkable: resolved.length, belowMedian: below, unverifiable, evidenceIds: [...new Set(evidenceIds)] }, lines };
}

/**
 * Generic choices the fixed list cannot see: a plan with no place from this block, and music with no
 * local signal behind it (no artist Qloo could check, or most of them below the median of Qloo's own
 * picks for the city).
 */
export function genericCliches(items: readonly Pick<PlanItem, "kind" | "text">[], check: Baseline["check"], blockNames: readonly string[], city: string, named?: { named: number; chains: number; onBlock: number }): Baseline["cliches"] {
  const out: Baseline["cliches"] = [];
  const text = items.map((i) => i.text.toLowerCase()).join("\n");
  if (!(named && named.onBlock > 0) && !blockNames.some((name) => name.trim().length > 2 && text.includes(name.trim().toLowerCase()))) {
    out.push({ text: "No place in this community", why: "It names no food spot, venue or park Qloo found near the store, so any store in any city could run it." });
  }
  if (named && named.named > 0 && named.chains === named.named) out.push({ text: "Chains instead of community spots", why: "Every place it names is a chain, the same at any store." });
  if (items.some((i) => i.kind === "music")) {
    if (!check || check.checkable === 0) out.push({ text: "Music with no local signal", why: `None of its artists could be checked against what Qloo measured for ${city}.` });
    else if (check.belowMedian * 2 >= check.checkable) out.push({ text: "Music with no local signal", why: `Qloo put ${check.belowMedian} of its ${check.checkable} checkable artists below the median of its own picks for ${city}.` });
  }
  return out;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const count = (n: number, one: string, many: string) => `the ${n === 1 ? one : `${WORDS[n] ?? n} ${many}`}`;
const listed = (parts: readonly string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/**
 * What Qloo decided in a plan, read from its lines' origins and refs, so the sentence is always true:
 * the playlist, the gift cards, the snack spot, the partner, the theme. Each part says what the plan
 * would lack without Qloo.
 */
export function qlooDecided(kept: Concept | null, plan: Pick<Plan, "shopping" | "wheel"> | null, block: Block | null, blockMusic?: BlockMusic | null): { decided: string[]; without: string[] } {
  const items = kept?.items ?? [];
  const backed = (kinds: readonly string[]) => items.filter((i) => kinds.includes(i.kind) && i.evidenceIds.length > 0);
  const places = new Map((block?.places ?? []).map((p) => [p.id, p]));
  const blockArtists = new Set(blockMusic?.used ? blockMusic.artists.map((a) => a.id) : []);
  const decided: string[] = [];
  const without = new Set<string>();
  const music = backed(["music"]);
  if (music.length) {
    decided.push("the playlist");
    without.add("no local music");
    if (music.some((i) => i.refs.some((r) => blockArtists.has(r)))) decided.push("the music the nearby places point to");
  }
  const giftPlaces = new Set([
    ...(plan?.wheel?.slices ?? []).filter((s) => s.kind === "gift_card").flatMap((s) => s.refs),
    ...items.filter((i) => /gift ?cards?/i.test(i.text)).flatMap((i) => i.refs.filter((r) => places.has(r))),
  ]);
  if (giftPlaces.size) decided.push(count(giftPlaces.size, "gift card", "gift cards"));
  const snackPlaces = new Set((plan?.shopping ?? []).filter((s) => s.from && !/gift ?cards?/i.test(s.item) && places.get(s.from)?.kind === "food").map((s) => s.from as string));
  for (const item of backed(["food"])) for (const ref of item.refs) if (places.get(ref)?.kind === "food" && !giftPlaces.has(ref)) snackPlaces.add(ref);
  if (snackPlaces.size) decided.push(count(snackPlaces.size, "snack spot", "snack spots"));
  if (backed(["partner"]).some((i) => i.refs.some((r) => places.has(r)))) decided.push("the partner");
  const pointers = backed(["venue"]).flatMap((i) => i.refs).map((r) => places.get(r)).filter((p) => !!p);
  if (pointers.some((p) => p?.kind === "venue")) decided.push("the nearby venue");
  if (pointers.some((p) => p?.kind === "park")) decided.push("the park");
  if (giftPlaces.size || snackPlaces.size || pointers.length || backed(["partner"]).length) without.add("no community spots");
  if (backed(["theme"]).length) {
    decided.push("the theme");
    without.add("no local theme");
  }
  if (backed(["activity"]).length) decided.push("the activity");
  if (backed(["timing"]).length) decided.push("the timing");
  return { decided, without: [...without] };
}

/** How the generic plan's named places stand: chains, and which ones Qloo's list for this block knows. */
export function namedPlaces(names: readonly string[], block: Block | null, knownChains?: ReadonlySet<string>): { named: number; chains: number; onBlock: number } {
  const blockNames = (block?.places ?? []).map((p) => normalizeName(p.name));
  const onBlock = names.filter((n) => {
    const name = normalizeName(n);
    return name.length > 2 && blockNames.some((b) => b === name || b.startsWith(`${name} `) || name.startsWith(`${b} `));
  }).length;
  return { named: names.length, chains: names.filter((n) => isChain(n, knownChains)).length, onBlock };
}

export interface CompareInput {
  kept: Concept | null;
  plan: Pick<Plan, "runOfShow" | "shopping" | "wheel"> | null;
  /** The real places the generic plan named. */
  baselinePlaces?: readonly string[];
  blockMusic?: BlockMusic | null;
  knownChains?: ReadonlySet<string>;
  baseline: Baseline | null;
  block: Block | null;
  city: string;
  /** Where the block was read: "the store", or the event's location. */
  where: string;
}

const meters = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * The side by side, in plain sentences: the places on this block the plan uses (and the nearest), how
 * much of the kept concept has a receipt, Qloo's check of the generic playlist, and the generic
 * plan's cliches. The generic plan is a fair effort from the same model; the difference these lines
 * measure is local specificity.
 */
export function compare(input: CompareInput): Comparison {
  const { kept, plan, baseline, block, city, where } = input;
  const items = kept?.items ?? [];
  const backed = items.filter((i) => i.evidenceIds.length > 0).length;
  const lines: string[] = [];
  const { decided, without } = qlooDecided(kept, plan, block, input.blockMusic);
  if (decided.length) lines.push(`Qloo decided: ${listed(decided)}.`);
  if (without.length) lines.push(`Without Qloo, this plan has ${listed(without)}.`);
  const placeIds = new Set([
    ...items.flatMap((i) => i.refs),
    ...(plan?.shopping.flatMap((s) => (s.from ? [s.from] : [])) ?? []),
    ...(plan?.runOfShow.flatMap((s) => refsIn(s.step)) ?? []),
  ]);
  const used = (block?.places ?? []).filter((p) => placeIds.has(p.id));
  if (used.length > 0) {
    const distances = used.map((p) => p.distanceM).filter((d): d is number => d !== null);
    const nearest = distances.length ? `, ${used.length > 1 ? "the nearest " : ""}${meters(Math.min(...distances))} from ${where}` : "";
    const bought = new Set(plan?.shopping.flatMap((s) => (s.from ? [s.from] : [])) ?? []).size;
    const places = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;
    const head = bought === used.length ? `Buys from ${places(bought)} in this community${nearest}` : `Uses ${places(used.length)} in this community${nearest}${bought ? `, and buys from ${bought} of them` : ""}`;
    lines.push(`${head}; the generic plan names no place in this community.`);
  }
  if (kept) lines.push(`${backed} of ${items.length} lines in the kept concept cite a Qloo receipt; the generic plan cites none.`);
  if (baseline) {
    const check = baseline.check;
    if (check && check.checkable > 0) {
      lines.push(`Qloo checked the generic playlist against ${city}: ${check.belowMedian} of ${check.checkable} checkable ${check.checkable === 1 ? "artist sits" : "artists sit"} below the median of Qloo's own picks${check.unverifiable ? ` (${check.unverifiable} unverifiable)` : ""}.`);
    } else if (check) {
      lines.push(`Qloo could not check the generic plan's picks against ${city} (${check.unverifiable} unverifiable).`);
    }
    const named = namedPlaces(input.baselinePlaces ?? [], block, input.knownChains);
    if (named.named === 0) lines.push("The generic plan names no place.");
    else lines.push(`The generic plan names ${named.named} ${named.named === 1 ? "place" : "places"}: ${named.chains} ${named.chains === 1 ? "is a chain" : "are chains"}, and ${named.onBlock === 0 ? "none is" : `${named.onBlock} ${named.onBlock === 1 ? "is" : "are"}`} on Qloo's list for this community.`);
    const n = baseline.cliches.length;
    if (n > 0) lines.push(`The generic plan leans on ${n} generic ${n === 1 ? "choice" : "choices"}: ${baseline.cliches.map((c) => c.text.toLowerCase()).join(", ")}.`);
  }
  return { qlooBacked: { items: backed, of: items.length }, baselineCliches: baseline?.cliches.length ?? 0, lines };
}
