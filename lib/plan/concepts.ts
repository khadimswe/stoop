// Three event concepts, written and scored by Claude in one call from the city, the block and the
// manager's inputs only, then checked by code: every line goes through the guard, refs become real
// Qloo ids, receipts come from what the refs and styles point at, and specificity is capped by how
// many distinct Qloo items a concept uses. One repair call with the problems listed; whatever still
// fails is dropped, never shown.
import { z } from "zod";
import { askOnce, cachedInstructions } from "../agent/ask";
import { stripEmDashes } from "../guardrails";
import { CUE_ORIGINS } from "../types";
import { planDecide, type PlanEnv } from "./env";
import { itemIssues, type GuardContext } from "./guard";
import { buildAliases, evidenceFor, inputsText, localText, PLAN_RULES, PLANNER_ROLE, REF_RULES, toRealRefs, type Aliases } from "./prompt";
import { refsIn } from "./refs";
import { bounded, PLAN_CRITERIA, PLAN_CRITERION_IDS, PLAN_MAX_TOTAL, PLAN_RUBRIC_TEXT, pickKept, planTotal, type PlanScore } from "./rubric";
import { isChain } from "./taste";
import { ITEM_KINDS, type Concept, type Local, type PlanInputs, type PlanItem } from "./schema";

export const CONCEPT_COUNT = 3;
export const CONCEPTS_TIMEOUT_MS = 120_000;
/** A concept needs at least this many lines that pass the guard to be shown. */
export const MIN_CONCEPT_ITEMS = 3;
const MAX_TEXT = 240;

const llmItem = z.object({
  kind: z.enum(ITEM_KINDS),
  text: z.string().describe("One concrete line of at most 150 characters, with at most 2 keys. Artists and places only as [[a1]] or [[p2]] keys."),
  origin: z.enum(CUE_ORIGINS),
  styles: z.array(z.string()).describe("s-keys of the music styles this line uses, or an empty list"),
});
export const conceptsOutputSchema = z.object({
  concepts: z.array(
    z.object({
      title: z.string().describe("At most 50 characters, with no artist or place names"),
      hook: z.string().describe("Why someone walking past stops, in one line of at most 120 characters, with no artist or place names"),
      items: z.array(llmItem).describe("5 to 8 lines: a theme, the music, food or a partner, an activity, a giveaway, the setup, the signage, the timing"),
      scores: z.object(Object.fromEntries(PLAN_CRITERION_IDS.map((id) => [id, z.number().describe("1 to 5")])) as Record<(typeof PLAN_CRITERION_IDS)[number], z.ZodNumber>),
      noStereotype: z.boolean().describe("True when nothing relies on a stereotype about a group of people"),
      note: z.string().describe("One sentence: this concept's main weakness"),
    }),
  ),
});
type LlmConcepts = z.infer<typeof conceptsOutputSchema>;

const TASK = [
  "Task:",
  `Write ${CONCEPT_COUNT} clearly different event concepts for this store's table or booth, grounded only in the store's facts and what Qloo measured.`,
  "The store runs events for walk-ins and sign-ups. Every concept has one line that turns a stop into a walk-in: the moment and the reason to step inside, with the manager's promo doing the work. Never build the event around sending people to other businesses.",
  "Each concept has a title, a hook and 5 to 8 lines. Lines are short and concrete: what plays, what is served and from where, what people do, what they take home, how the table looks, what the sign says, when the peak is.",
  "Fit the day: use what the data says about the date (a holiday, a payday weekend, the season) where it helps.",
  "The manager's notes are requirements: every concept does what they ask.",
  "Food: snacks and drinks the area likes (from the block's favorite spots, or the kind of thing they sell), not catering. Order a meal from a partner only when the budget clearly covers it.",
  "Giveaways: small gift cards to the block's places are a good, Qloo-backed giveaway (\"a $10 gift card to [[p3]]\"), handed out in a free drawing. Proven tactics (the promo sign, a prize wheel, a free drawing) are welcome; what matters is that the details are local.",
  "Music: lead with the city's most-loved artists (the first keys in the list) and an energy that carries on a sidewalk, unless the notes ask for something calm.",
  "Use the block's places as partners where it fits (order food from them, point people to a nearby park or venue), and the city's artists and styles for the music.",
  "Favor what pulls people in from outside: the table or booth itself, something people can see and hear from down the block, and one line that tells people to come inside.",
  "Where it is natural, let the food, the drinks, the giveaway or the timing draw on the block's places too (hot drinks from a local cafe rather than a grocery store). Never force a place into a line; a good line beats a cited one.",
  "If the manager gave offers, one signage line quotes one of them exactly. If not, no line mentions a price or a deal.",
  "Then score each concept with the rubric below and say its main weakness in one sentence.",
].join("\n");

export function conceptsInstructions(): string {
  return [PLANNER_ROLE, PLAN_RULES, REF_RULES, TASK, PLAN_RUBRIC_TEXT].join("\n\n");
}

