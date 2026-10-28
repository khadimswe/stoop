// Which place Qloo reads as the store's city. The city's taste is read by name
// (signal.location.query), and small towns share names with bigger places elsewhere: "Jonesboro"
// resolves to Arkansas, "Decatur" to Alabama, "Duluth" to Minnesota, even "Riverdale, GA" to Maryland
// (the Oct 28 proof lab). Qloo echoes the locality it used at query.localities.signal, so each answer
// is checked against the store's state: the bare name first, then "<city>, <region>", then
// "<city>, <state name>", and as a last resort the nearest major city in the same state, said plainly.
import { z } from "zod";
import { insightsEntitiesResponse, type QlooEntity } from "../qloo/types";

export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

/** The state a store's region names ("GA" or "Georgia"), as its abbreviation and full name. */
export function stateOf(region: string): { abbr: string; name: string } | null {
  const text = region.trim();
  const upper = text.toUpperCase();
  if (STATES[upper]) return { abbr: upper, name: STATES[upper] as string };
  const entry = Object.entries(STATES).find(([, name]) => name.toLowerCase() === text.toLowerCase());
  return entry ? { abbr: entry[0], name: entry[1] } : null;
}

type City = readonly [name: string, lat: number, lon: number];

/** Major cities per state, for the last resort. Approximate centers; only the nearest one matters. */
export const MAJOR_CITIES: Record<string, readonly City[]> = {
  AL: [["Birmingham", 33.52, -86.8], ["Montgomery", 32.37, -86.3], ["Mobile", 30.69, -88.04], ["Huntsville", 34.73, -86.59]],
  AK: [["Anchorage", 61.22, -149.9]],
  AZ: [["Phoenix", 33.45, -112.07], ["Tucson", 32.22, -110.97]],
  AR: [["Little Rock", 34.75, -92.29]],
  CA: [["Los Angeles", 34.05, -118.24], ["San Diego", 32.72, -117.16], ["San Jose", 37.34, -121.89], ["San Francisco", 37.77, -122.42], ["Fresno", 36.74, -119.79], ["Sacramento", 38.58, -121.49]],
  CO: [["Denver", 39.74, -104.99], ["Colorado Springs", 38.83, -104.82]],
  CT: [["Hartford", 41.76, -72.69], ["New Haven", 41.31, -72.92]],
  DE: [["Wilmington", 39.74, -75.55]],
  DC: [["Washington", 38.91, -77.04]],
  FL: [["Miami", 25.76, -80.19], ["Tampa", 27.95, -82.46], ["Orlando", 28.54, -81.38], ["Jacksonville", 30.33, -81.66], ["Tallahassee", 30.44, -84.28]],
  GA: [["Atlanta", 33.75, -84.39], ["Savannah", 32.08, -81.09], ["Augusta", 33.47, -81.97], ["Columbus", 32.46, -84.99], ["Macon", 32.84, -83.63]],
  HI: [["Honolulu", 21.31, -157.86]],
  ID: [["Boise", 43.62, -116.2]],
  IL: [["Chicago", 41.88, -87.63], ["Springfield", 39.78, -89.65], ["Peoria", 40.69, -89.59], ["Rockford", 42.27, -89.09]],
  IN: [["Indianapolis", 39.77, -86.16], ["Fort Wayne", 41.08, -85.14]],
  IA: [["Des Moines", 41.59, -93.62]],
  KS: [["Wichita", 37.69, -97.34], ["Kansas City", 39.11, -94.63]],
  KY: [["Louisville", 38.25, -85.76], ["Lexington", 38.04, -84.5]],
  LA: [["New Orleans", 29.95, -90.07], ["Baton Rouge", 30.45, -91.15], ["Shreveport", 32.53, -93.75]],
  ME: [["Portland", 43.66, -70.26]],
  MD: [["Baltimore", 39.29, -76.61]],
  MA: [["Boston", 42.36, -71.06], ["Worcester", 42.26, -71.8], ["Springfield", 42.1, -72.59]],
  MI: [["Detroit", 42.33, -83.05], ["Grand Rapids", 42.96, -85.67]],
  MN: [["Minneapolis", 44.98, -93.27]],
  MS: [["Jackson", 32.3, -90.18]],
  MO: [["Kansas City", 39.1, -94.58], ["St. Louis", 38.63, -90.2]],
  MT: [["Billings", 45.78, -108.5]],
  NE: [["Omaha", 41.26, -95.93]],
  NV: [["Las Vegas", 36.17, -115.14], ["Reno", 39.53, -119.81]],
  NH: [["Manchester", 42.99, -71.46]],
  NJ: [["Newark", 40.74, -74.17], ["Jersey City", 40.72, -74.08]],
  NM: [["Albuquerque", 35.08, -106.65]],
  NY: [["New York", 40.71, -74.01], ["Buffalo", 42.89, -78.88], ["Rochester", 43.16, -77.61], ["Albany", 42.65, -73.76], ["Syracuse", 43.05, -76.15]],
  NC: [["Charlotte", 35.23, -80.84], ["Raleigh", 35.78, -78.64], ["Greensboro", 36.07, -79.79]],
  ND: [["Fargo", 46.88, -96.79]],
  OH: [["Columbus", 39.96, -83.0], ["Cleveland", 41.5, -81.69], ["Cincinnati", 39.1, -84.51], ["Toledo", 41.65, -83.54]],
  OK: [["Oklahoma City", 35.47, -97.52], ["Tulsa", 36.15, -95.99]],
  OR: [["Portland", 45.52, -122.68]],
  PA: [["Philadelphia", 39.95, -75.17], ["Pittsburgh", 40.44, -80.0]],
  PR: [["San Juan", 18.47, -66.11]],
  RI: [["Providence", 41.82, -71.41]],
  SC: [["Columbia", 34.0, -81.03], ["Charleston", 32.78, -79.93]],
  SD: [["Sioux Falls", 43.55, -96.73]],
  TN: [["Nashville", 36.16, -86.78], ["Memphis", 35.15, -90.05], ["Knoxville", 35.96, -83.92], ["Chattanooga", 35.05, -85.31]],
  TX: [["Houston", 29.76, -95.37], ["Dallas", 32.78, -96.8], ["San Antonio", 29.42, -98.49], ["Austin", 30.27, -97.74], ["Fort Worth", 32.76, -97.33], ["El Paso", 31.76, -106.49]],
  UT: [["Salt Lake City", 40.76, -111.89]],
  VT: [["Burlington", 44.48, -73.21]],
  VA: [["Virginia Beach", 36.85, -75.98], ["Richmond", 37.54, -77.44]],
  WA: [["Seattle", 47.61, -122.33], ["Spokane", 47.66, -117.43]],
  WV: [["Charleston", 38.35, -81.63]],
  WI: [["Milwaukee", 43.04, -87.91], ["Madison", 43.07, -89.4]],
  WY: [["Cheyenne", 41.14, -104.82]],
};

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
};

