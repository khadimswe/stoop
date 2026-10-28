// The plan's posts: a Facebook post, an Instagram caption with hashtags and a WhatsApp message, drafts
// the manager reviews and shares with one tap (lib/plan/share.ts). Nothing posts on its own.
//
// Claude writes only the short opening of each post. Code adds the facts: the date and time, the store
// and its address, and the manager's offers, verbatim. Claude names a measured artist or place only as
// a "[[id]]" token from the kept concept, and code renders the name from this run's Qloo results, so a
// partner is mentioned only when Qloo returned it. Every answer passes checkPostText (the shared
// guardrails plus the rules below); a failing answer gets one repair, then the deterministic template.
import type { LanguageModel } from "ai";
import { z } from "zod";
import { askOnce, type AskUsage } from "../agent/ask";
import { GUARDRAIL_INSTRUCTIONS, quoted } from "../agent/instructions";
import { checkText, childSetting, FAMOUS_PLACES, stripEmDashes, unsupportedClaims, type GuardIssue } from "../guardrails";
import { BRAND_WORDS } from "./poster-prompt";
import { keptConcept, posterText, refNames } from "./poster-text";
import { refsIn, renderRefs } from "./refs";
import type { PlanReport, Posts } from "./schema";

export const POSTS_INSTRUCTIONS_VERSION = 1;
/** The first answer plus one repair. */
export const POSTS_MAX_ATTEMPTS = 2;
export const POSTS_TIMEOUT_MS = 60_000;

type Report = Pick<PlanReport, "inputs" | "plan" | "local" | "meta">;

/** What Claude returns: openings only, with "[[id]]" tokens for names. */
export const llmPostsSchema = z.strictObject({
  facebook: z.string().min(1).max(700),
  instagram: z.string().min(1).max(500),
  hashtags: z.array(z.string().min(1).max(40)).max(8),
  whatsapp: z.string().min(1).max(300),
});
export type LlmPosts = z.infer<typeof llmPostsSchema>;

// --- The rules ------------------------------------------------------------------------------------

const AUDIENCE = /\b(?:your|our)\s+(?:customers?|clients?|shoppers?|buyers?)\b/i;
const ALCOHOL_TOBACCO = /\b(?:beers?|wines?|liquor|alcohol(?:ic)?|booze|cocktails?|margaritas?|tequila|vodka|whiske?y|rum|cigarettes?|cigars?|vapes?|vaping|hookah|tobacco|cannabis|weed|edibles?|cbd)\b/i;
const FREE = /\bfree\b/i;
const OFFER_WORDS = /\b(?:deals?|discounts?|%\s*off|half off|bogo|buy one|giveaways?|prizes?|raffle|sale)\b/i;
const CLAIMS = /\b(?:everyone|the whole (?:city|block|neighborhood)) (?:is|will be) (?:coming|there)\b|\bbiggest\b|\bbest in (?:town|the city)\b|\bguaranteed\b/i;
const HASHTAG = /^[A-Za-z][A-Za-z0-9]{1,29}$/;

/** Every id a post may name: the artists and places in the kept concept (its lines, title and hook). */
export function allowedRefs(report: Report): Set<string> {
  const concept = keptConcept(report);
  const known = refNames(report);
  const ids = new Set<string>();
  if (!concept) return ids;
  for (const item of concept.items) for (const ref of item.refs) ids.add(ref);
  for (const ref of [...refsIn(concept.title), ...refsIn(concept.hook)]) ids.add(ref);
  return new Set([...ids].filter((id) => known.has(id)));
}

/** The manager's own words and the plan's, for checking that a post invents no facts. */
function sellerText(report: Report): string {
  const concept = keptConcept(report);
  return [...report.inputs.offers.map((o) => o.text), ...(concept?.items.map((i) => i.text) ?? [])].join("\n");
}

function names(report: Report): string[] {
  return [
    ...(report.local.city?.artists.map((a) => a.name) ?? []),
    ...(report.local.block?.places.map((p) => p.name) ?? []),
    ...FAMOUS_PLACES,
  ];
}

const issue = (match: string, message: string): GuardIssue => ({ rule: "fake-proof", match, message });

/**
 * Every rule a post opening breaks, before its refs are rendered: the shared guardrails, real names
 * written out instead of a ref, refs outside the kept concept, invented facts (prices, numbers, "free"
 * when neither the offers nor the plan say it, deals), "your customers", alcohol or tobacco, and
 * anything aimed at minors.
 */
