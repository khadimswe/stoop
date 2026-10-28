// Writes data/plans/known-chains.json: every place name found at more than one branch (different Qloo
// ids) across the stores' blocks in the recorded runs (the example plans and the proof lab's runs), normalized. A business with
// branches near several stores is a chain, whatever the name list says. The live runtime reads the
// file (lib/plan/server.ts) and marks those places as chains: fine for gift cards and bulk snacks,
// never a co-promo partner. Repeat runs of one store (the -r2 and -r3 folders) count once.
//
// The file holds names Qloo returned, so it stays under data/plans (left out of the public mirror).
//   npx tsx scripts/record-plan-chains.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_CHAINS_FILE, PLANS_DIR } from "../lib/plan/examples";
import { repeatedPlaceNames } from "../lib/plan/taste";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Report {
  local?: { block?: { places: { name: string; id?: string }[] } | null };
}

function reports(dir: string): { id: string; report: Report }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((id) => {
    const file = path.join(dir, id, "plan.report.json");
    if (!existsSync(file) || /-r\d+$/.test(id)) return [];
    return [{ id, report: JSON.parse(readFileSync(file, "utf8")) as Report }];
  });
}

async function main(): Promise<void> {
  const sources = [path.join(ROOT, PLANS_DIR), ...["runs", "runs-2", "runs-3"].map((d) => path.join(ROOT, "data", "proof", d))];
  // One block per store: a later round of the same store replaces the earlier one.
  const blocks = new Map<string, { places: { name: string; id?: string }[] }>();
  for (const dir of sources) for (const { id, report } of reports(dir)) if (report.local?.block) blocks.set(id, report.local.block);
  const names = [...repeatedPlaceNames([...blocks.values()])].sort();
  await writeFile(path.join(ROOT, PLANS_DIR, KNOWN_CHAINS_FILE), `${JSON.stringify({ note: "Place names found on more than one store's block in the recorded runs (normalized). Written by scripts/record-plan-chains.ts.", stores: blocks.size, names }, null, 2)}\n`);
  console.log(`${names.length} names repeated across ${blocks.size} stores' blocks.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
