# Fixtures

Recorded **real** Qloo API responses. They are the source of truth for tests and for offline mode.

Rules:

- Real responses only. Never hand-write or edit Qloo data here.
- Record with `npm run fixtures:record -- <name>`, which reads `recipes/<name>.json`.
- The recorder saves the request, status, rate-limit headers, and body. It saves no other headers and refuses to write a file that contains the API key.
- Heatmap bodies (0.5 to 2.2 MB raw) are slimmed to the fields Stoop reads. Full raw bodies go to `raw/`, which is gitignored.
- `--probe` skips param validation, to test what Qloo does with params we do not allow yet. Probe results are labeled `"probe": true`.

Recipe format:

```json
{
  "description": "What this recording is for",
  "requests": [
    { "id": "search-olipop-brand", "endpoint": "/search", "params": { "query": "Olipop", "types": ["urn:entity:brand"] } }
  ]
}
```
