// Small formatters shared by the view builders. Fixed locale and time zone, so the server and the
// browser print the same text.
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Oct 16, 2026" from an ISO timestamp. */
export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

/** "skews +0.21": demographics are relative skew indices from -1 to 1, never shares. */
export function skewText(skew: number): string {
  const rounded = Math.round(skew * 100) / 100;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `skews ${sign}${Math.abs(rounded).toFixed(2)}`;
}

/**
 * Where a world's setting city comes from, said next to it: it is ranked across the whole taste
 * neighborhood, while a world's "top cities by lift" are its own age band's, so the two can differ.
 */
export function settingNote(audienceRank: number): string {
  return audienceRank === 1 ? "Setting: the whole taste neighborhood's top city" : `Setting: the whole taste neighborhood's #${audienceRank} city`;
}

/** A Qloo type in plain words: "urn:entity:tv_show" is "tv show", any tag is "tag". */
export function plainType(type: string): string {
  if (type.startsWith("urn:tag")) return "tag";
  const entity = /^urn:entity:([a-z_]+)$/.exec(type)?.[1];
  return (entity ?? type).replace(/_/g, " ");
}
