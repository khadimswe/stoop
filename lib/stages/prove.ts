// Prove: who the taste neighborhood around the seeds is, and where it clusters. Four Qloo calls,
// with the same params the Gate 2 data check recorded, so the examples replay from fixtures:
// demographics (one skew row per seed), a heatmap of the region, and the top music-genre and
// emotional-tone tags. Cities are ranked by reference-corrected lift (lib/geo/metros.ts).
import { checkText } from "../guardrails";
import { COVERAGE_FLOOR, gridCoverage, rankCities, shortMetroName } from "../geo/metros";
import { ENDPOINTS } from "../qloo/constants";
import type { QlooParams } from "../qloo/params";
import { demographicsResponse, heatmapResponse, insightsTagsResponse, slimHeatmapBody, type HeatmapCell, type QlooTag } from "../qloo/types";
import type { CityCue, Proof, Seed, TasteTag } from "../report/schema";
import { decide, qloo, type StageEnv } from "./env";
import { meanSkew } from "./measure";

/** Taste-tag types Prove reads, by the kind they describe. */
export const PROVE_TAG_TYPES = { music: "urn:tag:genre:music", tone: "urn:tag:emotional_tone:qloo" } as const;
export const TOP_CITIES = 5;
/** Ranks kept by name for the Reality Check (a stated city at 6 to 10 is a near tie). */
export const RANKED_CITIES = 10;
export const TOP_TAGS = 10;
export const MIN_SEEDS = 2;

/** The signal Prove and Segments send: entity seeds and tag seeds, in the order given. */
export function seedSignal(seeds: readonly Seed[]): QlooParams {
  const entities = seeds.filter((s) => s.ref.kind === "entity").map((s) => s.ref.id);
  const tags = seeds.filter((s) => s.ref.kind === "tag").map((s) => s.ref.id);
  return {
    ...(entities.length ? { "signal.interests.entities": entities } : {}),
    ...(tags.length ? { "signal.interests.tags": tags } : {}),
  };
}

/** Prove's four requests, exported so recordings can be planned from the same params. */
export function proveRequests(seeds: readonly Seed[], region: string) {
  const signal = seedSignal(seeds);
  return {
    demographics: { ...signal, "filter.type": "urn:demographics" },
    heatmap: { ...signal, "filter.type": "urn:heatmap", "filter.location.query": region },
    music: { ...signal, "filter.type": "urn:tag", "filter.tag.types": [PROVE_TAG_TYPES.music], take: 30 },
    tone: { ...signal, "filter.type": "urn:tag", "filter.tag.types": [PROVE_TAG_TYPES.tone], take: 30 },
  } satisfies Record<string, QlooParams>;
}

const guarded = (text: string) => checkText(text).filter((issue) => issue.rule === "minor" || issue.rule === "ethnicity");

function tasteTags(env: StageEnv, tags: readonly QlooTag[], kind: keyof typeof PROVE_TAG_TYPES, evidenceId: string): TasteTag[] {
  const kept: TasteTag[] = [];
  for (const tag of tags.filter((t) => t.type === PROVE_TAG_TYPES[kind])) {
    const name = tag.name.trim();
    if (guarded(name).length > 0) {
      decide(env, "prove", `Left out the tag "${name}"`, "It describes people by identity or implies minors; Stoop reads taste, never identity.");
      continue;
    }
    if (kept.length < TOP_TAGS) kept.push({ id: tag.id, name, kind, affinity: tag.affinity ?? 0, rank: kept.length + 1, evidenceIds: [evidenceId] });
  }
  return kept;
}

