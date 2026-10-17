// Deterministic culture guardrails, shared by the LLM-only baseline, the concept writer, user notes
// and every rendered prompt. Term lists live here once so validation and prompt checks never drift.
//   minor            anything that implies a person under 18 or a school setting
//   ethnicity        race or ethnicity used to describe a person (talent is never cast by ethnicity)
//   likeness         "in the style of <Name>", lookalikes, celebrities
//   named-reference  a real name (artist, film, brand, place) that must stay out of prompts
//   health-claim     medical or regulated claims
//   fake-proof       invented social proof (ratings, sales counts, "sold out")
//   em-dash          the U+2014 character, which the project never uses

export type GuardRule = "minor" | "ethnicity" | "likeness" | "named-reference" | "health-claim" | "fake-proof" | "em-dash";

export interface GuardIssue {
  rule: GuardRule;
  /** The text that matched. */
  match: string;
  message: string;
  /** Where in a structured value the match was found, e.g. "brief.hooks.1". */
  path?: string;
}

export interface GuardOptions {
  /** Real names that must not appear (whole word; single-word names match case-sensitively). */
  names?: readonly string[];
  /** Names that are allowed even if listed in `names`, e.g. the product's own name. */
  allowedNames?: readonly string[];
  /**
   * Match multi-word names only as written (case-sensitively), so a title like "Every Day" or "The
   * Office" doesn't flag the plain phrase "every day". For long lists of names Qloo returned, where
   * the risk is a leaked title, written the way titles are written.
   */
  exactCaseNames?: boolean;
}

const EM_DASH = String.fromCharCode(0x2014);

// Whole-word, case-insensitive. "minor" and "baby" are left out on purpose ("a minor key", "baby blue").
export const MINOR_TERMS = [
  "teen",
  "teens",
  "teenage",
  "teenager",
  "teenagers",
  "preteen",
  "tween",
  "tweens",
  "kid",
  "kids",
  "child",
  "children",
  "toddler",
  "underage",
  "girl",
  "girls",
  "boy",
  "boys",
  "schoolgirl",
  "schoolboy",
  "high school",
  "middle school",
  "elementary school",
  "classroom",
  "school uniform",
  "school uniforms",
  "homeroom",
  "prom",
  "high schooler",
  "high schoolers",
  "middle schooler",
  "middle schoolers",
  "schoolkid",
  "schoolkids",
  "schoolchildren",
  "kiddo",
  "kiddos",
  "youngster",
  "youngsters",
  "adolescent",
  "adolescents",
  "gen alpha",
] as const;

// "16-year-old", "fourteen year old", "15yo". A tens word before the number ("twenty-five-year-old") is an adult.
const UNDER_18 =
  "(?:[1-9]|1[0-7]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)";
