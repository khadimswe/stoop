// What each step of the floor shows, picked from a plan view (./plan.ts). Pure: names, numbers and
// receipts all come from the run's own Qloo results and the manager's inputs.
import { noGenre, type PlaceView, type PlanView, type ShoppingView } from "./plan";
import { plural, usd } from "./format";
import { gameWords } from "../game";
// The landing comparison's plain words and US units, shared with the landing (no runtime cycle: plain-words imports types only).
import { ageSpan, genericArtistNames, genericCheckWords, genericPicks, listOf, usDistance, usRadius } from "../../marketing/plain-words";

export const KIND_GROUPS = [
  { kind: "food", label: "Food" },
  { kind: "venue", label: "Venues" },
  { kind: "park", label: "Parks" },
  { kind: "shop", label: "Shops" },
  { kind: "other", label: "Other" },
] as const satisfies readonly { kind: PlaceView["kind"]; label: string }[];

/** Places this close to the store are "next door": the map folds them into "+N next door". */
export const NEXT_DOOR_M = 120;

/** Kind filter chips with counts: "All 24", "Food 15"... (kinds with no places left out). */
export function kindCounts(places: readonly PlaceView[]): { kind: PlaceView["kind"] | "all"; label: string; count: number }[] {
  return [
    { kind: "all" as const, label: "All", count: places.length },
    ...KIND_GROUPS.map((g) => ({ kind: g.kind, label: g.label, count: places.filter((p) => p.kind === g.kind).length })).filter((g) => g.count > 0),
  ];
}

/** "Food · 26 m · next door"; measured from the event's place, "Food · 450 ft from the event". */
export function placeMeta(p: Pick<PlaceView, "kindLabel" | "distanceText" | "distanceM" | "chain">, from: "the store" | "the event" = "the store"): string {
  const near = from === "the event" ? (p.distanceText ? `${p.distanceText} from the event` : null) : p.distanceM !== null && p.distanceM < NEXT_DOOR_M ? "next door" : p.distanceText;
  return [p.kindLabel, near, p.chain ? "chain" : null].filter(Boolean).join(" · ");
}

/** "0.3 mi away", or "0.3 mi from the event" when the community was read around the event's place. */
export function awayText(distanceText: string | null, view: Pick<PlanView, "local">): string | null {
  if (!distanceText) return null;
  return view.local.block?.from === "the event" ? `${distanceText} from the event` : `${distanceText} away`;
}

/** The event's three numbers: the spend against the budget, the block spots it uses, the wheel or the timeline. */
export function eventStats(view: PlanView): { value: string; label: string }[] {
  const spent = view.shopping.reduce((sum, s) => sum + (s.usd ?? 0), 0);
  const budget = view.header.budgetText.replace(" budget", "");
  const stats = [{ value: usd(spent), label: `of ${budget}` }, { value: String(view.partnerIds.length), label: view.partnerIds.length === 1 ? "spot in the community" : "spots in the community" }];
  if (view.wheel) stats.push({ value: "Free", label: gameWords(view.wheel.game).stat });
  else stats.push({ value: String(view.runOfShow.length), label: "timeline steps" });
  return stats;
}

/** Play: the artists the plan's playlist names (else the city's top 3), with the line's receipt. */
export function playView(view: PlanView): { artists: string[]; receipt: string | null; note: string | null } {
  const music = view.concept?.items.find((i) => i.kind === "music");
  const named = music?.parts.flatMap((p) => (p.kind === "ref" ? [p.name] : [])) ?? [];
  const artists = named.length ? named : (view.local.city?.artists.slice(0, 3).map((a) => a.name) ?? []);
  const city = view.local.city;
  return {
    artists,
    receipt: music?.receipt ?? view.local.city?.artists[0]?.receipt ?? null,
    note: city ? `Artists Qloo ranks for ${city.name}, adults ${city.ageText}` : null,
  };
}

/** Snacks: what to buy that isn't a prize, and its total. */
export function snacksView(view: PlanView): { items: ShoppingView[]; totalText: string | null } {
  const items = view.shopping.filter((s) => !s.prize);
  const total = items.reduce((sum, s) => sum + (s.usd ?? 0), 0);
  return { items, totalText: items.length ? usd(total) : null };
}

