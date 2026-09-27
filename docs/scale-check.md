# The scale check

CAMP-134. Every number here comes from a run on 27.09.2026, on the machine
that holds the database.

## Why it exists

On 25.09.2026 six defects out of eighteen shared one cause: each was
invisible on CI's fixture and obvious on the full data. CI stayed green
through all six.

| what broke | on the fixture | on 61 557 |
| --- | --- | --- |
| loading OSM layers | works on 3 countries | `ERROR: tables can have at most 1600 columns` |
| `loaded()` in e2e | map opens zoomed in, markers present | map opens too wide, `data-total` stays 0 forever |
| the "zoomed-out map" test | honestly shows "36 campsites" → test fails | shows "zoom in" → test passes |
| `data-map-state="ready"` | one chunk, no parallel requests | published with fetches in flight, 7 of 14 chunks |
| the search index | 1 small file | 6.9 MB against a 1.5 MB budget |
| the map snapshot | under the 20 000 bound | 61 521 against 20 000, the panel said "0 campsites" |

Twice it was mirror-image: the test failed **because** the data was small.
So the fixture does not merely miss defects — it invents them.

This is not a gap in the tests. The tests are written well; they check
what somebody guessed. These six are about size, and no volume of tests
on 72 campsites reaches any of them.

## What runs, and what it costs

| stage | what it asks | measured |
| --- | --- | --- |
| rehearsal | every guard below, driven with the broken version | 7.2 s |
| probes | OSM tag census; the map index against the API | 4.2 s |
| build | `next build`, 65 435 pages, against the warm API | **7 min 36 s** |
| browser | 9 tests, chromium, one viewport | 21–34 s |

So a nightly with the browser stage is **about eight and a half minutes**,
almost all of it the build. Without the build (`with-pages: false` on a
manual run) it is **eleven seconds**.

For comparison: the same build took over seven hours projected on
24.09.2026 when the rate-limit bypass was misconfigured. The API build
token is not an optimisation here, it is the difference between a nightly
and an impossibility.

## The four decisions

### 1. What runs on full data

Not the e2e matrix. `tests/e2e` is 18 files across six browser projects,
and almost all of it is about markup, headings, links and filter
arithmetic — none of which change with the size of the dataset. Running
it at scale would multiply the slowest suite we have by the largest data
we have to re-answer questions the fixture already answers correctly.

What runs is the set of things whose truth value depends on size:

- **the build completes** — the data routes throw when the index is empty
  or a chunk is over budget, and those throws are the guard;
- **the map and search stay inside their bounds** — index bytes, per-file
  bytes, raw and compressed totals, the size of the first chunk a reader
  waits for;
- **the numbers on the page match the files behind them** — `data-total`
  against the chunks actually fetched, the panel's count against
  `data-total`, the index's promise against `/spots/summary`;
- **the OSM export still narrows its tags** — priced against a real tag
  census of the real extracts.

Nine browser tests, chromium only, one viewport. Cross-browser coverage
stays in `tests/e2e`, on the fixture, where it is fast and where it
belongs.

### 2. Where the data comes from

The machine that already has it. Priced:

| option | cost |
| --- | --- |
| a dump in CI | the database is 4 379 MB; the OSM extracts are 30 GB, and `merged.water.pbf` alone is 797 MB — the tag census reads that file whole, a sample of it answers a different question |
| a second machine with its own copy | a production dataset kept in step by hand drifts; a scale check against a stale copy is worse than none, because it reports on data nobody serves |
| the machine that has it | free, and already running the API |

So: a self-hosted runner labelled `camptribe-data`. The label is a promise
about what the machine holds — the database, the extracts, and the API —
and `.github/actionlint.yaml` says so, because anything without all three
would pass the scale check over the wrong data.

The cost of this choice is stated rather than hidden: the workflow cannot
run on a fork, and cannot run when that machine is off. So its **absence**
is watched. `scripts/ci/check-schedule.mjs` lists `scale-check.yml`, and
the daily watchdog opens an issue after a night with no successful run. A
nightly cron that stops, stops silently; that is this repository's own
lesson and it applies to the thing it just built.

### 3. How often

Nightly on the default branch, at 02:00 UTC — after the day's work and
before the 04:00 weekly import, so a run never reads a database
mid-import.

