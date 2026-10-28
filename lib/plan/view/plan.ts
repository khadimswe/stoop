// The plan page's view model: the narrow, serializable props the store-events sections take, built
// from a recorded PlanReport (examples), a stored one (finished live runs) or the live reducer state
// (a run streaming in). Every name on screen comes from the run's own Qloo results (`local`) through
// "[[id]]" refs; every receipt comes from the run's ledger. No evidence, no receipt.
import type { Evidence } from "../../evidence";
import type { ReceiptRow, ReceiptView } from "../../report/view/types";
import type { CueOrigin } from "../../types";
import type { PlanState } from "../events";
import { splitRefs } from "../refs";
import { ITEM_KINDS, type ArtistRef, type Concept, type ItemKind, type Place, type PlanInputs, type PlanItem, type PlanReport, type PlanTraceStep } from "../schema";
import {
  CARRIER_LABELS,
  ITEM_KIND_LABELS,
  PLACE_KIND_LABELS,
  PLAN_STAGE_LABELS,
  SETTING_LABELS,
  ageBandsText,
  distanceText,
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
  /** The block partner to buy it from, with its receipt. */
  from: { name: string; receipt: string | null } | null;
  origin: CueOrigin;
  receipt: string | null;
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
  genres: string[];
  receipt: string | null;
}

export interface PlaceView {
  id: string;
  name: string;
  kindLabel: string;
  tags: string[];
  address: string | null;
  distanceText: string | null;
  /** Qloo's own explainability, shown as is. */
  why: string | null;
  receipt: string | null;
}

export interface LocalView {
  city: { name: string; ageText: string; artists: ArtistView[]; styles: { name: string; receipt: string | null }[] } | null;
  block: { radiusText: string; places: PlaceView[] } | null;
  gaps: string[];
}

export interface MarketingView {
  poster: { status: PlanReport["poster"]["status"]; src: string | null; alt: string; reason: string | null };
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
function ledgerRows(ledger: Ledger, ids: readonly string[]): ReceiptRow[] | null {
  const entries = [...new Set(ids)].map((id) => ledger.get(id)).filter((e): e is Evidence => Boolean(e));
  if (entries.length === 0) return null;
  return entries.flatMap((entry, i) => {
    const head: ReceiptRow[] =
      entries.length === 1 ? (entry.label ? [{ label: "Call", value: entry.label }] : []) : [{ label: `Call ${i + 1} of ${entries.length}`, value: entry.label ?? entry.endpoint }];
    return [...head, ...callRows(entry)];
  });
}

const rankText = (rank: number) => `#${rank} in its response`;

function artistRows(artist: ArtistRef): ReceiptRow[] {
  const rows: ReceiptRow[] = [{ label: "Qloo pick", value: `${artist.name} (artist, ${rankText(artist.rank)})` }];
  if (artist.genres.length > 0) rows.push({ label: "Genres", value: artist.genres.join(", ") });
  return rows;
}

function placeRows(place: Place): ReceiptRow[] {
  const rows: ReceiptRow[] = [{ label: "Qloo pick", value: `${place.name} (${PLACE_KIND_LABELS[place.kind].toLowerCase()}, ${rankText(place.rank)})` }];
  if (place.why) rows.push({ label: "Why", value: place.why });
  if (place.distanceM !== null) rows.push({ label: "Distance", value: `${distanceText(place.distanceM)} from the store` });
  if (place.address) rows.push({ label: "Address", value: place.address });
  if (place.tags.length > 0) rows.push({ label: "Tags", value: place.tags.join(", ") });
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
  const artists = new Map((report.local.city?.artists ?? []).map((a) => [a.id, a]));
  const places = new Map((report.local.block?.places ?? []).map((p) => [p.id, p]));

  /** Registers a receipt once under `key`; null when none of its ids is in the ledger. */
  const receipt = (key: string, ids: readonly string[], cue: string, title: string, lead: ReceiptRow[] = []): string | null => {
    if (receipts[key]) return key;
    const rows = ledgerRows(ledger, ids);
    if (!rows) return null;
    receipts[key] = { cue, title, rows: [...lead, ...rows], calls: new Set(ids.filter((i) => ledger.has(i))).size };
    return key;
  };
  const artistReceipt = (a: ArtistRef) => receipt(`artist:${a.id}`, a.evidenceIds, "City music", a.name, artistRows(a));
  const placeReceipt = (p: Place) => receipt(`place:${p.id}`, p.evidenceIds, "The block", p.name, placeRows(p));

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
      from: partner ? { name: partner.name, receipt: placeReceipt(partner) } : null,
      origin: s.origin,
      receipt: backed ? receipt(`shop:${i}`, s.evidenceIds, "Shopping list", plain(parts(s.item)), partner ? placeRows(partner) : []) : null,
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
  const cliches = baseline?.cliches ?? [];
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
        lines: report.comparison.lines,
      }
    : null;

