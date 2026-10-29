// The plan page's view model: the narrow, serializable props the store-events sections take, built
// from a recorded PlanReport (examples), a stored one (finished live runs) or the live reducer state
// (a run streaming in). Every name on screen comes from the run's own Qloo results (`local`) through
// "[[id]]" refs; every receipt comes from the run's ledger. No evidence, no receipt.
import type { Evidence } from "../../evidence";
import type { ReceiptRow, ReceiptView } from "../../report/view/types";
import type { CueOrigin } from "../../types";
import type { PlanState } from "../events";
import { splitRefs } from "../refs";
import { titleGenre } from "../words";
import { ITEM_KINDS, type ArtistRef, type Concept, type ItemKind, type Place, type PlanInputs, type PlanItem, type PlanReport, type PlanTraceStep } from "../schema";
import {
  CARRIER_LABELS,
  ITEM_KIND_LABELS,
  capitalizeFirst,
  PLACE_KIND_LABELS,
  PLAN_STAGE_LABELS,
  SETTING_LABELS,
  ageBandsText,
  cleanName,
  distanceText,
  radiusText,
  usUnits,
  eventDate,
  fictionalNotice,
  stampDate,
  timeOfDay,
  timeRange,
  usd,
} from "./format";

// --- Shapes -------------------------------------------------------------------------------------

/** A run of plain text, or a measured artist or place rendered by name with its receipt. */
export type TextPart = { kind: "text"; text: string } | { kind: "ref"; id: string; name: string; receipt: string | null };

export interface PlanHeaderView {
  storeName: string;
  carrierLabel: string;
  /** The dealer's internal store number: My stores only, never the public page. */
  storeNumber: string | null;
  /** The full address, with the city and state added when the street address leaves them out. */
  address: string;
  cityLine: string;
  dateText: string;
  /** "Sat, Nov 7". */
  dateShort: string;
  timeText: string;
  settingLabel: string;
  /** Where the event happens when it is away from the store ("Pilsen Fall Fest"). */
  venue: string | null;
  budgetText: string;
  /** The manager's own offers, word for word. */
  offers: string[];
  ageText: string;
  notes: string | null;
  provenance: "live" | "recorded" | "partial";
  /** "Oct 28, 2026": when the run was made. */
  madeOn: string | null;
  /** Set on example stores: "Fictional store. Not affiliated with or endorsed by T-Mobile." */
  fictional: string | null;
}

export interface ItemView {
  kind: ItemKind;
  kindLabel: string;
  parts: TextPart[];
  /** The line with names filled in, for copy buttons and screen readers. */
  plain: string;
  origin: CueOrigin;
  /** The line's own receipt (qloo and interpreted lines). */
  receipt: string | null;
  /** The block places the line names, with Qloo's own "why" and the distance from the store. */
  places: { id: string; name: string; distanceText: string | null; why: string | null; receipt: string | null }[];
}

export interface ConceptView {
  id: string;
  title: string;
  hook: string;
  items: ItemView[];
  scores: { criterion: string; score: number }[];
  total: number;
  /** The most a concept can score (5 per criterion). */
  max: number;
  kept: boolean;
  note: string | null;
}

export interface RunOfShowView {
  time: string;
  timeLabel: string;
  /** "12:00", "1:30": the clock without am or pm, for the timeline's time column. */
  clock: string;
  /** A short bold label when the step starts with one ("Open.", "First peak:"), else null. */
  label: string | null;
  /** The step after its label. */
  rest: TextPart[];
  parts: TextPart[];
}

export interface WheelSliceView {
  /** Slice number, clockwise from the top. */
  n: number;
  /** Printed big on the slice. */
  label: string;
  kind: "promo" | "gift_card" | "snack" | "other";
  kindLabel: string;
  parts: TextPart[];
  /** The full line, names filled in: a promo's terms exactly as the manager typed them. */
  text: string;
  origin: CueOrigin;
  receipt: string | null;
  /** For a gift card: the block place, its pin and distance. */
  place: { name: string; n: number; distanceText: string | null } | null;
}

export interface WheelView {
  slices: WheelSliceView[];
  rules: string[];
}

const WHEEL_KIND_LABELS: Readonly<Record<WheelSliceView["kind"], string>> = { promo: "Promo", gift_card: "Gift card", snack: "Snack", other: "Prize" };

export interface ShoppingView {
  item: string;
  qty: string | null;
  costText: string | null;
  /** The block partner to buy it from, with its pin number, distance and receipt. */
  from: { name: string; receipt: string | null; n: number; distanceText: string | null } | null;
  origin: CueOrigin;
  receipt: string | null;
  /** A gift card or prize for the wheel or the drawing (listed under the wheel, not the snacks). */
  prize: boolean;
  /** The estimate in dollars, for totals. */
  usd: number | null;
}

