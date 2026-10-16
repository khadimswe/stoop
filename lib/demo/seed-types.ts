// The Qloo entity type of every seed in the candidate pool. A founder picks seeds from Qloo
// autocomplete, which already knows the type; the pool's seeds are plain strings, so their types are
// written down here. Searching with the right type matters: without it, a brand name can resolve to
// a film or a person (fixtures/probe-search.json).
import type { EntityType } from "../qloo/constants";
import { CANDIDATES } from "./candidates";

export const SEED_TYPES: Readonly<Record<string, EntityType>> = {
  Carhartt: "brand",
  Champion: "brand",
  "Tyler, the Creator": "artist",
  "Rick and Morty": "tv_show",
  Nike: "brand",
  StockX: "brand",
  "Jason Markk": "brand",
  "Travis Scott": "artist",
  CeraVe: "brand",
  Glossier: "brand",
  "The Ordinary": "brand",
  "Emma Chamberlain": "person",
  "Blue Bottle Coffee": "brand",
  Chemex: "brand",
  "The Bear": "tv_show",
  Radiolab: "podcast",
  "Hot Ones": "tv_show",
  "Trader Joe's": "brand",
  "Parts Unknown": "tv_show",
  Tabasco: "brand",
  "Bath & Body Works": "brand",
  Anthropologie: "brand",
  "Phoebe Bridgers": "artist",
  Bridgerton: "tv_show",
  BarkBox: "brand",
  Chewy: "brand",
  "Taylor Swift": "artist",
  "Schitt's Creek": "tv_show",
  CapCut: "brand",
  Canva: "brand",
  "Casey Neistat": "person",
  "The Diary of a CEO": "podcast",
  Strava: "brand",
  Rapha: "brand",
  GoPro: "brand",
  "Freakonomics Radio": "podcast",
};

export function seedType(seed: string): EntityType {
  const type = SEED_TYPES[seed];
  if (!type) throw new Error(`No entity type for seed "${seed}". Add it to lib/demo/seed-types.ts.`);
  return type;
}

/** Every seed in the pool, each once. */
export function poolSeeds(candidates = CANDIDATES): string[] {
  return [...new Set(candidates.flatMap((c) => c.seeds))];
}
