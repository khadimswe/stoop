// The plan page's view model: the narrow, serializable props the store-events sections take, built
// from a recorded PlanReport (examples), a stored one (finished live runs) or the live reducer state
// (a run streaming in). Every name on screen comes from the run's own Qloo results (`local`) through
// "[[id]]" refs; every receipt comes from the run's ledger. No evidence, no receipt.
import type { Evidence } from "../../evidence";
import type { ReceiptRow, ReceiptView } from "../../report/view/types";
import type { CueOrigin } from "../../types";
import type { PlanState } from "../events";
import { splitRefs } from "../refs";
import type { ArtistRef, Concept, ItemKind, Place, PlanInputs, PlanItem, PlanReport, PlanTraceStep } from "../schema";
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
  address: string;
  cityLine: string;
  dateText: string;
  timeText: string;
  settingLabel: string;
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

export interface ShoppingView {
  item: string;
  qty: string | null;
  costText: string | null;
  /** The block partner to buy it from, with its receipt. */
  from: { name: string; receipt: string | null } | null;
  origin: CueOrigin;
  receipt: string | null;
}

export interface GenericItemView {
  kindLabel: string;
  text: string;
  /** The cliche this line matches, if any, with why it was flagged. */
  flagged: string | null;
}

export interface GenericView {
  items: GenericItemView[];
  cliches: { text: string; why: string }[];
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
  checklist: TextPart[][];
  generic: GenericView | null;
  comparison: ComparisonView | null;
  local: LocalView;
  marketing: MarketingView;
  results: ResultView[];
  trace: PlanTraceRow[];
  /** Qloo calls the trace made: live and from cache. */
  calls: { live: number; cached: number };
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

/** "exact cliche text in the line, or the line in the cliche", case-insensitive. */
function matchesCliche(line: string, cliche: string): boolean {
  const a = line.toLowerCase();
  const b = cliche.toLowerCase().replace(/[."]+$/g, "").trim();
  return b.length > 0 && (a.includes(b) || b.includes(a));
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
    return {
      kind: it.kind,
      kindLabel: ITEM_KIND_LABELS[it.kind],
      parts: ps,
      plain: text,
      origin: it.origin,
      receipt: backed ? receipt(`item:${conceptId}:${i}`, it.evidenceIds, ITEM_KIND_LABELS[it.kind], text, lead) : null,
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
  const generic: GenericView | null = baseline
    ? {
        items: baseline.items.map((it) => {
          const text = plain(parts(it.text));
          const hit = baseline.cliches.find((c) => matchesCliche(text, c.text));
          return { kindLabel: ITEM_KIND_LABELS[it.kind], text, flagged: hit ? hit.why : null };
        }),
        cliches: baseline.cliches.map((c) => ({ text: c.text, why: c.why })),
        check: baseline.check
          ? {
              line:
                baseline.check.checkable === 0
                  ? "Qloo could not check any of the generic plan's music or food picks against this city."
                  : `${baseline.check.belowMedian} of ${baseline.check.checkable} checkable music and food picks sit below this city's reference median${
                      baseline.check.unverifiable > 0 ? ` (${baseline.check.unverifiable} unverifiable)` : ""
                    }.`,
              receipt: receipt("generic-check", baseline.check.evidenceIds, "Generic AI plan, checked with Qloo", "The generic plan's picks, scored against this city"),
            }
          : null,
      }
    : null;
  if (generic?.check?.receipt) receipts[generic.check.receipt] = { ...receipts[generic.check.receipt]!, subject: "generic" };

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
  return {
    id,
    kind: source.kind,
    header: {
      storeName: store.name,
      carrierLabel: CARRIER_LABELS[store.carrier],
      address: store.address,
      cityLine: `${store.city}, ${store.region}`,
      dateText: eventDate(inputs.date),
      timeText: timeRange(inputs.startTime, inputs.durationMinutes),
      settingLabel: SETTING_LABELS[inputs.setting],
      budgetText: `${usd(inputs.budgetUsd)} budget`,
      offers: inputs.offers.map((o) => o.text),
      ageText: ageBandsText(inputs.ageBands),
      notes: inputs.notes?.trim() || null,
      provenance: source.provenance,
      madeOn: source.createdAt ? stampDate(source.createdAt) : null,
      fictional: source.kind === "example" ? fictionalNotice(store.carrier) : null,
    },
    concept: kept ? concept(kept) : null,
    alternatives: plan && kept ? plan.concepts.filter((c) => c.id !== kept.id).map(concept) : [],
    runOfShow: (plan?.runOfShow ?? []).map((s) => ({ time: s.time, timeLabel: timeOfDay(s.time), parts: parts(s.step) })),
    shopping,
    costLine: plan && plan.shopping.length > 0 ? `About ${usd(plan.estimatedCostUsd)} of a ${usd(inputs.budgetUsd)} budget` : null,
    checklist: (plan?.checklist ?? []).map(parts),
    generic,
    comparison,
    local,
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