/** Something rose on a generic line: a cliche (the line is struck through) or Qloo's check of its picks. */
export interface GenericFlag {
  kind: "cliche" | "check";
  /** "Music with no local signal", or the check line. */
  label: string;
  why: string | null;
  receipt: string | null;
}

export interface GenericItemView {
  kind: ItemKind;
  kindLabel: string;
  text: string;
  /** Struck through on screen: a cliche covers this kind of line. */
  struck: boolean;
  /** Said once, on the first line of its kind. */
  flags: GenericFlag[];
}

/** One kind of line (music, food...) with the Stoop plan's lines beside the generic plan's. */
export interface CompareRow {
  kind: ItemKind;
  kindLabel: string;
  stoop: ItemView[];
  generic: GenericItemView[];
}

export interface GenericView {
  items: GenericItemView[];
  /** The kept concept and the generic plan, kind by kind, in ITEM_KINDS order. */
  rows: CompareRow[];
  cliches: { text: string; why: string }[];
  /** Cliches about the plan as a whole ("No place on this block"), not one kind of line. */
  planCliches: { text: string; why: string }[];
  /** "4 of 7 checkable picks sit below this city's reference median (2 unverifiable)", with its receipt. */
  check: { line: string; receipt: string | null } | null;
}

export interface ComparisonView {
  /** "9 of 11 plan lines have a Qloo receipt". */
  backedLine: string;
  clichesLine: string;
  /** Written by the pipeline, shown verbatim. */
  lines: string[];
}

export interface ArtistView {
  id: string;
  name: string;
  rank: number;
  receipt: string | null;
}

export interface PlaceView {
  id: string;
  name: string;
  kind: Place["kind"];
  kindLabel: string;
  /** A national chain: fine for gift cards and snack runs, marked quietly. */
  chain: boolean;
  /** Its pin number: places numbered by distance from the store, nearest first. */
  n: number;
  distanceM: number | null;
  /** Qloo's coordinates, for the block map. */
  point: { lat: number; lon: number } | null;
  address: string | null;
  distanceText: string | null;
  /** Qloo's own explainability, shown as is. */
  why: string | null;
  receipt: string | null;
}

export interface LocalView {
  /** The city's artists by rank. Genre tags are never shown: no event or crowd is labeled by genre. */
  city: { name: string; ageText: string; artists: ArtistView[] } | null;
  block: {
    radiusText: string;
    radiusM: number;
    /** The map's center: the event's own place when it is away from the store, else the store. */
    center: { lat: number; lon: number; label: string };
    /** Places by distance, nearest first (their pin numbers). */
    places: PlaceView[];
  } | null;
  /** Music the block's own places point to, shown only when the plan uses it. */
  blockMusic: { places: { name: string; receipt: string | null }[]; artists: { name: string; receipt: string | null }[] } | null;
  gaps: string[];
}

export interface MarketingView {
  poster: {
    status: PlanReport["poster"]["status"];
    /** The full portrait poster (the Poster step, downloads). */
    src: string | null;
    /** A 360 px WebP for lists, and a 720 px one for the event page. */
    thumb: string | null;
    medium: string | null;
    alt: string;
    reason: string | null;
  };
  posts: {
    facebook: string;
    instagram: string;
    hashtags: string[];
    whatsapp: string;
    share: { facebook: string | null; whatsapp: string | null };
  } | null;
  /** The public event page people open from a post. */
  eventPath: string;
}

export interface ResultView {
  loggedOn: string;
  walkIns: number | null;
  sales: number | null;
  postedOn: string[];
  notes: string | null;
}

export interface PlanTraceRow {
  key: string;
  stage: string;
  stageLabel: string;
  startsGroup: boolean;
  kind: PlanTraceStep["kind"];
  label: string;
  reason: string | null;
  served: "cached" | "live" | null;
  world: null;
  evidenceId: string | null;
}

/** One of the four tiles on the first screen: what to do, in a word or two. */
export interface TileView {
  key: "music" | "snacks" | "wheel" | "post";
  label: string;
  value: string;
  note: string | null;
  /** Qloo picked it (the tile says so in text). */
  qloo: boolean;
  /** Where the tile goes on the page. */
  href: string;
}

export interface PlanView {
  /** A live run id, or "ex-<slug>" for an example. */
  id: string;
  kind: "live" | "example";
  header: PlanHeaderView;
  concept: ConceptView | null;
  alternatives: ConceptView[];
  runOfShow: RunOfShowView[];
  shopping: ShoppingView[];
  /** "About $120 of a $150 budget". */
  costLine: string | null;
  /** "$198": the estimated total of the shopping list. */
  shoppingTotal: string | null;
  checklist: TextPart[][];
  /** The physical prize wheel at the table: what goes on each slice, and the rules. */
  wheel: WheelView | null;
  generic: GenericView | null;
  comparison: ComparisonView | null;
  local: LocalView;
  /** Block places the plan uses (named in a line or bought from), Qloo ids. */
  partnerIds: string[];
  /** How the plan uses each of those places: "Snacks", "Partner", "Gift card". */
  placeUses: Record<string, string[]>;
  marketing: MarketingView;
  results: ResultView[];
  trace: PlanTraceRow[];
  /** Qloo calls the trace made: live and from cache. */
  calls: { live: number; cached: number };
  /** The first screen's four tiles: music, snacks, the wheel, posting. */
  tiles: TileView[];
  /** Every receipt on the page, sent once and looked up by key. */
  receipts: Record<string, ReceiptView>;
  partial: { stageLabel: string; reason: string } | null;
}

