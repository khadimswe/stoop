// Proof lab, step 1: find real Metro by T-Mobile stores across metro Atlanta from public OpenStreetMap
// data, as anonymous data points for the store-to-store test. Nothing here calls Qloo or Claude.
//
// Sources, in order: the Overpass API (shop with the Metro by T-Mobile brand wikidata id), then
// Nominatim searches by city as a fallback when Overpass is at capacity, then the OSM API for each
// node's tags (its store-locator link). Nominatim's usage policy is one request per second with an
// identifying User-Agent: every request here waits 1.1 s and sends the generic "stoop-proof" agent.
// No personal data goes anywhere.
//
// Output (private, excluded from the public mirror): data/proof/osm/stores-raw.json (metro Atlanta),
// or stores-raw-<metro>.json with --metro dallas (round 3's holdout metro).
//   npx tsx scripts/proof-stores.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METRO = process.argv.includes("--metro") ? (process.argv[process.argv.indexOf("--metro") + 1] ?? "atlanta") : "atlanta";
const OUT = path.join(ROOT, "data", "proof", "osm", METRO === "atlanta" ? "stores-raw.json" : `stores-raw-${METRO}.json`);
const UA = "stoop-proof";
const BRAND_WIKIDATA = "Q1925685"; // Metro by T-Mobile
const METROS: Record<string, { bbox: { south: number; west: number; north: number; east: number }; state: string; cities: string[] }> = {
  // Cities and towns across metro Atlanta, chosen to spread the search over clearly different areas
  // (north, south, east, west, in town and suburbs). The search finds whatever OSM has in each.
  atlanta: {
    bbox: { south: 33.3, west: -84.95, north: 34.25, east: -83.85 },
    state: "Georgia",
    cities: [
      "Atlanta", "Jonesboro", "Riverdale", "Forest Park", "Morrow", "College Park", "East Point", "Union City", "Kennesaw", "Marietta", "Smyrna",
      "Austell", "Douglasville", "Decatur", "Stone Mountain", "Lithonia", "Norcross", "Doraville", "Chamblee", "Duluth", "Lawrenceville",
      "Snellville", "Alpharetta", "Roswell", "Sandy Springs", "Tucker", "Conyers", "Stockbridge", "McDonough", "Lilburn", "Buford",
    ],
  },
  // Round 3's holdout: Dallas and Fort Worth, a metro no example store and no pipeline fix ever used.
  dallas: {
    bbox: { south: 32.55, west: -97.55, north: 33.25, east: -96.45 },
    state: "Texas",
    cities: [
      "Dallas", "Fort Worth", "Arlington", "Irving", "Garland", "Mesquite", "Grand Prairie", "Plano", "Richardson", "Carrollton", "Denton",
      "McKinney", "Frisco", "Lewisville", "DeSoto", "Duncanville", "Lancaster", "Cedar Hill", "Rowlett", "Haltom City", "North Richland Hills",
    ],
  },
};
const CONFIG = METROS[METRO];
if (!CONFIG) throw new Error(`Unknown metro "${METRO}". Metros: ${Object.keys(METROS).join(", ")}`);
const BBOX = CONFIG.bbox;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Found {
  osm: string;
  lat: number;
  lon: number;
  name: string | null;
  road: string | null;
  houseNumber: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  website: string | null;
  source: string;
}

