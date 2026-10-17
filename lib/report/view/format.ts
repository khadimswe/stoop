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

/** A Qloo type in plain words: "urn:entity:tv_show" is "tv show", any tag is "tag". */
export function plainType(type: string): string {
  if (type.startsWith("urn:tag")) return "tag";
  const entity = /^urn:entity:([a-z_]+)$/.exec(type)?.[1];
  return (entity ?? type).replace(/_/g, " ");
}