  const city = report.local.city;
  const block = report.local.block;
  const local: LocalView = {
    city: city
      ? {
          name: city.city,
          ageText: ageBandsText(city.ageBands),
          artists: city.artists.map((a) => ({ id: a.id, name: a.name, rank: a.rank, genres: a.genres, receipt: artistReceipt(a) })),
          styles: city.styles.map((s) => ({ name: s.name, receipt: receipt(`style:${s.tagId}`, s.evidenceIds, "City music", s.name) })),
        }
      : null,
    block: block
      ? {
          radiusText: distanceText(block.radiusM),
          places: block.places.map((p) => ({
            id: p.id,
            name: p.name,
            kindLabel: PLACE_KIND_LABELS[p.kind],
            tags: p.tags,
            address: p.address,
            distanceText: p.distanceM === null ? null : distanceText(p.distanceM),
            why: p.why,
            receipt: placeReceipt(p),
          })),
        }
      : null,
    gaps: report.local.gaps,
  };

  const marketing = marketingView(id, inputs.store.name, report.poster, report.posts);

  const trace = traceRows(report.trace);
  const calls = { live: 0, cached: 0 };
  for (const step of report.trace) if (step.kind === "tool") calls[step.cached ? "cached" : "live"]++;

  const { store } = inputs;
  const keptView = kept ? concept(kept) : null;
  const tiles = tileViews(keptView, plan?.wheel ? plan.wheel.slices.length : 0, marketing);
  if (generic) generic.rows = compareRows(keptView?.items ?? [], generic.items);
  return {
    id,
    kind: source.kind,
    header: {
      storeName: store.name,
      carrierLabel: CARRIER_LABELS[store.carrier],
      address: fullAddress(store),
      cityLine: `${store.city}, ${store.region}`,
      dateText: eventDate(inputs.date),
      dateShort: eventDate(inputs.date, "short"),
      timeText: timeRange(inputs.startTime, inputs.durationMinutes),
      settingLabel: SETTING_LABELS[inputs.setting],
      venue: inputs.location?.name ?? null,
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
    runOfShow: (plan?.runOfShow ?? []).map((s) => ({ time: s.time, timeLabel: timeOfDay(s.time), parts: parts(s.step) })),
    shopping,
    costLine: plan && plan.shopping.length > 0 ? `About ${usd(plan.estimatedCostUsd)} of a ${usd(inputs.budgetUsd)} budget, bought on the block where Qloo found a partner.` : null,
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
            };
          }),
          rules: plan.wheel.rules,
        }
      : null,
    generic,
    comparison,
    local,
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
export function posterRoute(id: string, size?: "og"): string {
  return `/api/plan/${encodeURIComponent(id)}/marketing/poster.png${size ? `?size=${size}` : ""}`;
}

/** The poster and the posts as the marketing section shows them (also used after "Generate poster and posts"). */
export function marketingView(id: string, storeName: string, poster: PlanReport["poster"], posts: PlanReport["posts"]): MarketingView {
  return {
    poster: {
      status: poster.status,
      src: poster.status === "ready" ? (poster.url ?? posterRoute(id)) : null,
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

/** The first screen's tiles, from the kept concept, the wheel and the marketing state. */
export function tileViews(concept: ConceptView | null, wheelSlices: number, marketing: MarketingView): TileView[] {
  const items = concept?.items ?? [];
  const music = items.find((i) => i.kind === "music");
  const musicNames = music?.parts.flatMap((p) => (p.kind === "ref" ? [p.name] : [])) ?? [];
  const snack = items.find((i) => (i.kind === "food" || i.kind === "partner") && i.places.length > 0) ?? items.find((i) => i.kind === "food");
  const place = snack?.places[0];
  const giveaway = items.find((i) => i.kind === "giveaway");
  const posts = marketing.posts;
  return [
    { key: "music", label: "Music", value: musicNames.length ? musicNames.slice(0, 3).join(", ") : (music?.plain ?? "Your playlist"), note: null, qloo: isQloo(music), href: "#event" },
    {
      key: "snacks",
      label: "Snacks",
      value: place ? place.name : (snack?.plain ?? "Your pick"),
      note: place?.distanceText ? `${place.distanceText} away` : null,
      qloo: Boolean(place) || isQloo(snack),
      href: "#shopping",
    },
    wheelSlices > 0
      ? { key: "wheel", label: "Prize wheel", value: `${wheelSlices} slices`, note: "Print the labels", qloo: false, href: "#wheel" }
      : { key: "wheel", label: "Giveaway", value: giveaway?.plain ?? "Your pick", note: null, qloo: isQloo(giveaway), href: "#event" },
    {
      key: "post",
      label: "Post it",
      value: posts ? "Poster and 3 posts" : marketing.poster.status === "ready" ? "Poster ready" : "Make the poster",
      note: posts ? "Facebook, Instagram, WhatsApp" : null,
      qloo: false,
      href: "#posts",
    },
  ];
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
    label: step.label,
    reason: step.reason?.trim() || null,
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
