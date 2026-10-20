# Stoop

**Stop making ads for nobody.** Data, not stereotypes.

Stoop uses [Qloo](https://www.qloo.com)'s taste data to map the audience around a product (who they are, what else they love, where they cluster), then writes the short-form ad they'd actually stop for, with a Qloo receipt for every creative choice.

The idea is concept diversity grounded in Qloo taste data: for each product, Stoop builds two or three distinct concept worlds, each drawn from what that taste neighborhood loves across music, film, brands and places.

It's built for Shopify and DTC brands already running video ads on Meta and TikTok, for the small creative agencies and AI-ad operators who make ads for several brands, and for startup founders making content that connects with their customers. Paste a store or product link (or describe the product), confirm a few "customers also love" picks, and get a Reality Check report plus a Campaign Kit for Reels and TikTok (9:16).

Without store data, Stoop measures your product's taste neighborhood. Precision mode (roadmap) adds real order data.

Built for the Qloo Agentic Hackathon (2026). Work in progress: the full judge guide, write-up, and live demo link land before submission.

## Stoop is the brain, you bring your own camera

Stoop decides who each ad is for and what it should feel like, then hands you a Production Pack for the video tools you already use (Higgsfield, Veo, Kling, Runway): asset sheet prompts, scene prompts that reference them, a critique checklist, and a Director's Guide, plus scripts. Copy a prompt or download the kit. In-app draft rendering is planned and off by default; the before/after clips on the site were made ahead of time, following the same Director's Guide, to show the difference.

## Status

- [x] Qloo client: validated params, cache, rate limit, retries, call budget, evidence on every result
- [x] Data check against the live API ([docs/data-check.md](docs/data-check.md))
- [ ] Agent stages: page reading, audience proof, Reality Check, segments, culture brief, creative director, Production Packs, scoring
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
| `npm run check:public` | Fail if Qloo response data (an excluded path, or a Qloo-like entity id) is in this public tree |

## Data and the Qloo API

Qloo response data is not stored in this public repository. Qloo's [hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) says: "Do not store Qloo response data in a public repository." So the recorded responses and everything built from them are left out of every commit here: the recordings in `fixtures/`, the stored example runs in `data/runs/`, the frozen reference panels in `data/culture/`, the reference audiences for city ranking (`data/geo/reference-heatmap.json`), the data check's results (`data/data-check/`, `docs/data-check-details.md`) and the `/mcp` page's example session (`data/marketing/`). [`public-mirror.exclude`](public-mirror.exclude) lists every path, and `npm run check:public` fails if one comes back. [`docs/data-check.md`](docs/data-check.md) keeps the method and the aggregate findings.

The live demo runs on the same code with private server-side caching of Qloo responses, which the guide allows ("Private server-side caching is fine and there is no time limit on how long you can keep cached responses").

**Without the data,** typecheck, lint and the unit tests that need no recordings all run (`npm run check`); the tests that replay recordings are skipped with a notice, and `next build` and `npm run e2e` stop at once with a message that lists the missing files.

**To run Stoop with your own Qloo key,** put `QLOO_API_KEY` and `ANTHROPIC_API_KEY` in `.env.local`, then record the data in this order (about 400 Qloo calls of the 10,000 a month, plus Claude calls for the three examples). Each `plan` step writes a recipe to `fixtures/recipes/`; record it before the next step.

```bash
npm run fixtures:record -- smoke                 # one call: the key works
npm run fixtures:record -- probe-search          # search shapes some tests replay
npm run fixtures:record -- pool-resolve          # the 9 candidates' seeds and the generic briefs' picks
npm run fixtures:record -- pool-refresh-2
npm run data-check -- plan audience && npm run fixtures:record -- pool-audience
npm run data-check -- panels                     # writes data/culture/panels.json and data/geo/reference-heatmap.json
npm run data-check -- plan reference && npm run fixtures:record -- reference-audiences
npm run data-check -- plan reference --tags && npm run fixtures:record -- reference-audiences-2
npm run data-check -- reference                  # rebuilds the reference audiences from every recording
npm run data-check -- plan missing               # names a top-up recipe: record it (add --allow-large over 80
                                                 # requests), then run plan missing again until nothing is missing
npm run example -- food-hot-sauce --record       # each example: live misses are recorded, then replayed into data/runs/
npm run example -- home-candles --record
npm run example -- pets-outfits --record
npm run audience -- --picks                      # the audience half of each example run
npm run mcp:session                              # the /mcp example session (add -- --record if a call is missing)
npm run build && npm run test && npm run e2e
```

Some unit tests pin values from our own recordings (a city's rank, a segment's label), so with your recordings expect those to differ. Keep your recordings out of any public repository too.

## How Stoop talks to Qloo

Every call goes through `lib/qloo/client.ts`:

- **Validated before sending.** Qloo silently ignores parameters that don't apply and still returns 200 with quietly wrong data, so each request is checked against a strict schema per `filter.type` (`lib/qloo/schemas.ts`). Unknown or known-ignored params throw with a specific message.
- **Cached** by a hash of the canonical query (7 days), so repeats cost nothing.
- **Paced** at 4 requests per second, with retries and backoff on 429 and gateway errors. A 500 is not retried because Qloo returns it deterministically.
- **Budgeted** per run (`lib/qloo/budget.ts`), with a guard on the monthly quota Qloo reports in its response headers.
- **Receipted.** Every result comes with an `Evidence` record (endpoint, exact params, cached flag, time) that the UI shows next to each fact.
- **Honest about scores.** Heatmaps are ranked by popularity-corrected lift, and affinities are shown as rank or position against a reference panel scored in the same call, never as raw scores (`lib/qloo/lift.ts`).

Only aggregate taste data is used. No personal data is ever sent to Qloo: just entity ids, tags, locations, and age bands.

## Roadmap

- **Precision mode:** connect your Shopify store so real order locations and best-sellers sharpen Qloo's picture. Aggregated, no customer PII.
- **A Shopify App Store app** as the way in for brands.
- **Customer language from reviews:** blend a brand's own review language into its briefs, labeled as the brand's words, never as Qloo data.
- **Ad-account results loop:** tag each concept with its real CTR and CPA from the ad account, so later runs learn which concept worlds worked.

## License

[MIT](LICENSE)
