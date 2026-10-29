// GET /api/geocode?q=<address> or ?lat=&lon=: finds a store's address on OpenStreetMap's Nominatim,
// server side, so the manager never types coordinates. Only the typed address (or the point the
// browser shared) is sent: no cookies, no IP, nothing about the person. Nominatim's policy is met
// with a named User-Agent, at most one request a second across the site (a short store lock) and a
// 30-day cache; each visitor gets 30 lookups an hour.
import { z } from "zod";
import { getBotCheck } from "@/lib/bot-check";
import { hashOf } from "@/lib/hash";
import { apiError } from "@/lib/http";
import { failSafe, guard } from "@/lib/routes/guard";
import { json } from "@/lib/runtime/respond";
import { getStore } from "@/lib/store";

const NOMINATIM = "https://nominatim.openstreetmap.org";
const USER_AGENT = "stoop (store events planner)";
const RULE = { name: "geocode", limit: 30, windowSeconds: 60 * 60 } as const;
const CACHE_TTL = 30 * 24 * 60 * 60;

const query = z.union([
  z.object({ q: z.string().trim().min(4).max(200) }),
  z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) }),
]);

export interface GeocodeHit {
  /** The street line, like "1240 W 18th St". */
  address: string;
  city: string;
  /** The state's postal code when Nominatim knows it, else its name. */
  region: string;
  lat: number;
  lon: number;
  /** The whole place name, for the pick list. */
  label: string;
}

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
}

function hitOf(p: NominatimPlace): GeocodeHit | null {
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  const a = p.address ?? {};
  const city = a.city ?? a.town ?? a.village ?? a.suburb ?? a.county ?? "";
  const state = a.state ?? "";
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !city) return null;
  const street = [a.house_number, a.road].filter(Boolean).join(" ") || (p.display_name ?? "").split(",")[0] || "";
  return { address: street, city, region: STATES[state.toLowerCase()] ?? state, lat, lon, label: p.display_name ?? `${street}, ${city}` };
}

/** Waits for the site-wide slot: one Nominatim request a second. */
async function slot(store: ReturnType<typeof getStore>): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    if (await store.set("geocode:slot", 1, { ifAbsent: true, ttlSeconds: 1 })) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function GET(request: Request) {
  return failSafe("geocode", async () => {
    const admitted = await guard(request, { store: getStore, botCheck: getBotCheck }, RULE);
    if (!admitted.ok) return admitted.response;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = query.safeParse(params);
    if (!parsed.success) return apiError("invalid", "Type the store's street address, city and state.", 400);
    const ask = "q" in parsed.data ? parsed.data : { lat: parsed.data.lat.toFixed(5), lon: parsed.data.lon.toFixed(5) };
    const cacheKey = `geocode:${hashOf(ask)}`;
    const { store } = admitted;
    const cached = await store.get<GeocodeHit[]>(cacheKey);
    if (cached) return json({ hits: cached });
    if (!(await slot(store))) return apiError("rate_limited", "Address search is busy. Try again in a few seconds.", 429, { "Retry-After": "2" });

    const url =
      "q" in ask
        ? `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&q=${encodeURIComponent(ask.q)}`
        : `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${ask.lat}&lon=${ask.lon}`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) return apiError("failed", "Address search isn't answering right now. Try again in a minute.", 502);
    const body: unknown = await response.json();
    const list = (Array.isArray(body) ? body : [body]) as NominatimPlace[];
    const hits = list.map(hitOf).filter((h): h is GeocodeHit => h !== null);
    await store.set(cacheKey, hits, { ttlSeconds: CACHE_TTL }).catch(() => undefined);
    return json({ hits });
  });
}
