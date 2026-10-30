# Stoop

**Give your community a reason to stop.** Tailored events for prepaid wireless stores, planned with [Qloo](https://www.qloo.com)'s taste data.

Every prepaid phone store (Metro by T-Mobile, Cricket, Boost Mobile) runs the same table outside: a speaker, some chips, a sign. A table that pulls people in on one street gets walked past on another. Stoop plans the table for the community around the store: music the city plays, snacks and gift cards from spots down the street, and a prize wheel built from the store's own deals. Then it makes the poster and lines up the posts for Facebook, Instagram and WhatsApp. Nothing posts until the manager approves.

Built for the Qloo Agentic Hackathon (2026) by a sales rep who works the floor at a Metro by T-Mobile store.

- Live demo: `https://<live-demo-url>`
- Judge's guide: `https://<live-demo-url>/judges`

## Why

At my first Metro store, on Tara Boulevard south of Atlanta, a table outside with music and snacks brought in real traffic. When I moved to a store in Kennesaw and set up the same table, people walked right past it. Same table, different community, and I couldn't read the new one. Reading a community is a marketing team's job, and stores like mine don't have one.

## What Stoop does, in five steps

1. **Community.** Qloo finds the places within about a mile of the store (food spots, venues, parks), each with Qloo's own description, and the artists Qloo ranks for the city's adults. They show on a map with the same numbers as the list.
2. **Create.** The manager adds the day, the hours, a budget ($50 by default) and the store's promos, typed exactly.
3. **Event.** Stoop writes three table ideas, scores them on a rubric and keeps the best, then builds the day: what to play, what to serve and where to buy it, the prize wheel, a timeline, a checklist and a shopping list that stays in budget. A generic AI plan for the same store sits beside it, so the difference is visible.
4. **Poster.** An image model paints the background (no text, logos or people) and code sets every word, so dates, prices and deals are always exact.
5. **Promote.** An announcement plus reminders for the evening before, the morning of and an hour before, each with its own words, ready to share in one tap. Posting straight to a Facebook Page and Instagram is built behind a switch and turns on once Meta approves the app.

## The 2-minute judge path

1. **The landing's "Same table. Different community."** Three fictional example stores in Chicago, Atlanta and Houston, with the same kind of deals. Qloo picked different music, food spots and prizes for each. They load from recorded runs, instantly, with no live calls.
2. **One example event** (`/plan/ex-chicago-18th-street`). Open any "Why Qloo picked this": the receipt shows the exact Qloo query (never the key), whether it came from cache, and Qloo's own reason for the place.
3. **The comparison** (`#compare` on the same page): the generic AI plan's own picks, checked against Qloo.
4. **Your own store** at `/start`, within the daily caps. When live plans are off, it says so plainly and opens a full example instead.

`/judges` walks the same path and maps every Qloo call to the code behind it.

## How Qloo decides

| What | Qloo call | Used for |
| --- | --- | --- |
| The city's music | `/v2/insights`, `filter.type=urn:entity:artist`, the city as `signal.location.query`, the store's adult age bands | The playlist |
| The community | `/v2/insights`, `filter.type=urn:entity:place`, `filter.location` (the store's point) and a 1.5 km radius, `feature.explainability=true` | Snack runs, gift cards, partners, the map |
| The community's own music (an option) | One call with the community's top independent places as the signal | Offered only when it comes back current and different from the city's list |
| Checking the generic plan | `/search`, then one `filter.results.entities` call | Scoring the generic plan's picks against Qloo's own |

About 11 live Qloo calls per plan, a hard cap of 20, and everything cached. Claude cites Qloo ids, never names: names are rendered from Qloo's results, so the plan can't invent a place.

We tested Qloo live before building. A city name re-ranks results strongly; a map point used as a taste signal barely does; neighborhood names are inconsistent; places near a point are distinct for every store. So Stoop uses the city for music and the places near the store for everything local, and says so.

## Proof

We ran Stoop for 12 real Metro locations across metro Atlanta with identical inputs, then for 12 in Dallas and Fort Worth, a metro we never tuned on.

- Every plan named spots within 1.5 km of its own store, each with a Qloo receipt; in Dallas and Fort Worth, Qloo decided both the gift cards and the snacks in all 12.
- The generic AI plan, allowed to name places, named no business near any of the 24 stores.
- What didn't carry over as well: more of the Dallas picks were chains, and several stores got similar food-led themes.
- Qloo's music is city-wide: two towns in the same metro got nearly the same artists. Stoop says that plainly instead of claiming it knows a neighborhood's music.

## What's honest, and what isn't claimed

- Stoop makes no traffic or sales claims. The first pilot runs at the founder's store; results are a first look, not proof.
- Qloo measures a city and the places near a store, not a store's buyers. Stoop never says "your customers", never builds a theme on assumed ethnicity or identity tags, and plans only for adults (the youngest band reads 18 to 24; nothing is aimed at minors).
- Every music, food, partner and venue line has a Qloo receipt, or is labeled "Your choice" or "Creative suggestion (not from Qloo)".
- Promos are quoted exactly as the manager typed them, and are checked before they go on a poster or a post. No alcohol or tobacco giveaways. Free to spin, no purchase needed.
- No carrier logos and no implied endorsement. Metro by T-Mobile, Cricket Wireless and Boost Mobile are trademarks of their owners; Stoop is independent. The example stores are fictional.
- Only aggregate taste data is used. Stoop never sends personal data to Qloo: only a city, a point, a radius and age bands.

## Use Stoop inside Claude (MCP)

Stoop is a remote MCP server. Its `plan_store_event` tool plans an event for a store and sends back the plan link; when live plans are off or the day's share is used up, it sends back an example. Get a token at `https://<live-demo-url>/mcp` (shown once, daily caps, revocable), then:

```bash
claude mcp add --transport http stoop https://<live-demo-url>/api/mcp --header "Authorization: Bearer stp_your_token_here"
```

## Architecture

- **App:** Next.js 16 (App Router, Cache Components), React 19, TypeScript strict, Tailwind 4, zod.
- **Agent:** the Vercel AI SDK with Claude for the ideas, the plan, the generic plan and the posts. Every output is checked (Qloo ids only, offers verbatim, no alcohol, no identity themes, no community slang) and sent back for one rewrite, with a deterministic fallback.
- **Qloo client:** validates every parameter per entity type (Qloo silently ignores bad ones), caches, paces requests, and enforces a per-plan budget and daily caps, with a receipt on every result.
- **Runs:** one event schema and one reducer for live plans, replays and examples. Plans run after the response with a deadline and stream progress over server-sent events. The poster and posts start on their own when a plan finishes.
- **Map:** MapLibre GL with OpenFreeMap tiles (no API key).
- **Posters:** fal (Nano Banana 2) for the background art, next/og for every word.
- **Storage:** Upstash Redis for runs, caps and rate limits; Vercel Blob or Cloudflare R2 for images, behind one adapter ([`lib/storage.ts`](lib/storage.ts)).
- **Security:** a live plan's private details and actions belong to the browser that started it; its public event link shows only the event. Daily caps on plans, Qloo calls and renders, counted per network. A site-wide Content Security Policy, HSTS and `nosniff`. The Qloo key is read on the server only. One switch (`STOOP_LIVE`, off by default) turns every paid live call off.

## How we got here

Stoop started on Oct 16 as a culture-brief tool for direct-to-consumer video ads: Qloo mapped the audience around a product and Stoop wrote concepts for it. Testing it against real stores showed the stronger problem was on the sidewalk outside them, so on Oct 28 Stoop pivoted to store events. The ad flow still runs at `/ads`, and the store-events product is built on its Qloo client, receipts and guardrails.

## Data and the Qloo API

Qloo response data is not stored in this public repository. Qloo's [hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) says: "Do not store Qloo response data in a public repository." So the recorded responses and everything built from them are left out of every commit here: the recordings in `fixtures/`, the example store plans in `data/plans/`, the proof runs in `data/proof/`, the ad flow's example runs in `data/runs/`, the frozen reference panels in `data/culture/`, the reference audiences for city ranking (`data/geo/reference-heatmap.json`), the data check's results (`data/data-check/`, `docs/data-check-details.md`) and the `/mcp` page's example session (`data/marketing/`). [`public-mirror.exclude`](public-mirror.exclude) lists every path, and `npm run check:public` fails if one comes back. [`docs/data-check.md`](docs/data-check.md) keeps the method and the aggregate findings.

The live demo runs on the same code with private server-side caching of Qloo responses, which the guide allows ("Private server-side caching is fine and there is no time limit on how long you can keep cached responses").

**Without the data,** typecheck, lint and the unit tests that need no recordings all run (`npm run check`); the tests that replay recordings are skipped with a notice, and `next build` and `npm run e2e` stop at once with a message that lists the missing files. In CI, `next build` and the end-to-end tests skip with a notice.

## Run it locally with your own keys

Requires Node 22.12 or newer, a Qloo hackathon API key and an Anthropic API key. Hackathon keys only work against `https://hackathon.api.qloo.com`.

```bash
git clone https://github.com/khadimswe/stoop.git
cd stoop
npm ci
cp .env.example .env.local   # then fill in QLOO_API_KEY and ANTHROPIC_API_KEY
```

Record the three example stores (live once, then replayed offline; their Qloo answers go to `fixtures/`, their Claude answers to `fixtures/llm/` and the plans to `data/plans/`):

```bash
npx tsx scripts/record-plan-example.ts --all
npm run dev                  # http://localhost:3000, the examples replay with no live calls
```

Live plans are off by default. To plan your own store, set `STOOP_LIVE=true` in `.env.local`. Poster art also needs `FAL_KEY` and a storage token (`BLOB_READ_WRITE_TOKEN`, or the R2 settings with `STORAGE_DRIVER=r2`). Without Upstash settings, a local server keeps its state in memory. Keep your recordings out of any public repository too.

<details>
<summary>Recording the ad flow's data (only for <code>/ads</code>)</summary>

```bash
npm run fixtures:record -- smoke
npm run fixtures:record -- probe-search
npm run fixtures:record -- pool-resolve
npm run fixtures:record -- pool-refresh-2
npm run data-check -- plan audience && npm run fixtures:record -- pool-audience
npm run data-check -- panels
npm run data-check -- plan reference && npm run fixtures:record -- reference-audiences
npm run data-check -- plan reference --tags && npm run fixtures:record -- reference-audiences-2
npm run data-check -- reference
npm run data-check -- plan missing
npm run example -- food-hot-sauce --record
npm run example -- home-candles --record
npm run example -- pets-outfits --record
npm run audience -- --picks
npm run mcp:session
```

</details>

## Tests

| Command | What it runs |
| --- | --- |
| `npm run check` | Typecheck, lint, the unit tests, an em dash scan and a color contrast check |
| `npm run test` | Unit tests (Vitest), replaying recorded Qloo and Claude responses; each example plan must replay offline to exactly its stored plan |
| `npm run e2e` | End-to-end tests (Playwright) on desktop Chrome, a Pixel 7 and a 390 px phone |
| `npm run check:public` | Fails if Qloo response data (an excluded path, or a Qloo-like entity id) is in this tree |

To test a production build end to end:

```bash
npx playwright install chromium   # once
npx next build && npx next start -p 3215
E2E_BASE_URL=http://localhost:3215 npm run e2e   # in a second terminal
```

GitHub Actions runs a secret scan, the em dash scan, `npm run check` and the Qloo data scan on every push. Where the recordings are present, it also runs a production build and the end-to-end suite in replay mode, with no secrets. In this public copy those two skip with a notice.

## Roadmap

- Results from both pilot stores, then a whole dealer.
- Measuring each event in Poppy, the founder's sales app for prepaid dealers, which already logs walk-ins.
- Posting straight to Facebook Pages and Instagram once Meta approves the app.
- "Picture your table": snap the current table and see a labeled setup preview built from the plan's picks.
- Accounts, so multi-store and district managers see every store's next event.
- Other commissioned sales teams: phone repair, furniture, fitness.

## License

[MIT](LICENSE)