export function checkPostText(text: string, report: Report, path: string): GuardIssue[] {
  const allowedNames = [report.inputs.store.city, report.inputs.store.name, report.inputs.store.region, ...(report.inputs.location ? [report.inputs.location.name] : [])];
  const issues = checkText(text, { names: names(report), allowedNames, exactCaseNames: true }).map((i) => ({ ...i, path }));
  const add = (match: string, message: string) => issues.push({ ...issue(match, message), path });
  const allowed = allowedRefs(report);
  for (const id of refsIn(text)) if (!allowed.has(id)) add(`[[${id}]]`, `[[${id}]] is not an artist or place in the kept plan.`);
  const seller = sellerText(report);
  for (const claim of unsupportedClaims(text.replace(/\[\[[A-Za-z0-9-]+\]\]/g, ""), seller)) add(claim, `"${claim}" is a fact neither the manager nor the plan gave. Code adds the offers, date and address.`);
  const free = text.match(FREE)?.[0];
  if (free && !FREE.test(seller)) add(free, `"${free}" promises something neither the offers nor the plan offer.`);
  const deal = text.match(OFFER_WORDS)?.[0];
  if (deal) add(deal, `"${deal}" restates an offer. Code adds the manager's offers word for word.`);
  const audience = text.match(AUDIENCE)?.[0];
  if (audience) add(audience, `"${audience}" claims to know who shops here. Speak to the city and the block.`);
  const vice = text.match(ALCOHOL_TOBACCO)?.[0];
  if (vice) add(vice, `"${vice}": no alcohol or tobacco at a sidewalk event.`);
  const child = childSetting(text);
  if (child) add(child, `"${child}" aims the event at children. The event is for adults passing by.`);
  const claim = text.match(CLAIMS)?.[0];
  if (claim) add(claim, `"${claim}" is a claim about turnout or rank that nobody measured.`);
  if (/https?:\/\/|www\./i.test(text)) add("link", "Links are added by code: the share link carries the event page.");
  // Carrier names and promos come only from what the manager typed (the store's name, the offers).
  const typed = [report.inputs.store.name, ...report.inputs.offers.map((o) => o.text)].join("\n");
  for (const brand of BRAND_WORDS) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
    const hit = text.match(pattern)?.[0];
    if (hit && !pattern.test(typed)) {
      add(hit, `"${hit}": carrier names and promos come only from the store's name and the manager's offers, never invented.`);
      break;
    }
  }
  return issues;
}

