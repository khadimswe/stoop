// What /start's second step shows from an intake: the product as the run will use it, "Your site
// speaks to X" (Claude's reading of the page, never Qloo's), and the seeds with their receipts.
// Every string comes from the intake response; nothing here adds a fact.
import type { IntakeResponse } from "../api/responses";
import type { Evidence } from "../evidence";
import type { Seed } from "../report/schema";
import { plainType } from "../report/view/format";
import { receiptView } from "../report/view/receipts";
import type { ReceiptView } from "../report/view/types";

type Site = NonNullable<IntakeResponse["site"]>;

/**
 * The price as the seller's page gave it, or null. The intake appends it to the seller facts as
 * "Price: 14.00 USD.", after the description, so the last such line is the page's own.
 */
export function priceFrom(sellerFacts: string | undefined): string | null {
  const matches = sellerFacts ? [...sellerFacts.matchAll(/(?:^|\s)Price: (.+?)\.(?=\s|$)/g)] : [];
  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

const GENDER: Record<NonNullable<Site["genderSkew"]>, string> = {
  female: "leans female",
  male: "leans male",
  balanced: "no clear gender lean",
};

/**
 * "Your site speaks to 25 to 29 and 30 to 34, leans female, around Austin, TX, into Coffee shop":
 * in Qloo's dimensions (age band, gender, place, taste tags), so the Reality Check compares like for
 * like. Null when the reading found nothing to say.
 */
export function siteSpeaksTo(site: Site | null): string | null {
  if (!site) return null;
  const parts: string[] = [];
  const ages = site.ageBands.map((band) => band.label);
  if (ages.length) parts.push(ages.length === 1 ? ages[0] : `${ages.slice(0, -1).join(", ")} and ${ages.at(-1)}`);
  if (site.genderSkew) parts.push(GENDER[site.genderSkew]);
  if (site.place) parts.push(`around ${site.place}`);
  if (site.tags.length) parts.push(`into ${site.tags.map((tag) => tag.name).join(", ")}`);
  return parts.length ? parts.join(", ") : null;
}

export interface SeedView {
  id: string;
  name: string;
  /** "brand", "tv show", "tag". */
  kind: string;
  origin: Seed["origin"];
}

export const seedView = (seed: Seed): SeedView => ({ id: seed.ref.id, name: seed.ref.name, kind: plainType(seed.ref.type), origin: seed.origin });

/** One receipt for the seeds on screen: every Qloo call behind them, from the intake and the searches. */
export function seedsReceipt(seeds: readonly Seed[], evidence: readonly Evidence[]): ReceiptView | null {
  const ledger = new Map(evidence.map((entry) => [entry.id, entry]));
  const view = receiptView(
    ledger,
    seeds.flatMap((seed) => seed.evidenceIds),
    "Seeds",
    seeds.length === 1 ? `Where ${seeds[0].ref.name} comes from` : "Where these seeds come from",
  );
  return view ? { ...view, note: "Qloo tags come from /v2/tags. Suggested and added seeds were each matched by name in Qloo's search." } : null;
}