/** What a plan view is built from: a whole report, or the live state once its inputs arrived. */
export interface PlanSource {
  id: string;
  kind: "live" | "example";
  createdAt: string | null;
  provenance: "live" | "recorded" | "partial";
  inputs: PlanInputs;
  report: Omit<PlanReport, "version" | "meta" | "inputs">;
}

export function sourceFromReport(report: PlanReport, id: string = report.meta.id): PlanSource {
  const { meta, inputs, ...withVersion } = report;
  const rest: PlanSource["report"] = { ...withVersion };
  delete (rest as Partial<PlanReport>).version;
  return { id, kind: meta.kind, createdAt: meta.createdAt, provenance: meta.provenance, inputs, report: rest };
}

/** The live state as a source, or null before the run's inputs arrive. */
export function sourceFromState(state: PlanState, id: string): PlanSource | null {
  const { inputs, ...rest } = state.report;
  if (!inputs) return null;
  const provenance = state.status === "partial" || rest.partial ? "partial" : state.kind === "example" ? "recorded" : "live";
  return { id, kind: state.kind ?? "live", createdAt: state.createdAt, provenance, inputs, report: rest };
}

// --- Receipts -----------------------------------------------------------------------------------

type Ledger = ReadonlyMap<string, Evidence>;

function callRows(entry: Evidence): ReceiptRow[] {
  const rows: ReceiptRow[] = [{ label: "Endpoint", value: entry.endpoint, mono: true }];
  const type = entry.params["filter.type"];
  if (type) rows.push({ label: "Asked for", value: type, mono: true });
  const query = Object.entries(entry.params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  if (query) rows.push({ label: "Query", value: query, mono: true });
  rows.push({ label: "Served", value: `${entry.cached ? "From cache, fetched" : "Fetched from Qloo"} ${stampDate(entry.fetchedAt)}` });
  if (entry.status !== 200) rows.push({ label: "Status", value: `HTTP ${entry.status}`, mono: true });
  return rows;
}

/** The calls behind a fact, each introduced by what it did when there is more than one. */
function ledgerRows(ledger: Ledger, ids: readonly string[], callLabels = true): ReceiptRow[] | null {
  const entries = [...new Set(ids)].map((id) => ledger.get(id)).filter((e): e is Evidence => Boolean(e));
  if (entries.length === 0) return null;
  return entries.flatMap((entry, i) => {
    // A place's own receipt leaves out the search's label ("Finding food spots"): Qloo sorts what it
    // finds by its own tags, so a venue can come back from a food search. The query stays, under
    // the receipt's technical details.
    const head: ReceiptRow[] = !callLabels
      ? entries.length === 1
        ? []
        : [{ label: `Call ${i + 1} of ${entries.length}`, value: entry.endpoint, mono: true }]
      : entries.length === 1
        ? entry.label
          ? [{ label: "Call", value: usUnits(entry.label) }]
          : []
        : [{ label: `Call ${i + 1} of ${entries.length}`, value: usUnits(entry.label ?? entry.endpoint) }];
    return [...head, ...callRows(entry)];
  });
}

const rankText = (rank: number) => `#${rank} in its response`;

function artistRows(artist: ArtistRef): ReceiptRow[] {
  // Genres stay out: an event, a crowd or a block is never labeled by a music genre.
  return [{ label: "Qloo pick", value: `${artist.name} (artist, ${rankText(artist.rank)})` }];
}

function placeRows(place: Place): ReceiptRow[] {
  const rows: ReceiptRow[] = [
    { label: "Qloo pick", value: `${place.name} (${PLACE_KIND_LABELS[place.kind].toLowerCase()}, ${rankText(place.rank)})` },
    { label: "Found by", value: "Qloo's places near the store, sorted by Qloo's own tags" },
  ];
  if (place.why) rows.push({ label: "Why", value: place.why });
  if (place.distanceM !== null) rows.push({ label: "Distance", value: `${distanceText(place.distanceM)} from the store` });
  if (place.address) rows.push({ label: "Address", value: place.address });
  return rows;
}

// --- The builder --------------------------------------------------------------------------------

/**
 * The kind of line a cliche is about ("Music with no local signal" is music, "Generic store-bought
 * snacks" is food), or null for one about the plan as a whole ("No place on this block").
 */
export function clicheKind(text: string): ItemKind | null {
  const t = text.toLowerCase();
  if (/\b(music|playlist|dj|song|speaker)\b/.test(t)) return "music";
  if (/\b(snack|snacks|food|drink|drinks|pizza|candy|chips)\b/.test(t)) return "food";
  if (/\b(balloon|balloons|banner|sign|signs|signage)\b/.test(t)) return "signage";
  if (/\b(giveaway|giveaways|raffle|drawing|swag|free phone)\b/.test(t)) return "giveaway";
  if (/\b(game|games|activity|trivia|spin)\b/.test(t)) return "activity";
  return null;
}

export function planView(source: PlanSource): PlanView {
  const { id, inputs, report } = source;
  const ledger: Ledger = new Map(report.ledger.map((e) => [e.id, e]));
  const receipts: Record<string, ReceiptView> = {};
  // The city's artists, and the block's when the plan uses them ("People who love a place also play...").
  const artists = new Map<string, ArtistRef>([...(report.local.city?.artists ?? []), ...(report.local.blockMusic?.artists ?? [])].map((a) => [a.id, a]));
  const blockPlaces = (report.local.block?.places ?? []).map((p) => ({ ...p, name: cleanName(p.name) }));
  const places = new Map(blockPlaces.map((p) => [p.id, p]));

  // Places numbered by distance from the store, nearest first: the block map's pins and every badge.
  const byDistance = [...blockPlaces].sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || a.rank - b.rank);
  const pinOf = new Map(byDistance.map((p, i) => [p.id, i + 1]));

  /** Registers a receipt once under `key`; null when none of its ids is in the ledger. */
  const receipt = (key: string, ids: readonly string[], cue: string, title: string, lead: ReceiptRow[] = [], callLabels = true): string | null => {
    if (receipts[key]) return key;
    const rows = ledgerRows(ledger, ids, callLabels);
    if (!rows) return null;
    receipts[key] = { cue, title, rows: [...lead, ...rows], calls: new Set(ids.filter((i) => ledger.has(i))).size };
    return key;
  };
  const artistReceipt = (a: ArtistRef) => receipt(`artist:${a.id}`, a.evidenceIds, "Playlist", a.name, artistRows(a));
  const placeReceipt = (p: Place) => receipt(`place:${p.id}`, p.evidenceIds, "The community", p.name, placeRows(p), false);

  const nameOf = (refId: string): { name: string; receipt: string | null } | null => {
    const artist = artists.get(refId);
    if (artist) return { name: artist.name, receipt: artistReceipt(artist) };
    const place = places.get(refId);
    if (place) return { name: place.name, receipt: placeReceipt(place) };
    return null;
  };
  /** Text with "[[id]]" tokens as parts; an unknown id reads "a local spot", never the id. */
  const parts = (text: string): TextPart[] =>
    splitRefs(text).map((part) => {
      if (part.kind === "text") return part;
      const known = nameOf(part.id);
      return known ? { kind: "ref", id: part.id, name: known.name, receipt: known.receipt } : { kind: "text", text: "a local spot" };
    });
  const plain = (ps: readonly TextPart[]) => ps.map((p) => (p.kind === "text" ? p.text : p.name)).join("");

  const item = (conceptId: string, it: PlanItem, i: number): ItemView => {
    const ps = parts(it.text);
    const text = plain(ps);
    const lead = it.refs.flatMap((ref) => {
      const a = artists.get(ref);
      if (a) return artistRows(a);
      const p = places.get(ref);
      return p ? placeRows(p) : [];
    });
    const backed = it.origin === "qloo" || it.origin === "interpreted";
    const named = it.refs.flatMap((ref) => {
      const p = places.get(ref);
      return p ? [{ id: p.id, name: p.name, distanceText: p.distanceM === null ? null : distanceText(p.distanceM), why: p.why, receipt: placeReceipt(p) }] : [];
    });
    return {
      kind: it.kind,
      kindLabel: ITEM_KIND_LABELS[it.kind],
      parts: ps,
      plain: text,
      origin: it.origin,
      receipt: backed ? receipt(`item:${conceptId}:${i}`, it.evidenceIds, ITEM_KIND_LABELS[it.kind], text, lead) : null,
      places: named,
    };
  };
  const concept = (c: Concept): ConceptView => ({
    id: c.id,
    title: c.title,
    hook: c.hook,
    items: c.items.map((it, i) => item(c.id, it, i)),
    scores: c.scores,
    total: c.total,
    max: c.scores.length * 5,
    kept: c.kept,
    note: c.note ?? null,
  });

  const plan = report.plan;
  const kept = plan ? (plan.concepts.find((c) => c.id === plan.conceptId) ?? plan.concepts.find((c) => c.kept) ?? null) : null;

  const shopping: ShoppingView[] = (plan?.shopping ?? []).map((s, i) => {
    const partner = s.from ? places.get(s.from) : undefined;
    const backed = s.origin === "qloo" || s.origin === "interpreted";
    return {
      item: plain(parts(s.item)),
      qty: s.qty ?? null,
      costText: s.estUsd === undefined ? null : usd(s.estUsd),
      from: partner ? { name: partner.name, receipt: placeReceipt(partner), n: pinOf.get(partner.id) ?? 0, distanceText: partner.distanceM === null ? null : distanceText(partner.distanceM) } : null,
      origin: s.origin,
      receipt: backed ? receipt(`shop:${i}`, s.evidenceIds, "Shopping list", plain(parts(s.item)), partner ? placeRows(partner) : []) : null,
      prize: /\b(gift ?cards?|prizes?|raffle|drawing)\b/i.test(s.item),
      usd: s.estUsd ?? null,
    };
  });

  const baseline = report.baseline;
  const checkLine = baseline?.check
    ? baseline.check.checkable === 0
      ? "Qloo could not check any of the generic plan's music or food picks against this city."
      : `${baseline.check.belowMedian} of ${baseline.check.checkable} checkable picks sit below ${inputs.store.city}'s median${
          baseline.check.unverifiable > 0 ? ` (${baseline.check.unverifiable} unverifiable)` : ""
        }.`
    : null;
  const checkReceipt = baseline?.check ? receipt("generic-check", baseline.check.evidenceIds, "Generic AI plan, checked with Qloo", "The generic plan's picks, scored against this city") : null;
  if (checkReceipt) receipts[checkReceipt] = { ...receipts[checkReceipt]!, subject: "generic" };
  const cliches = (baseline?.cliches ?? []).map((c) => ({ text: usUnits(c.text), why: usUnits(c.why) }));
  const byKind = new Map<ItemKind, { text: string; why: string }[]>();
  for (const c of cliches) {
    const kind = clicheKind(c.text);
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), c]);
  }
  const flaggedKinds = new Set<ItemKind>();
  const genericItems: GenericItemView[] = (baseline?.items ?? []).map((it) => {
    const text = plain(parts(it.text));
    const hits = byKind.get(it.kind) ?? [];
    const first = !flaggedKinds.has(it.kind);
    if (hits.length > 0) flaggedKinds.add(it.kind);
    const flags: GenericFlag[] = first ? hits.map((c) => ({ kind: "cliche", label: c.text, why: c.why, receipt: it.kind === "music" ? checkReceipt : null })) : [];
    return { kind: it.kind, kindLabel: ITEM_KIND_LABELS[it.kind], text, struck: hits.length > 0, flags };
  });
  // Qloo's check of the generic picks, said once on the first music line when no cliche already says it.
  if (checkLine && baseline?.check && baseline.check.belowMedian > 0 && !byKind.has("music")) {
    const music = genericItems.find((g) => g.kind === "music") ?? genericItems.find((g) => g.kind === "food");
    music?.flags.push({ kind: "check", label: `Qloo check: ${checkLine}`, why: null, receipt: checkReceipt });
  }
  const generic: GenericView | null = baseline
    ? {
        items: genericItems,
        rows: [],
        cliches: cliches.map((c) => ({ text: c.text, why: c.why })),
        planCliches: cliches.filter((c) => clicheKind(c.text) === null || !genericItems.some((g) => g.kind === clicheKind(c.text))).map((c) => ({ text: c.text, why: c.why })),
        check: baseline.check && checkLine ? { line: checkLine, receipt: checkReceipt } : null,
      }
    : null;

  const comparison = report.comparison
    ? {
        backedLine: `${report.comparison.qlooBacked.items} of ${report.comparison.qlooBacked.of} plan lines have a Qloo receipt`,
        clichesLine: report.comparison.baselineCliches === 1 ? "1 cliché flagged in the generic plan" : `${report.comparison.baselineCliches} clichés flagged in the generic plan`,
        lines: report.comparison.lines.map(usUnits),
      }
    : null;

  const city = report.local.city;
  const block = report.local.block;
  const local: LocalView = {
    city: city
      ? {
          name: city.city,
          ageText: ageBandsText(city.ageBands),
          artists: city.artists.map((a) => ({ id: a.id, name: a.name, rank: a.rank, receipt: artistReceipt(a) })),
        }
      : null,
    block: block
      ? {
          radiusText: radiusText(block.radiusM),
          radiusM: block.radiusM,
          center: inputs.location ? { ...inputs.location.point, label: "The event" } : { ...inputs.store.point, label: "Your store" },
          places: byDistance.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            kindLabel: PLACE_KIND_LABELS[p.kind],
            chain: p.chain === true,
            n: pinOf.get(p.id) ?? 0,
            distanceM: p.distanceM,
            point: p.point ?? null,
            address: p.address,
            distanceText: p.distanceM === null ? null : distanceText(p.distanceM),
            why: p.why,
            receipt: placeReceipt(p),
          })),
        }
      : null,
    blockMusic:
      report.local.blockMusic?.used && report.local.blockMusic.artists.length > 0
        ? {
            places: report.local.blockMusic.placeIds.flatMap((id) => {
              const p = places.get(id);
              return p ? [{ name: p.name, receipt: placeReceipt(p) }] : [];
            }),
            artists: report.local.blockMusic.artists.map((a) => ({ name: a.name, receipt: artistReceipt(a) })),
          }
        : null,
    gaps: report.local.gaps,
  };

  // The poster route draws a poster for any plan with a concept (every word set by code, the art when there is one).
  const marketing = marketingView(id, inputs.store.name, report.poster, report.posts, Boolean(report.plan?.concepts.length));

  const trace = traceRows(report.trace);
  const calls = { live: 0, cached: 0 };
  for (const step of report.trace) if (step.kind === "tool") calls[step.cached ? "cached" : "live"]++;

  const { store } = inputs;
  const keptView = kept ? concept(kept) : null;
  const partnerId = plan?.shopping.find((x) => x.from && places.has(x.from))?.from;
  const partnerPlace = partnerId ? places.get(partnerId) : undefined;
  const tiles = tileViews(keptView, plan?.wheel ? plan.wheel.slices.length : 0, marketing, partnerPlace ? { name: partnerPlace.name, distanceText: partnerPlace.distanceM === null ? null : distanceText(partnerPlace.distanceM) } : null);
  if (generic) generic.rows = compareRows(keptView?.items ?? [], generic.items);
  return {
    id,
    kind: source.kind,
    header: {
      storeName: store.name,
      carrierLabel: CARRIER_LABELS[store.carrier],
      storeNumber: store.storeNumber ?? null,
      address: fullAddress(store),
      cityLine: `${store.city}, ${store.region}`,
      dateText: eventDate(inputs.date),
      dateShort: eventDate(inputs.date, "short"),
      timeText: timeRange(inputs.startTime, inputs.durationMinutes),
      settingLabel: SETTING_LABELS[inputs.setting],
      venue: inputs.location ? capitalizeFirst(inputs.location.name) : null,
      budgetText: `${usd(inputs.budgetUsd)} budget`,
      offers: inputs.offers.map((o) => o.text),
      ageText: ageBandsText(inputs.ageBands),
      notes: inputs.notes?.trim() || null,
      provenance: source.provenance,
      madeOn: source.createdAt ? stampDate(source.createdAt) : null,
      fictional: source.kind === "example" ? fictionalNotice(store.carrier) : null,
    },
    concept: keptView,
    alternatives: plan && kept ? plan.concepts.filter((c) => c.id !== kept.id).map(concept) : [],
    runOfShow: (plan?.runOfShow ?? []).map((s) => {
      const all = parts(s.step);
      const { label, rest } = stepLabel(all);
      const [h, m] = s.time.split(":").map(Number) as [number, number];
      const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
      return { time: s.time, timeLabel: timeOfDay(s.time), clock, label, rest, parts: all };
    }),
    shopping,
    costLine: plan && plan.shopping.length > 0 ? `About ${usd(plan.estimatedCostUsd)} of a ${usd(inputs.budgetUsd)} budget, bought in the community where Qloo found a partner.` : null,
    shoppingTotal: plan && plan.shopping.length > 0 ? usd(plan.estimatedCostUsd) : null,
    checklist: (plan?.checklist ?? []).map(parts),
    wheel: plan?.wheel
      ? {
          slices: plan.wheel.slices.map((slice, i) => {
            const textParts = parts(slice.text);
            const backed = slice.origin === "qloo" || slice.origin === "interpreted";
            const place = slice.refs.map((r) => places.get(r)).find((p): p is Place => Boolean(p));
            return {
              n: i + 1,
              label: plain(parts(slice.label)),
              kind: slice.kind,
              kindLabel: WHEEL_KIND_LABELS[slice.kind],
              parts: textParts,
              text: plain(textParts),
              origin: slice.origin,
              receipt: backed ? receipt(`wheel:${i}`, slice.evidenceIds, "Prize wheel", plain(textParts), place ? placeRows(place) : []) : null,
              place: place ? { name: place.name, n: pinOf.get(place.id) ?? 0, distanceText: place.distanceM === null ? null : distanceText(place.distanceM) } : null,
            };
          }),
          rules: plan.wheel.rules,
        }
      : null,
    generic,
    comparison,
    local,
    placeUses: placeUsesOf(kept, plan, places),
    partnerIds: [...new Set([...(kept?.items.flatMap((i) => i.refs.filter((r) => places.has(r))) ?? []), ...(plan?.shopping.flatMap((s) => (s.from ? [s.from] : [])) ?? [])])],
    marketing,
    results: report.results.map((r) => ({
      loggedOn: stampDate(r.loggedAt),
      walkIns: r.walkIns,
      sales: r.sales,
      postedOn: (["facebook", "instagram", "whatsapp"] as const).filter((c) => r.posted[c]).map((c) => CHANNEL_LABELS[c]),
      notes: r.notes ?? null,
    })),
    trace,
    calls,
    tiles,
    receipts,
    partial: report.partial ? { stageLabel: PLAN_STAGE_LABELS[report.partial.stage], reason: report.partial.reason } : null,
  };
}

