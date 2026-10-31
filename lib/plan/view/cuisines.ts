// The Community step's one-line food summary: the cuisine and food-type tags Qloo put on the food
// places near the store, counted and ranked. View layer only: it reads the plan's own places, makes
// no Qloo call, and describes places, never people ("The food spots near your store, by Qloo's tags:
// most often A, B and C"). Only tags on the allow list below count; price, ambience, service and
// generic tags (Restaurant, Food, Inexpensive, Casual, Takeout, Fast food, Lively...) never do.

/** The fewest food places that must carry an allowed tag before the line shows. */
export const MIN_FOOD_PLACES = 2;
/** How many cuisines the line names. */
export const TOP_CUISINES = 3;

/**
 * Each label the line can say, with the Qloo tag names (lowercase) that count toward it. Tags that
 * name the same kind of spot share a label ("Coffee shop" and "Cafe" are both "coffee"), so a place
 * carrying both counts once. Cuisine adjectives keep their capital; food types stay lowercase.
 */
const CUISINE_TAGS: Readonly<Record<string, readonly string[]>> = {
  // Cuisines.
  Mexican: ["mexican", "mexican restaurant", "taqueria", "taco restaurant"],
  "Tex-Mex": ["tex mex", "tex-mex", "tex mex restaurant"],
  "Latin American": ["latin american", "latin american restaurant"],
  Salvadoran: ["salvadoran", "salvadoran restaurant", "pupuseria"],
  Honduran: ["honduran", "honduran restaurant"],
  Guatemalan: ["guatemalan", "guatemalan restaurant"],
  Cuban: ["cuban", "cuban restaurant"],
  "Puerto Rican": ["puerto rican", "puerto rican restaurant"],
  Dominican: ["dominican", "dominican restaurant"],
  Colombian: ["colombian", "colombian restaurant"],
  Peruvian: ["peruvian", "peruvian restaurant"],
  Venezuelan: ["venezuelan", "venezuelan restaurant"],
  Brazilian: ["brazilian", "brazilian restaurant"],
  Caribbean: ["caribbean", "caribbean restaurant"],
  Jamaican: ["jamaican", "jamaican restaurant"],
  Haitian: ["haitian", "haitian restaurant"],
  American: ["american", "american restaurant", "new american", "traditional american"],
  Southern: ["southern", "southern restaurant us", "southern restaurant"],
  "soul food": ["soul food", "soul food restaurant"],
  Cajun: ["cajun", "cajun restaurant", "creole", "creole restaurant"],
  Italian: ["italian", "italian restaurant", "southern italian restaurant", "northern italian restaurant"],
  French: ["french", "french restaurant"],
  Spanish: ["spanish", "spanish restaurant", "tapas", "tapas restaurant"],
  Greek: ["greek", "greek restaurant"],
  Mediterranean: ["mediterranean", "mediterranean restaurant"],
  "Middle Eastern": ["middle eastern", "middle eastern restaurant"],
  Lebanese: ["lebanese", "lebanese restaurant"],
  Turkish: ["turkish", "turkish restaurant"],
  Ethiopian: ["ethiopian", "ethiopian restaurant"],
  "West African": ["west african", "west african restaurant", "nigerian", "nigerian restaurant", "senegalese", "senegalese restaurant"],
  Indian: ["indian", "indian restaurant", "north indian restaurant", "south indian restaurant"],
  Pakistani: ["pakistani", "pakistani restaurant"],
  Asian: ["asian", "asian restaurant", "pan asian", "asian fusion", "asian fusion restaurant"],
  "Southeast Asian": ["southeast asian", "southeast asian restaurant"],
  Vietnamese: ["vietnamese", "vietnamese restaurant"],
  Thai: ["thai", "thai restaurant"],
  Filipino: ["filipino", "filipino restaurant"],
  Chinese: ["chinese", "chinese restaurant", "cantonese restaurant", "szechuan restaurant", "dim sum restaurant"],
  Japanese: ["japanese", "japanese restaurant"],
  Korean: ["korean", "korean restaurant", "korean barbecue restaurant"],
  halal: ["halal", "halal restaurant"],
  // Food types.
  coffee: ["coffee", "coffee shop", "cafe", "coffee lab", "espresso bar", "coffee roasters"],
  tea: ["tea house", "tea shop"],
  "bubble tea": ["bubble tea store", "bubble tea", "boba"],
  juice: ["juice shop", "juice bar", "smoothie shop"],
  bakery: ["bakery", "panaderia"],
  desserts: ["dessert", "dessert shop", "dessert restaurant", "cake shop", "cupcake shop", "pastry shop"],
  donuts: ["donut shop", "doughnut shop"],
  "ice cream": ["ice cream shop", "ice cream", "frozen yogurt shop", "gelato shop"],
  breakfast: ["breakfast", "breakfast restaurant", "brunch restaurant"],
  sandwiches: ["sandwich shop", "deli"],
  burgers: ["hamburger restaurant", "burger restaurant"],
  "hot dogs": ["hot dog restaurant", "hot dog stand"],
  pizza: ["pizza", "pizza restaurant", "pizzeria", "pizza delivery", "pizza takeout"],
  chicken: ["chicken restaurant", "fried chicken restaurant"],
  wings: ["chicken wings restaurant", "wings restaurant"],
  seafood: ["seafood", "seafood restaurant", "fish restaurant", "fish chips restaurant", "oyster bar"],
  barbecue: ["barbecue restaurant", "barbecue", "bbq"],
  steakhouse: ["steakhouse", "steak house"],
  soup: ["soup restaurant"],
  salads: ["salad shop"],
  noodles: ["noodle shop", "ramen restaurant"],
  sushi: ["sushi restaurant", "sushi"],
  vegan: ["vegan", "vegan restaurant", "vegetarian", "vegetarian restaurant", "vegetarian cafe and deli", "raw food restaurant"],
  "health food": ["health food", "health food restaurant"],
};

