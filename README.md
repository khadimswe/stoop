# Stoop

**Stop making ads for nobody.** Ads are free to make now. Knowing who they're for isn't.

Stoop is an agent for Shopify and DTC brands that already run video ads on Meta and TikTok, and for the small agencies that make those ads. It uses [Qloo](https://www.qloo.com)'s taste data to map the audience around a product (who it is, what else it loves, where it clusters), splits it into two or three distinct concept worlds, and writes a short-form ad for each world. Every audience fact and every creative cue comes with a Qloo receipt.

Data, not stereotypes. Built for the Qloo Agentic Hackathon (2026).

- Live demo: `https://<live-demo-url>`
- Judge's guide: `https://<live-demo-url>/judges`

## What Stoop does, in five steps

1. **Read.** Paste a store or product link, or describe the product if there is no site. Stoop reads the product, the price and who the page seems to speak to, then proposes a few "customers also love" seeds. You see every seed with its origin (a Qloo tag, a suggestion Qloo matched by name, or your own pick) and can edit them before anything runs.
2. **Measure.** Qloo maps the taste neighborhood around those seeds: age and gender skews, the music and mood it leans into, and the cities where it clusters.
3. **Reality Check.** Stoop sets what Qloo measured next to what you said, what your site speaks to, and what a generic AI brief assumed. Each stated dimension is called a gap, a near tie or confirmed, with its own margin. Stoop never forces a gap.
4. **Concept worlds.** The audience splits into two or three measured segments. Each one gets a Culture Brief: music style, visual language, wardrobe, setting, voice and creators, each cue labeled with where it came from.
5. **Production Pack.** Each world gets a pack for the video tool you already use (Higgsfield, Veo, Kling or Runway): asset sheet prompts, 3 to 5 scene prompts for a 15 s ad (9:16, Reels and TikTok), hooks, scripts, captions, a critique checklist and a Director's Guide. A Launch plan sets each world up as a test cell next to the generic Control.

Nothing to connect, and nothing auto-publishes. Every pack ends with a human review checklist and an AI disclosure note.

## The 2-minute judge path

Open `https://<live-demo-url>/examples/food-hot-sauce`, the report for Porchlight Pepper Co., a fictional small-batch hot sauce brand. It loads from a recorded run, so it is instant and makes no live calls.

1. **The Reality Check** is at the top: what the brand said, what Qloo measured for its taste neighborhood, and what a generic AI brief assumed, then a call on each dimension (age, gender, cities, taste) with its own receipt.
2. **The Screening Room** (`#screening`): the Control, made from an LLM-only brief, next to one concept per world. Same template, same model, same length. Only the brief changes.
3. **One receipt** (`#receipt-music`): the drawer for the music style cue. It shows the exact Qloo query (the key never appears), whether it came from cache, and the rank or panel position behind the cue.

Then try your own product at `/start`. `/judges` walks the same path and maps every Qloo call to the code behind it.

The judge code is in Devpost's testing instructions only. It unlocks a small number of server-paid draft video renders. Everything else is open to everyone.

## How Qloo decides every audience fact and cue

If a feature would work the same without Qloo, it isn't in Stoop. Every Qloo call goes through one client ([`lib/qloo/client.ts`](lib/qloo/client.ts)).

| Qloo call | What it decides | Code |
| --- | --- | --- |
| `/search` | Resolves each seed. A suggestion is kept only when Qloo's name matches it, or starts or ends with the whole suggestion (marked in the receipt). | [`lib/qloo/match.ts`](lib/qloo/match.ts) |
| `/v2/tags` | Turns a product page into taste tags offered as seeds. | [`lib/intake/tags.ts`](lib/intake/tags.ts) |
| `/v2/insights`, `urn:demographics` | Age and gender skews, as relative indices from -1 to 1, never as shares of an audience. | [`lib/stages/prove.ts`](lib/stages/prove.ts) |
| `/v2/insights`, `urn:heatmap` | Where the audience clusters. Cities are ranked by lift against reference audiences, never by raw affinity, which tracks popularity. A city sets the setting, never the cast. | [`lib/geo/metros.ts`](lib/geo/metros.ts) |
| `/v2/insights`, `urn:tag` | The music genres and emotional tone the audience over-indexes on. | [`lib/stages/prove.ts`](lib/stages/prove.ts) |
| `/v2/insights`, entity types | Each world's Culture Brief: artists become music feel, films and TV become visual language, brands become wardrobe, places become settings (with Qloo's explainability). | [`lib/stages/culture.ts`](lib/stages/culture.ts) |
| `/v2/insights`, `filter.results.entities` and `filter.results.tags` | Scores Qloo's picks, the generic brief's picks and a frozen reference panel in one call, so their ranks compare fairly. | [`lib/stages/check.ts`](lib/stages/check.ts) |

The rules behind the table:

- **Ids, not names.** Claude plans, explains and writes copy, but it may only cite entities and tags Qloo returned in this run. It returns ids; names come from the run's own ledger, and anything else is rejected.
- **Receipts.** Every audience fact and creative cue carries evidence: the endpoint, the query with the key left out, whether it came from cache, and its rank or panel position ("beats N of M reference artists"). No evidence, no display.
- **Labeled origins.** Each cue is marked as from Qloo, as wording that cites Qloo results, as a creative suggestion (not from Qloo), or as your choice. A field Qloo has no signal for says "No Qloo signal". Tempo, camera and lens are never Qloo's.
- **Validated params.** Qloo ignores invalid parameters and still answers 200, so every request is checked against a schema per `filter.type` before it is sent ([`lib/qloo/schemas.ts`](lib/qloo/schemas.ts)). Unknown and known-ignored params throw.
- **Fair comparisons.** Affinity is never compared across calls with different signals. The Control is scored in the same call as Qloo's picks and the reference panel. A checkable choice below the audience's reference median is flagged as a cliche; a missing entity counts as "no measurable affinity", and there is no median under 5 items.
- **The Control.** The LLM-only brief runs the same product through the same template and model with no Qloo tools. Qloo then scores it, and the report shows the numbers ("N of M checkable choices miss what Qloo measured"), not just two texts side by side.
- **Craft, not names.** Prompts describe music as a style (genre, era, tempo, instrumentation) and never name a real artist, song, film or brand. No celebrity likenesses and no third-party logos.

## What's honest, and what isn't claimed

- Without store data, Stoop measures your product's taste neighborhood. Precision mode (roadmap) adds real order data.
- The example brands (Porchlight Pepper Co., Lowlight Candle Co., Whisker & Brim) are fictional. Their runs use real Qloo responses, recorded on Oct 16, 2026.
- Measured ad-spend lift is a November pilot. Stoop makes no performance claims.
- Demographics are relative skews, not shares of an audience. A near tie is called a near tie, never a gap.
- Every audience is 18 or older. The youngest band reads 18 to 24, all talent is adult, and settings never imply minors. Segments come from Qloo affinities and skews, never from a race or ethnicity label, and are named by what Qloo measured.
- Only aggregate taste data is used. Stoop never sends personal data to Qloo: only entity ids, tags, locations and age bands.
- UGC scripts speak as the brand, never as a customer who "tried it", and use only facts the seller supplies.

## Video: Stoop is the brain, you bring your own camera.

Stoop decides who each ad is for and what it should feel like. You render it where you already work: copy a scene prompt or the whole pack into Higgsfield, Veo, Kling or Runway.

In the app, each world can also render one 480p draft on fal:

