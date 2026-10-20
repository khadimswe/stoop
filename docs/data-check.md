# Data check: what Qloo actually returns

Recorded October 16, 2026, against `https://hackathon.api.qloo.com`. Every finding below comes from a real recorded response. The recordings themselves are not in this repository: Qloo's hackathon developer guide asks that Qloo response data stay out of public repositories, so this page keeps the method, the rules it led to and aggregate findings, and leaves out entity names, per-entity scores and per-product results. README.md ("Data and the Qloo API") explains how to record your own and replay them with no key (`QLOO_MODE=fixtures`, `npm run data-check -- analyze`, `npm run audience -- --picks`).

- **Calls spent:** 338 of the 10,000 monthly calls.
  - The first data check: 271 (45 probes, 225 for the 9 candidate products, 1 top-up).
  - Building the audience stages: 67 (35 reference audiences for city ranking, 24 place and locality top-ups, 6 per-segment heatmaps, 2 to re-score one regenerated generic brief).
- **No live Claude calls,** except 4 to regenerate one product's LLM-only brief after its creative direction changed (below).
- **Why:** Qloo silently ignores parameters it doesn't support and still answers 200. So before building on any parameter, we recorded what it really does.
- **Scope:** Without store data, Stoop measures a product's taste neighborhood: the people whose tastes cluster around the brands, artists and shows a founder names. Precision mode (roadmap) adds real order data.

## Endpoints and parameters

