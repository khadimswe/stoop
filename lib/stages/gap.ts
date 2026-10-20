// The Reality Check: what the founder said (or what their site reads as) against what Qloo
// measured, per dimension, never forcing a gap. Each stated dimension is a gap, a near tie or
// confirmed, each with its own margin; a stated taste Qloo cannot score is unverifiable, which is
// not evidence either way. A confirmed read says so plainly ("Your read is right"), then moves to
// what the founder didn't state (cities, taste tags). The generic AI brief's assumptions show
// whenever they differ from Qloo, even when the founder matched.
// No Qloo calls except an optional taste check (stated taste tags scored against the tag panel).
import { tagPanel } from "../culture/panels";
import { METROS, STATES } from "../geo/metros";
import { ENDPOINTS, type AgeBucket } from "../qloo/constants";
import { insightsTagsResponse } from "../qloo/types";
import type { DimensionCheck, GapLine, Proof, RealityCheck, Seed } from "../report/schema";
import { ageBandLabel } from "../types";
import { decide, qloo, type StageEnv } from "./env";
import { bandSpan, bucketsForBand, guessedMetro, rankedBuckets } from "./measure";
import { seedSignal } from "./prove";

export const AGE_MARGIN = 0.1;
/** A gender skew this strong reads as "skews female" or "skews male". */
export const GENDER_SKEW = 0.2;
export const CITY_CONFIRMED_TOP = 5;
export const CITY_NEAR_TOP = 10;
/** A stated band spanning more than this many years is broad: a match says little. */
export const BROAD_SPAN = 25;

export type Gender = "female" | "male" | "balanced";

/** An audience someone stated: the founder ("you") or Claude's reading of their site ("site"). */
export interface StatedAudience {
  by: "you" | "site";
  /** The words as given (quoted data). */
  text: string;
  /** The age band exactly as stated ("25 to 40"); `ages` are the Qloo buckets it overlaps. */
  band: string | null;
  ages: AgeBucket[];
  gender: Gender | null;
  /**
   * A city or state the founder named as where their customers are. Never the run's region: the
   * heatmap is already limited to the region, so it would always "confirm".
   */
  place: string | null;
  /** Taste tags resolved through Qloo (from intake), scored against the tag panel. */
  tags: { id: string; name: string; kind: "music" | "tone" }[];
}

/** What the LLM-only (generic) brief assumed: its age bands, gender skew and guessed cities. */
export interface GenericAssumption {
  ages: AgeBucket[];
  gender: Gender;
  cities: string[];
}

const FEMALE = /\b(women|woman|female|females|moms?|mothers?|her|she|ladies)\b/i;
const MALE = /\b(men|man|male|males|dads?|fathers?|guys|him|he)\b/i;

/**
 * Reads a stated customer sentence in Qloo's dimensions, without an LLM (the examples' path): the
 * age band and gender words. A place comes only from intake's reading, never from the region field.
 */
export function statedFromText(text: string, by: StatedAudience["by"] = "you"): StatedAudience {
  const female = FEMALE.test(text);
  const male = MALE.test(text);
  const band = /\b(\d{2}) to (\d{2})\b/.exec(text);
  return {
    by,
    text,
    band: band ? `${band[1]} to ${band[2]}` : null,
    ages: bucketsForBand(text),
    gender: female === male ? null : female ? "female" : "male",
    place: null,
    tags: [],
  };
}

export function measuredGender(skew: { male: number; female: number }): Gender {
  if (skew.female >= GENDER_SKEW) return "female";
  if (skew.male >= GENDER_SKEW) return "male";
  return "balanced";
}

const bandText = (ages: readonly AgeBucket[]) => {
  if (ages.length === 0) return "";
  const labels = ages.map(ageBandLabel);
  return labels.length === 1 ? labels[0] : `${labels[0].split(" to ")[0]} to ${labels.at(-1)?.split(" to ").at(-1)}`;
};

type Base = Pick<DimensionCheck, "dimension" | "measured" | "evidenceIds">;
const unstated = (base: Base): DimensionCheck => ({ ...base, stated: null, statedBy: null, outcome: "not_stated", margin: null, position: null, broad: false });

function ageCheck(proof: Proof, stated: StatedAudience | null): DimensionCheck {
  const age = proof.demographics.age;
  const top = rankedBuckets(age)[0];
  const base: Base = { dimension: "age", measured: `top skew ${ageBandLabel(top)} (${age[top].toFixed(2)})`, evidenceIds: proof.demographics.evidenceIds };
  if (!stated || stated.ages.length === 0) return unstated(base);
  const best = Math.max(...stated.ages.map((b) => age[b]));
  const margin = Number((age[top] - best).toFixed(3));
  const outcome = stated.ages.includes(top) ? "confirmed" : margin >= AGE_MARGIN ? "gap" : "near_tie";
  const span = stated.band ? bandSpan(stated.band) : null;
  return { ...base, stated: stated.band ?? bandText(stated.ages), statedBy: stated.by, outcome, margin, position: null, broad: span !== null && span > BROAD_SPAN };
}

