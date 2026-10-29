// The plan's posts: a Facebook post, an Instagram caption with hashtags and a WhatsApp message, drafts
// the manager reviews and shares with one tap (lib/plan/share.ts). Nothing posts on its own.
//
// Claude writes only the short opening of each post. Code adds the facts: the date and time, the store
// and its address, and the manager's offers, verbatim. Claude names a measured artist or place only as
// a "[[id]]" token from the kept concept, and code renders the name from this run's Qloo results, so a
// partner is mentioned only when Qloo returned it. Every answer passes checkPostText (the shared
// guardrails, the plan's own guard in lib/plan/guard.ts and the rules below); a failing answer gets one
// repair, then the deterministic template.
import { GENRE_AND_SLANG } from "./words";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { askOnce, type AskUsage } from "../agent/ask";
import { GUARDRAIL_INSTRUCTIONS, quoted } from "../agent/instructions";
import { checkText, FAMOUS_PLACES, stripEmDashes, unsupportedClaims, type GuardIssue } from "../guardrails";
import { textIssues } from "./guard";
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

/** "Free" in Claude's own words is always an offer: the offers and the wheel line carry it, added by code. */
const FREE = /\bfree\b|\bon us\b|\bno charge\b|\bcomplimentary\b/i;
/** Deal and prize talk: the offers say it word for word, and a post never says what the wheel pays out. */
const DEAL_WORDS = /\b(?:deals?|sales?|save|savings|giveaways?|prizes?|raffles?|win|wins|winners?|winning|gift ?cards?|promos?|promotions?|specials?)\b/i;
/** The prize wheel, as the plan names it: a post may say there is one when the plan has one. */
const WHEEL = /\bprize wheel\b|\bspin the wheel\b/gi;
/** Settings aimed at minors that the shared term list leaves out. */
const MINOR_SETTING = /\bback[- ]?to[- ]?school\b|\bschools?\b|\bcampus\b/i;
const AUDIENCE = /\b(?:your|our)\s+(?:customers?|clients?|shoppers?|buyers?)\b/i;
const CLAIMS = /\b(?:everyone|the whole (?:city|block|neighborhood|community)) (?:is|will be) (?:coming|there)\b|\bbiggest\b|\bbest in (?:town|the city)\b|\bguaranteed\b/i;
const HASHTAG = /^[A-Za-z][A-Za-z0-9]{1,29}$/;
const REF_TOKEN = /\[\[[A-Za-z0-9-]+\]\]/g;
const CALENDAR = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Every id a post may name: the places in the kept concept (its lines, title and hook). Never an
 * artist: a public post that names a real person to promote a store event borrows their name for an
 * ad, so posts describe the music by its style and the playlist stays in the plan.
 */
export function allowedRefs(report: Report): Set<string> {
  const concept = keptConcept(report);
  const places = new Set((report.local.block?.places ?? []).map((p) => p.id));
  const ids = new Set<string>();
  if (!concept) return ids;
  for (const item of concept.items) for (const ref of item.refs) ids.add(ref);
  for (const ref of [...refsIn(concept.title), ...refsIn(concept.hook)]) ids.add(ref);
  // Not the prize wheel's gift-card places: a post never says what the wheel pays out.
  return new Set([...ids].filter((id) => places.has(id)));
}

/** Plan text for the prompt, with each artist token shown as "a local artist", so no artist id reaches a post. */
function withoutArtists(text: string, report: Report): string {
  const artists = new Set((report.local.city?.artists ?? []).map((a) => a.id));
  return text.replace(/\[\[([A-Za-z0-9-]+)\]\]/g, (token, id: string) => (artists.has(id) ? "a local artist" : token));
}

/** The manager's own words and the plan's lines (not the wheel's slices), for checking a post invents no facts. */
function sellerText(report: Report): string {
  const concept = keptConcept(report);
  return [...report.inputs.offers.map((o) => o.text), ...(concept?.items.map((i) => i.text) ?? []), ...(report.plan?.wheel?.rules ?? [])].join("\n");
}

/** Every real name this run measured, plus famous places: none may be written out instead of a ref. */
function names(report: Report): string[] {
  return [...(report.local.city?.artists.map((a) => a.name) ?? []), ...(report.local.block?.places.map((p) => p.name) ?? []), ...FAMOUS_PLACES];
}