const MINOR_AGE_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}.-])(?<!(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\\s)${UNDER_18}(?:[\\s-]*(?:years?|yrs?)[\\s-]*olds?|\\s?(?:yo|y/o))(?![\\p{L}\\p{N}])`,
  "giu",
);

// Unambiguous ethnicity words: flagged anywhere (case-insensitive).
export const ETHNICITY_TERMS = [
  "ethnicity",
  "ethnic",
  "racial",
  "biracial",
  "mixed-race",
  "african american",
  "asian american",
  "latina",
  "latino",
  "latinx",
  "hispanic",
  "caucasian",
  "skin tone",
  "skin color",
  "skin colour",
  "native american",
  "pacific islander",
  "first nations",
  "aboriginal",
  "latine",
  "chicano",
  "chicana",
  "blackface",
  // Seen in kept Qloo style tags (Gate 2 fixtures): "Indigenous visual vernacular", "Afro-Indigenous Influenced".
  "indigenous",
  "afro-indigenous",
] as const;

// Skin color named directly ("dark-skinned", "light skin") describes a person by ethnicity.
const SKIN_PATTERN =
  /(?<![\p{L}\p{N}])(?:dark|darker|light|lighter|fair|pale|olive|tan|tanned|black|white|brown)[\s-]+(?:skin|skinned|complexion|complexioned)(?![\p{L}\p{N}])/giu;

// Words that are fine for colors, food or fashion ("black leather jacket", "Korean barbecue") and only
// describe ethnicity when they modify a person, so they are flagged only before a person noun.
export const ETHNICITY_MODIFIERS = [
  "black",
  "white",
  "brown",
  "asian",
  "african",
  "indian",
  "arab",
  "middle eastern",
  "european",
  "mexican",
  "korean",
  "japanese",
  "chinese",
  "nigerian",
  "jamaican",
  "indigenous",
  "latin",
  "filipino",
  "filipina",
  "vietnamese",
  "thai",
  "puerto rican",
  "dominican",
  "haitian",
  "ethiopian",
  "somali",
  "brazilian",
  "colombian",
  "cuban",
  "caribbean",
  "pakistani",
  "persian",
] as const;

// Up to two of these may sit between the ethnicity word and the person noun ("Black female model").
const PERSON_ADJECTIVES = [
  "young",
  "younger",
  "older",
  "adult",
  "stylish",
  "smiling",
  "female",
  "male",
  "middle-aged",
  "elderly",
  "happy",
  "confident",
  "beautiful",
  "handsome",
] as const;

// "mom", "dad", "mother", "boyfriend", "chef" and "hands" are left out on purpose: "white mom jeans",
// "black dad hat", "mother-of-pearl", "boyfriend jeans", "Japanese chef knife", "black watch hands".
export const PERSON_NOUNS = [
  "man",
  "men",
  "woman",
  "women",
  "person",
  "people",
  "guy",
  "guys",
  "lady",
  "ladies",
  "model",
  "models",
  "actor",
  "actress",
  "talent",
  "family",
  "couple",
  "creator",
  "creators",
  "influencer",
  "friends",
  "customer",
  "customers",
  "audience",
  "female",
  "females",
  "male",
  "males",
  "founder",
  "founders",
  "student",
  "students",
  "athlete",
  "athletes",
  "adult",
  "adults",
  "folks",
  "neighbor",
  "neighbors",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
] as const;

/**
 * Well-known cities, neighborhoods and landmarks that a generic brief reaches for. Prompts never name a
 * place unless Qloo returned it (callers pass those as allowedNames). Ambiguous names that are also
 * common words (Nice, Mobile, Reading, Bath) are left out.
 */
export const FAMOUS_PLACES = [
  "New York",
  "NYC",
  "LA",
  "SF",
  "DC",
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Bronx",
  "Staten Island",
  "Harlem",
  "SoHo",
  "Williamsburg",
  "Times Square",
  "Central Park",
  "Los Angeles",
  "Hollywood",
  "Venice Beach",
  "Silver Lake",
  "Echo Park",
  "Malibu",
  "San Francisco",
  "Bay Area",
  "Golden Gate",
  "Oakland",
  "Chicago",
  "Miami",
  "Atlanta",
  "Austin",
  "Houston",
  "Dallas",
  "Seattle",
  "Portland",
  "Denver",
  "Boston",
  "Philadelphia",
  "Nashville",
  "New Orleans",
  "Las Vegas",
  "Detroit",
  "Phoenix",
  "San Diego",
  "Route 66",
  "Coachella",
  "Disneyland",
  "London",
  "Paris",
  "Tokyo",
  "Shibuya",
  "Harajuku",
  "Berlin",
  "Seoul",
  "Mexico City",
  "Toronto",
  "Lagos",
  "Mumbai",
] as const;

export const HEALTH_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bFDA\b/i,
  /\bclinically\b/i,
  /\bcur(?:e|es|ed|ing)\b/i,
  /\bheals?\b/i,
  /\b(?:doctor|dermatologist)[- ]recommended\b/i,
  /\bmedical[- ]grade\b/i,
  /\bSPF\b/i,
  /\bdermatologist[- ](?:tested|approved)\b/i,
  /\bdoctor[- ]approved\b/i,
  /\bmedically\b/i,
  /\bhypoallergenic\b/i,
  /\bimmun(?:e|ity)\b/i,
  /\bdetox(?:es|ing|ify)?\b/i,
  /\bweight[- ]loss\b/i,
  /\banti[- ]inflammatory\b/i,
];

export const FAKE_PROOF_PATTERNS: readonly RegExp[] = [
  /\bsold out\b/i,
  /\bbest[- ]?sell(?:er|ing)\b/i,
  /#1\b/,
  /\bsell(?:s|ing) out\b/i,
  /\b(?:[1-5](?:\.\d)?|four|five)[- ]?stars?\b/i,
  /\d(?:\.\d)?\s*[\u2605\u2B50]/u,
  /\b\d[\d,.]*\s*(?:k|m|million|thousand)?\+?\s*(?:(?:happy|satisfied|loyal)\s+)?(?:reviews|customers|sold|orders|buyers)\b/i,
  /\b(?:thousands|millions) of (?:happy |satisfied )?customers\b/i,
  /\bloved by (?:thousands|millions)\b/i,
  /\b(?:top|highest)[- ]rated\b/i,
  /\baward[- ]winning\b/i,
  /\brated \d/i,
  /\bas seen on\b/i,
  /\bwent viral\b/i,
];

// The lead phrase matches in any case ("In the style of" opens a sentence); the name must be capitalized.
const LIKENESS_PATTERNS: readonly RegExp[] = [
  /\b(?:[Ii]n the style of|[Ll]ooks? like|[Ll]ook-?alike of|[Rr]esembl(?:es|ing)|[Cc]hannel(?:s|ing)|[Aa] la|[Àà] la)\s+(?:a young |an older |the )?([A-Z][\p{L}'.-]+)/gu,
  /\bceleb(?:s|rit(?:y|ies))?\b/gi,
  /\blook-?alikes?\b/gi,
  /\bdoppelg(?:a|ä)ngers?\b/giu,
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Spaces and hyphens inside a term match any run of them, or none ("high-school", "highschool", "#WesAnderson").
const wordRegex = (term: string, flags: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(term).replace(/[ -]/g, "[\\s-]*")}(?![\\p{L}\\p{N}])`, `${flags}u`);

