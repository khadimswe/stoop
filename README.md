# Stoop

Ads made on the block.

Ads are free to make now. Knowing who they're for isn't. Stoop uses [Qloo](https://www.qloo.com)'s taste graph to prove who a product's customer really is, find the culture they live in, and write short-form video ads that culture would make, with a Qloo receipt for every creative choice.

Built for the Qloo Agentic Hackathon (2026). Work in progress: the full judge guide, write-up, and live demo link land before submission.

## Stoop is the brain, you bring your own camera

Stoop decides who each ad is for and what it should feel like, then hands you copy-ready prompts and scripts for the video tools you already use (Higgsfield, Veo, Kling, Runway) or your own Higgsfield MCP. Stoop never renders video on your behalf from the public app; the before/after clips on the site were made ahead of time to show the difference.

## Status

- [x] Qloo client: validated params, cache, rate limit, retries, call budget, evidence on every result
- [ ] Data reality check against the live API
- [ ] Agent stages: prove, reality gap, segments, culture brief, creative director, prompt packs, scoring
- [ ] Web app, examples, and before/after videos

## Setup

Requires Node 22.12 or newer and a Qloo hackathon API key.

```bash
npm install
cp .env.example .env.local   # then fill in QLOO_API_KEY
npm run dev                  # http://localhost:3000
```

Hackathon keys only work against `https://hackathon.api.qloo.com`. The key is read on the server only and never sent to the browser.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the local server |
| `npm run build` | Production build |
| `npm run check` | Typecheck, lint, unit tests, and an em dash scan |
| `npm run test` | Unit tests (Vitest) |
| `npm run e2e` | End-to-end tests (Playwright) |
| `npm run fixtures:record -- <name>` | Record real Qloo responses from `fixtures/recipes/<name>.json` into `fixtures/` |

## How Stoop talks to Qloo

Every call goes through `lib/qloo/client.ts`:

- **Validated before sending.** Qloo silently ignores parameters that don't apply and still returns 200 with quietly wrong data, so each request is checked against a strict schema per `filter.type` (`lib/qloo/schemas.ts`). Unknown or known-ignored params throw with a specific message.
- **Cached** by a hash of the canonical query (7 days), so repeats cost nothing.
- **Paced** at 4 requests per second, with retries and backoff on 429 and gateway errors. A 500 is not retried because Qloo returns it deterministically.
- **Budgeted** per run (`lib/qloo/budget.ts`), with a guard on the monthly quota Qloo reports in its response headers.
- **Receipted.** Every result comes with an `Evidence` record (endpoint, exact params, cached flag, time) that the UI shows next to each fact.
- **Honest about scores.** Heatmaps are ranked by popularity-corrected lift, and affinities are shown as rank or position against a reference panel scored in the same call, never as raw scores (`lib/qloo/lift.ts`).

Only aggregate taste data is used. No personal data is ever sent to Qloo: just entity ids, tags, locations, and age bands.

## License

[MIT](LICENSE)