export const CHANNEL_LABELS = { facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp" } as const;

/** Lane C's poster route: 1080 by 1350, or 1200 by 630 with `og`. */
export function posterRoute(id: string, size?: "og" | "thumb" | "medium"): string {
  return `/api/plan/${encodeURIComponent(id)}/marketing/poster.png${size ? `?size=${size}` : ""}`;
}

/** The poster and the posts as the marketing section shows them (also used after "Generate poster and posts"). */
export function marketingView(id: string, storeName: string, poster: PlanReport["poster"], posts: PlanReport["posts"], hasPlan = true): MarketingView {
  return {
    poster: {
      status: poster.status,
      src: poster.status === "ready" && poster.url ? poster.url : hasPlan ? posterRoute(id) : null,
      thumb: poster.status === "ready" && poster.url ? poster.url : hasPlan ? posterRoute(id, "thumb") : null,
      medium: poster.status === "ready" && poster.url ? poster.url : hasPlan ? posterRoute(id, "medium") : null,
      alt: poster.alt || `Event poster for ${storeName}`,
      reason: poster.reason ?? null,
    },
    posts: posts
      ? {
          facebook: posts.facebook.text,
          instagram: posts.instagram.caption,
          hashtags: posts.instagram.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)),
          whatsapp: posts.whatsapp.text,
          share: { facebook: posts.share.facebook ?? null, whatsapp: posts.share.whatsapp ?? null },
        }
      : null,
    eventPath: `/e/${encodeURIComponent(id)}`,
  };
}