/** A price from the plan is Claude's estimate: "about $11". */
export const about = (costText: string | null): string | null => (costText ? `about ${costText}` : null);

export interface SnackGroup {
  /** The community place to buy from (its pin number matches the Community map), or null for the rest. */
  place: { name: string; n: number; distanceText: string | null; receipt: string | null } | null;
  items: ShoppingView[];
  totalText: string | null;
}

/** Snacks under the place they come from, nearest place first, so one place shows its pin once. */
export function snackGroups(view: PlanView): SnackGroup[] {
  const groups = new Map<string, SnackGroup>();
  for (const s of snacksView(view).items) {
    const key = s.from ? `p:${s.from.name}` : "none";
    const g = groups.get(key) ?? { place: s.from ? { name: s.from.name, n: s.from.n, distanceText: s.from.distanceText, receipt: s.from.receipt } : null, items: [], totalText: null };
    g.items.push(s);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, totalText: g.items.some((s) => s.usd !== null) ? usd(g.items.reduce((sum, s) => sum + (s.usd ?? 0), 0)) : null }))
    .sort((a, b) => (a.place ? a.place.n : Infinity) - (b.place ? b.place.n : Infinity));
}

/** The prizes on the shopping list, one per line, and their total. */
export function prizesView(view: PlanView): { items: { item: string; costText: string | null }[]; totalText: string } | null {
  const prizes = view.shopping.filter((s) => s.prize);
  if (!prizes.length) return null;
  return { items: prizes.map((p) => ({ item: p.item, costText: p.costText })), totalText: usd(prizes.reduce((sum, s) => sum + (s.usd ?? 0), 0)) };
}

/** The side column's budget: what the shopping list adds up to against the budget, snacks and prizes apart. */
export function budgetView(view: PlanView): { spentText: string; budgetText: string; rows: { label: string; value: string }[] } {
  const snacks = view.shopping.filter((s) => !s.prize).reduce((sum, s) => sum + (s.usd ?? 0), 0);
  const prizes = view.shopping.filter((s) => s.prize).reduce((sum, s) => sum + (s.usd ?? 0), 0);
  const rows = [
    ...(snacks > 0 ? [{ label: "Food and drinks", value: usd(snacks) }] : []),
    ...(prizes > 0 ? [{ label: "Prizes", value: usd(prizes) }] : []),
  ];
  return { spentText: usd(snacks + prizes), budgetText: view.header.budgetText.replace(" budget", ""), rows };
}

/** "At a fall community fair" (an article stays lowercase after "At"), "At Pilsen Fall Fest". */
export function venueLine(venue: string): string {
  return `At ${lowerArticle(venue)}`;
}

/** "A fall community fair" as "a fall community fair" mid-sentence; a name ("Pilsen Fall Fest") stays. */
export function lowerArticle(venue: string): string {
  return /^(A|An|The) /.test(venue) ? venue.charAt(0).toLowerCase() + venue.slice(1) : venue;
}

/** "Prizes on the list: Gift card for the 2:00 drawing, Gift cards for the wheel's slice · $15". */
export function prizesLine(view: PlanView): string | null {
  const prizes = view.shopping.filter((s) => s.prize);
  if (!prizes.length) return null;
  const total = prizes.reduce((sum, s) => sum + (s.usd ?? 0), 0);
  return `Prizes on the list: ${prizes.map((p) => p.item.charAt(0).toLowerCase() + p.item.slice(1)).join("; ")} · ${usd(total)}`;
}

/** "13 checks", "5 items · $39 of $50". */
export function foldMeta(view: PlanView): { checklist: string; shopping: string } {
  const spent = view.shopping.reduce((sum, s) => sum + (s.usd ?? 0), 0);
  return {
    checklist: plural(view.checklist.length, "check"),
    shopping: `${plural(view.shopping.length, "item")} · ${usd(spent)} of ${view.header.budgetText.replace(" budget", "")}`,
  };
}

