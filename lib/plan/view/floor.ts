// What each step of the floor shows, picked from a plan view (./plan.ts). Pure: names, numbers and
// receipts all come from the run's own Qloo results and the manager's inputs.
import { noGenre, type PlaceView, type PlanView, type ShoppingView } from "./plan";
import { plural, usd } from "./format";

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

/** "Food · 26 m · next door". */
export function placeMeta(p: Pick<PlaceView, "kindLabel" | "distanceText" | "distanceM" | "chain">): string {
  return [p.kindLabel, p.distanceText, p.distanceM !== null && p.distanceM < NEXT_DOOR_M ? "next door" : null, p.chain ? "chain" : null].filter(Boolean).join(" · ");
}

/** The event's three numbers: the spend against the budget, the block spots it uses, the wheel or the timeline. */
export function eventStats(view: PlanView): { value: string; label: string }[] {
  const spent = view.shopping.reduce((sum, s) => sum + (s.usd ?? 0), 0);
  const budget = view.header.budgetText.replace(" budget", "");
  const stats = [{ value: usd(spent), label: `of ${budget}` }, { value: String(view.partnerIds.length), label: view.partnerIds.length === 1 ? "spot in the community" : "spots in the community" }];
  if (view.wheel) stats.push({ value: "Free", label: "to spin" });
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
  stats: { value: string; label: string }[];
  /** A generic choice next to what the Stoop plan did instead, from the pipeline's own sentences. */
  pairs: { generic: string; stoop: string | null }[];
  /** The rest of the pipeline's comparison lines, verbatim. */
  lines: string[];
}

const PAIR_CUES: { cliche: RegExp; line: RegExp }[] = [
  { cliche: /place|community/i, line: /^Buys from|places? in this community/i },
  { cliche: /music|playlist/i, line: /playlist|artists/i },
  { cliche: /snack|food|drink/i, line: /snack|food|buys/i },
];

/** The judges' fold: three numbers, then each cliche beside the Stoop line that answers it. */
export function judgeView(view: PlanView): JudgeView | null {
  if (!view.generic || !view.comparison) return null;
  const c = view.comparison;
  const backed = /^(\d+) of (\d+)/.exec(c.backedLine);
  const check = view.generic.check;
  const stats = [
    { value: backed ? `${backed[1]} of ${backed[2]}` : "0", label: "lines cite Qloo" },
    { value: "0", label: "in generic" },
    ...(check ? [{ value: /^(\d+ of \d+)/.exec(check.line)?.[1] ?? "n/a", label: "below median" }] : [{ value: String(view.generic.cliches.length), label: "clichés" }]),
  ];
  const used = new Set<string>();
  const pairs = view.generic.cliches.map((cl) => {
    const cue = PAIR_CUES.find((p) => p.cliche.test(cl.text));
    const line = cue ? c.lines.find((l) => !used.has(l) && cue.line.test(l) && !/^The generic plan/i.test(l)) : undefined;
    if (line) used.add(line);
    return { generic: noGenre(`${cl.text}. ${cl.why}`), stoop: line ? noGenre(line) : null };
  });
  return { stats, pairs, lines: c.lines.filter((l) => !used.has(l)).map(noGenre) };
}

/** The agent's posting plan: now, the evening before, and just before the table opens. */
export interface AgentPost {
  id: "announce" | "reminder" | "outside";
  when: string;
  title: string;
  channels: string;
  text: string;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${h12} ${h < 12 ? "am" : "pm"}` : `${h12}:${String(min).padStart(2, "0")}`;
};

/**
 * Three posts with times in the store's own calendar: "Now" (announce), the evening before at 6 pm
 * (reminder) and 15 minutes before the table opens ("We're outside"). The words are the plan's own
 * drafts and its inputs; nothing is invented.
 */
export function agentPosts(view: PlanView, inputs: { date: string; startTime: string }): AgentPost[] {
  const posts = view.marketing.posts;
  if (!posts) return [];
  const day = new Date(`${inputs.date}T12:00:00Z`);
  const before = new Date(day.getTime() - 86_400_000);
  const start = minutes(inputs.startTime);
  const title = view.concept?.title ?? view.header.storeName;
  const where = view.header.venue ?? view.header.storeName;
  return [
    { id: "announce", when: "Now", title: "Announce", channels: "Facebook, Instagram", text: posts.facebook },
    {
      id: "reminder",
      when: `${WEEKDAY.format(before)} 6 pm`,
      title: "Reminder",
      channels: "Facebook, Instagram",
      text: `Tomorrow: ${title}. ${view.header.timeText} at ${where}, ${view.header.address}.`,
    },
    {
      id: "outside",
      when: `${WEEKDAY.format(day)} ${clock(start - 15)}`,
      title: "We're outside",
      channels: "Facebook, Instagram",
      text: `We're setting up now: ${title}, ${view.header.timeText}. Come by ${where}.`,
    },
  ];
}

/** The landing's "A generic AI plan could be for any store." rows: the generic plan beside this store's. */
export function landingCompare(view: PlanView): { row: string; generic: string; stoop: string }[] {
  const g = view.generic;
  if (!g || !view.concept) return [];
  const cliche = (re: RegExp) => g.cliches.find((c) => re.test(c.text));
  const firstSentence = (text: string | undefined) => (text ? noGenre(text.split(/(?<=\.)\s/)[0]!.replace(/\.$/, "")) : "Nothing on this line");
  const genericOf = (kind: string) => g.items.find((i) => i.kind === kind)?.text;
  const play = playView(view);
  const snack = view.shopping.find((s) => !s.prize && s.from);
  const cards = (view.wheel?.slices ?? []).filter((s) => s.kind === "gift_card" && s.place).map((s) => s.place!.name);
  const places = view.local.block?.places.length ?? 0;
  const rows = [
    { row: "Music", generic: cliche(/music/i) ? "No local signal" : firstSentence(genericOf("music")), stoop: play.note ?? "Qloo's artists for this city" },
    {
      row: "Snacks",
      generic: cliche(/snack/i) ? "Store-bought snacks, no spot named" : firstSentence(genericOf("food")),
      stoop: snack?.from ? `${snack.item.split(",")[0]} from ${snack.from.name}${snack.from.distanceText ? `, ${snack.from.distanceText} from the door` : ""}` : "Nothing on this line",
    },
    { row: "Prizes", generic: firstSentence(genericOf("giveaway")), stoop: cards.length ? `Gift cards to ${[...new Set(cards)].join(" and ")}` : "The store's own promos" },
    { row: "Places", generic: cliche(/place|community/i) ? "None in this community" : "Names no place nearby", stoop: places ? `${places} within ${view.local.block?.radiusText ?? "1.5 km"}, from Qloo` : "No Qloo places" },
  ];
  return rows.filter((r) => r.stoop !== "Nothing on this line");
}