function genderCheck(proof: Proof, stated: StatedAudience | null): DimensionCheck {
  const skew = proof.demographics.gender;
  const measuredAs = measuredGender(skew);
  const strength = Number(Math.max(skew.female, skew.male).toFixed(3));
  const base: Base = {
    dimension: "gender",
    measured: measuredAs === "balanced" ? "balanced" : `skews ${measuredAs} (${(measuredAs === "female" ? skew.female : skew.male).toFixed(2)})`,
    evidenceIds: proof.demographics.evidenceIds,
  };
  if (!stated?.gender) return unstated(base);
  const common = { ...base, stated: stated.gender, statedBy: stated.by, margin: strength, position: null, broad: false };
  if (stated.gender === measuredAs) return { ...common, outcome: "confirmed" };
  // A measured skew of 0.2 or more the other way is a clear mismatch; a roughly balanced reading is a near tie.
  return { ...common, outcome: measuredAs === "balanced" ? "near_tie" : "gap" };
}

/** Where a stated city or state sits among the top 10 cities by lift (best rank of any city in a stated state), and whether that rank is flagged unstable. */
function placeRank(proof: Proof, place: string): { rank: number; flagged: boolean } | null {
  const state = Object.entries(STATES).find(([, name]) => name.toLowerCase() === place.toLowerCase())?.[0];
  const metro = state ? null : guessedMetro(place, METROS);
  // For a state, prefer its best-ranked stable city, falling back to a flagged one.
  const inState = state ? proof.cityRanks.filter((c) => c.label.endsWith(`, ${state}`)) : [];
  const hit = state ? (inState.find((c) => c.flags.length === 0) ?? inState[0]) : metro ? proof.cityRanks.find((c) => c.metro === metro.name) : undefined;
  return hit ? { rank: hit.rank, flagged: hit.flags.length > 0 } : null;
}

/** Cities without a stability flag, for copy (a flagged city still shows in the list, with its flag). */
const stableCities = (proof: Proof) => proof.cities.filter((c) => c.flags.length === 0);

function cityCheck(proof: Proof, stated: StatedAudience | null): DimensionCheck {
  const top = stableCities(proof).slice(0, 3).map((c) => c.label);
  const base: Base = { dimension: "cities", measured: top.length ? `clusters around ${top.join(", ")}` : "no stable city with enough signal", evidenceIds: proof.cities[0]?.evidenceIds ?? [] };
  if (!stated?.place) return unstated(base);
  const found = placeRank(proof, stated.place);
  const rank = found?.rank ?? null;
  // A high rank that is flagged unstable (it swings between reference sets) is a near tie, not a confirmation.
  const outcome =
    rank !== null && rank <= CITY_CONFIRMED_TOP && !found?.flagged ? "confirmed" : rank !== null && rank <= CITY_NEAR_TOP ? "near_tie" : "gap";
  return { ...base, stated: stated.place, statedBy: stated.by, outcome, margin: rank, position: null, broad: false };
}

/** The scoring call for stated taste tags: Qloo's own top tags, the stated tags, then the frozen tag panel. */
export function tasteRequest(seeds: readonly Seed[], proof: Proof, kind: "music" | "tone", statedIds: readonly string[]) {
  const top = proof.tags.filter((t) => t.kind === kind).map((t) => t.id);
  const ids = [...new Set([...top, ...statedIds, ...tagPanel(kind).map((p) => p.id)])];
  return { ...seedSignal(seeds), "filter.type": "urn:tag", "filter.results.tags": ids, take: ids.length };
}