/** Facebook's share dialog for a page, and a WhatsApp message that ends with the page's link. */
export function shareLinks(eventUrl: string, whatsappText: string): { facebook: string; whatsapp: string } {
  const text = whatsappText.includes(eventUrl) ? whatsappText : `${whatsappText.trim()}\n${eventUrl}`;
  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}

const isQloo = (item: ItemView | undefined) => item?.origin === "qloo" || item?.origin === "interpreted";

const USE_LABELS: Partial<Record<ItemKind, string>> = { food: "Snacks", partner: "Partner", venue: "Venue", giveaway: "Giveaway", activity: "Activity", music: "Music" };

/** How the kept plan uses each block place, in words ("Snacks", "Gift card"). */
function placeUsesOf(kept: Concept | null, plan: PlanReport["plan"], places: ReadonlyMap<string, Place>): Record<string, string[]> {
  const uses: Record<string, string[]> = {};
  const add = (id: string, label: string) => {
    if (!places.has(id)) return;
    const list = (uses[id] ??= []);
    if (!list.includes(label)) list.push(label);
  };
  for (const item of kept?.items ?? []) for (const ref of item.refs) add(ref, USE_LABELS[item.kind] ?? ITEM_KIND_LABELS[item.kind]);
  for (const s of plan?.shopping ?? []) if (s.from) add(s.from, "Shopping");
  for (const slice of plan?.wheel?.slices ?? []) for (const ref of slice.refs) add(ref, slice.kind === "gift_card" ? "Gift card" : "Prize wheel");
  return uses;
}