export function checkHashtags(tags: readonly string[], report: Report): GuardIssue[] {
  const issues: GuardIssue[] = [];
  const banned = [...names(report), ...BRAND_WORDS];
  tags.forEach((raw, i) => {
    const tag = raw.replace(/^#/, "");
    const path = `instagram.hashtags.${i}`;
    if (!HASHTAG.test(tag)) issues.push({ ...issue(tag, `#${tag}: hashtags are letters and digits only, 2 to 30 characters.`), path });
    const folded = tag.toLowerCase();
    for (const name of banned) {
      const compact = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (compact.length >= 4 && compact !== report.inputs.store.city.toLowerCase().replace(/[^a-z0-9]+/g, "") && folded.includes(compact)) {
        issues.push({ ...issue(tag, `#${tag} names ${name}. Hashtags never carry an artist, place, carrier or brand name.`), path });
        break;
      }
    }
    issues.push(...checkText(tag).map((i) => ({ ...i, path })));
  });
  return issues;
}

export function checkLlmPosts(posts: LlmPosts, report: Report): GuardIssue[] {
  return [
    ...checkPostText(posts.facebook, report, "facebook"),
    ...checkPostText(posts.instagram, report, "instagram"),
    ...checkPostText(posts.whatsapp, report, "whatsapp"),
    ...checkHashtags(posts.hashtags, report),
    ...(posts.hashtags.length < 2 ? [{ ...issue("hashtags", "Give 3 to 6 hashtags."), path: "instagram.hashtags" }] : []),
  ];
}

// --- Composing the posts --------------------------------------------------------------------------

/** The facts code adds to every post, from the inputs only. */
export function postFacts(report: Report) {
  const text = posterText(report);
  const where = text.location ? `${text.location}, hosted by ${text.store}` : `${text.store}, ${text.address}`;
  return { title: text.title, when: `${text.date}, ${text.time}`, where, offers: text.offers, weekday: text.date.split(",")[0] ?? "" };
}

/** Openings plus the facts, refs rendered: the posts as shared. `share` is filled by the caller. */
export function composePosts(openings: LlmPosts, report: Report): Posts {
  const nameOf = refNames(report);
  const r = (text: string) => renderRefs(text.trim(), nameOf).replace(/[ \t]+/g, " ");
  const f = postFacts(report);
  const offerLines = f.offers.map((o) => `Offer: ${o}`);
  const facebook = [r(openings.facebook), "", `When: ${f.when}`, `Where: ${f.where}`, ...offerLines].join("\n");
  const instagram = [r(openings.instagram), "", `${f.when}`, `${f.where}`, ...offerLines].join("\n");
  const whatsapp = [r(openings.whatsapp), `${f.when}, ${f.where}.`, ...offerLines].join("\n");
  const hashtags = [...new Set(openings.hashtags.map((t) => t.replace(/^#/, "")))].slice(0, 8);
  return { facebook: { text: facebook.slice(0, 2000) }, instagram: { caption: instagram.slice(0, 2200), hashtags }, whatsapp: { text: whatsapp.slice(0, 1000) }, share: {} };
}

const cityTag = (city: string) => city.replace(/[^A-Za-z0-9]+/g, "");

/** The deterministic template: the plan's own title and hook, and nothing it cannot back. */
export function fallbackOpenings(report: Report): LlmPosts {
  const { weekday } = postFacts(report);
  const concept = keptConcept(report);
  const hook = concept && checkPostText(concept.hook, report, "hook").length === 0 ? ` ${concept.hook.trim().replace(/([^.!?])$/, "$1.")}` : "";
  // The raw title, so a ref in it stays a token until composePosts renders it.
  const title = concept && checkPostText(concept.title, report, "title").length === 0 ? concept.title.trim() : "Come by the table";
  const { store, location } = { store: report.inputs.store.name, location: report.inputs.location?.name.trim() };
  const tag = cityTag(report.inputs.store.city);
  // Where, in the store's own words: a table outside, inside the store, or a booth at the event's place.
  const setup = {
    sidewalk_table: `we're setting up a table outside ${store}`,
    in_store: `we're hosting it inside ${store}`,
    nearby_venue: location ? `${store} will be at ${location}` : `we'll be near ${store}`,
    community_event: location ? `${store} will have a booth at ${location}` : `${store} will have a booth at the community event`,
  }[report.inputs.setting];
  const at = location && report.inputs.setting !== "sidewalk_table" && report.inputs.setting !== "in_store" ? `${location} with ${store}` : store;
  return {
    facebook: `${title}: ${setup} this ${weekday}.${hook} Stop by and say hi.`,
    instagram: `${title} at ${at} this ${weekday}.${hook}`,
    whatsapp: `${title} at ${at} this ${weekday}.${hook} Stop by and say hi.`,
    hashtags: [...(HASHTAG.test(tag) ? [tag] : []), "ShopLocal", "WeekendPlans"],
  };
}

// --- Asking Claude ---------------------------------------------------------------------------------

export function postsInstructions(): string {
  return [
    "You write short social posts for a prepaid phone store's event: a table outside the store with music and food from the block.",
    "The store manager reviews every post and shares it themselves. Write as the store (we), friendly, short, plain and local, like a neighbor talking.",
    "Write only the opening lines of each post. Code adds the date, the time, the store's address and the manager's offers word for word, so never write dates, times, addresses, prices, deals or offers yourself, and never add links.",
    "Name an artist or a place only by writing its token exactly as given, like [[place-id]]. Never write a name out. Use only the tokens listed in the plan. Mention a food spot or venue only if the plan lists it.",
    "Never name a carrier, a carrier promo or a promo day yourself: the manager's offers carry them, word for word. Never claim turnout, popularity, sales or anything nobody measured. Never say \"your customers\" or \"our customers\": speak to the city and the block. Never mention alcohol or tobacco. The event is for adults passing by: nothing aimed at children.",
    "Facebook: 2 to 4 short sentences. Instagram: 1 to 3 short sentences. WhatsApp: 1 or 2 sentences, like a text to a neighbor who asked to hear about events. At most one emoji per post.",
    "Hashtags: 3 to 6, letters and digits only, no # sign. The city's name is fine; never an artist, a place, a carrier or a brand.",
    GUARDRAIL_INSTRUCTIONS,
  ].join("\n");
}

const SETTING_WORDS: Record<PlanReport["inputs"]["setting"], string> = {
  sidewalk_table: "a table on the sidewalk outside the store",
  in_store: "inside the store",
  nearby_venue: "at a venue near the store",
  community_event: "a booth at a fair or community event",
};

export function postsPrompt(report: Report): string {
  const concept = keptConcept(report);
  const f = postFacts(report);
  const nameOf = refNames(report);
  const places = new Map((report.local.block?.places ?? []).map((p) => [p.id, p]));
  const tokens = [...allowedRefs(report)].map((id) => {
    const place = places.get(id);
    return place
      ? `[[${id}]]: ${nameOf.get(id)} (${place.kind === "food" ? "food spot" : place.kind}${place.distanceM !== null ? `, about ${Math.round(place.distanceM / 10) * 10} m from the store` : ""})`
      : `[[${id}]]: ${nameOf.get(id)} (an artist the city plays)`;
  });
  const lines = (concept?.items ?? []).map((i) => `- ${i.kind}: ${i.text}`);
  return [
    `The event: ${f.title}, on ${f.when}, ${SETTING_WORDS[report.inputs.setting]}, ${report.inputs.location ? `at ${report.inputs.location.name}, hosted by ${report.inputs.store.name}` : `at ${report.inputs.store.name}`} in ${report.inputs.store.city}.`,
    concept ? `Why someone stops: ${concept.hook}` : "",
    report.inputs.offers.length ? `The manager has ${report.inputs.offers.length} offer${report.inputs.offers.length === 1 ? "" : "s"} at the table; code adds ${report.inputs.offers.length === 1 ? "it" : "them"} word for word below your lines.` : "There are no offers.",
    `Tokens you may use (write the token, never the name):\n${tokens.length ? tokens.join("\n") : "(none)"}`,
    `The plan's lines:\n${lines.join("\n")}`,
    ...(report.inputs.notes ? [quoted("manager notes", report.inputs.notes)] : []),
    "Return the four fields: facebook, instagram, hashtags, whatsapp.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface PostsResult {
  posts: Posts;
  source: "claude" | "fallback";
  attempts: number;
  /** The checks the last refused answer failed, for the trace. */
  refusedFor: string[];
  usage: { calls: number; inputTokens: number; outputTokens: number };
}

/** Claude's posts, checked, with one repair; the deterministic template when both answers fail. */
export async function generatePosts(model: LanguageModel | null, report: Report, options: { abortSignal?: AbortSignal; timeoutMs?: number } = {}): Promise<PostsResult> {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const count = (u: AskUsage) => {
    usage.calls++;
    usage.inputTokens += u.inputTokens ?? 0;
    usage.outputTokens += u.outputTokens ?? 0;
  };
  let problems: string[] = [];
  let previous = "";
  const prompt = postsPrompt(report);
  for (let attempt = 1; model && attempt <= POSTS_MAX_ATTEMPTS; attempt++) {
    const ask =
      attempt === 1
        ? prompt
        : [prompt, `Your previous answer broke these rules. Fix every one and answer again in full:\n${problems.map((p) => `- ${p}`).join("\n")}`, quoted("previous answer", previous)].join("\n\n");
    const reply = await askOnce(model, {
      instructions: postsInstructions(),
      prompt: ask,
      schema: llmPostsSchema,
      name: "event_posts",
      description: "Opening lines for a store event's Facebook post, Instagram caption and WhatsApp message.",
      timeoutMs: options.timeoutMs ?? POSTS_TIMEOUT_MS,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
    count(reply.usage);
    if (reply.failure) {
      problems = [reply.failure];
      if (/did not answer within/.test(reply.failure)) break;
      continue;
    }
    const parsed = llmPostsSchema.safeParse(stripEmDashes(reply.output));
    if (!parsed.success) {
      problems = ["the answer did not match the four fields"];
      previous = JSON.stringify(reply.output ?? null);
      continue;
    }
    const issues = checkLlmPosts(parsed.data, report);
    if (issues.length === 0) return { posts: composePosts(parsed.data, report), source: "claude", attempts: attempt, refusedFor: [], usage };
    problems = issues.slice(0, 12).map((i) => `${i.path ? `${i.path}: ` : ""}${i.message}`);
    previous = JSON.stringify(parsed.data);
  }
  return { posts: composePosts(fallbackOpenings(report), report), source: "fallback", attempts: usage.calls, refusedFor: problems, usage };
}