// Names are compared without accents and with straight apostrophes, so "Beyonce" and "Levi’s" still match.
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u02BC]/g, "'");

// Exclusion clauses ("no people, no text, no celebrity likenesses") name things in order to forbid them.
// They are removed before the content checks so prompts can state their own negatives. A clause ends at
// punctuation or a joining word, so "no clutter and two kids" still flags "kids". Only instructions
// open a clause: "do not" does, but a bare "not" or "nothing" does not ("not your average teen hangout",
// "nothing beats prom night"), and neither does a compound ("no-frills", "never-ending").
function withoutExclusions(text: string): string {
  return text.replace(
    /\b(?:no|never|without|avoid|avoids|avoiding|cannot|(?:do|does|did|must|should|will|can|may)\s+not|(?:don|doesn|didn|mustn|shouldn|won|can)['\u2019]t)\b(?![-'\u2019])(?:(?![.,;:!?\n]|\b(?:and|but|with|while|plus|then)\b)[\s\S])*/gi,
    " ",
  );
}

function findAll(text: string, regex: RegExp): string[] {
  const global = regex.flags.includes("g") ? regex : new RegExp(regex.source, `${regex.flags}g`);
  return [...text.matchAll(global)].map((m) => m[0]);
}

/** Every guardrail issue in one piece of text. An empty array means it passes. */
export function checkText(text: string, options: GuardOptions = {}): GuardIssue[] {
  const issues: GuardIssue[] = [];
  const add = (rule: GuardRule, match: string, message: string) => issues.push({ rule, match, message });

  if (text.includes(EM_DASH)) add("em-dash", EM_DASH, "Contains an em dash; use a comma, colon or period.");

  const content = withoutExclusions(text);

  const minorMessage = (match: string) =>
    `"${match}" implies someone under 18 or a school setting. Every segment and all talent are adults.`;
  for (const term of MINOR_TERMS) {
    for (const match of findAll(content, wordRegex(term, "i"))) add("minor", match, minorMessage(match));
  }
  for (const match of findAll(content, MINOR_AGE_PATTERN)) add("minor", match, minorMessage(match));

  for (const term of ETHNICITY_TERMS) {
    for (const match of findAll(content, wordRegex(term, "i"))) {
      add("ethnicity", match, `"${match}" describes race or ethnicity. Talent is never cast or described by ethnicity.`);
    }
  }
  const people = PERSON_NOUNS.map(escape).join("|");
  const adjectives = PERSON_ADJECTIVES.map(escape).join("|");
  for (const term of ETHNICITY_MODIFIERS) {
    const regex = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(term).replace(/ /g, "[\\s-]+")}\\s+(?:(?:${adjectives})\\s+){0,2}(?:${people})(?![\\p{L}\\p{N}])`,
      "giu",
    );
    for (const match of findAll(content, regex)) {
      add("ethnicity", match, `"${match}" describes a person by ethnicity. Describe styling and energy instead.`);
    }
  }
  for (const match of findAll(content, SKIN_PATTERN)) {
    add("ethnicity", match, `"${match}" describes a person by skin color. Describe styling and energy instead.`);
  }

  for (const pattern of LIKENESS_PATTERNS) {
    for (const match of findAll(content, pattern)) {
      add("likeness", match, `"${match}" points at a real person's likeness. Prompts use fictional people only.`);
    }
  }

  for (const pattern of HEALTH_CLAIM_PATTERNS) {
    for (const match of findAll(content, pattern)) add("health-claim", match, `"${match}" is a health or regulated claim.`);
  }
  for (const pattern of FAKE_PROOF_PATTERNS) {
    for (const match of findAll(content, pattern)) {
      add("fake-proof", match, `"${match}" is social proof. Proof beats use facts the seller supplies, never invented ones.`);
    }
  }

  const allowed = (options.allowedNames ?? []).map((name) => fold(name.trim()).toLowerCase()).filter(Boolean);
  // A name is allowed when an allowed name is it, or contains it as whole words ("Brooklyn Museum" allows "Brooklyn").
  const isAllowed = (name: string) => {
    const lower = name.toLowerCase();
    return allowed.some((entry) => entry === lower || wordRegex(lower, "").test(entry));
  };
  const folded = fold(text);
  for (const raw of options.names ?? []) {
    const name = fold(raw.trim());
    // Very short names are skipped unless they are uppercase codes such as "LA" or "SF".
    if ((name.length < 3 && !/^[A-Z]{2}$/.test(name)) || isAllowed(name)) continue;
    // Single-word names are matched case-sensitively, so a film called "Her" doesn't flag "her".
    const regex = wordRegex(name, /\s/.test(name) && !options.exactCaseNames ? "i" : "");
    for (const match of findAll(folded, regex)) {
      add("named-reference", match, `"${match}" is a real name. Prompts carry its style, never the name itself.`);
    }
  }

  return issues;
}

