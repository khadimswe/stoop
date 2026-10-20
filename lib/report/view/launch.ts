// The Launch plan: a fair test of each concept world against the generic AI brief, which the brand
// sets up in its own ad account (Stoop never connects to one). One cell per world with a kept
// concept, plus the Control as the baseline cell. Each cell carries its creative (the kept concept's
// title and hook, and where its prompts are in the Output section), its audience options, what to
// watch and the placements. A world's age bands, cities and interest searches are Qloo facts, each
// with its receipt (no evidence, no display); the Control's options come from its own brief and say
// they are not from Qloo, and it has no interest searches (it has no Qloo audience). The interest
// names are suggestions to search in an ads manager: they appear here only, never in a video prompt.
// No medians, no benchmarks, no promised results: the budget math (launch-sheet.ts) only does
// arithmetic on what the brand types in.
// Pure and client-safe: types only from the Report contract, so it never pulls in the pack compiler.
import { CONTROL_SEGMENT } from "../../api/requests";
import { AD_PLAN_MAX_CITIES, AD_PLAN_NOTE, AD_PLAN_OPTIONAL, hypothesisWatch } from "../../kit/ad-plan-copy";
import type { AgeBucket } from "../../qloo/constants";
import { ageBandLabel } from "../../types";
import type { CityCue, Report, Segment } from "../schema";
import type { Control, CultureSource, World } from "../world";
import { currentControl, currentWorld, keptConcept } from "./current";
import { plainType, settingNote, skewText } from "./format";
import { fileSlug } from "./kit";
import { ledgerOf, panelNoun, panelText, receiptView, type Ledger } from "./receipts";
import type { ReceiptView } from "./types";

export const CONTROL_CELL_LABEL = "Generic AI brief · not from Qloo";
/** Reels + TikTok 9:16, the default format: Meta Reels and Stories, plus TikTok. */
export const LAUNCH_PLACEMENTS = ["Meta Reels", "Meta Stories", "TikTok"] as const;
export const CONTROL_WATCH =
  "The baseline. Run it on the same objective, budget and placements as every world: each world's cost per result is judged against this one.";
export const WORLD_COMPARE = "Compare its cost per result with the Control's.";
/** Interest searches shown per world at most. */
export const LAUNCH_MAX_INTERESTS = 8;
/** Entity types worth searching as interests, in the order they take turns. No people, no places. */
export const INTEREST_TYPES = ["urn:entity:brand", "urn:entity:artist", "urn:entity:tv_show", "urn:entity:movie", "urn:entity:podcast"] as const;

/** The id of a world's (or the Control's) card in the Output section, where its prompts are. */
export function outputAnchor(key: string): string {
  return `output-${key}`;
}

/** One audience option: an age band or a city. */
export interface LaunchOptionView {
  /** "55 and older", "Pittsfield, MA". */
  text: string;
  /** What Qloo measured for it ("skews +0.21", "#1 by lift"); null on the Control, whose options are not from Qloo. */
  detail: string | null;
  /** The Qloo calls behind it. Null only on the Control. */
  receipt: ReceiptView | null;
  evidenceIds: string[];
}

/** One interest search to try: an entity Qloo returned for this world, from its Culture Brief. */
export interface LaunchInterestView {
  /** The entity's id in Qloo. */
  id: string;
  /** Its name as Qloo returned it. */
  name: string;
  /** "brand", "artist", "tv show", "movie", "podcast". */
  kind: string;
  /** Its position in its own Qloo response (1 = Qloo's top pick there). */
  rank: number;
  receipt: ReceiptView;
  evidenceIds: string[];
}

export interface LaunchCreativeView {
  /** The kept concept's title (origin `creative`): the ad's name. */
  title: string;
  hook: string;
  /** The id of this cell's card in the Output section (`#${anchor}`), where its prompts are. */
  anchor: string;
  /**
   * The city the ad is set in (Qloo heatmap lift across the whole taste neighborhood), with the line
   * that says so next to the world's own city options, and its receipt. Null on the Control.
   */
  setting: { city: string; note: string; receipt: ReceiptView } | null;
}

export interface LaunchCellView {
  /** The world's segment id, or "control". */
  key: string;
  kind: "world" | "control";
  /** "Control", "World 1", "World 2". */
  name: string;
  /** The world's label (what Qloo measured), or "Generic AI brief · not from Qloo". */
  label: string;
  /** The ad set (Meta) or ad group (TikTok) name, e.g. "World 1 · 55 and older · rock and classic rock". */
  adSetName: string;
  creative: LaunchCreativeView;
  /** Where the age bands and cities come from: Qloo for a world, the generic brief for the Control. */
  optionsFrom: "qloo" | "generic";
  ageBands: LaunchOptionView[];
  cities: LaunchOptionView[];
  /** Up to LAUNCH_MAX_INTERESTS searches to try in an ads manager; always empty on the Control. */
  interests: LaunchInterestView[];
  watch: string;
  placements: string[];
}

