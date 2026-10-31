// Plain words for the agent's trace, at view time. Recorded runs keep their own labels and reasons
// (the examples replay against them), so the event page rewords a few exact phrases into what
// happened ("Removed 1 line that didn't cite Qloo") and never shows a validator's path
// ("concepts.1.items.2: ...") to a reader. Pure, for tests.
import { plural } from "./format";

/** A checker's path at the start of an issue: "concepts.1.items.2: ", "concepts.1.title or hook: ", "items.3: ". */
const PATH = /\b[a-z][a-zA-Z]*(?:\.(?:\d+|[a-z][a-zA-Z]*))+(?: or [a-z]+)?:\s/g;

/** True when a text carries a validator path, which is never shown. */
export function hasCheckPath(text: string): boolean {
  return new RegExp(PATH.source).test(text);
}

/** What each kind of issue says, in the order the reason lists them. */
const ISSUE_WORDS: readonly [RegExp, string][] = [
  [/must cite a Qloo/i, "didn't cite Qloo"],
  [/genre word|names a music genre/i, "named a music genre"],
  [/prices and deals come only/i, "quoted a price the manager didn't type"],
  [/characters once|the limit is \d+|must be \d+ to \d+ characters/i, "ran too long"],
  [/national chain/i, "used a chain as a partner"],
  [/add the music line/i, "left out the city's playlist"],
];
const PLAYLIST = "left out the city's playlist";

/** The issues a checker's reason lists, one per path (the text after each path). */
export function checkIssues(reason: string | undefined): string[] {
  if (!reason) return [];
  const starts = [...reason.matchAll(PATH)].map((m) => ({ at: m.index, end: m.index + m[0].length }));
  return starts.map((s, i) => reason.slice(s.end, starts[i + 1]?.at ?? reason.length).trim());
}

/** The kinds of issue, in plain words, each once. An issue no rule names reads "broke a plan rule". */
function issueKinds(issues: readonly string[]): string[] {
  const kinds = new Set<string>();
  for (const issue of issues) kinds.add(ISSUE_WORDS.find(([re]) => re.test(issue))?.[1] ?? "broke a plan rule");
  return ISSUE_WORDS.map(([, w]) => w).concat("broke a plan rule").filter((w) => kinds.has(w));
}

function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/** Why a place is left off the community list, said once for every place it covers. */
const LEFT_OUT_GROUPS: readonly [RegExp, string][] = [
  [/built around alcohol/i, "Built around alcohol (no alcohol at a sidewalk table)"],
  [/adults-only nightlife/i, "Adults-only nightlife"],
  [/another wireless store/i, "Another wireless store"],
  [/aimed at kids/i, "Aimed at kids"],
];

/**
 * "A (why); B (why)" as one line per reason: "Built around alcohol (no alcohol at a sidewalk
 * table): A, B and C." The label counts every place; when the reason names fewer, "and N more".
 * null when the reason is not in that shape.
 */
export function leftOffReason(label: string, reason: string): string | null {
  const total = Number(/^Left (\d+) places? off/.exec(label)?.[1] ?? 0);
  const parts = reason.split("; ").map((part) => /^(.+) \(([^()]+)\)$/.exec(part.trim()));
  if (parts.length === 0 || parts.some((m) => !m)) return null;
  const groups = new Map<string, string[]>();
  for (const m of parts) {
    const why = LEFT_OUT_GROUPS.find(([re]) => re.test(m![2]!))?.[1] ?? m![2]!.charAt(0).toUpperCase() + m![2]!.slice(1);
    groups.set(why, [...(groups.get(why) ?? []), m![1]!]);
  }
  const and = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  const lines = [...groups].map(([why, names]) => `${why}: ${and(names)}.`);
  const more = total - parts.length;
  return more > 0 ? `${lines.join(" ")} And ${more} more.` : lines.join(" ");
}

/**
 * A recorded trace step in plain words. The checks' own steps read as what they did: "Checked
 * Claude's draft and sent 12 fixes back", "Removed 1 line that didn't cite Qloo", "Checked the
 * generic plan's draft". A reason with a validator path is reworded, or left out.
 */
export function plainStep(label: string, reason: string | null): { label: string; reason: string | null; written: boolean } {
  const issues = checkIssues(reason ?? undefined);
  const kinds = issueKinds(issues);

  const sent = /^Sent (\d+) problems? back to Claude$/.exec(label);
  if (sent) {
    const n = Number(sent[1]);
    return {
      label: `Checked Claude's draft and sent ${plural(n, "fix", "fixes")} back`,
      reason: kinds.length ? `For example, lines that ${orList(kinds)}.` : null,
      written: true,
    };
  }

  if (label === "Dropped what still failed the checks") {
    const lineKinds = kinds.filter((k) => k !== PLAYLIST);
    const lines = issues.filter((i) => !/add the music line/i.test(i)).length;
    // The reason lists at most 4 issues: a count is only said when it is the whole count.
    const count = issues.length < 4 && lines > 0 ? plural(lines, "line") : "lines";
    const what = lineKinds.length ? `Removed ${count} that ${orList(lineKinds)}` : "Checked Claude's second draft";
    const playlist = kinds.includes(PLAYLIST) ? "The city's playlist is added next." : null;
    const why = lineKinds.length === 1 && lineKinds[0] === "didn't cite Qloo" ? "A line that says it comes from Qloo has to name what Qloo found." : null;
    return { label: what, reason: playlist ?? why, written: true };
  }

  const generic = /^(\d+) lines? failed the checks/.exec(reason ?? "");
  if (label === "Asked Claude again for the generic plan") {
    return {
      label: "Checked the generic plan's draft",
      reason: generic ? `${plural(Number(generic[1]), "line")} broke the rules every plan follows, so Claude wrote it again.` : "It broke the rules every plan follows, so Claude wrote it again.",
      written: true,
    };
  }

  if (/^Left \d+ places? off the community list$/.test(label) && reason) {
    return { label, reason: leftOffReason(label, reason) ?? reason, written: false };
  }

  return { label, reason: reason && hasCheckPath(reason) ? null : reason, written: false };
}

/** "a snack run" and "snack spots" in the trace's own steps read "a food run" and "food spots". */
export function foodWords(text: string): string {
  return text.replace(/\bsnack (runs?|spots?)\b/g, "food $1").replace(/\bSnack (runs?|spots?)\b/g, "Food $1");
}

/** Plan text without a stray JSON tail Claude sometimes leaves ('door."}' reads "door."). */
export function tidyPlanText(text: string): string {
  let out = text;
  for (;;) {
    const m = /\s*(?:"\}|"\]|\}|\])\s*$/.exec(out);
    if (!m) return out;
    const head = out.slice(0, m.index);
    const tail = m[0].trim();
    // Only an unmatched closer: a "{...}" or "[...]" the text opened itself stays.
    const opener = tail.endsWith("}") ? "{" : "[";
    const closer = tail.endsWith("}") ? "}" : "]";
    const opens = (head.match(new RegExp(`\\${opener}`, "g")) ?? []).length;
    const closes = (head.match(new RegExp(`\\${closer}`, "g")) ?? []).length;
    if (opens > closes) return out;
    // A quote in the tail ('"}') is stray only when the text's quotes are already balanced; else it
    // closes the text's own quote and stays.
    out = tail.startsWith('"') && (head.match(/"/g) ?? []).length % 2 === 1 ? `${head}"` : head;
    if (out.endsWith('"') && tail.startsWith('"')) return out;
  }
}
