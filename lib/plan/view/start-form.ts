// The store form on /start: what a manager types, checked in plain words, then turned into the plan
// inputs POST /api/plan takes (lib/plan/schema.ts `inputsSchema`). Pure, so the browser and the tests
// check it the same way. Offers are kept word for word: the plan never invents one.
import { AGE_BUCKETS, type AgeBucket } from "../../qloo/constants";
import { settingHasGame, type TableGame } from "../game";
import { CARRIERS, GAMES, inputsSchema, SETTINGS, type PlanInputs } from "../schema";

export type Carrier = (typeof CARRIERS)[number];
export type Setting = (typeof SETTINGS)[number];

/** Settings away from the store: the form asks where (lib/plan/view/format.ts AWAY_SETTINGS). */
const AWAY: readonly Setting[] = ["nearby_venue", "community_event"];

export interface StoreFormValues {
  storeName: string;
  carrier: Carrier;
  address: string;
  city: string;
  region: string;
  /** Public, printed on the poster and the event page. */
  phone: string;
  /** The dealer's internal store number, for My stores; never public. */
  storeNumber: string;
  lat: string;
  lon: string;
  date: string;
  startTime: string;
  durationMinutes: string;
  setting: Setting;
  /** The game at an outdoor table: the prize wheel, or a drop board with 6 slots. */
  game: TableGame;
  /** Where the event happens when it is away from the store (a fair, a nearby venue). */
  venueName: string;
  venueLat: string;
  venueLon: string;
  budgetUsd: string;
  /** The store's promo list, one per row: up to MAX_OFFERS. */
  offers: string[];
  ageBands: AgeBucket[];
  notes: string;
}

export type StoreField = Exclude<keyof StoreFormValues, "offers"> | `offer${number}` | "point";

/** Enough promos to fill a tabletop prize wheel with the store's real deals. */
export const MAX_OFFERS = 8;

/** The order fields appear in, so the first error gets focus. */
export const FIELD_ORDER: readonly StoreField[] = [
  "storeName",
  "carrier",
  "address",
  "city",
  "region",
  "phone",
  "point",
  "lat",
  "lon",
  "date",
  "startTime",
  "durationMinutes",
  "setting",
  "game",
  "venueName",
  "venueLat",
  "venueLon",
  "budgetUsd",
  ...Array.from({ length: 8 }, (_, i) => `offer${i}` as const),
  "storeNumber",
  "ageBands",
  "notes",
];

/** Where /start leaves an example's message (live plans paused) for the example page to show once. */
export const PLAN_NOTICE_KEY = "stoop:plan-notice";

export const LIMITS = { storeName: 80, venueName: 120, address: 200, city: 80, region: 40, offer: 140, notes: 280, budget: 5000, maxBands: 3 } as const;

/** The least a plan can work with, in dollars. */
export const BUDGET_MIN = 10;

/** How far ahead an event can be, in days: the same limit the server keeps (lib/plan/runtime.ts). */
export const EVENT_DAYS_AHEAD = 28;

/**
 * Why a phone number can't go on the poster, or null when it can (or is left empty): digits and the
 * usual separators only, the same rule the plan's inputs use.
 */
export function phoneProblem(phone: string): string | null {
  const p = phone.trim();
  if (!p) return null;
  if (/[a-z]/i.test(p)) return "Use digits only, like (312) 555-0142. Leave out words and extensions.";
  if (!/^[0-9()+.\-\s]{7,24}$/.test(p)) return "Use digits, like (312) 555-0142.";
  return null;
}

/** Event lengths the form offers, in minutes. */
export const DURATIONS = [60, 90, 120, 180, 240, 300, 360, 480] as const;

export function emptyStoreForm(): StoreFormValues {
  return {
    storeName: "",
    carrier: "metro",
    address: "",
    city: "",
    region: "",
    phone: "",
    storeNumber: "",
    lat: "",
    lon: "",
    date: "",
    startTime: "12:00",
    durationMinutes: "240",
    setting: "sidewalk_table",
    game: "wheel",
    venueName: "",
    venueLat: "",
    venueLon: "",
    budgetUsd: "100",
    offers: ["", "", ""],
    ageBands: ["25_to_29", "30_to_34"],
    notes: "",
  };
}