export interface LaunchPlanView {
  /** The brand, or the product when there is no brand. */
  brand: string;
  /** The campaign every cell runs in. */
  campaign: string;
  /** The launch sheet's file name, e.g. "porchlight-pepper-co-launch-sheet.csv". */
  fileName: string;
  /** The Control first (the baseline), then each world with a kept concept, in segment order. Empty when the test cannot run. */
  cells: LaunchCellView[];
  /** Worlds that stopped before their concept: not in the test. */
  skipped: { label: string; reason: string }[];
  /** "Targeting suggestions from aggregate taste data", and that the options are optional (as the kit wrote it). */
  optionsNote: string;
  /** Why the test cannot run (no Control or no world with a concept); null when it can. */
  unavailable: string | null;
}

/** The world's demographics call when it is among the segment's receipts (the call the skew comes from), else all of them. */
function ageEvidence(ledger: Ledger, ids: readonly string[]): string[] {
  const demographics = ids.filter((id) => ledger.get(id)?.params["filter.type"] === "urn:demographics");
  return demographics.length > 0 ? demographics : [...ids];
}

function ageOptions(ledger: Ledger, buckets: readonly AgeBucket[], segment: Segment | undefined, fallbackIds: readonly string[]): LaunchOptionView[] {
  const ids = ageEvidence(ledger, segment?.evidenceIds ?? fallbackIds);
  return buckets.flatMap((bucket) => {
    const text = ageBandLabel(bucket);
    const detail = segment && segment.bucket === bucket ? skewText(segment.skew) : null;
    const receipt = receiptView(ledger, ids, "Age band", detail ? `${text}, ${detail}` : text);
    return receipt ? [{ text, detail, receipt, evidenceIds: [...new Set(ids)] }] : [];
  });
}

function cityOptions(ledger: Ledger, labels: readonly string[], cues: readonly CityCue[], fallbackIds: readonly string[]): LaunchOptionView[] {
  return [...new Set(labels)].slice(0, AD_PLAN_MAX_CITIES).flatMap((text) => {
    const cue = cues.find((c) => c.label === text);
    const ids = cue ? cue.evidenceIds : [...fallbackIds];
    const title = cue ? `${text}: #${cue.rank} of this world's cities by lift, ranked against ${cue.comparedWith} reference audiences` : text;
    const receipt = receiptView(ledger, ids, "City", title);
    return receipt ? [{ text, detail: cue ? `#${cue.rank} by lift` : null, receipt, evidenceIds: [...new Set(ids)] }] : [];
  });
}

/**
 * The world's interest searches: entities from its Culture Brief (this world's own calls, not the
 * whole audience's), people and places left out. Each type keeps Qloo's rank order, and the types
 * take turns (brand, artist, TV show, movie, podcast), so no ranks from different calls are compared
 * and no one type fills the list. Rejected items of a revision stay out.
 */
function interestOptions(ledger: Ledger, world: World): LaunchInterestView[] {
  const revision = world.revisions.findLast((r) => r.pack !== null);
  const culture = revision ? revision.culture : (world.culture ?? []);
  const excluded = new Set(revision?.excluded ?? []);
  const byType = new Map<string, CultureSource[]>(INTEREST_TYPES.map((type) => [type, []]));
  const seen = new Set<string>();
  const sources = culture
    .filter((field) => field.scope === "segment")
    .flatMap((field) => field.sources)
    .filter((source) => source.kind === "entity" && byType.has(source.type) && !excluded.has(source.id))
    .sort((a, b) => a.rank - b.rank);
  for (const source of sources) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    byType.get(source.type)!.push(source);
  }
  const lists = [...byType.values()];
  const turns = Math.max(0, ...lists.map((list) => list.length));
  const ordered = Array.from({ length: turns }, (_, i) => lists.flatMap((list) => (list[i] ? [list[i]] : []))).flat();
  return ordered
    .flatMap((source) => {
      const kind = source.type === "urn:entity:tv_show" ? "TV show" : plainType(source.type);
      const panel = source.position && source.position.of > 0 ? `, ${panelText(source.position, panelNoun(source.type))}` : "";
      const receipt = receiptView(ledger, source.evidenceIds, "Interest search", `${source.name}: #${source.rank} in Qloo's ${kind} results for this world${panel}`);
      return receipt ? [{ id: source.id, name: source.name, kind, rank: source.rank, receipt, evidenceIds: [...new Set(source.evidenceIds)] }] : [];
    })
    .slice(0, LAUNCH_MAX_INTERESTS);
}

