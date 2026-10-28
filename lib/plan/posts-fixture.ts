// A small, valid plan report for the marketing lane's unit tests (poster, posts, share links, routes).
// Every name in it is made up for tests: it is not Qloo data, and no test reads it as a measurement.
import { planReportSchema, type PlanReport } from "./schema";

const EV_CITY = "ev_00000000c1c1";
const EV_BLOCK = "ev_00000000b10c";

export function samplePlanReport(patch: { kind?: "live" | "example"; id?: string } = {}): PlanReport {
  const kind = patch.kind ?? "live";
  return planReportSchema.parse({
    version: 1,
    meta: { id: patch.id ?? (kind === "example" ? "ex-test-store" : "run_test0001"), kind, createdAt: "2026-10-28T15:00:00.000Z", provenance: kind === "example" ? "recorded" : "live" },
    inputs: {
      store: {
        id: "test-store",
        name: "Corner Wireless on Fifth",
        carrier: "metro",
        address: "1200 Fifth Ave, Testville, IL 60000",
        city: "Testville",
        region: "IL",
        point: { lat: 41.85, lon: -87.65 },
      },
      date: "2026-11-07",
      startTime: "12:00",
      durationMinutes: 240,
      setting: "sidewalk_table",
      budgetUsd: 150,
      offers: [{ text: "$25/mo unlimited with a free phone when you switch" }, { text: "Free screen protector with any accessory" }],
      ageBands: ["24_and_younger", "25_to_29"],
    },
    ledger: [
      { id: EV_CITY, endpoint: "/v2/insights", params: { "filter.type": "urn:entity:artist" }, status: 200, cached: false, fetchedAt: "2026-10-28T15:00:01.000Z", durationMs: 300 },
      { id: EV_BLOCK, endpoint: "/v2/insights", params: { "filter.type": "urn:entity:place" }, status: 200, cached: false, fetchedAt: "2026-10-28T15:00:02.000Z", durationMs: 300 },
    ],
    local: {
      city: {
        city: "Testville",
        ageBands: ["24_and_younger", "25_to_29"],
        artists: [
          { id: "artist-a", name: "Velvet Testline", rank: 1, genres: ["Trap", "Southern Hip Hop"], evidenceIds: [EV_CITY] },
          { id: "artist-b", name: "Mara Fixture", rank: 2, genres: ["Contemporary R&B"], evidenceIds: [EV_CITY] },
        ],
        styles: [
          { tagId: "urn:tag:genre:music:trap", name: "Trap", evidenceIds: [EV_CITY] },
          { tagId: "urn:tag:genre:music:contemporary_rnb", name: "Contemporary R&B", evidenceIds: [EV_CITY] },
        ],
      },
      block: {
        radiusM: 1500,
        places: [
          { id: "place-taqueria", name: "Taqueria Fixture Grande", kind: "food", tags: ["Mexican", "Tacos"], address: "1180 Fifth Ave", distanceM: 120, why: "Popular nearby", rank: 1, affinity: 0.9, popularity: 0.8, evidenceIds: [EV_BLOCK] },
          { id: "place-park", name: "Testville Commons", kind: "park", tags: ["Park"], address: null, distanceM: 600, why: null, rank: 2, affinity: 0.7, popularity: 0.6, evidenceIds: [EV_BLOCK] },
          { id: "place-bakery", name: "Sample Street Bakery", kind: "food", tags: ["Bakery"], address: "1300 Fifth Ave", distanceM: 300, why: null, rank: 3, affinity: 0.6, popularity: 0.5, evidenceIds: [EV_BLOCK] },
        ],
      },
      gaps: [],
    },
    plan: {
      conceptId: "taco-table",
      concepts: [
        {
          id: "taco-table",
          title: "Taco Table Saturday",
          hook: "Tacos from down the street and the city's own sound at the table.",
          items: [
            { kind: "theme", text: "A sidewalk taco table with the city's trap and R&B on the speaker.", origin: "interpreted", refs: [], evidenceIds: [EV_CITY] },
            { kind: "food", text: "Tacos from [[place-taqueria]], two blocks over.", origin: "qloo", refs: ["place-taqueria"], evidenceIds: [EV_BLOCK] },
            { kind: "music", text: "A playlist in the spirit of [[artist-a]] and [[artist-b]].", origin: "qloo", refs: ["artist-a", "artist-b"], evidenceIds: [EV_CITY] },
            { kind: "giveaway", text: "Free screen protector with any accessory, from the manager's offer.", origin: "yours", refs: [], evidenceIds: [] },
            { kind: "setup", text: "One table, two chairs, a speaker at low volume.", origin: "creative", refs: [], evidenceIds: [] },
          ],
          scores: [{ criterion: "stops a passerby", score: 4 }],
          total: 4,
          kept: true,
        },
        {
          id: "park-picnic",
          title: "Picnic by the Commons",
          hook: "A picnic table near the park.",
          items: [{ kind: "venue", text: "Near [[place-park]].", origin: "qloo", refs: ["place-park"], evidenceIds: [EV_BLOCK] }],
          scores: [{ criterion: "stops a passerby", score: 3 }],
          total: 3,
          kept: false,
          note: "Further from the store.",
        },
      ],
      runOfShow: [{ time: "12:00", step: "Table out, music on." }],
      shopping: [{ item: "Tacos for 30", estUsd: 90, from: "place-taqueria", origin: "qloo", evidenceIds: [EV_BLOCK] }],
      checklist: ["Check the city's sidewalk rules."],
      estimatedCostUsd: 120,
    },
    baseline: null,
    comparison: null,
    poster: { status: "none", prompt: "", promptHash: "", alt: "" },
    posts: null,
    results: [],
    trace: [],
    stats: { stages: {} },
    partial: null,
    cost: null,
  });
}