/** The first screen's tiles, from the kept concept, the wheel and the marketing state. */
export function tileViews(concept: ConceptView | null, wheelSlices: number, marketing: MarketingView, partner: { name: string; distanceText: string | null } | null = null): TileView[] {
  const items = concept?.items ?? [];
  const music = items.find((i) => i.kind === "music");
  const musicNames = music?.parts.flatMap((p) => (p.kind === "ref" ? [p.name] : [])) ?? [];
  const snack = items.find((i) => (i.kind === "food" || i.kind === "partner") && i.places.length > 0) ?? items.find((i) => i.kind === "food");
  // A named place in a food line first, else the block partner the shopping list buys from.
  const place = snack?.places[0] ?? partner ?? undefined;
  const giveaway = items.find((i) => i.kind === "giveaway");
  const posts = marketing.posts;
  return [
    { key: "music", label: "Playlist", value: musicNames.length ? musicNames.slice(0, 3).join(", ") : (music?.plain ?? "Your playlist"), note: null, qloo: isQloo(music), href: "#event" },
    {
      key: "snacks",
      label: "Snacks",
      value: place ? place.name : (snack?.plain ?? "Not in this plan"),
      note: place?.distanceText ? `${place.distanceText} away` : null,
      qloo: Boolean(place) || isQloo(snack),
      href: "#shopping",
    },
    wheelSlices > 0
      ? { key: "wheel", label: "Prize wheel", value: `${wheelSlices} slices`, note: "For your wheel", qloo: false, href: "#wheel" }
      : { key: "wheel", label: "Giveaway", value: giveaway?.plain ?? "Your pick", note: null, qloo: isQloo(giveaway), href: "#event" },
    {
      key: "post",
      label: "Post it",
      value: posts ? "Poster and 3 posts" : marketing.poster.src ? "Poster ready" : "Make the poster",
      note: posts ? "Facebook, Instagram, WhatsApp" : null,
      qloo: false,
      href: "#posts",
    },
  ];
}

