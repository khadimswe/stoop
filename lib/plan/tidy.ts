// The last pass over plan text before it reaches an event, deterministic so recorded runs replay
// unchanged: 12-hour times everywhere ("2:30 pm", never "14:30"), and busy windows phrased as the
// plan's suggestion, never as traffic data nobody measured ("Busiest stretch, usually 1 to 3 pm",
// never "First peak"). A crowd the manager named in the notes ("after the train") stays: it is theirs.

import type { Baseline, Concept, Plan } from "./schema";

const hour12 = (h: number, m: string) => {
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return { text: `${hour}${m === "00" ? "" : `:${m}`}`, suffix };
};

/**
 * 24-hour clock times in text become 12-hour ones. Times from 13:00 on, 00:xx and 12:xx are
 * unambiguous and converted; "2:00" without am or pm is left as written. A range keeps one suffix
 * when both ends share it ("2 to 4 pm").
 */
export function twelveHour(text: string): string {
  const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?(?:am|pm|a\.m\.|p\.m\.))/gi;
  const converted = text.replace(TIME, (whole, hh: string, mm: string) => {
    const h = Number(hh);
    if (h >= 1 && h <= 11 && hh.length === 1) return whole;
    if (h >= 1 && h <= 11) return `${h}${mm === "00" ? "" : `:${mm}`} am`;
    const { text: t, suffix } = hour12(h, mm);
    return `${t} ${suffix}`;
  });
  // "2 pm to 4 pm" reads as "2 to 4 pm".
  return converted.replace(/\b(\d{1,2}(?::\d{2})?) (am|pm)(\s*(?:to|-|and|until)\s*)(\d{1,2}(?::\d{2})?) \2\b/gi, "$1$3$4 $2");
}

const CROWDS = ["train", "bus", "lunch crowd"];

/** Busy windows as the plan's suggestion, and crowds nobody named taken out. */
export function calmTimeline(text: string, notes = ""): string {
  let out = text
    .replace(/\b(first|second|third|lunch|afternoon|evening|morning|late) peak\b/gi, (_, which: string) => `${which} busy stretch`)
    .replace(/\bpeaks?\s+(?:at|from|is|runs?|around)\s+/gi, (m) => (m[0] === "P" ? "Busiest stretch, usually " : "busiest stretch, usually "))
    .replace(/\bpeak (?:hours?|times?|traffic)\b/gi, (m) => (m[0] === "P" ? "Busiest stretch" : "busiest stretch"))
    .replace(/\b(?:the|at the|at)\s+([\d:]+(?: (?:am|pm))?(?: and [\d:]+(?: (?:am|pm))?)?) peaks\b/gi, "at $1, the busiest stretches")
    .replace(/\bpeaks\b/gi, (m) => (m[0] === "P" ? "Busy stretches" : "busy stretches"))
    .replace(/\bpeak\b/gi, (m) => (m[0] === "P" ? "Busiest stretch" : "busiest stretch"));
  for (const crowd of CROWDS) {
    if (new RegExp(`\\b${crowd}\\b`, "i").test(notes)) continue;
    out = out
      .replace(new RegExp(`\\s*,?\\s*\\b(?:after|when|as) (?:the )?${crowd}(?: crowd)?(?: (?:arrives|lets out|gets in|comes in|ends))?\\b`, "gi"), "")
      .replace(new RegExp(`\\bthe ${crowd} crowd\\b`, "gi"), "people walking by");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}

/** Both passes, outside double quotes only: a quoted offer stays exactly as the manager typed it. */
export function tidy(text: string, notes = ""): string {
  return text
    .split(/("[^"]*")/)
    .map((part) => {
      if (part.startsWith('"') && part.endsWith('"') && part.length > 1) return part;
      const lead = /^\s*/.exec(part)?.[0] ?? "";
      const trail = part.trim() ? (/\s*$/.exec(part)?.[0] ?? "") : "";
      const body = calmTimeline(twelveHour(part), notes);
      return body ? `${lead}${body}${trail}` : part.trim() ? "" : part;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const tidyItems = <T extends { text: string }>(items: readonly T[], notes: string): T[] => items.map((i) => ({ ...i, text: tidy(i.text, notes) }));

/**
 * The plain playlist line code writes (lib/plan/concepts.ts defaultMusicLine) says what Qloo measured:
 * artists it ranks for the city by affinity, not play counts. The line reaches Claude's plan prompt as
 * it was written, so the recorded runs replay; it is reworded here, on the way to the page.
 */
export function honestPlaylist(text: string): string {
  return text.replace(/^A playlist of (?!the city's )(.+?)'s most-played artists on Qloo:/, "A playlist of artists Qloo ranks for $1:");
}

/** Concepts as shown: their titles, hooks, lines and notes tidied. */
export function tidyConcepts(concepts: readonly Concept[], notes = ""): Concept[] {
  return concepts.map((c) => ({
    ...c,
    title: tidy(c.title, notes),
    hook: tidy(c.hook, notes),
    items: tidyItems(c.items, notes).map((i) => (i.kind === "music" ? { ...i, text: honestPlaylist(i.text) } : i)),
    ...(c.note ? { note: tidy(c.note, notes) } : {}),
  }));
}

/**
 * The plan as shown. It runs on the finished plan, after every Claude call, so the prompts (and the
 * recorded answers they key) never change. Promo slices on the wheel are the manager's words: untouched.
 */
export function tidyPlan(plan: Plan, notes = ""): Plan {
  return {
    ...plan,
    concepts: tidyConcepts(plan.concepts, notes),
    runOfShow: plan.runOfShow.map((s) => ({ ...s, step: tidy(s.step, notes) })),
    shopping: plan.shopping.map((s) => ({ ...s, item: tidy(s.item, notes) })),
    checklist: plan.checklist.map((c) => tidy(c, notes)),
    ...(plan.wheel ? { wheel: { ...plan.wheel, slices: plan.wheel.slices.map((s) => (s.kind === "promo" ? s : { ...s, text: tidy(s.text, notes), label: tidy(s.label, notes) })) } } : {}),
  };
}

export function tidyBaseline(baseline: Baseline, notes = ""): Baseline {
  return { ...baseline, items: tidyItems(baseline.items, notes) };
}
