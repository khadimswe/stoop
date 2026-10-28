// The store form on /start: what a manager types, checked in plain words, then turned into the plan
// inputs POST /api/plan takes (lib/plan/schema.ts `inputsSchema`). Pure, so the browser and the tests
// check it the same way. Offers are kept word for word: the plan never invents one.
import { AGE_BUCKETS, type AgeBucket } from "../../qloo/constants";
import { CARRIERS, inputsSchema, SETTINGS, type PlanInputs } from "../schema";

export type Carrier = (typeof CARRIERS)[number];
export type Setting = (typeof SETTINGS)[number];

export interface StoreFormValues {
  storeName: string;
  carrier: Carrier;
  address: string;
  city: string;
  region: string;
  lat: string;
  lon: string;
  date: string;
  startTime: string;
  durationMinutes: string;
  setting: Setting;
  budgetUsd: string;
  offers: [string, string, string];
  ageBands: AgeBucket[];
  notes: string;
}

export type StoreField = Exclude<keyof StoreFormValues, "offers"> | "offer0" | "offer1" | "offer2" | "point";

/** The order fields appear in, so the first error gets focus. */
export const FIELD_ORDER: readonly StoreField[] = [
  "storeName",
  "carrier",
  "address",
  "city",
  "region",
  "point",
  "lat",
  "lon",
  "date",
  "startTime",
  "durationMinutes",
  "setting",
  "budgetUsd",
  "offer0",
  "offer1",
  "offer2",
  "ageBands",
  "notes",
];

/** Where /start leaves an example's message (live plans paused) for the example page to show once. */
export const PLAN_NOTICE_KEY = "stoop:plan-notice";

export const LIMITS = { storeName: 80, address: 200, city: 80, region: 40, offer: 140, notes: 280, budget: 5000, maxBands: 3 } as const;

/** Event lengths the form offers, in minutes. */
export const DURATIONS = [60, 90, 120, 180, 240, 300, 360, 480] as const;

export function emptyStoreForm(): StoreFormValues {
  return {
    storeName: "",
    carrier: "metro",
    address: "",
    city: "",
    region: "",
    lat: "",
    lon: "",
    date: "",
    startTime: "12:00",
    durationMinutes: "240",
    setting: "sidewalk_table",
    budgetUsd: "150",
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

  const lat = decimal(values.lat);
  const lon = decimal(values.lon);
  if (!values.lat.trim() && !values.lon.trim()) errors.point = "Add the store's location: tap Use my location at the store, or type its latitude and longitude.";
  else {
    if (lat === null || lat < -90 || lat > 90) errors.lat = "Latitude is a number from -90 to 90, like 41.85760.";
    if (lon === null || lon < -180 || lon > 180) errors.lon = "Longitude is a number from -180 to 180, like -87.65660.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(Date.parse(`${values.date}T12:00:00Z`))) errors.date = "Pick the event day.";
  else if (today && values.date < today) errors.date = "Pick today or a day ahead.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.startTime)) errors.startTime = "Pick a start time.";
  const duration = Number(values.durationMinutes);
  if (!Number.isInteger(duration) || duration < 30 || duration > 480) errors.durationMinutes = "Pick how long the event runs.";
  if (!(SETTINGS as readonly string[]).includes(values.setting)) errors.setting = "Pick where the event happens.";

  const budgetText = values.budgetUsd.trim().replace(/^\$/, "");
  const budget = Number(budgetText);
  if (!/^\d+$/.test(budgetText)) errors.budgetUsd = "Enter the budget in whole dollars, like 150.";
  else if (budget > LIMITS.budget) errors.budgetUsd = `Stoop plans events up to $${LIMITS.budget.toLocaleString("en-US")}.`;

  const offers = values.offers.map((o) => o.trim());
  offers.forEach((o, i) => {
    if (o.length > LIMITS.offer) errors[`offer${i}` as StoreField] = `Keep each offer to ${LIMITS.offer} characters.`;
  });

  const bands = AGE_BUCKETS.filter((b) => values.ageBands.includes(b));
  if (bands.length === 0) errors.ageBands = "Pick at least one age band.";
  else if (bands.length > LIMITS.maxBands) errors.ageBands = `Pick up to ${LIMITS.maxBands} age bands.`;

  const notes = values.notes.trim();
  if (notes.length > LIMITS.notes) errors.notes = `Keep notes to ${LIMITS.notes} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = inputsSchema.safeParse({
    store: { id: storeSlug(name, city), name, carrier: values.carrier, address, city, region, point: { lat, lon } },
    date: values.date,
    startTime: values.startTime,
    durationMinutes: duration,
    setting: values.setting,
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
