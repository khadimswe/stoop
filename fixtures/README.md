# Fixtures

Recorded **real** Qloo API responses. They are the source of truth for tests and for offline mode (`QLOO_MODE=fixtures`), and `docs/data-check.md` explains what they showed.

Rules:

- Real responses only. Never hand-write or edit Qloo data here.
- Record with `npm run fixtures:record -- <name>`, which reads `recipes/<name>.json`.
- The recorder saves the request, status, rate-limit headers, and body. It saves no other headers and refuses to write a file that contains the API key.
- An existing fixture is never recorded again without `--force`, so no recipe is paid for twice. A recipe over 80 requests needs `--allow-large`.
- Bodies are slimmed to the fields Stoop reads (`slimBody` in `lib/qloo/types.ts`): heatmap cells keep location, affinity and popularity, and entities drop akas, websites, plot text, raw media keywords, Wikipedia categories and audience-identity text. Only fields are dropped; no value is changed. Full raw bodies go to `raw/`, which is gitignored.
- `npm run fixtures:record -- <name> --reslim` re-applies the slimming rules from `raw/` without spending calls.
- Fixtures over 1 MB are stored gzipped as `<name>.json.gz` (read one with `gunzip -c`). Smaller ones stay readable JSON.
- `--probe` skips param validation, to test what Qloo does with params we do not allow yet, and allows probe-only endpoints (`/v2/trending`). Probe results are labeled `"probe": true` and are never replayed by the app.

The Gate 2 recordings (`probe-*`, `pool-*`) were planned by `npm run data-check -- plan <stage>`, which writes the recipes from code, so a replay sends exactly the params that were recorded. `plan missing` writes a top-up (`pool-refresh`, then `pool-refresh-2` and so on) with only the requests the current code needs and no fixture holds. Replay is keyed by params, not by request id: `apparel-everyday--places` appears in both `pool-segments` (Huntington, WV) and `pool-refresh` (Flint, MI), recorded before and after the city method changed.

Recipe format:

```json
{
  "description": "What this recording is for",
  "requests": [
    { "id": "search-olipop-brand", "endpoint": "/search", "params": { "query": "Olipop", "types": ["urn:entity:brand"] } }
  ]
}
```