export interface JudgeView {
  /** Three numbers with plain labels: receipts on each side, and Qloo's check of the generic artists. */
  stats: { value: string; label: string }[];
  /** The landing's own rows ("A generic AI plan could be for any store."): what each plan picked, line by line. */
  rows: LandingCompareRow[];
  /** What else the comparison found, in the pipeline's words, without what the rows and numbers already say. */
  lines: string[];
}

/** Comparison lines the rows and the numbers already say (receipt counts, the median check, "names no place"). */
const SAID_BY_ROWS = /median|cite a Qloo receipt|names no place|^Buys from|leans on \d+ generic/i;

/**
 * The judges' fold: the same rows the landing shows (call landingCompare, read-only), three numbers in
 * plain words ("Stoop plan lines with a receipt", "generic artists in Qloo's top 20"), then what else
 * the comparison found. "Below the median" is never said: the landing's "none make Qloo's own top 20"
 * is the one wording.
 */
export function judgeView(view: PlanView): JudgeView | null {
  if (!view.generic || !view.comparison) return null;
  const c = view.comparison;
  const backed = /^(\d+) of (\d+)/.exec(c.backedLine);
  const names = genericArtistNames(view);
  const { checked } = genericPicks(view);
  const top = Math.max(0, ...checked.map((x) => x.of ?? 0));
  const inTop = checked.filter((x) => (x.beats ?? 0) > 0).length;
  const stats = [
    { value: backed ? `${backed[1]} of ${backed[2]}` : "0", label: "Stoop plan lines with a Qloo receipt" },
    { value: "0", label: "generic plan lines with a Qloo receipt" },
    names.length && top && genericCheckWords(view)
      ? { value: `${inTop} of ${names.length}`, label: `generic artists in Qloo's top ${top}` }
      : { value: String(view.generic.cliches.length), label: view.generic.cliches.length === 1 ? "cliché in the generic plan" : "clichés in the generic plan" },
  ];
  // A cliche no row covers (balloons, a banner) is said once, in the generic plan's own words.
  const covered = /music|playlist|snack|food|drink|place|community|gift|prize/i;
  const extra = view.generic.cliches.filter((cl) => !covered.test(cl.text)).map((cl) => noGenre(`Also flagged in the generic plan: ${cl.text.charAt(0).toLowerCase()}${cl.text.slice(1)}. ${cl.why}`));
  return { stats, rows: landingCompare(view), lines: [...c.lines.filter((l) => !SAID_BY_ROWS.test(l)).map(noGenre), ...extra] };
}

// The agent's posting plan (the Promote timeline) lives in lib/plan/view/promote.ts, on the one schedule in lib/social/schedule.ts.

/** One row of the landing's comparison, each side with the receipt behind it when there is one. */
export interface LandingCompareRow {
  row: string;
  generic: string;
  stoop: string;
  genericReceipt: string | null;
  stoopReceipt: string | null;
}

/**
 * The landing's "A generic AI plan could be for any store." rows: what the generic plan picked beside
 * what this store's plan did, in plain words and US units. The generic plan's artists come from its
 * own Qloo check (the trace's "Resolving the generic plan's ..." calls and "Checked a generic pick"
 * decisions), and its vague spots ("a nearby bakery") are quoted in its own words.
 */