/** Words a post may capitalize mid-sentence: the store's, the city's, the event's own, the calendar, and Qloo's music styles. */
function allowedWords(report: Report): Set<string> {
  const { store, location } = report.inputs;
  const concept = keptConcept(report);
  const city = report.local.city;
  const sources = [store.name, store.city, store.region, location?.name ?? "", concept?.title.replace(REF_TOKEN, " ") ?? "", ...report.inputs.offers.map((o) => o.text), ...CALENDAR, ...CALENDAR.map((d) => `${d}s`), ...(city?.styles.map((s) => s.name) ?? []), ...(city?.artists.flatMap((a) => a.genres) ?? []), "Facebook Instagram WhatsApp"];
  return new Set(sources.flatMap((s) => s.toLowerCase().split(/[^\p{L}\p{N}&']+/u)).filter(Boolean));
}

/**
 * Names Claude wrote that nobody gave it: a capitalized word that does not open a sentence and is not
 * the store's, the city's, the event's, a weekday or month, a measured music style or a short acronym
 * ("DJ", "R&B"). Partners are named only through refs, so anything else is refused (a false alarm
 * only costs a repair, then the template).
 */
export function unknownNames(text: string, report: Report): string[] {
  const allow = allowedWords(report);
  const plain = text.replace(REF_TOKEN, " ref ");
  const found: string[] = [];
  for (const m of plain.matchAll(/\p{Lu}[\p{L}\p{N}&'’-]*/gu)) {
    const word = m[0].replace(/['’-]+$/, "");
    const before = plain.slice(0, m.index).replace(/\s+$/, "");
    if (before === "" || /[.!?:;\n"“(]$/.test(before) || /\p{Extended_Pictographic}$/u.test(before)) continue;
    if (/^[\p{Lu}\p{N}&]{1,4}$/u.test(word)) continue;
    if (word.split(/['’-]/).every((part) => allow.has(part.toLowerCase().replace(/'s$/, "")))) continue;
    if (allow.has(word.toLowerCase().replace(/['’]s$/, ""))) continue;
    found.push(word);
  }
  return [...new Set(found)];
}

const issue = (match: string, message: string): GuardIssue => ({ rule: "fake-proof", match, message });

/**
 * What a post's words may never say, names aside: the plan's own guard (lib/plan/guard.ts: alcohol or
 * tobacco, "your customers", themes built on who people are, implied carrier endorsement, prices and
 * deal language outside an exactly quoted offer, minors), plus "free", deal and prize talk, settings
 * aimed at minors, turnout claims, links, carrier names the manager never typed, and facts the plan
 * and the offers do not give.
 */
function contentIssues(text: string, report: Report, path: string): GuardIssue[] {
  const issues: GuardIssue[] = [];
  const add = (match: string, message: string) => issues.push({ ...issue(match, message), path });
  for (const message of textIssues(text, { offers: report.inputs.offers.map((o) => o.text), budgetUsd: report.inputs.budgetUsd, known: allowedRefs(report) })) add(message.slice(0, 60), message);
  const audience = text.match(AUDIENCE)?.[0];
  if (audience) add(audience, `"${audience}" claims to know who shops here. Speak to the city and the community.`);
  const free = text.match(FREE)?.[0];
  if (free) add(free, `"${free}" is an offer. Code adds the manager's offers and the wheel line word for word.`);
  const deal = (report.plan?.wheel ? text.replace(WHEEL, " ") : text).match(DEAL_WORDS)?.[0];
  if (deal) add(deal, `"${deal}" is deal or prize talk. Code adds the offers word for word, and a post never says what the wheel pays out.`);
  const minor = text.match(MINOR_SETTING)?.[0];
  if (minor) add(minor, `"${minor}" points at students. The event is for adults passing by.`);
  const claim = text.match(CLAIMS)?.[0];
  if (claim) add(claim, `"${claim}" is a claim about turnout or rank that nobody measured.`);
  if (/https?:\/\/|www\./i.test(text)) add("link", "Links are added by code: the share link carries the event page.");
  for (const fact of unsupportedClaims(text.replace(REF_TOKEN, ""), sellerText(report))) add(fact, `"${fact}" is a fact neither the manager nor the plan gave. Code adds the offers, date and address.`);
  // Carrier names and promos come only from what the manager typed (the store's name, the offers).
  const typed = [report.inputs.store.name, ...report.inputs.offers.map((o) => o.text)].join("\n");
  for (const brand of BRAND_WORDS) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
    const hit = text.match(pattern)?.[0];
    if (hit && !pattern.test(typed) && hit !== hit.toLowerCase()) {
      add(hit, `"${hit}": carrier names and promos come only from the store's name and the manager's offers, never invented.`);
      break;
    }
  }
  return issues;
}

/**
 * Music genres and slang that would label the people walking by. A playlist is an ingredient of the
 * event, never its identity, so posts and hashtags never name a genre ("Trap Friday", "Southern trap you
 * can hear from down the block" read as a stereotype of the crowd).
 */
export { GENRE_AND_SLANG };
const wordRe = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");

/**
 * Every rule a post opening breaks, before its refs are rendered: the shared guardrails, any measured
 * name written out (in any case) instead of a ref, refs outside the kept concept, names nobody gave,
 * and everything in contentIssues.
 */
export function checkPostText(text: string, report: Report, path: string): GuardIssue[] {
  const allowedNames = [report.inputs.store.city, report.inputs.store.name, report.inputs.store.region, ...(report.inputs.location ? [report.inputs.location.name] : [])];
  const issues: GuardIssue[] = checkText(text, { names: names(report), allowedNames }).map((i) => ({ ...i, path }));
  const add = (match: string, message: string) => issues.push({ ...issue(match, message), path });
  // checkText matches one-word names by exact case; a measured one-word name written in lower case still counts.
  const lower = text.toLowerCase();
  for (const name of names(report)) {
    const word = name.trim().toLowerCase();
    if (/\s/.test(word) || word.length < 5 || allowedNames.some((a) => a.toLowerCase() === word)) continue;
    if (new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(lower) && !text.includes(name)) add(name, `"${name}" is a measured name. Write its [[id]] token instead.`);
  }
  const allowed = allowedRefs(report);
  for (const id of refsIn(text)) if (!allowed.has(id)) add(`[[${id}]]`, `[[${id}]] is not an artist or place in the kept plan.`);
  for (const name of unknownNames(text, report)) add(name, `"${name}" looks like a name nobody gave. Name a measured artist or place only by its [[id]] token, and no other names.`);
  for (const word of GENRE_AND_SLANG) if (wordRe(word).test(text)) add(word, `Posts never name a music genre or use slang tied to a community ("${word}"). Say "music" instead.`);
  issues.push(...contentIssues(text, report, path));
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(`${i.path}:${i.message}`) ? false : (seen.add(`${i.path}:${i.message}`), true)));
}

/** Hashtags: letters and digits, no names, and the same content rules as the posts, read as words ("FreePhones" is "free phones"). */
export function checkHashtags(tags: readonly string[], report: Report): GuardIssue[] {
  const issues: GuardIssue[] = [];
  const banned = [...names(report), ...BRAND_WORDS];
  const city = report.inputs.store.city.toLowerCase().replace(/[^a-z0-9]+/g, "");
  tags.forEach((raw, i) => {
    const tag = raw.replace(/^#/, "");
    const path = `instagram.hashtags.${i}`;
    if (!HASHTAG.test(tag)) issues.push({ ...issue(tag, `#${tag}: hashtags are letters and digits only, 2 to 30 characters.`), path });
    const folded = tag.toLowerCase();
    const genre = GENRE_AND_SLANG.map((g) => g.replace(/[^a-z]+/g, "")).find((g) => g.length >= 4 && folded.includes(g));
    if (genre) issues.push({ ...issue(tag, `#${tag} names a music genre or slang. Hashtags name the city and the occasion only.`), path });
    for (const name of banned) {
      const compact = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (compact.length >= 4 && compact !== city && folded.includes(compact)) {
        issues.push({ ...issue(tag, `#${tag} names ${name}. Hashtags never carry an artist, place, carrier or brand name.`), path });
        break;
      }
    }
    const words = tag.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").toLowerCase();
    issues.push(...checkText(words).map((x) => ({ ...x, path })), ...contentIssues(words, report, path).map((x) => ({ ...x, match: `#${tag}` })));
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
  // The store's public phone, when it gave one; the internal store number never reaches a post.
  return { title: text.title, when: `${text.date}, ${text.time}`, where, phone: text.phone, offers: text.offers, wheel: text.wheel, weekday: text.date.split(",")[0] ?? "" };
}

/**
 * Joins a post's lines within the network's limit. Offers are never cut mid-line: when they do not all
 * fit, whole offers drop from the end and one line says how many more are at the table.
 */
export function fitPost(head: readonly string[], offers: readonly string[], tail: readonly string[], max: number): string {
  for (let shown = offers.length; shown >= 0; shown--) {
    const more = offers.length - shown;
    const lines = [...head, ...offers.slice(0, shown).map((o) => `Offer: ${o}`), ...(more ? [`${more} more ${more === 1 ? "offer" : "offers"} at the table.`] : []), ...tail];
    const text = lines.join("\n");
    if (text.length <= max) return text;
  }
  return [...head, ...tail].join("\n").slice(0, max);
}

/** Openings plus the facts, refs rendered: the posts as shared. `share` is filled by the caller. */
export function composePosts(openings: LlmPosts, report: Report): Posts {
  const nameOf = refNames(report);
  const r = (text: string) => renderRefs(text.trim(), nameOf).replace(/[ \t]+/g, " ");
  const f = postFacts(report);
  // The prize wheel's line, the same words as on the poster, and an example store's fictional line.
  const disclaimer = posterText(report).disclaimer;
  const wheel = [...(f.wheel ? [f.wheel] : []), ...(disclaimer ? [disclaimer] : [])];
  const call = f.phone ? [`Call or text: ${f.phone}`] : [];
  const facebook = fitPost([r(openings.facebook), "", `When: ${f.when}`, `Where: ${f.where}`, ...call], f.offers, wheel, 2000);
  const instagram = fitPost([r(openings.instagram), "", `${f.when}`, `${f.where}`], f.offers, wheel, 2200);
  const whatsapp = fitPost([r(openings.whatsapp), `${f.when}, ${f.where}.`, ...call], f.offers, wheel, 1000);
  const hashtags = [...new Set(openings.hashtags.map((t) => t.replace(/^#/, "")))].slice(0, 8);
  return { facebook: { text: facebook }, instagram: { caption: instagram, hashtags }, whatsapp: { text: whatsapp }, share: {} };
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
    facebook: `${title}: ${setup} on ${weekday}.${hook} Stop by and say hi.`,
    instagram: `${title} at ${at} on ${weekday}.${hook}`,
    whatsapp: `${title} at ${at} on ${weekday}.${hook} Stop by and say hi.`,
    hashtags: [...(HASHTAG.test(tag) ? [tag] : []), "ShopLocal", ...(weekday === "Saturday" || weekday === "Sunday" ? ["WeekendPlans"] : [])],
  };
}

// --- Asking Claude ---------------------------------------------------------------------------------

export function postsInstructions(): string {
  return [
    "You write short social posts for a prepaid phone store's event: a table outside the store with music and food from the block.",
    "The store manager reviews every post and shares it themselves. Write as the store (we), friendly, short, plain and local, like a neighbor talking.",
    "Write only the opening lines of each post. Code adds the date, the time, the store's address and the manager's offers word for word, so never write dates, times, addresses, prices, deals or offers yourself, and never add links.",
    "Name a place only by writing its token exactly as given, like [[place-id]]. Never write a name out. Use only the tokens listed in the plan. Mention a food spot or venue only if the plan lists it.",
    "Never name an artist, a band or any person, and never name a music genre or style. If you mention music at all, just say \"music\". The event is for everyone walking by: never describe the crowd, the neighborhood or the event by a genre, and never use slang tied to any community.",
    "Never name a carrier, a carrier promo or a promo day yourself: the manager's offers carry them, word for word. Never claim turnout, popularity, sales or anything nobody measured. Never say \"your customers\" or \"our customers\": speak to the city and the block. Never mention alcohol or tobacco. The event is for adults passing by: nothing aimed at children.",
    "Facebook: 2 to 4 short sentences. Instagram: 1 to 3 short sentences. WhatsApp: 1 or 2 sentences, like a text to a neighbor who asked to hear about events. At most one emoji per post.",
    "Hashtags: 3 to 6, letters and digits only, no # sign. The city's name and the occasion are fine; never an artist, a music genre, a place, a carrier or a brand.",
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
    return `[[${id}]]: ${nameOf.get(id)} (${place?.kind === "food" ? "food spot" : (place?.kind ?? "place")}${place && place.distanceM !== null ? `, about ${Math.round(place.distanceM / 10) * 10} m from the store` : ""})`;
  });
  const lines = (concept?.items ?? []).map((i) => `- ${i.kind}: ${withoutArtists(i.text, report)}`);
  return [
    `The event: ${f.title}, on ${f.when}, ${SETTING_WORDS[report.inputs.setting]}, ${report.inputs.location ? `at ${report.inputs.location.name}, hosted by ${report.inputs.store.name}` : `at ${report.inputs.store.name}`} in ${report.inputs.store.city}.`,
    concept ? `Why someone stops: ${concept.hook}` : "",
    report.inputs.offers.length ? `The manager has ${report.inputs.offers.length} offer${report.inputs.offers.length === 1 ? "" : "s"} at the table; code adds ${report.inputs.offers.length === 1 ? "it" : "them"} word for word below your lines.` : "There are no offers.",
    ...(report.plan?.wheel ? ["The table has a prize wheel, free to spin with no purchase needed. You may say \"spin the prize wheel\"; never list, describe or promise a prize."] : []),
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
