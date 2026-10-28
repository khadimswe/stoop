// Proof lab, step 4: the named picks in each generic plan, extracted by Claude with one fixed prompt
// per plan (recorded to data/proof/llm/proof-extract.json, so it replays). Stoop's plans need no
// extraction: they name Qloo entities only through "[[id]]" refs, which are exact.
//
// The generic plan is told to describe music and food "by style and kind, never by an artist's or a
// business's name" in its lines, and to list the real artists and food brands it leans on separately
// (picks, kept for scoring). So the extraction reads both: the lines (for any name that slipped in)
// and the picks, and sorts every name into a type, so a packaged-snack brand is not
// counted as a place on the block.
//
// Writes data/proof/extract.json.
//   cd /Users/khadim/Stoop && npx tsx <worktree>/scripts/proof-extract.ts [--replay-only]
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { askOnce } from "../lib/agent/ask";
import type { PlanReport } from "../lib/plan/schema";
import { loadLocalEnv } from "./env";
import { exists, json, loadStores, PROOF, PROOF_RUNS, proofModel, readJson } from "./proof-lib";

export const EXTRACT_INSTRUCTIONS = [
  "You extract named things from a short event plan. You never add, guess or correct anything.",
  "A named thing is a proper name that appears in the text: a music artist or group, a restaurant, cafe, grocery store or food chain, a packaged food or drink brand, a park, venue, landmark, street or neighborhood, or another business.",
  "Generic words are not names: 'tacos', 'Southern hip-hop', 'gift card', 'payday', 'Veterans Day', a city or state name used only to describe a style ('Atlanta-style') are not named things.",
  "Copy each name exactly as written. Give its type, and the number of the plan line it appears in (null when it appears only in the 'also leans on' list).",
].join("\n");

export const extractSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["artist", "food_business", "product_brand", "place", "other_business", "other"]),
      line: z.number().int().nullable(),
    }),
  ),
});
export type Extracted = z.infer<typeof extractSchema>;

interface GenericAnswer {
  items?: { kind: string; text: string }[];
  picks?: { artists?: string[]; foods?: string[] };
}

export function extractPrompt(lines: readonly string[], picks: { artists: string[]; foods: string[] }): string {
  return [
    "Event plan lines:",
    ...lines.map((line, i) => `${i + 1}. ${line}`),
    "",
    "The plan also leans on these (artists, then food brands):",
    `- artists: ${picks.artists.join("; ") || "none"}`,
    `- food brands: ${picks.foods.join("; ") || "none"}`,
    "",
    "List every named thing.",
  ].join("\n");
}

async function main(): Promise<void> {
  const replayOnly = process.argv.includes("--replay-only");
  if (!replayOnly) loadLocalEnv();
  const { model, store } = proofModel("proof-extract", { replayOnly });
  const out: Record<string, { lines: string[]; picks: { artists: string[]; foods: string[] }; extracted: Extracted | null; failure?: string }> = {};
  for (const s of loadStores()) {
    const dir = path.join(PROOF_RUNS, s.id);
    if (!exists(path.join(dir, "plan.report.json"))) continue;
    const report = readJson<PlanReport>(path.join(dir, "plan.report.json"));
    const answers = readJson<{ answers: GenericAnswer[] }>(path.join(dir, "generic.json")).answers;
    const last = [...answers].reverse().find((a) => (a.items?.length ?? 0) >= 4);
    const lines = (report.baseline?.items ?? []).map((i) => i.text);
    const picks = { artists: last?.picks?.artists ?? [], foods: last?.picks?.foods ?? [] };
    const reply = await askOnce(model, { instructions: EXTRACT_INSTRUCTIONS, prompt: extractPrompt(lines, picks), schema: extractSchema, name: "named_things", description: "Every named thing in the plan, typed." });
    const parsed = reply.failure ? null : extractSchema.safeParse(reply.output);
    out[s.id] = { lines, picks, extracted: parsed?.success ? parsed.data : null, ...(parsed?.success ? {} : { failure: reply.failure ?? "did not match the schema" }) };
    console.log(`${s.id}: ${parsed?.success ? parsed.data.entities.map((e) => `${e.name} [${e.type}${e.line ? ` l${e.line}` : ""}]`).join(", ") : out[s.id]?.failure}`);
  }
  if (!replayOnly) {
    store.prune();
    store.save();
  }
  await writeFile(path.join(PROOF, "extract.json"), json({ note: "Named things in each generic plan (lines and picks), extracted by Claude with the fixed prompt in scripts/proof-extract.ts.", instructions: EXTRACT_INSTRUCTIONS, plans: out }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
