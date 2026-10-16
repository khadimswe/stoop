// The frozen reference audiences for city ranking (data/geo/reference-heatmap.json, built by
// `npm run data-check -- reference` from recorded fixtures). Read once at runtime and checked with
// zod, rather than imported, so TypeScript never types its 6,000 cell keys. Server and scripts only.
// Deploys must trace this file (Gate 5: outputFileTracingIncludes).
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseReferenceFile, type ReferenceSets } from "./metros";

export const REFERENCE_FILE = path.join("data", "geo", "reference-heatmap.json");

const setSchema = z.object({
  audiences: z.number().int().min(1),
  members: z.array(z.string()),
  cells: z.record(z.string(), z.tuple([z.number(), z.number().int().min(0)])),
});
const fileSchema = z.object({ sets: z.object({ candidates: setSchema, full: setSchema }) });

let cached: ReferenceSets | undefined;

export function loadReferenceSets(file = path.join(process.cwd(), REFERENCE_FILE)): ReferenceSets {
  return parseReferenceFile(fileSchema.parse(JSON.parse(readFileSync(file, "utf8"))));
}

/** The frozen reference sets, parsed once per process. */
export function referenceSets(): ReferenceSets {
  cached ??= loadReferenceSets();
  return cached;
}
