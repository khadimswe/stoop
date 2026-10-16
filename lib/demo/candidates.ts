// The candidate pool for the example reports. Each candidate is a fictional brand written the way a
// founder fills in the composer: a generic product, 3 to 5 "customers also love" seeds, a stated
// customer, a region and platforms. Gate 2 picks the examples from this pool by how rich the Qloo
// data is. The pool is static JSON so scripts, tests and pages read the same file, and every string
// in it passes the guardrails (no brand names of our own, no cities, no claims, adults only).
import { z } from "zod";
import data from "../../data/candidates.json" with { type: "json" };
import { creativeDirectionSchema } from "../types";

export const LANES = ["apparel", "food", "startup", "pets", "care", "home", "care-kit"] as const;
export type Lane = (typeof LANES)[number];

/** "Reels + TikTok 9:16": Meta Reels and Stories plus TikTok. The only format in the hackathon build. */
export const PLATFORMS = "reels-tiktok-9x16";

/** "18 to 24", "25 to 40": an age band whose lower bound is 18 or more. */
const AGE_BAND = /\b(\d{2}) to (\d{2})\b/g;

/** True when the text states at least one age band and every band it states is adult (18+). */
export function hasAdultAgeBand(text: string): boolean {
  const bands = [...text.matchAll(AGE_BAND)].map((m) => [Number(m[1]), Number(m[2])] as const);
  return bands.length > 0 && bands.every(([low, high]) => low >= 18 && high > low);
}

const text = z.string().trim().min(1, { error: "must not be empty" });

export const candidateSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]+$/, { error: "slug must use lowercase letters, digits and hyphens" }),
  lane: z.enum(LANES),
  /** Internal label only, e.g. "Candidate: small-batch hot sauce". The example gets its own name in Gate 2. */
  workingName: text,
  product: z.strictObject({
    /** A generic product noun phrase, never a brand name. */
    name: text,
    description: text,
    price: text,
    category: text,
    /** The physical product for the packshot. The label is a simple symbol, never a wordmark or readable text. */
    lookDescription: text,
  }),
  seeds: z
    .array(text)
    .min(3, { error: "needs at least 3 seeds" })
    .max(5, { error: "takes at most 5 seeds" })
    .refine((seeds) => new Set(seeds.map((s) => s.toLowerCase())).size === seeds.length, { error: "seeds must be unique" }),
  /** What the fictional founder believes about their customer. Always an adult age band, never ethnicity or cities. */
  statedCustomer: text.refine(hasAdultAgeBand, { error: 'must state an adult age band such as "25 to 40"' }),
  region: text,
  platforms: z.literal(PLATFORMS),
  direction: creativeDirectionSchema.optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const candidatesFileSchema = z
  .strictObject({
    version: z.literal(1),
    candidates: z.array(candidateSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const [index, { slug }] of file.candidates.entries()) {
      if (seen.has(slug)) ctx.addIssue({ code: "custom", path: ["candidates", index, "slug"], message: `duplicate slug "${slug}"` });
      seen.add(slug);
    }
  });
export type CandidatesFile = z.infer<typeof candidatesFileSchema>;

/** Parses data/candidates.json (or any value with its shape). Throws with every problem listed. */
export function loadCandidates(json: unknown): Candidate[] {
  const result = candidatesFileSchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid candidates file:\n${z.prettifyError(result.error)}`);
  return result.data.candidates;
}

export const CANDIDATES: readonly Candidate[] = loadCandidates(data);

export function candidateBySlug(slug: string): Candidate | undefined {
  return CANDIDATES.find((candidate) => candidate.slug === slug);
}