/** Prove's result, plus its heatmap, which Segments leaves out of the reference (a segment shares its parent's signal). */
export async function prove(env: StageEnv, input: { seeds: readonly Seed[]; region: string }): Promise<{ proof: Proof; heatmap: HeatmapCell[] } | { partial: string }> {
  const usable = input.seeds.filter((s) => s.ref.id);
  if (usable.length < MIN_SEEDS) {
    decide(env, "prove", "Stopped: need at least 2 seeds Qloo knows", `${usable.length} seed(s) resolved.`);
    return { partial: "Need at least 2 seeds Qloo knows." };
  }
  const requests = proveRequests(usable, input.region);
  const n = usable.length;

  const demographics = await qloo(env, "prove", `Measuring age and gender skew from ${n} seeds`, {
    endpoint: ENDPOINTS.insights,
    params: requests.demographics,
    schema: demographicsResponse,
  });
  const heatmap = await qloo(env, "prove", `Mapping where this taste neighborhood clusters in ${input.region}`, {
    endpoint: ENDPOINTS.insights,
    params: requests.heatmap,
    schema: heatmapResponse,
    slim: slimHeatmapBody,
  });
  const music = await qloo(env, "prove", "Reading the music genres this audience over-indexes on", {
    endpoint: ENDPOINTS.insights,
    params: requests.music,
    schema: insightsTagsResponse,
  });
  const tone = await qloo(env, "prove", "Reading the emotional tone it responds to", {
    endpoint: ENDPOINTS.insights,
    params: requests.tone,
    schema: insightsTagsResponse,
  });

  const skew = meanSkew(demographics.data);
  const coverage = gridCoverage(heatmap.data, env.reference.full.cells);
  const flags: Proof["flags"] = [];
  if (coverage < COVERAGE_FLOOR) {
    flags.push("thin-heatmap");
    decide(env, "prove", "Flagged a thin heatmap", `It covers ${Math.round(coverage * 100)}% of the reference grid; city ranks are less certain.`);
  }

  const { cities: ranked, smallSetOnly } = rankCities(heatmap.data, env.reference, { own: env.inReference });
  const cities: CityCue[] = ranked.slice(0, TOP_CITIES).map((m) => ({
    metro: m.metro.name,
    label: shortMetroName(m.metro),
    rank: m.rank,
    lift: m.lift,
    cells: m.cells,
    topCell: m.topCell.geohash,
    comparedWith: m.comparedWith,
    candidateSetRank: m.candidateSetRank,
    flags: m.flags,
    basis: "audience" as const,
    evidenceIds: [heatmap.evidence.id],
  }));
  const small = env.reference.candidates.audiences - (env.inReference ? 1 : 0);
  const stable = cities.find((c) => c.flags.length === 0);
  if (cities[0]) {
    const lead = cities[0].flags.length === 0 ? cities[0] : stable;
    decide(
      env,
      "prove",
      lead ? `Top stable city by lift: ${lead.label}` : `No stable city in the top ${TOP_CITIES}`,
      `Ranked against ${cities[0].comparedWith} reference audiences, only metros with real signal (3 or more dense cells).${lead && lead !== cities[0] ? ` ${cities[0].label} ranks first but is flagged unstable.` : ""}`,
    );
  }
  for (const city of cities.filter((c) => c.flags.includes("large-swing"))) {
    decide(env, "prove", `${city.label} is unstable`, `#${city.rank} against the full set but ${city.candidateSetRank ? `#${city.candidateSetRank}` : "unranked"} against ${small} candidate audiences.`);
  }
  for (const city of smallSetOnly) {
    decide(
      env,
      "prove",
      `Not using ${shortMetroName(city.metro)}`,
      `It ranked #${city.candidateSetRank} against ${small} candidate audiences but ${city.fullRank ? `#${city.fullRank}` : "outside the ranking"} against the full set, so its rank holds only against the small set.`,
    );
  }

  const proof: Proof = {
    seeds: [...input.seeds],
    demographics: {
      age: skew.age,
      gender: skew.gender,
      perSeed: demographics.data.map((row) => ({
        seedId: row.signalId,
        age: Object.fromEntries(Object.entries(row.age).map(([k, v]) => [k, v])) as Proof["demographics"]["age"],
        gender: { male: row.gender.male ?? 0, female: row.gender.female ?? 0 },
      })),
      evidenceIds: [demographics.evidence.id],
    },
    tags: [...tasteTags(env, music.data, "music", music.evidence.id), ...tasteTags(env, tone.data, "tone", tone.evidence.id)],
    cities,
    cityRanks: ranked.slice(0, RANKED_CITIES).map((m) => ({ metro: m.metro.name, label: shortMetroName(m.metro), rank: m.rank, flags: m.flags })),
    smallSetOnly: smallSetOnly.map((c) => ({ label: shortMetroName(c.metro), candidateSetRank: c.candidateSetRank, fullRank: c.fullRank })),
    coverage,
    flags,
  };
  return { proof, heatmap: heatmap.data };
}