/**
 * A trace step's "why", safe to show: the tags Stoop left out are counted, never listed (their names
 * include identity terms and genres), and a reason that quotes words or names a genre is left out.
 */
export function safeReason(label: string, reason: string | undefined): string | null {
  const r = reason?.trim();
  if (!r) return null;
  if (/^Left out \d+ identity tags?/i.test(label)) return "Each describes who people are, not what they play. Stoop reads taste, never identity.";
  if (/^Left out \d+ .*tags?/i.test(label)) return "Not a style to play, or not the city's own.";
  if (r.includes('"') || r.includes("\u201c") || titleGenre(r)) return null;
  return r;
}

/** A line safe to show beside the plan: a genre-led generic line is said as what it is. */
export function noGenre(text: string): string {
  return titleGenre(text) ? "Names a music genre, no local signal" : text;
}

/** "1240 W 18th St, Chicago, IL 60608" as typed, or the street with ", Chicago, IL" added when it leaves the city out. */
export function fullAddress(store: Pick<PlanInputs["store"], "address" | "city" | "region">): string {
  return store.address.toLowerCase().includes(store.city.toLowerCase()) ? store.address : `${store.address}, ${store.city}, ${store.region}`;
}

/** The trace as one-line rows, the stage named above each run of steps (the shape TraceList renders). */
export function traceRows(steps: readonly PlanTraceStep[]): PlanTraceRow[] {
  return steps.map((step, i) => ({
    key: String(i),
    stage: step.stage,
    stageLabel: PLAN_STAGE_LABELS[step.stage],
    startsGroup: i === 0 || steps[i - 1]!.stage !== step.stage,
    kind: step.kind,
    label: titleGenre(step.label) ? "Checked a step that named a music genre" : usUnits(step.label),
    reason: ((r) => (r ? usUnits(r) : r))(safeReason(step.label, step.reason)),
    served: step.kind === "tool" ? (step.cached ? "cached" : "live") : null,
    world: null,
    evidenceId: step.evidenceId ?? null,
  }));
}

