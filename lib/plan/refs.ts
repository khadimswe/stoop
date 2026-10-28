// Ref tokens: plan text names a measured artist or place as "[[id]]", and code renders the name from
// the run's own Qloo results. The model never writes a name, so it can't name something Qloo didn't
// return (the same rule as Stoop's grounding guard).
const REF = /\[\[([A-Za-z0-9-]+)\]\]/g;

/** The ids a text names, in order, without repeats. */
export function refsIn(text: string): string[] {
  return [...new Set([...text.matchAll(REF)].map((m) => m[1] as string))];
}

/** Replaces each token with its name. An unknown id renders as "a local spot" rather than leaking the id. */
export function renderRefs(text: string, names: ReadonlyMap<string, string>): string {
  return text.replace(REF, (_, id: string) => names.get(id) ?? "a local spot");
}

/** Splits text into plain parts and refs, for UIs that render each ref as a chip with its receipt. */
export function splitRefs(text: string): ({ kind: "text"; text: string } | { kind: "ref"; id: string })[] {
  const parts: ({ kind: "text"; text: string } | { kind: "ref"; id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    parts.push({ kind: "ref", id: m[1] as string });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
