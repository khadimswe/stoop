// Unit tests that replay Stoop's recorded Qloo data (fixtures/, data/runs/ and the files built from
// them) skip when it is absent, as in the public mirror, which leaves it out because Qloo's developer
// guide asks that its response data stay out of public repositories. Every other test still runs.
// The global setup prints the reason once (README.md, "Data and the Qloo API").
import { describe, it } from "vitest";
import { E2E_DATA_FILES, missingFiles } from "../recorded-data";

/** Files that only exist with the recordings: everything the build and e2e need, plus the analyses. */
const RECORDED_FILES = [...E2E_DATA_FILES, "fixtures/smoke.json", "fixtures/llm/food-hot-sauce.json", "data/data-check/summary.json"];

/** True when the recorded Qloo data is present (the working repository), false in the public mirror. */
export const HAS_RECORDED_DATA = missingFiles(RECORDED_FILES).length === 0;

export const NO_RECORDED_DATA_REASON =
  "Recorded Qloo data is absent (the public mirror leaves it out): the unit tests that replay it are skipped. README.md, \"Data and the Qloo API\", says how to record your own.";

/** The skipped placeholder's name, so each skipped suite says why in the test report. */
export const SKIPPED_TEST_NAME = "skipped: needs the recorded Qloo data, which the public repository leaves out";

/**
 * Without the data, a suite with one skipped placeholder test. Vitest runs a skipped suite's body to
 * list its tests, and these bodies read the recordings, so the body is never called here.
 */
function skippedSuite(name: unknown): void {
  describe.skip(String(name), () => {
    it(SKIPPED_TEST_NAME, () => {});
  });
}
const skippedDescribe = Object.assign((name: unknown) => skippedSuite(name), {
  each: () => (name: unknown) => skippedSuite(name),
});

/** A describe block that replays recorded data (describeRecorded.each too): one skipped placeholder without it. */
export const describeRecorded = (HAS_RECORDED_DATA ? describe : skippedDescribe) as typeof describe;

/** A single test that replays recorded data: skipped without it. */
export const itRecorded = it.skipIf(!HAS_RECORDED_DATA);

/**
 * Reads recorded data at module load when it is present. Without it this returns a stand-in that is
 * never used, because every suite that reads the value is a describeRecorded block (or an itRecorded test).
 */
export function ifRecorded<T>(read: () => T): T {
  return HAS_RECORDED_DATA ? read() : (undefined as T);
}