async function overpass(): Promise<Found[] | null> {
  const query = `[out:json][timeout:60];nwr["brand:wikidata"="${BRAND_WIKIDATA}"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});out center tags;`;
  for (const [i, host] of ["https://overpass-api.de", "https://overpass.private.coffee", "https://overpass.kumi.systems"].entries()) {
    try {
      const res = await fetch(`${host}/api/interpreter`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
      return body.elements.map((e) => ({
        osm: `${e.type}/${e.id}`,
        lat: e.lat ?? e.center?.lat ?? NaN,
        lon: e.lon ?? e.center?.lon ?? NaN,
        name: e.tags?.name ?? null,
        road: e.tags?.["addr:street"] ?? null,
        houseNumber: e.tags?.["addr:housenumber"] ?? null,
        city: e.tags?.["addr:city"] ?? null,
        county: null,
        postcode: e.tags?.["addr:postcode"] ?? null,
        website: e.tags?.website ?? null,
        source: `overpass ${host}`,
      }));
    } catch (error) {
      console.log(`overpass ${host}: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(5_000 * (i + 1));
    }
  }
  return null;
}

interface NominatimHit {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name: string;
  category: string;
  type: string;
  address: Record<string, string>;
}

async function nominatim(q: string): Promise<NominatimHit[]> {
  await sleep(1_100);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries({ q, format: "jsonv2", limit: "40", countrycodes: "us", addressdetails: "1", viewbox: `${BBOX.west},${BBOX.north},${BBOX.east},${BBOX.south}`, bounded: "1" })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`);
  return (await res.json()) as NominatimHit[];
}

async function nodeTags(osm: string): Promise<Record<string, string>> {
  await sleep(1_100);
  const res = await fetch(`https://api.openstreetmap.org/api/0.6/${osm}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return {};
  const body = (await res.json()) as { elements: { tags?: Record<string, string> }[] };
  return body.elements[0]?.tags ?? {};
}


/** `--reverse lat,lon ...` names the street at each point; `--search "address" ...` geocodes addresses. */
async function lookups(args: string[]): Promise<boolean> {
  const mode = args[0];
  if (mode !== "--reverse" && mode !== "--search") return false;
  for (const value of args.slice(1)) {
    await sleep(1_100);
    const url = new URL(`https://nominatim.openstreetmap.org/${mode === "--reverse" ? "reverse" : "search"}`);
    const params: Record<string, string> = mode === "--reverse"
      ? { format: "jsonv2", lat: value.split(",")[0] ?? "", lon: value.split(",")[1] ?? "", zoom: "18", addressdetails: "1" }
      : { format: "jsonv2", q: value, countrycodes: "us", addressdetails: "1", limit: "3" };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json()) as unknown;
    const hits = (Array.isArray(body) ? body : [body]) as { lat?: string; lon?: string; display_name?: string; address?: Record<string, string> }[];
    for (const h of hits) {
      const a = h.address ?? {};
      console.log(`${value} | ${h.lat},${h.lon} | ${a.house_number ?? ""} ${a.road ?? ""} | ${a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? ""} ${a.postcode ?? ""} | ${h.display_name ?? ""}`);
    }
  }
  return true;
}

async function main(): Promise<void> {
  if (await lookups(process.argv.slice(2))) return;
  const found = new Map<string, Found>();
  const fromOverpass = await overpass();
  if (fromOverpass) for (const f of fromOverpass) found.set(f.osm, f);
  console.log(`overpass: ${fromOverpass ? fromOverpass.length : "unavailable"}`);
  for (const city of CONFIG.cities) {
    for (const q of [`Metro by T-Mobile, ${city}, ${CONFIG.state}`]) {
      let hits: NominatimHit[] = [];
      try {
        hits = await nominatim(q);
      } catch (error) {
        console.log(`${q}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const metro = hits.filter((h) => /metro/i.test(h.name ?? "") && (h.category === "shop" || h.type === "mobile_phone"));
      console.log(`${q}: ${hits.length} hits, ${metro.length} Metro shops`);
      for (const h of metro) {
        const osm = `${h.osm_type}/${h.osm_id}`;
        if (found.has(osm)) continue;
        const a = h.address;
        found.set(osm, {
          osm,
          lat: Number(h.lat),
          lon: Number(h.lon),
          name: h.name,
          road: a.road ?? null,
          houseNumber: a.house_number ?? null,
          city: a.city ?? a.town ?? a.village ?? a.hamlet ?? null,
          county: a.county ?? null,
          postcode: a.postcode ?? null,
          website: null,
          source: `nominatim "${q}"`,
        });
      }
    }
  }
  // Each node's tags: the store-locator link names the store's city and id.
  for (const f of found.values()) {
    if (f.website) continue;
    const tags = await nodeTags(f.osm);
    f.website = tags.website ?? null;
    if (tags.brand && tags["brand:wikidata"] !== BRAND_WIKIDATA) f.source += ` (brand ${tags.brand})`;
  }
  const stores = [...found.values()].sort((a, b) => b.lat - a.lat);
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), note: "Public OpenStreetMap data (ODbL). Private: real store locations, never published.", stores }, null, 2)}\n`);
  console.log(`${stores.length} stores -> ${path.relative(ROOT, OUT)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