/** Runs checkText over every string inside a structured value and records where each issue was found. */
export function checkValue(value: unknown, options: GuardOptions = {}, path = ""): GuardIssue[] {
  if (typeof value === "string") return checkText(value, options).map((issue) => ({ ...issue, path }));
  if (Array.isArray(value)) return value.flatMap((item, index) => checkValue(item, options, join(path, String(index))));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => checkValue(item, options, join(path, key)));
  }
  return [];
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** Replaces every em dash in every string of a value with a comma. Returns a new value. */
export function stripEmDashes<T>(value: T): T {
  if (typeof value === "string") {
    if (!value.includes(EM_DASH)) return value;
    return value
      .replace(new RegExp(`\\s*${EM_DASH}\\s*`, "g"), ", ")
      .replace(/,(?:\s*,)+/g, ",")
      .replace(/,\s*(?=[.!?;:])/g, "")
      .replace(/^\s*,\s*/, "")
      .replace(/\s*,\s*$/, "") as T;
  }
  if (Array.isArray(value)) return value.map((item) => stripEmDashes(item)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripEmDashes(item)])) as T;
  }
  return value;
}

/** Rules relaxed inside an "avoid" list, which names banned claims in order to forbid them. */
export const AVOID_LIST_EXEMPT: ReadonlySet<GuardRule> = new Set<GuardRule>(["health-claim", "fake-proof"]);

/** One line per issue, for error messages and LLM repair prompts. */
export function formatGuardIssues(issues: readonly GuardIssue[]): string {
  return issues.map((issue) => `- ${issue.path ? `${issue.path}: ` : ""}${issue.message}`).join("\n");
}
