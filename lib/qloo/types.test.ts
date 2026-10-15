import { describe, it } from "vitest";

// Response schemas are only tested against real recorded responses. None exist until the Qloo key
// arrives, and hand-written Qloo data is not allowed, so these stay skipped until Slice 2.
describe.skip("response schemas against recorded fixtures", () => {
  it.todo("TODO(slice-2): /search fixture parses and keeps entity ids, types, popularity");
  it.todo("TODO(slice-2): /v2/tags fixture parses and normalizes id");
  it.todo("TODO(slice-2): urn:entity:* fixtures parse, with subtype as the real type and explainability on places");
  it.todo("TODO(slice-2): urn:tag fixture parses and normalizes tag_id");
  it.todo("TODO(slice-2): urn:demographics fixture parses into skew indices");
  it.todo("TODO(slice-2): urn:heatmap fixture parses, and slimHeatmapBody keeps every cell");
  it.todo("TODO(slice-2): /v2/analysis/compare fixture parses shared, a and b tags");
});