/** The next Saturday on or after `today` (local calendar), as "YYYY-MM-DD". */
export function nextSaturday(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A store id the plan can key on: the name and city, lowercased, with dashes. */
export function storeSlug(name: string, city: string): string {
  const slug = `${name} ${city}`
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "store";
}

/** "41.85760" from a coordinate, at about one-meter precision. */
export function coordText(value: number): string {
  return value.toFixed(5);
}

function decimal(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d{1,3}(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export type ParseResult = { ok: true; inputs: PlanInputs } | { ok: false; errors: Partial<Record<StoreField, string>> };

/**
 * Checks the form and builds the plan inputs. `today` ("YYYY-MM-DD") rejects past dates; leave it out
 * to skip that check. Every message says what to do, in plain words.
 */
export function parseStoreForm(values: StoreFormValues, today?: string): ParseResult {
  const errors: Partial<Record<StoreField, string>> = {};
  const required = (field: StoreField, text: string, label: string, max: number) => {
    const t = text.trim();
    if (!t) errors[field] = `Enter the ${label}.`;
    else if (t.length > max) errors[field] = `Keep the ${label} to ${max} characters.`;
    return t;
  };

  const name = required("storeName", values.storeName, "store name", LIMITS.storeName);
  const address = required("address", values.address, "street address", LIMITS.address);
  const city = required("city", values.city, "city", LIMITS.city);
  const region = required("region", values.region, "state", LIMITS.region);
  if (!(CARRIERS as readonly string[]).includes(values.carrier)) errors.carrier = "Pick the store's carrier.";
  const phone = values.phone.trim();
  const badPhone = phoneProblem(phone);
  if (badPhone) errors.phone = badPhone;
  const storeNumber = values.storeNumber.trim();
  if (storeNumber.length > 24) errors.storeNumber = "Keep it to 24 characters.";

  const lat = decimal(values.lat);
  const lon = decimal(values.lon);
  if (!values.lat.trim() && !values.lon.trim()) errors.point = "Tap Use my location, or type the coordinates.";
  else {
    if (lat === null || lat < -90 || lat > 90) errors.lat = "Latitude runs from -90 to 90.";
    if (lon === null || lon < -180 || lon > 180) errors.lon = "Longitude runs from -180 to 180.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(Date.parse(`${values.date}T12:00:00Z`))) errors.date = "Pick the event day.";
  else if (today && values.date < today) errors.date = "Pick today or a day ahead.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.startTime)) errors.startTime = "Pick a start time.";
  const duration = Number(values.durationMinutes);
  if (!Number.isInteger(duration) || duration < 30 || duration > 480) errors.durationMinutes = "Pick how long the event runs.";
  if (!(SETTINGS as readonly string[]).includes(values.setting)) errors.setting = "Pick where the event happens.";
  if (!(GAMES as readonly string[]).includes(values.game ?? "wheel")) errors.game = "Pick the game: a prize wheel or a drop board.";

  // Away from the store (a fair, a nearby venue): optional, but all three parts or none.
  let location: PlanInputs["location"];
  if (AWAY.includes(values.setting)) {
    const venue = values.venueName.trim();
    const vLat = decimal(values.venueLat);
    const vLon = decimal(values.venueLon);
    if (venue || values.venueLat.trim() || values.venueLon.trim()) {
      if (!venue) errors.venueName = "Name the place, like Pilsen Fall Fest.";
      else if (venue.length > LIMITS.venueName) errors.venueName = `Keep the place name to ${LIMITS.venueName} characters.`;
      if (vLat === null || vLat < -90 || vLat > 90) errors.venueLat = "Latitude is a number from -90 to 90.";
      if (vLon === null || vLon < -180 || vLon > 180) errors.venueLon = "Longitude is a number from -180 to 180.";
      if (venue && vLat !== null && vLon !== null) location = { name: venue, point: { lat: vLat, lon: vLon } };
    }
  }

  const budgetText = values.budgetUsd.trim().replace(/^\$/, "");
  const budget = Number(budgetText);
  if (!/^\d+$/.test(budgetText)) errors.budgetUsd = "Enter the budget in whole dollars, like 150.";
  else if (budget > LIMITS.budget) errors.budgetUsd = `Stoop plans events up to $${LIMITS.budget.toLocaleString("en-US")}.`;
  else if (budget < BUDGET_MIN) errors.budgetUsd = `Plan with at least $${BUDGET_MIN}.`;

  const offers = values.offers.map((o) => o.trim());
  offers.forEach((o, i) => {
    if (o.length > LIMITS.offer) errors[`offer${i}`] = `Keep each promo to ${LIMITS.offer} characters.`;
  });
  if (offers.filter(Boolean).length > MAX_OFFERS) errors[`offer${MAX_OFFERS}`] = `Up to ${MAX_OFFERS} promos.`;

  const bands = AGE_BUCKETS.filter((b) => values.ageBands.includes(b));
  if (bands.length === 0) errors.ageBands = "Pick at least one age band.";
  else if (bands.length > LIMITS.maxBands) errors.ageBands = `Pick up to ${LIMITS.maxBands} age bands.`;

  const notes = values.notes.trim();
  if (notes.length > LIMITS.notes) errors.notes = `Keep notes to ${LIMITS.notes} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = inputsSchema.safeParse({
    store: { id: storeSlug(name, city), name, carrier: values.carrier, address, city, region, point: { lat, lon }, ...(phone ? { phone } : {}), ...(storeNumber ? { storeNumber } : {}) },
    date: values.date,
    startTime: values.startTime,
    durationMinutes: duration,
    setting: values.setting,
    // A drop board is sent only when the setting has a game; the wheel is the default and is never sent.
    ...(settingHasGame(values.setting) && values.game === "drop_board" ? { game: "drop_board" as const } : {}),
    ...(location ? { location } : {}),
    budgetUsd: budget,
    offers: offers.filter(Boolean).map((text) => ({ text })),
    ageBands: bands,
    ...(notes ? { notes } : {}),
  });
  if (!parsed.success) return { ok: false, errors: { storeName: "Something in the form does not look right. Check each field." } };
  return { ok: true, inputs: parsed.data };
}

/** The first field with an error, in screen order. */
export function firstError(errors: Partial<Record<StoreField, string>>): StoreField | null {
  return FIELD_ORDER.find((f) => errors[f]) ?? null;
}