/**
 * The two plans side by side, one row per kind of line (theme, music, food...), in ITEM_KINDS order.
 * A kind only one plan has still gets its row, with the other side empty.
 */
export function compareRows(stoop: readonly ItemView[], generic: readonly GenericItemView[]): CompareRow[] {
  return ITEM_KINDS.flatMap((kind) => {
    const group = COMPARE_GROUPS[kind];
    if (group === null) return [];
    const kinds = new Set<ItemKind>([kind, ...group]);
    const s = stoop.filter((i) => kinds.has(i.kind));
    const g = generic.filter((i) => kinds.has(i.kind));
    const label = group.length > 0 ? COMPARE_LABELS[kind] ?? ITEM_KIND_LABELS[kind] : ITEM_KIND_LABELS[kind];
    return s.length || g.length ? [{ kind, kindLabel: label, stoop: s, generic: g }] : [];
  });
}

/** Kinds compared on one row: food sits with the block partners and venues it comes from. null: shown on another kind's row. */
const COMPARE_GROUPS: Readonly<Record<ItemKind, readonly ItemKind[] | null>> = {
  theme: [],
  music: [],
  food: ["partner", "venue"],
  partner: null,
  venue: null,
  giveaway: [],
  activity: [],
  setup: [],
  signage: [],
  timing: [],
};
const COMPARE_LABELS: Partial<Record<ItemKind, string>> = { food: "Food and partners" };

/**
 * A timeline step's short label: its first clause when that is a few words ending in "." or ":"
 * ("Open.", "First peak:"). Else no label, and the whole step reads as one line.
 */
export function stepLabel(stepParts: readonly TextPart[]): { label: string | null; rest: TextPart[] } {
  const first = stepParts[0];
  if (!first || first.kind !== "text") return { label: null, rest: [...stepParts] };
  const m = /^\s*([^.:]{1,24}?)[.:]\s+([\s\S]*)$/.exec(first.text);
  if (!m || m[1]!.trim().split(/\s+/).length > 3) return { label: null, rest: [...stepParts] };
  const after = m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1) : "";
  const rest: TextPart[] = [...(after ? [{ kind: "text" as const, text: after }] : []), ...stepParts.slice(1)];
  return { label: m[1]!.trim(), rest };
}