/** The world's setting city with its receipt (no evidence, no display). */
function settingOf(ledger: Ledger, world: World): LaunchCreativeView["setting"] {
  const city = world.settingCity;
  if (!city) return null;
  const receipt = receiptView(ledger, city.evidenceIds, "Setting city", `${city.label}, #${city.audienceRank} of the taste neighborhood's cities by lift`);
  return receipt ? { city: city.label, note: settingNote(city.audienceRank), receipt } : null;
}

function worldCell(ledger: Ledger, world: World, number: number, segment: Segment | undefined): LaunchCellView | null {
  const parts = currentWorld(world);
  const concept = keptConcept(parts);
  if (!concept) return null;
  const plan = parts.kit?.adPlan ?? null;
  const planIds = plan?.evidenceIds ?? [];
  const buckets = plan ? plan.ageBands : segment ? [segment.bucket] : [];
  const cities = plan ? plan.cities : (segment?.cities ?? []).map((c) => c.label);
  const name = `World ${number}`;
  return {
    key: world.segmentId,
    kind: "world",
    name,
    label: world.label,
    adSetName: `${name} · ${world.label}`,
    creative: { title: concept.title, hook: concept.hook, anchor: outputAnchor(world.segmentId), setting: settingOf(ledger, world) },
    optionsFrom: "qloo",
    ageBands: ageOptions(ledger, buckets, segment, planIds),
    cities: cityOptions(ledger, cities, segment?.cities ?? [], planIds),
    interests: interestOptions(ledger, world),
    watch: `${hypothesisWatch(concept) ?? `Watch how "${concept.title}" does.`} ${WORLD_COMPARE}`,
    placements: [...LAUNCH_PLACEMENTS],
  };
}

function controlCell(control: Control): LaunchCellView | null {
  const concept = keptConcept(currentControl(control));
  if (!concept) return null;
  const generic = (text: string): LaunchOptionView => ({ text, detail: null, receipt: null, evidenceIds: [] });
  return {
    key: CONTROL_SEGMENT,
    kind: "control",
    name: "Control",
    label: CONTROL_CELL_LABEL,
    adSetName: "Control · generic AI brief",
    creative: { title: concept.title, hook: concept.hook, anchor: outputAnchor(CONTROL_SEGMENT), setting: null },
    optionsFrom: "generic",
    ageBands: control.assumed.ageBands.map((bucket) => generic(ageBandLabel(bucket))),
    cities: [...new Set(control.assumed.cities)].slice(0, AD_PLAN_MAX_CITIES).map(generic),
    interests: [],
    watch: CONTROL_WATCH,
    placements: [...LAUNCH_PLACEMENTS],
  };
}

function unavailableReason(control: LaunchCellView | null, hasControl: boolean, worlds: number): string | null {
  if (!hasControl) return "This run has no generic Control, so there is no baseline to test the concept worlds against.";
  if (!control) return "The generic Control stopped before its concept, so there is no baseline to test against yet.";
  if (worlds === 0) return "No concept world reached its concept, so there is nothing to test yet.";
  return null;
}

export function launchPlanView(report: Report, ledger: Ledger = ledgerOf(report)): LaunchPlanView {
  const { product } = report.inputs;
  const brand = product.brandName ?? product.name;
  const segments = new Map((report.audience.segments?.items ?? []).map((s) => [s.id, s]));
  const worlds: LaunchCellView[] = [];
  const skipped: LaunchPlanView["skipped"] = [];
  for (const world of report.worlds) {
    const cell = worldCell(ledger, world, worlds.length + 1, segments.get(world.segmentId));
    if (cell) worlds.push(cell);
    else skipped.push({ label: world.label, reason: world.partial ? `Stopped early: ${world.partial.reason}` : "No concept yet." });
  }
  const control = report.control ? controlCell(report.control) : null;
  const unavailable = unavailableReason(control, report.control !== null, worlds.length);
  const note = report.worlds.map((w) => currentWorld(w).kit?.adPlan?.note).find((n): n is string => Boolean(n));
  return {
    brand,
    campaign: `${brand} · concept world test`,
    fileName: `${fileSlug(brand)}-launch-sheet.csv`,
    cells: unavailable || !control ? [] : [control, ...worlds],
    skipped,
    optionsNote: note ?? `${AD_PLAN_NOTE} ${AD_PLAN_OPTIONAL}`,
    unavailable,
  };
}