async function tasteCheck(env: StageEnv, seeds: readonly Seed[], proof: Proof, stated: StatedAudience | null): Promise<DimensionCheck> {
  const top = proof.tags.slice(0, 2).map((t) => t.name);
  const base: Base = { dimension: "taste", measured: top.length ? `into ${top.join(" and ")}` : "no taste tags with enough signal", evidenceIds: proof.tags[0]?.evidenceIds ?? [] };
  if (!stated || stated.tags.length === 0) return unstated(base);
  // One call per kind the founder named. Each stated tag is placed against that kind's panel, leaving
  // out panel tags that are among Qloo's own top tags for this audience (a pick is never scored against itself).
  const placed: { name: string; beats: number; of: number }[] = [];
  const unscored: string[] = [];
  const evidence: string[] = [];
  for (const kind of ["music", "tone"] as const) {
    const mine = stated.tags.filter((t) => t.kind === kind);
    if (mine.length === 0) continue;
    const result = await qloo(env, "gap", `Scoring the ${kind} you named against Qloo's reference ${kind} tags`, {
      endpoint: ENDPOINTS.insights,
      params: tasteRequest(seeds, proof, kind, mine.map((t) => t.id)),
      schema: insightsTagsResponse,
    });
    evidence.push(result.evidence.id);
    const scores = new Map(result.data.flatMap((t) => (t.affinity === null ? [] : [[t.id, t.affinity] as const])));
    const own = new Set(proof.tags.filter((t) => t.kind === kind).map((t) => t.id));
    const panel = tagPanel(kind).filter((p) => !own.has(p.id)).flatMap((p) => (scores.has(p.id) ? [scores.get(p.id) as number] : []));
    for (const tag of mine) {
      const score = scores.get(tag.id);
      if (score === undefined || panel.length === 0) unscored.push(tag.name);
      else placed.push({ name: tag.name, beats: panel.filter((p) => score > p).length, of: panel.length });
    }
  }
  const common = { ...base, stated: stated.tags.map((t) => t.name).join(", "), statedBy: stated.by, broad: false, evidenceIds: evidence };
  if (placed.length === 0) {
    return { ...common, measured: `${base.measured}; no measurable affinity for ${unscored.join(", ")}`, outcome: "unverifiable", margin: null, position: null };
  }
  // Above the panel median confirms; the 25th percentile to the median is a near tie; below is a gap.
  // Several tags: all confirmed confirms, all gaps is a gap, a mix is a near tie (one weak tag is not the whole picture).
  const verdict = (p: { beats: number; of: number }) => (p.beats / p.of > 0.5 ? "confirmed" : p.beats / p.of >= 0.25 ? "near_tie" : "gap");
  const verdicts = placed.map(verdict);
  const outcome = verdicts.every((v) => v === "confirmed") ? "confirmed" : verdicts.every((v) => v === "gap") ? "gap" : "near_tie";
  const middle = [...placed].sort((a, b) => a.beats / a.of - b.beats / b.of)[Math.floor(placed.length / 2)];
  return { ...common, outcome, margin: null, position: { tag: middle.name, beats: middle.beats, of: middle.of } };
}

function overall(dimensions: readonly DimensionCheck[]): RealityCheck["outcome"] {
  const stated = dimensions.filter((d) => d.outcome !== "not_stated" && d.outcome !== "unverifiable");
  if (stated.length === 0) return "not_stated";
  if (stated.every((d) => d.outcome === "gap")) return "gap";
  // A broad band that happens to contain the top skew is not a full confirmation.
  if (stated.every((d) => d.outcome === "confirmed" && !d.broad)) return "confirmed";
  return "partly";
}

/** "skews 55 and older, into rock and folk, around Slidell, LA": Qloo's measurement in its own dimensions. */
function measuredLine(proof: Proof): GapLine {
  const age = proof.demographics.age;
  const top = rankedBuckets(age)[0];
  const gender = measuredGender(proof.demographics.gender);
  const parts = [`skews ${ageBandLabel(top)}${gender === "balanced" ? "" : `, ${gender}`}`];
  const tags = proof.tags.slice(0, 2).map((t) => t.name);
  if (tags.length) parts.push(`into ${tags.join(" and ")}`);
  const city = stableCities(proof)[0];
  if (city) parts.push(`around ${city.label} (ranked against ${city.comparedWith} reference audiences)`);
  return {
    kind: "measured",
    text: `Qloo measured a taste neighborhood that ${parts.join(", ")}.`,
    evidenceIds: [...new Set([...proof.demographics.evidenceIds, ...(proof.tags[0]?.evidenceIds ?? []), ...(city?.evidenceIds ?? [])])],
  };
}

function statedLine(stated: StatedAudience): GapLine {
  const parts = [stated.band ?? bandText(stated.ages), stated.gender && stated.gender !== "balanced" ? `mostly ${stated.gender === "female" ? "women" : "men"}` : "", stated.place ? `in ${stated.place}` : ""].filter(Boolean);
  const said = parts.length ? parts.join(", ") : `"${stated.text}"`;
  return stated.by === "site"
    ? { kind: "site", text: `Read from your site: it speaks to ${said}.`, evidenceIds: [] }
    : { kind: "stated", text: `You said ${said}.`, evidenceIds: [] };
}