export function landingCompare(view: PlanView): LandingCompareRow[] {
  const g = view.generic;
  if (!g || !view.concept) return [];
  const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const cliche = (re: RegExp) => g.cliches.find((c) => re.test(c.text));
  const firstSentence = (text: string | undefined) => (text ? noGenre(text.split(/(?<=\.)\s/)[0]!.replace(/\.$/, "")) : "Nothing on this line");
  const genericOf = (kind: string) => g.items.find((i) => i.kind === kind)?.text;
  // "a nearby bakery", "a local food spot": a spot the generic plan points at without naming one.
  const VAGUE = /\b(?:an?|the) (?:nearby|local) (?:[A-Z][a-z]+ )?(?:[a-z]+ )?(?:bakery|food spot|spot|shop|restaurant|place|store|cafe|deli|market)\b/;
  const city = view.local.city;
  const play = playView(view);
  const from = view.header.venue ? "the event" : "the door";
  const placeAt = (n: number) => view.local.block?.places.find((p) => p.n === n);

  // Music: the generic plan's own artists, and what Qloo's one scoring call said about them.
  const searched = genericArtistNames(view);
  const check = genericCheckWords(view);
  const genericMusic = searched.length && check ? `${listOf(searched)}: famous, but ${check}` : cliche(/music/i) ? "Music picked with no local data" : firstSentence(genericOf("music"));
  const music = view.concept.items.find((i) => i.kind === "music");
  const ranks = (music?.parts ?? []).flatMap((p) => (p.kind === "ref" ? [city?.artists.find((a) => a.id === p.id)?.rank] : [])).filter((r): r is number => typeof r === "number");
  const stoopMusic =
    city && play.artists.length
      ? ranks.length === play.artists.length
        ? `${listOf(play.artists)}: Qloo's ${listOf(ranks.map((r) => `#${r}`))} for ${city.name} adults ${ageSpan(city.ageText)}`
        : `${listOf(play.artists)}: artists Qloo ranks for ${city.name}, adults ${ageSpan(city.ageText)}`
      : (play.note ?? "Qloo's artists for this city");

  // Snacks: the generic plan's vague spot in its own words, beside the spot this plan buys from.
  const food = genericOf("food");
  const foodSpot = food ? VAGUE.exec(food) : null;
  let genericSnack = cliche(/snack/i) ? "Store-bought snacks, no spot named" : firstSentence(food);
  if (food && foodSpot) {
    const before = food.slice(0, foodSpot.index).replace(/\s*\bfrom\s*$/, "");
    const what = before.split(/\bof\s+|,\s+/).at(-1)?.trim() ?? "";
    genericSnack = `${what && what.split(/\s+/).length <= 5 ? upper(what) : "Food"} from “${foodSpot[0]}”`;
  }
  const snack = view.shopping.find((s) => !s.prize && s.from);
  const snackM = snack?.from ? placeAt(snack.from.n)?.distanceM : null;

  // Prizes: a gift card "to a nearby food spot", beside the spots this plan's gift cards come from.
  const giveaway = genericOf("giveaway");
  const giftSpot = giveaway && /gift cards?\b/i.test(giveaway) ? VAGUE.exec(giveaway.slice(giveaway.search(/gift cards?\b/i))) : null;
  const genericPrize = giftSpot ? `A gift card to “${giftSpot[0]}”` : giveaway && /gift cards?\b/i.test(giveaway) ? "Gift cards, no spot named" : firstSentence(giveaway);
  const cardPins = [
    ...(view.wheel?.slices ?? []).flatMap((s) => (s.kind === "gift_card" && s.place ? [s.place.n] : [])),
    ...view.shopping.flatMap((s) => (s.prize && s.from ? [s.from.n] : [])),
  ];
  const cardPlaces = [...new Set(cardPins)].flatMap((n) => placeAt(n) ?? []);

  const block = view.local.block;
  const rows: LandingCompareRow[] = [
    { row: "Music", generic: genericMusic, stoop: stoopMusic, genericReceipt: g.check?.receipt ?? null, stoopReceipt: play.receipt },
    {
      row: "Food",
      generic: genericSnack,
      stoop: snack?.from ? `${snack.item.split(",")[0]} from ${snack.from.name}${snackM != null ? `, ${usDistance(snackM)} from ${from}` : ""}` : "Nothing on this line",
      genericReceipt: null,
      stoopReceipt: snack?.from?.receipt ?? null,
    },
    {
      row: "Prizes",
      generic: genericPrize,
      stoop: cardPlaces.length ? `Gift cards to ${listOf(cardPlaces.map((p) => p.name))}` : "The store's own promos",
      genericReceipt: null,
      stoopReceipt: cardPlaces[0]?.receipt ?? null,
    },
    {
      row: "Places",
      generic: cliche(/place|community/i) ? "Names no place near the store" : "Places it names aren't checked against Qloo",
      stoop: block?.places.length ? `${block.places.length} places within ${usRadius(block.radiusM)}, from Qloo` : "No Qloo places",
      genericReceipt: null,
      stoopReceipt: null,
    },
  ];
  return rows.filter((r) => r.stoop !== "Nothing on this line");
}