- **Render with your fal key (BYOK).** The report links to `/byok`, an isolated page with no inline code and a strict Content Security Policy of its own (Trusted Types required, `connect-src` limited to the page itself and fal's queue). Your key stays in that tab's memory and goes only to fal. Stoop never receives or stores it.
- **Judge drafts.** With the judge code, a capped number of drafts render on Stoop's own fal account.

On live runs, storyboard frames come first as the cheap draft. Claude reviews them with vision against the critique checklist, rewrites the prompt once and re-renders once, and the trace shows the change.

## Use Stoop inside Claude (MCP)

Stoop is a remote MCP server with two tools:

- `score_brief` checks the creative choices in any brief against Qloo's taste data. Qloo only, no AI model.
- `culture_brief` starts a full run and sends back the report link. When live runs are off or the day's share is used up, it sends back an example report instead.

1. **Get a token** at `https://<live-demo-url>/mcp`. It is shown once (and emailed as a backup when possible), has daily caps, stops working after judging and can be revoked.
2. **Add Stoop with the token in a header** (recommended). Claude Code:

   ```bash
   claude mcp add --transport http stoop https://<live-demo-url>/api/mcp --header "Authorization: Bearer stp_your_token_here"
   ```

   Any client that reads a JSON config with headers:

   ```json
   {
     "mcpServers": {
       "stoop": {
         "type": "http",
         "url": "https://<live-demo-url>/api/mcp",
         "headers": { "Authorization": "Bearer stp_your_token_here" }
       }
     }
   }
   ```

3. **Only if your client takes a URL and nothing else** (for example a custom connector in Claude on the web): `https://<live-demo-url>/api/mcp/stp_your_token_here`. The address carries the token and hosting logs record addresses, so keep it as private as the token.

## Architecture

- **App:** Next.js 16 (App Router, Cache Components), React 19, TypeScript strict, Tailwind 4.
- **Agent:** the Vercel AI SDK with Claude (Anthropic provider). The Culture step is a bounded tool-calling agent that returns Qloo ids only; a grounding guard rejects anything else.
- **Qloo client:** validated, cached (7 days), paced at 4 requests per second with backoff, counted per run and per day, with evidence on every result.
- **Storage:** Upstash Redis for the shared Qloo cache, run events, caps, rate limits, the waitlist and MCP tokens (an in-memory store for local development). Frames go to Vercel Blob or Cloudflare R2 through one adapter ([`lib/storage.ts`](lib/storage.ts)).
- **Media:** fal for storyboard frames and draft video.
- **Hosting:** Vercel, with vendor services behind small adapters.
- **Runs:** starting is idempotent on the brief, so a double press joins the same run. At most 2 live runs go at once; past that, Stoop replays an example (no queue). A 240 s deadline covers each attempt. Stages are memoized, so a stopped run picks up where it left off with Resume. Events stream over server-sent events and reconnect without loss, and one event schema and reducer serve live runs, finished runs and example replays.
- **Caps:** 50 Qloo calls per run (6 per revision), plus daily caps on live runs, storyboard frames, Qloo calls and renders. At a cap, Stoop shows an example or a plain note, never an error screen. One switch (`STOOP_LIVE`, off by default) turns every live Qloo, Claude and server-side fal call off (BYOK bills the visitor's own key, so it is separate).
- **Security:** a site-wide Content Security Policy (`frame-ancestors 'none'`, `object-src 'none'`, `connect-src 'self'`), the stricter `/byok` policy, HSTS, `nosniff`, a Referrer-Policy and a Permissions-Policy. The Qloo key is read on the server only. The page reader fetches only public addresses (re-checked on every redirect), with a timeout and a size cap, and treats page text as data, never instructions. Spending routes have a cross-site and bot guard. Reports, live runs, `/byok` and the API are kept out of search.

## Data and the Qloo API

Qloo response data is not stored in this public repository. Qloo's [hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) says: "Do not store Qloo response data in a public repository." So the recorded responses and everything built from them are left out of every commit here: the recordings in `fixtures/`, the stored example runs in `data/runs/`, the frozen reference panels in `data/culture/`, the reference audiences for city ranking (`data/geo/reference-heatmap.json`), the data check's results (`data/data-check/`, `docs/data-check-details.md`) and the `/mcp` page's example session (`data/marketing/`). [`public-mirror.exclude`](public-mirror.exclude) lists every path, and `npm run check:public` fails if one comes back. [`docs/data-check.md`](docs/data-check.md) keeps the method and the aggregate findings.

The live demo runs on the same code with private server-side caching of Qloo responses, which the guide allows ("Private server-side caching is fine and there is no time limit on how long you can keep cached responses").

**Without the data,** typecheck, lint and the unit tests that need no recordings all run (`npm run check`); the tests that replay recordings are skipped with a notice, and `next build` and `npm run e2e` stop at once with a message that lists the missing files. In CI, `next build` and the end-to-end tests skip with a notice.

## Run it locally with your own Qloo key

Requires Node 22.12 or newer, a Qloo hackathon API key and an Anthropic API key. Hackathon keys only work against `https://hackathon.api.qloo.com`.

```bash
git clone https://github.com/khadimswe/stoop-public.git stoop
cd stoop
npm ci
cp .env.example .env.local   # then fill in QLOO_API_KEY and ANTHROPIC_API_KEY
```

Then record the data in this order (about 400 Qloo calls of the 10,000 a month, plus Claude calls for the three examples). Each `plan` step writes a recipe to `fixtures/recipes/`; record it before the next step.

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
```

Then start it:

```bash
npm run dev                  # http://localhost:3000, examples replay with no live calls
```

Live runs are off by default. To run your own product, set `STOOP_LIVE=true` in `.env.local`. Storyboard frames also need `FAL_KEY` and a storage token (`BLOB_READ_WRITE_TOKEN`, or the R2 settings with `STORAGE_DRIVER=r2`). Without Upstash settings, a local server keeps its state in memory.

Some unit tests pin values from our own recordings (a city's rank, a segment's label), so with your recordings expect those to differ. Keep your recordings out of any public repository too.

## Tests

| Command | What it runs |
| --- | --- |
| `npm run check` | Typecheck, lint, the unit tests, an em dash scan and a color contrast check |
| `npm run test` | Unit tests (Vitest) for `lib/` and `scripts/`, replaying recorded Qloo responses from `fixtures/` |
| `npm run e2e` | End-to-end tests (Playwright) on desktop Chrome, a Pixel 7 and a 390 px phone |
| `npm run check:public` | Fails if Qloo response data (an excluded path, or a Qloo-like entity id) is in this tree |

`npm run e2e` starts `npm run dev` by default. To test a production build instead:

```bash
npx playwright install chromium   # once
npx next build && npx next start -p 3215
E2E_BASE_URL=http://localhost:3215 npm run e2e   # in a second terminal
```

GitHub Actions runs a secret scan, the em dash scan, `npm run check` and the Qloo data scan on every push. Where the recordings are present, it also runs a production build and, on pull requests and `main`, the end-to-end suite in replay mode, with no secrets. In this public copy those two skip with a notice.

## Roadmap

- **Precision mode:** connect your Shopify store so real order locations and best-sellers sharpen Qloo's picture. Aggregated, no customer PII. It ships as a Shopify App Store app.
- **A results loop:** upload the Meta or TikTok results export for each concept, so later runs learn which concept worlds worked.
- **Stoop Series:** turn one concept world into a short branded micro-series, with its characters, settings, music and voice drawn from that world's Qloo data and every cue scored by Qloo, as in the ads today.
- **Customer language from reviews:** blend a brand's own review language into its briefs, labeled as the brand's words, never as Qloo data.

## License

[MIT](LICENSE)