/** True when the generic brief's assumptions differ from Qloo on any dimension (its cities: none in the top 10). */
export function genericDiffers(proof: Proof, generic: GenericAssumption): boolean {
  const top = rankedBuckets(proof.demographics.age)[0];
  const ranked = new Set(proof.cityRanks.map((c) => c.metro));
  return (
    !generic.ages.includes(top) ||
    generic.gender !== measuredGender(proof.demographics.gender) ||
    !generic.cities.some((city) => {
      const name = guessedMetro(city, METROS)?.name;
      return name !== undefined && ranked.has(name);
    })
  );
}

export async function realityCheck(
  env: StageEnv,
  input: { seeds: readonly Seed[]; proof: Proof; stated: StatedAudience | null; site: StatedAudience | null; generic: GenericAssumption | null },
): Promise<RealityCheck> {
  const { proof } = input;
  // The founder's own words win; the site reading fills in what the founder didn't state.
  const pick = (has: (s: StatedAudience) => boolean) => (input.stated && has(input.stated) ? input.stated : input.site && has(input.site) ? input.site : null);
  const dimensions: DimensionCheck[] = [
    ageCheck(proof, pick((s) => s.ages.length > 0)),
    genderCheck(proof, pick((s) => s.gender !== null)),
    cityCheck(proof, pick((s) => s.place !== null)),
    await tasteCheck(env, input.seeds, proof, pick((s) => s.tags.length > 0)),
  ];
  for (const d of dimensions) {
    if (d.outcome === "not_stated") continue;
    const verdict = d.outcome === "near_tie" ? "near tie, not a gap" : d.outcome;
    const detail = d.position ? `; your ${d.position.tag} beats ${d.position.beats} of ${d.position.of} reference tags` : d.margin === null ? "" : ` (margin ${d.margin})`;
    decide(env, "gap", `${d.dimension[0].toUpperCase()}${d.dimension.slice(1)}: ${verdict}`, `Stated ${d.stated}; Qloo measured ${d.measured}${detail}.`);
  }
  const outcome = overall(dimensions);

  const lines: GapLine[] = [];
  if (input.site) lines.push(statedLine(input.site));
  if (input.stated) lines.push(statedLine(input.stated));
  const measured = measuredLine(proof);
  if (outcome === "confirmed") {
    const same = dimensions.filter((d) => d.outcome === "confirmed").map((d) => d.measured);
    lines.push({ kind: "confirmed", text: `Your read is right: Qloo measures the same (${same.join("; ")}).`, evidenceIds: measured.evidenceIds });
    const missing = dimensions.filter((d) => d.outcome === "not_stated" && (d.dimension === "cities" || d.dimension === "taste"));
    if (missing.length) {
      lines.push({ kind: "unstated", text: `What you didn't say: it ${missing.map((d) => d.measured).join(", and it's ")}.`, evidenceIds: [...new Set(missing.flatMap((d) => d.evidenceIds))] });
    }
  } else {
    lines.push(measured);
  }
  for (const d of dimensions) {
    if (d.dimension === "age" && d.broad && d.outcome === "confirmed") {
      lines.push({ kind: "broad", text: `Your band (${d.stated}) is broad, so a match says little: within it, Qloo's ${d.measured.replace("top skew ", "top skew is ")}.`, evidenceIds: d.evidenceIds });
    } else if (d.outcome === "near_tie") {
      const text =
        d.dimension === "age" && d.margin !== null
          ? `Near tie on age: Qloo's ${d.measured.replace("top skew ", "top skew, ")}, is only ${d.margin.toFixed(2)} ahead of the band you stated (${d.stated}), so it isn't a gap.`
          : d.position
            ? `Near tie on taste: your ${d.position.tag} beats ${d.position.beats} of ${d.position.of} reference tags for this audience, so it isn't a gap.`
            : `Near tie on ${d.dimension}: Qloo measured ${d.measured}, close to what you stated (${d.stated}), so it isn't a gap.`;
      lines.push({ kind: "near", text, evidenceIds: d.evidenceIds });
    } else if (d.outcome === "unverifiable") {
      lines.push({ kind: "unverifiable", text: `Couldn't check ${d.dimension}: Qloo returned no measurable affinity for ${d.stated}, which is not evidence either way.`, evidenceIds: d.evidenceIds });
    }
  }
  if (input.generic && genericDiffers(proof, input.generic)) {
    const { ages, gender, cities } = input.generic;
    const parts = [bandText(ages), gender === "balanced" ? "" : `mostly ${gender === "female" ? "women" : "men"}`, cities.length ? `in ${cities.join(" and ")}` : ""].filter(Boolean);
    lines.push({ kind: "generic", text: `A generic AI brief assumed ${parts.join(", ")}.`, evidenceIds: [] });
    decide(env, "gap", "Showing the generic AI brief's assumptions", "They differ from what Qloo measured.");
  }
  return { outcome, dimensions, lines };
}