| What | Result | Recording |
| --- | --- | --- |
| `GET /search` with `types` | Works. The exact match comes first and filler follows (other entities with similar names). Some entities live under longer names (a host's name before a show's title, a product line after a brand's name). | `probe-search`, `pool-resolve` |
| `GET /search` for `urn:entity:locality` | Works, with the county and state in the description, so Stoop picks the city only when name and state both match. | `pool-refresh-5` |
| `GET /v2/tags` | Works, with `id`. Emotional-tone tags are not in tag search ("calm" returns nothing), though insights return them by id. | `probe-search`, `pool-resolve` |
| Insights, entity types | Works. The real type is in `subtype`. 20 results without `take`, up to 50 with it. | `probe-insights` |
| `filter.results.entities` | Works, which makes one-call panel scoring possible. Details below. | `probe-scoring` |
| `filter.results.tags` | Not in Qloo's docs, but it works: only the requested tags come back, each with an affinity. | `probe-extra` |
| `signal.location.query` on brand and artist | Not in Qloo's docs, but it works. Details under Region. | `probe-scoring` |
| `filter.location.query` on brand | Silently ignored: same top 50 as with no location (overlap 1.00). Stoop rejects it before sending. | `probe-extra` |
| `filter.location.query` on places | Fuzzy, and it can land abroad: two small US city names matched similarly named places in other countries. Stoop now sends the verified locality id instead (Qloo accepts it as `filter.location`). | `pool-refresh-4`, `pool-refresh-6` |
| `signal.demographics.age` | Works: 18 to 24 and 35 to 44 share 0.08 of their top 20 artists. | `probe-scoring` |
| `urn:demographics` | One row of skew indices (-1 to 1) per input entity, not per audience. Stoop averages them and says "skews", never "% of". | `probe-insights` |
| `urn:heatmap` + `filter.location.query: "United States"` | Works: 6,000 to 13,000 geohash cells per audience (precision 4, about 40 by 20 km), territories included. Single niche titles can return very few cells (48 for one film). | `probe-insights`, `pool-audience`, `reference-audiences` |
| Places + `feature.explainability` | Works: each place carries a score per input signal. | `probe-insights`, `pool-refresh-6` |
| `urn:tag` without filters | Mostly noise for this use (foods, a credit card, identity tags). With `filter.tag.types` (for example `urn:tag:genre:music`) it is clean. | `probe-insights`, `probe-scoring` |
| `/v2/analysis/compare` | Unreliable here: one side came back empty for a brand that has 114 tags in search. Not used for the Reality Check. | `probe-insights` |
| `urn:audience` | Returns ranked interest audiences. Not used: segments come from affinities and skews only. | `probe-extra` |
| `/v2/trending` | Needs a signal and a date range (400 without). Not used. | `probe-extra` |
| `urn:entity:destination` | Leans toward tourist cities in the western US, so not used to name places. | `probe-extra` |
| Rate limits | 5 per second (`x-second-ratelimit-reset` is in seconds), 10,000 per month. Stoop paces at 4 per second. | `smoke` |

## One-call panel scoring

Stoop scores the LLM-only brief's picks, Qloo's picks and a frozen reference panel in one call with `filter.results.entities`. The recordings confirm the four behaviors that depend on:

1. **Only the requested ids come back.** Ids of the wrong type (a podcast id in an artist call) are dropped.
2. **A signal's own seeds are left out** of its results, so a seed can't be scored against itself.
3. **Scores match the open list for the same signal** (identical to 10 decimal places), so a panel position means what it says.
4. **Scores move when the signal changes:** the same artist's affinity dropped by about a quarter under a different seed.

Without `take`, Qloo returns 20 results, so a call scoring 36 ids would be cut silently. Stoop now refuses a scoring call whose `take` is smaller than its id list.

## Region

`signal.location.query` re-ranks brand and artist results. For the same seeds:

| Results | Top-20 overlap, no location vs Atlanta | vs Seattle | Atlanta vs Seattle |
| --- | --- | --- | --- |
| Brands | 0.08 | 0.11 | 0.11 |
| Artists | 0.25 | 0.54 | 0.29 |

Atlanta brings sneaker and streetwear shops; Seattle brings outdoor brands. So region reaches brand and artist results through `signal.location`, and heatmap and place queries through `filter.location`.

## Where a taste neighborhood clusters

Heatmap affinity is a percentile within each response, and it tracks popularity (correlation 0.955), so raw affinity just picks the biggest metros. We compared four rankings on the 9 recorded candidate heatmaps:

| Method | Result | Top-5 overlap between products |
| --- | --- | --- |
| Raw affinity | The largest, densest metros for every product | not measured |
| Residual lift (fit on popularity, one response) | Small towns with noisy cells. Among dense metros, the same four in the top 5 for 6 of 9 products | 0.11 |
| Ratio to an all-ages baseline heatmap | Noisy (a mid-size city first) | not used |
| **Reference-corrected lift** | Product-specific | low (partly built in, see below) |

How reference-corrected lift works:
1. **One grid.** Responses hold different cell sets, so every heatmap is re-ranked as percentiles on the 6,050 cells all 9 candidate heatmaps share. This is the one place Stoop compares Qloo numbers across calls. It compares rank positions on the same cells, never raw affinity. Entity and tag scores are only ever compared within one call.
2. **Reference audiences.** A cell's lift is this audience's percentile minus the mean percentile of a frozen set of reference audiences on the same cell (`data/geo/reference-heatmap.json`, built by `npm run data-check -- reference`). Shared effects like population density cancel out.
   - **The full set has 23 audiences:** the 9 candidates plus 14 more.
   - **The 14 came from 35 recorded:** single artists, brands, films and TV shows from the frozen panels, plus broad music genres. Only those covering at least 95% of the grid count; single films and shows were mostly too sparse.
   - **Receipts** say how many reference audiences a ranking compared against ("ranked against 22 reference audiences" for a candidate, which is left out of its own reference).
3. **Leave-one-out.** For a candidate, each cell's lifts across the reference set sum to zero, so some separation between products is built into the method. The evidence is where each product lands, not the low overlap.
4. **Noise floor.** Only cells where this audience has real signal count (popularity of at least 0.7), and a metro needs 3 such cells. Metros are ranked by mean lift shrunk by cell count (n / (n + 2)), so a consistent metro beats a 3-cell blip.
5. **Stability, both ways.** Each city is also ranked against the 9 candidates alone.
   - **Small-set only:** a city in the top 5 there but outside the top 10 against the full set "holds only against the small set", and Stoop doesn't use it. This happened for 5 of the 9 products.
   - **Large swing:** a city whose rank moves by more than 20 between the two sets is flagged unstable either way. It stays in the list with its flag, and copy names the first stable city instead. One example's first city against the full set ranked far down against the candidates alone, so its copy names the next stable city. A city is a measured hint, not a fact.

How cities get named:
- **Labels:** Qloo returns cells, not names, so each cell is labeled with the nearest US metro area from the Census Bureau's 2024 metro list (public domain, `data/geo/us-metros.json`). The name is only a label; the receipt is Qloo's cell and lift.
- **Name rule:** one metro is labeled by its second principal city. Its first-listed city is a village home to a single religious community, and naming an ad setting after it would read as targeting that community.
- **Cities set the setting, never the cast:** talent is never described by ethnicity.

## Segments

- **What a segment is:** an age bucket that over-indexes (positive skew), up to two. Each gets its own artist, brand and heatmap call.
- **Labels** name each world by the genres most distinctive to it, from the top artists' `primary_genres` (a Qloo property). Taken alone, two worlds can share a genre label; side by side each is named by what sets it apart.
- **Segment cities carry an age effect.** The reference audiences have no age signal, so a segment's ranking also reflects where that age band lives in general: an 18 to 24 world lands in college towns. These cities are kept as setting hints, not used in labels or the Reality Check.

## Reference panels

Six frozen panels: artist, brand, movie, TV show, music tag and emotional-tone tag (`data/culture/panels.json`, built by `npm run data-check -- panels`).
- **What each holds:** 25 real entries from the recorded audience lists, spread evenly across popularity, at most 3 from any one candidate.
- **What each never holds:** a seed, a generic-brief pick, or a name the minor or ethnicity guardrails flag.
- **Own picks left out:** a panel entry that is one of an audience's own top 10 is left out of that audience's comparison, so a position can read "of 24".
- **Frozen:** changing a panel changes every score.

What the panels showed:
- **For every candidate, Qloo's own top 10 beat every panel entry Qloo returned, in all six panels.** At the whole-audience level the panel-scored fields all show strong signal, so richness doesn't separate candidates. The Culture stage re-checks it per segment, where the signal is narrower.
- **The panels discriminate where it matters: the LLM-only brief's choices.** The generic brief's music style landed at or near the bottom of the music tag panel for some products, where Qloo's top music tag beat the whole panel.
- **Tag panels are partly unscored.** Not every panel tag comes back for a given signal (between 8 and 25). A missing tag means no measurable affinity, not a low score.

## What the LLM-only brief can be checked on

The LLM-only briefs (written with no Qloo data, 3 runs per product) named almost nothing beyond the founder's own seeds: one artist in 27 runs. Seeds are the signal, so they aren't scored. The comparison therefore rests on:
- **Age and gender:** the brief's guess against Qloo's skews.
- **Cities:** the brief's guessed cities against the metros ranked by lift. A bare name is read as the matching metro with the largest land area (so Portland is Portland, OR, not Maine), and Brooklyn counts as New York. Every brief guessed at least one of Los Angeles, New York, Portland, Austin or Brooklyn.
- **Music style and mood:** mapped to a Qloo tag (word similarity of at least 0.5, shown in the receipt) and scored against the tag panel. A mood maps to Qloo's emotional-tone id; if Qloo doesn't return it, the choice is unverifiable.

The generic briefs also repeat themselves: four of 9 very different products got some form of indie pop or indie folk (indie pop, indie electronic pop, indie folk, acoustic indie folk).

**One regeneration:** the pet hats example's creative direction changed to a 3D-animated look on Oct 16.
- **Why it was regenerated:** the LLM-only brief is written with the creative direction, and only the brief may differ between it and the Qloo path. So its three runs and concepts were regenerated once with the new look, and kept as they came back.
- **What it records:** its runs say why (`regeneratedBecause`).
- **What changed:** its music went from indie pop to bedroom pop, and its cities from Los Angeles and Brooklyn to Los Angeles and Austin. That moved the comparison in the example's favor. It was regenerated because its direction changed, and kept as it came back, not chosen.

## The candidate pool

All 9 candidates are fictional products. "Gap lines" is the first-pass screen used to pick the examples; it counts how many of three checks differ:
1. **Age:** Qloo's top age skew falls outside the stated band and beats every stated bucket by at least 0.1 (a near tie is not a gap). A bucket counts as stated only when the band covers at least 3 of its years or half of it: "25 to 45" does not state 45 to 54.
2. **Cities:** none of the brief's cities is in the top 10 metros by lift.
3. **Music:** the brief's music style is below the panel median, or at least 5 panel positions behind Qloo's top music tag.

Segments are the age buckets that over-index (positive skew), up to two. Distinctness is 1 minus the top-20 overlap of the two segments' artists and brands.

Across the 9 candidates:
- **Seeds:** 34 of 36 resolved. Two had no match and were dropped, never guessed: one brand had no result, and for another Qloo's best guess was a different brand. Three resolved as Qloo's top hit under a longer name, and the receipt marks these as affix matches.
- **Gap lines:** two products scored 3, three scored 2, two scored 1 and two scored 0.
- **Segments:** 8 products had two measured segments and one had a single segment. Distinctness between the two worlds ranged from 0.42 to 0.97.

## The examples and their Reality Check

The examples, chosen with the gap-lines screen:
- **Lead: Porchlight Pepper Co.** (small-batch hot sauce)
- **Lowlight Candle Co.** (hand-poured soy candles)
- **Whisker & Brim** (pet hats and outfits, the 3D-animated example)

Their audience runs are recorded in `data/runs/<slug>/` and replay to the same report byte for byte.

The Reality Check never forces a gap.
- **Per dimension:** each dimension the founder stated (age, gender, cities, taste) is a gap, a near tie or confirmed, each with its own margin. A stated taste Qloo can't score is unverifiable, which counts neither way. A broad band (more than 25 years) is never a full confirmation, and a stated city whose rank is flagged unstable is a near tie at best.
- **Overall:** gap, partly or confirmed. A near tie is labeled as one.
- **The generic AI brief's assumptions** show whenever they differ from Qloo.

The three results: two examples show a gap; the third is "partly", because its age difference is a near tie (0.03), so it is not called a gap, while the generic brief's cities still differ from Qloo's.

**Set aside:**
- **The two products with 0 gap lines:** the generic brief and Qloo largely agree.
- **The startup products:** one has 1 gap line. The other has 2, but only one measured segment, so there is no second world to show.
- **The product with the most overlapping worlds (distinctness 0.42)** and 1 gap line.
- **Two more products:** on review, their top cities and segments follow one scene and a few cities closely enough that an example ad could read as a stereotype rather than a taste. Both products still work in Stoop. Examples are the showcase, and we hold them to the stricter bar.

## Concept worlds

Each measured segment becomes a concept world: a Culture Brief written from that world's own Qloo answers, checked against the frozen panels, next to the LLM-only brief scored the same way. Recorded for the three examples in `data/runs/<slug>/run.*.json` (`npm run example -- --picks` replays them offline).

**The age signal changes film and TV, a lot.**
- For one example's oldest world, the top 20 films overlap the whole audience's top 20 by 0.08, and TV shows by 0.14.
- So every world gets its own visual references from its own call: seeds plus its age bucket, the same signal Segments sends.

**Settings come from the audience's own headline cities.**
- **The rule:** each world is set in one of Prove's stable top 5 cities, the one its own heatmap lifts most, and no two worlds share one.
- **Result:** all six worlds got their own city.

**Places still lean on chains.**
- **Chains are dropped:** a name Qloo returns twice or more in one answer is a chain and is dropped, in the sweep and in the agent's probes. That removed one to three per world, all national coffee or fast-food chains.
- **What remains is local, with a reason:** the kept places are local ones with Qloo's explainability, shown as the seeds that drove them ("Fans of" two of the seeds).
- **Thin settings get a probe:** one world's city returned one local place, so the Culture agent probed Qloo once more for places there. It is the agent's one probe across the six worlds; every other field already had rich signal.

**Wardrobe comes from brands people wear.**
- A segment's top brands include kitchen appliances, delis and snack brands. Only brands Qloo files under a wearable genre (Fashion, Casual, Accessories, Footwear, Eyewear and the like) back wardrobe.

**How rich each world is.**
- **Fields:** every world has Qloo signal on all 7 brief fields (music, visual, wardrobe, setting, mood, voice, creators), and 3 to 5 brief slots are backed richly. A slot is rich at 3 or more measured picks: beating 75% of the panel, or a place Qloo explained.
- **Panel positions:** per type, Qloo's own top picks for each world sit at the top of the reference panel. Positions are only compared inside one scoring call, so types are never pooled. The panel leaves out each world's own picks, so a position can read "of 24".
- **Small tag panels:** the tag panels return fewer items for these signals: 11 to 16 mood tags and 19 to 25 music tags. Every position is still shown as "beats N of M", and none of them fell under the 5 a median needs.

**Creators are measured for the whole audience.**
- **Who comes back:** people are mostly TV food hosts and musicians; podcasts are mostly comedy and lifestyle shows.
- **How they're used:** to describe the kind of creator to partner with and the voice. Their names stay in the receipts, never in prompts.
- **Never rich:** people and podcasts have no reference panel and no explanation, so they can back a field but never make it rich.

**The LLM-only brief, checked against every world.**
- In each of the six worlds, 2 or 3 of the brief's 4 checkable choices miss, and the range over its 3 runs stays within one choice of that.
- **Checkable:** ages, cities, the music style and named references. A named reference that resolves to one of the seeds is left out: the seeds are the signal.
- **Unverifiable:** setting types and wardrobe text have nothing to check against. A mood word counts only if Qloo returns a mood tag by that name, and none of the three did.
- **The cliches it flags:**
  - **Cities:** the brief's Austin, Portland, Brooklyn and Los Angeles rank well outside the top cities of every world.
  - **Ages:** the generic 25 to 44 band misses the oldest and youngest worlds.
  - **Music, where it differs by world:** the same generic music style can sit at the top of one world's panel and at the bottom of another's.

**Calls:**
- **A recorded run makes 33 to 36 Qloo calls,** within the 44 a live run plans and its cap of 50 (a test runs a full example in a live run's budget context):
  - Prove 4
  - Segments 6
  - creators 2
  - mapping the generic brief 1 to 4
  - for the two worlds together: 6 for the sweep, 2 locality lookups and 12 scoring calls
  - 0 to 2 agent probes
- **This round recorded 76 new calls:** 3 for the age-signal probe and 73 for the three examples, across a few re-recordings as the stages were fixed.

## Fixture format

Recorded fixtures keep only the fields Stoop reads; full bodies stay in the gitignored `fixtures/raw/`.
- **Entities:** the slimmer drops akas, websites, plot text, raw media keywords and Wikipedia categories.
- **Identity text:** it also drops audience-identity and demographic text, because Stoop never builds segments from text labels.
- **Large files:** fixtures over 1 MB are stored gzipped (`.json.gz`), and a test scans every fixture, gzipped or not, with the patterns gitleaks uses.
- **Integrity:** no value is ever changed. `npm run fixtures:record -- <name> --reslim` re-applies the rules from the raw bodies with no calls.