/** Qloo tag name (lowercase) to its label. */
const LABEL_OF: ReadonlyMap<string, string> = new Map(Object.entries(CUISINE_TAGS).flatMap(([label, tags]) => tags.map((t) => [t, label] as const)));

/** The label an allowed Qloo tag counts toward, or null for any tag off the allow list. */
export function cuisineLabel(tag: string): string | null {
  return LABEL_OF.get(tag.trim().toLowerCase().replace(/\s+/g, " ")) ?? null;
}

/** The fields the count reads from a plan place (lib/plan/schema.ts placeSchema). */
export interface CuisinePlace {
  kind: string;
  tags: readonly string[];
  rank: number;
}

export interface CuisineCount {
  label: string;
  /** Food places carrying a tag for this label (each place once). */
  places: number;
  /** Qloo's rank of the first (best ranked) place carrying it: the tie break. */
  rank: number;
}

/**
 * The allowed cuisine labels across the food places, most places first. Ties go to the label whose
 * first carrying place Qloo ranked higher, then to the label met first in the plan's order.
 */
export function countCuisines(places: readonly CuisinePlace[]): { counts: CuisineCount[]; foodPlaces: number } {
  const byLabel = new Map<string, { places: number; rank: number; first: number }>();
  let foodPlaces = 0;
  places.forEach((p, i) => {
    if (p.kind !== "food") return;
    const labels = new Set(p.tags.map(cuisineLabel).filter((l): l is string => l !== null));
    if (labels.size > 0) foodPlaces++;
    for (const label of labels) {
      const seen = byLabel.get(label);
      if (seen) {
        seen.places++;
        seen.rank = Math.min(seen.rank, p.rank);
      } else byLabel.set(label, { places: 1, rank: p.rank, first: i });
    }
  });
  const counts = [...byLabel.entries()]
    .sort(([, a], [, b]) => b.places - a.places || a.rank - b.rank || a.first - b.first)
    .map(([label, c]) => ({ label, places: c.places, rank: c.rank }));
  return { counts, foodPlaces };
}

/** "A, B and C". */
const andList = (words: readonly string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/**
 * The Community step's line, or null when fewer than MIN_FOOD_PLACES food places carry an allowed tag.
 * `from` is where the community was read: "the event" when the plan has its own event location.
 */
export function cuisineLine(places: readonly CuisinePlace[], from: "the store" | "the event"): string | null {
  const { counts, foodPlaces } = countCuisines(places);
  if (foodPlaces < MIN_FOOD_PLACES || counts.length === 0) return null;
  const top = counts.slice(0, TOP_CUISINES).map((c) => c.label);
  return `The food spots near ${from === "the event" ? "the event" : "your store"}, by Qloo's tags: most often ${andList(top)}.`;
}
