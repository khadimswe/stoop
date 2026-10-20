// Vitest global setup: says once, before any test file runs, when the recorded Qloo data is absent
// and the tests that replay it are skipped (lib/testing/recorded.ts).
import { HAS_RECORDED_DATA, NO_RECORDED_DATA_REASON } from "./recorded";

export default function setup(): void {
  if (!HAS_RECORDED_DATA) console.warn(`\n${NO_RECORDED_DATA_REASON}\n`);
}