export function conceptsPrompt(inputs: PlanInputs, local: Local, aliases: Aliases): string {
  return [inputsText(inputs), localText(local, aliases, inputs), "Write the concepts."].join("\n\n");
}

export interface CheckedConcept {
  title: string;
  hook: string;
  items: PlanItem[];
  score: PlanScore;
  note: string;
  /** Distinct Qloo artists, places and styles the concept uses. */
  qlooItems: number;
}

export interface ConceptCheck {
  concepts: CheckedConcept[];
  /** "concepts.1.items.2: ..." lines, for the repair prompt and the trace. */
  issues: string[];
}

const clip = (text: string) => text.trim();

/** Things the manager's notes ask for that a concept's lines must carry (checked by words, not by the model). */
const NOTE_ASKS: readonly { asks: RegExp; carries: RegExp; what: string }[] = [
  { asks: /gift ?cards?/i, carries: /gift ?cards?/i, what: "gift cards" },
  { asks: /\bsnacks?\b/i, carries: /\b(snacks?|chips|bites|treats?|pastr\w*|doughnuts?|donuts?|cookies|paletas?|popsicles?|fruit|nuts|popcorn|cups? of)\b/i, what: "snacks" },
  { asks: /\b(drinks?|coffee|cocoa|cider|water)\b/i, carries: /\b(drinks?|coffee|cocoa|chocolate|cider|tea|water|juice|lemonade|agua)\b/i, what: "drinks" },
  { asks: /\b(post|facebook|instagram|whatsapp|social)\b/i, carries: /\b(post|facebook|instagram|whatsapp|social)\b/i, what: "posting about it" },
];

/** What the notes ask for that none of the lines carry. */
export function notesMissing(notes: string, items: readonly Pick<PlanItem, "text">[]): string[] {
  return NOTE_ASKS.filter((n) => n.asks.test(notes) && !items.some((i) => n.carries.test(i.text))).map((n) => n.what);
}

/** Maps one answer to plan items with real refs and receipts, and lists every problem. Lines with problems are left out. */
export function checkConcepts(raw: LlmConcepts, aliases: Aliases, guard: GuardContext): ConceptCheck {
  const issues: string[] = [];
  const concepts: CheckedConcept[] = [];
  const answer = stripEmDashes(raw);
  if (answer.concepts.length !== CONCEPT_COUNT) issues.push(`concepts: write exactly ${CONCEPT_COUNT} concepts, got ${answer.concepts.length}.`);
  answer.concepts.slice(0, CONCEPT_COUNT).forEach((concept, c) => {
    const at = `concepts.${c + 1}`;
    const title = clip(concept.title);
    const hook = clip(concept.hook);
    if (!title || title.length > 60) issues.push(`${at}.title: must be 1 to 60 characters.`);
    if (!hook || hook.length > 140) issues.push(`${at}.hook: must be 1 to 140 characters.`);
    for (const problem of [...itemIssues({ kind: "theme", text: title, origin: "creative", refs: [], evidenceIds: [] }, guard), ...itemIssues({ kind: "theme", text: hook, origin: "creative", refs: [], evidenceIds: [] }, guard)]) {
      issues.push(`${at}.title or hook: ${problem}`);
    }
    const items: PlanItem[] = [];
    const used = new Set<string>();
    concept.items.forEach((item, i) => {
      const where = `${at}.items.${i + 1}`;
      const text = toRealRefs(clip(item.text), aliases);
      const refs = refsIn(text);
      const unknownStyles = item.styles.filter((key) => !aliases.styles.has(key.toLowerCase()));
      const styles = item.styles.filter((key) => aliases.styles.has(key.toLowerCase()));
      const evidenceIds = item.origin === "creative" || item.origin === "yours" ? [] : evidenceFor(aliases, refs, styles);
      const problems = itemIssues({ kind: item.kind, text, origin: item.origin, refs, evidenceIds }, guard);
      if (!text) problems.push("must not be empty.");
      else if (text.length > MAX_TEXT) problems.push(`is ${text.length} characters once its keys become Qloo ids (each key is about 40); the limit is ${MAX_TEXT}. Shorten it or use fewer keys.`);
      if (unknownStyles.length) problems.push(`styles ${unknownStyles.join(", ")} are not s-keys from the data.`);
      if ((item.origin === "creative" || item.origin === "yours") && styles.length) problems.push(`a ${item.origin} line cites styles; mark it interpreted instead.`);
      if (item.kind === "partner") {
        const chain = refs.map((id) => aliases.places.get(id)).find((p) => p && isChain(p.name));
        if (chain) problems.push(`a national chain is not a co-promo partner; use it for a gift card or a snack run (kind giveaway or food), or partner with a local independent.`);
      }
      if (problems.length) {
        for (const problem of problems) issues.push(`${where}: ${problem}`);
        return;
      }
      items.push({ kind: item.kind, text, origin: item.origin, refs, evidenceIds });
      for (const ref of refs) used.add(ref);
      if (evidenceIds.length) for (const key of styles) used.add(key.toLowerCase());
    });
    const qlooItems = used.size;
    if (!concept.noStereotype) issues.push(`${at}: it fails the no-stereotype gate; rewrite it without relying on a stereotype.`);
    if (items.length < MIN_CONCEPT_ITEMS) issues.push(`${at}: needs at least ${MIN_CONCEPT_ITEMS} lines that pass the checks.`);
    for (const missing of notesMissing(guard.notes ?? "", items)) issues.push(`${at}: the manager's notes ask for ${missing}; add a line for it.`);
    const scores = Object.fromEntries(PLAN_CRITERION_IDS.map((id) => [id, concept.scores[id]])) as PlanScore["scores"];
    concepts.push({ title: title.slice(0, 60), hook: hook.slice(0, 140), items, score: { scores, noStereotype: concept.noStereotype }, note: clip(concept.note), qlooItems });
  });
  return { concepts, issues };
}