/** The nearest major city in the state, or null when the state is unknown. */
export function nearestMajorCity(abbr: string, point: { lat: number; lon: number }): { name: string; km: number } | null {
  const best = (MAJOR_CITIES[abbr] ?? []).map(([name, lat, lon]) => ({ name, km: km(point, { lat, lon }) })).sort((a, b) => a.km - b.km)[0];
  return best ? { name: best.name, km: Math.round(best.km) } : null;
}

/** The names to try, in order: the bare city, "<city>, <abbr>", "<city>, <state>". Without a known state, the city alone. */
export function cityQueries(city: string, region: string): string[] {
  const name = city.trim();
  const state = stateOf(region);
  const tries = state ? [name, `${name}, ${state.abbr}`, `${name}, ${state.name}`] : [name];
  return [...new Set(tries)];
}

export interface Locality {
  name: string;
  /** "Jonesboro, Clayton County, Georgia, United States" */
  disambiguation: string | null;
}

const echo = z.looseObject({
  query: z.looseObject({ localities: z.looseObject({ signal: z.looseObject({ name: z.string(), disambiguation: z.string().nullish() }).nullish() }).nullish() }).nullish(),
});

/** The locality Qloo says it used for signal.location.query, or null when it sends none. */
export function signalLocality(body: unknown): Locality | null {
  const parsed = echo.safeParse(body);
  const signal = parsed.success ? parsed.data.query?.localities?.signal : null;
  return signal ? { name: signal.name, disambiguation: signal.disambiguation ?? null } : null;
}

/** True when the locality is in the named state (its disambiguation ends with "<state>, United States"). */
export function inState(locality: Locality, stateName: string): boolean {
  const text = (locality.disambiguation ?? locality.name).toLowerCase();
  const state = stateName.toLowerCase();
  return text.endsWith(`, ${state}, united states`) || text.endsWith(`, ${state}`) || text === state;
}

/** Artist insights with the locality Qloo read, so the city can be checked against the store's state. */
export const artistsWithLocality = z.unknown().transform((body, ctx): { entities: QlooEntity[]; locality: Locality | null } => {
  const entities = insightsEntitiesResponse.safeParse(body);
  if (!entities.success) {
    for (const issue of entities.error.issues.slice(0, 3)) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    return z.NEVER;
  }
  return { entities: entities.data, locality: signalLocality(body) };
});
