// Fails if any tracked or new (non-ignored) text file contains an em dash (U+2014).
// Mirrors the CI job so the check runs locally as part of `npm run check`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EM_DASH = String.fromCharCode(0x2014);
// Recorded Qloo responses and media are third-party data; hand-written files under fixtures/ are still checked.
const SKIP = [/^package-lock\.json$/, /^pnpm-lock\.yaml$/, /^yarn\.lock$/, /^public\/demo\//, /^fixtures\/raw\//, /^fixtures\/[^/]+\.json$/];

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\0")
  .filter((f) => f && !SKIP.some((re) => re.test(f)));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  if (text.includes("\0")) continue; // binary
  text.split("\n").forEach((line, i) => {
    if (line.includes(EM_DASH)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (hits.length > 0) {
  console.error("Em dashes found. Replace each with a comma, period, colon, parentheses, or a hyphen:");
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`No em dashes in ${files.length} files.`);