/** A slug for a concept id: its title, made unique within the plan. */
export function conceptIds(titles: readonly string[]): string[] {
  const used = new Set<string>();
  return titles.map((title, i) => {
    const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || `concept-${i + 1}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

/** The concepts as the contract holds them: scored, capped, one kept, the others with a note. */
export function toConcepts(checked: readonly CheckedConcept[]): Concept[] {
  const usable = checked.filter((c) => c.score.noStereotype && c.items.length >= MIN_CONCEPT_ITEMS);
  const capped = usable.map((c) => ({ ...c, score: bounded(c.score, c.qlooItems) }));
  const kept = pickKept(capped);
  const ids = conceptIds(capped.map((c) => c.title));
  const keptTotal = kept ? planTotal(kept.score) : 0;
  return capped.map((c, i) => {
    const total = planTotal(c.score);
    const isKept = c === kept;
    return {
      id: ids[i] as string,
      title: c.title,
      hook: c.hook,
      items: c.items,
      scores: PLAN_CRITERIA.map((criterion) => ({ criterion: criterion.label, score: c.score.scores[criterion.id] })),
      total,
      kept: isKept,
      ...(isKept ? {} : { note: `Scored ${total} of ${PLAN_MAX_TOTAL} against ${keptTotal} for the kept concept.${c.note ? ` ${c.note}` : ""}`.slice(0, 300) }),
    };
  });
}

function repairPrompt(prompt: string, previous: unknown, issues: readonly string[]): string {
  return [
    prompt,
    `Your previous answer failed these checks:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    `Fix every issue and return all ${CONCEPT_COUNT} concepts again. Keep everything that already worked.`,
    `Previous answer (JSON):\n${JSON.stringify(previous)}`,
  ].join("\n\n");
}

export interface ConceptsOutcome {
  concepts: Concept[];
  aliases: Aliases;
}

/** One concept call, plus one repair when lines fail. Null when nothing usable came back. */
export async function writeConcepts(env: PlanEnv, inputs: PlanInputs, local: Local, guard: GuardContext): Promise<ConceptsOutcome | null> {
  const aliases = buildAliases(local);
  const instructions = cachedInstructions(conceptsInstructions());
  const prompt = conceptsPrompt(inputs, local, aliases);
  let ask = prompt;
  let best: ConceptCheck | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await askOnce(env.model, { instructions, prompt: ask, schema: conceptsOutputSchema, name: "event_concepts", description: "Three scored event concepts.", timeoutMs: env.timeoutMs ?? CONCEPTS_TIMEOUT_MS, ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}) });
    const parsed = reply.failure ? null : conceptsOutputSchema.safeParse(reply.output);
    if (!parsed?.success) {
      planDecide(env, "concepts", attempt === 1 ? "Asked Claude again for the concepts" : "Claude's concepts did not come back usable", reply.failure ?? "The answer did not match the concept format.");
      if (attempt === 1) continue;
      break;
    }
    const check = checkConcepts(parsed.data, aliases, guard);
    best = check;
    if (check.issues.length === 0) break;
    if (attempt === 1) {
      planDecide(env, "concepts", `Sent ${check.issues.length} ${check.issues.length === 1 ? "problem" : "problems"} back to Claude`, check.issues.slice(0, 4).join(" "));
      ask = repairPrompt(prompt, parsed.data, check.issues);
    } else {
      planDecide(env, "concepts", `Dropped what still failed the checks`, check.issues.slice(0, 4).join(" "));
    }
  }
  if (!best) return null;
  const concepts = toConcepts(best.concepts);
  if (concepts.length === 0) return null;
  const kept = concepts.find((c) => c.kept);
  planDecide(env, "concepts", `Kept "${kept?.title}"`, `It scored ${kept?.total} of ${PLAN_MAX_TOTAL} on the event rubric (bringing people inside counts double); ${concepts.length - 1} other ${concepts.length - 1 === 1 ? "concept stays" : "concepts stay"} with their scores.`);
  return { concepts, aliases };
}