Not per PR. The build is 7 min 36 s and almost every push does not change
what any of these numbers would say. A PR that does can carry the `scale`
label, which runs the whole thing on that branch. A label rather than a
`paths:` filter, deliberately: `paths:` would run this on every commit to
those files, which is the per-PR cost again under another name, while a
label is a person deciding that this change is one of the ones worth the
runner.

The changes worth labelling:

- `scripts/osm-pipeline/**` — the export, the merge, the load;
- `apps/web/src/lib/search*.ts` and `apps/web/src/app/data/search/**`;
- `apps/web/src/lib/map-chunks.ts`, `map-sources.ts` and
  `apps/web/src/app/data/spots/**`;
- `apps/web/src/components/campsite-map.tsx`;
- `apps/api/src/spots/map.service.ts` and anything that changes what the
  bulk routes return.

### 4. Why the fixture is not made bigger instead

Because the numbers say it would not work, and they say it precisely.
Measured with `osmium tags-count` over the extracts the pipeline merges:

```
slovenia                    206 distinct keys on the water layer
croatia                     317
france                    1 055
germany                   1 458
slovenia+croatia+france   1 149   ← the three it was developed on
EU-27, merged             3 381   ← where it dies
```

Postgres refuses past 1 600 columns. **Three whole countries, France
included, stay under the ceiling.** A fixture that crossed it would have
to be most of the real extracts — at which point it is not a fixture, it
is the data, and it is neither fast nor cheap.

The same shape holds for the rest. The map snapshot's 20 000 cap is
silent over Slovenia and Croatia together (1 624 markers, measured) and
fires over the EU (truncated at 20 000). The search index's 1.5 MB
ceiling is at 1% over 72 rows and 6.1x over at full scale. A "realistic"
fixture would have to be realistic in tag diversity, in campsite density
and in country count simultaneously — which is a description of
production.

## Rehearsal

Nothing here is believed until it has been shown to fail.

```
./scripts/scale-check/run.sh --rehearse
```

runs the **broken versions** against the live data:

- the OSM export with its tag allowlist removed → 3 384 columns, fires.
  The same broken export over three countries → 1 152 columns, passes.
  That second half is the point: the code is equally broken in both runs,
  and only the data makes it visible.
- the deleted whole-world snapshot (`/spots/map/points?bbox=-180,-85,180,85&limit=20000`)
  → truncated, fires. The same request over Slovenia and Croatia → 1 624
  markers, silent.

The browser stage rehearses itself, in the suite, every run: one test
publishes `data-map-state="ready"` over a live chunk download and requires
the check to catch it. That test exists because the first version of the
detector recorded **zero** samples — its observer attached to
`document.documentElement` from an init script, before that element
existed — and passed, since "no sample says ready while fetching" is
trivially true of no samples. A check that cannot observe reports safety.

Two of the six cannot be rehearsed from a test, because they live in
application source that other cards own this week. They were rehearsed by
hand and the transcripts are on the pull request:

- the pre-CAMP-127 `loaded()` helper (poll `data-total > 0`, no zooming)
  → `data-total` stayed 0 for the full 20 000 ms and timed out;
- the fixture-shaped panel assertion (expect a campsite count at the
  opening view) → 0 elements, because the panel correctly says "zoom in".

## Running it by hand

```
set -a; . apps/api/.env; set +a          # API_BUILD_TOKEN
export API_BASE_URL=http://localhost:3001

./scripts/scale-check/run.sh              # probes only, ~4 s
./scripts/scale-check/run.sh --rehearse   # prove they can fail, ~7 s
npm run build --workspace=apps/web        # ~7.5 min
./scripts/scale-check/run.sh --with-pages # probes + browser
```

The runner refuses to start if `API_BUILD_TOKEN` is unset, if nothing
answers at `API_BASE_URL`, or if what answers holds fewer than 10 000
campsites. That last one is not hypothetical: pointing this at the CI
fixture is one wrong variable away, and every check would pass.

**Never** print the token, and never commit it. `camp-tribe-eu/camp` is
public; see `docs/ci-and-public-repo.md`. In the workflow it is
`secrets.SCALE_API_BUILD_TOKEN`, by name only.
