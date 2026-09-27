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
| the search index | 1 small file | 6.9 MB against a 1.5 MB budget (25.09.2026) |
| the map snapshot | under the 20 000 bound | 61 521 against 20 000, the panel said "0 campsites" |

Twice it was mirror-image: the test failed **because** the data was small.
So the fixture does not merely miss defects — it invents them.

### A seventh, found while this was being built

Not "the fixture is too small to show it" but "the test declined to run,
anywhere, and the job was green".

`apps/web/tests/unit/ranking-quality.spec.ts` measures the search against
the live index and reads that index from `RANKING_INDEX`. CI does not set
it. Measured 27.09.2026:

```
npx playwright test --project=unit                    295 passed,  5 skipped
…with RANKING_INDEX pointing at the live index        300 passed,  0 skipped
```

So five tests — including guards written to keep a hand-maintained lookup
table in step with its expectations — have never run on CI. A skip is
green, and the summary line says "295 passed" without mentioning them.

The same shape reached **inside this card's own work**: `tests/scale`
originally used `test.skip` when a browser had no WebGL2, which would
have turned five of six map tests into silent passes on a runner with a
changed driver while the runner still printed `✓ every scale check
passed`. That is why every spec in `tests/scale` now fails rather than
skips.

Two things follow, and both are in this change:

- `scripts/ci/check-skips.mjs` — the sibling of `check-flaky.mjs`. It
  reads a Playwright report and fails on a test that did not run, naming
  it and its reason. It counts a `fixme` too (Playwright reports that as
  `expected` with a skipped result, so counting only `status: 'skipped'`
  would walk past it), and it refuses a report containing no tests at
  all, because a run that executed nothing reports zero skips.
- the scale run **provides** the index. It fetches `/spots/search-index`
  and runs the unit project with `RANKING_INDEX` set, then holds both
  that run and the scale suite to a budget of **zero** skips. This job is
  the only place in the repository with the real index, so it is the only
  place those five can run for real.

⚠️ **What is not covered, stated rather than folded in.** The gate is not
yet on `ci.yml`'s e2e suite — only the guard's self-test is. `tests/e2e`
has 23 `test.skip` sites, most of them of the form "this build holds no
gone campsites" / "the fixture holds no campsite without facilities",
which is this card's subject arriving from a third direction: tests that
quietly stand down because the fixture lacks the case they were written
for. Budgeting those needs a full e2e report to seed from and a decision
per skip, which is a card of its own. Until then, CI can still go green
over an e2e test that declined to run.

This is not a gap in the tests. The tests are written well; they check
what somebody guessed. These six are about size, and no volume of tests
on 72 campsites reaches any of them.

## What runs, and what it costs

🔴 **Two columns, because one number would be a lie.** Every figure here
was measured on 27.09.2026 on the same machine, but some of them were
taken while a second full site build was running on it — load average 41,
and the API on :3001 answering `/spots/countries` in **15.1 s** instead of
0.15 s. Both conditions are real; only one of them is what the nightly
meets.

| stage | what it asks | idle machine | while a full build runs |
| --- | --- | --- | --- |
| probes | OSM tag census, then the map index against the API | ~10 s | 42 s |
| rehearsal | every guard, driven with the broken version | ~10 s | 29 s |
| build | `next build`, 65 435 pages | **7 min 36 s** | > 40 min |
| ranking | the unit project against the live search index | ~20 s | 1 min 6 s |
| browser | 9 tests, chromium, one viewport | 21–34 s | — |

🔴 The contended column is **one sample each**, taken between 16:20 and
17:20 on 27.09.2026 at load averages of 28–48. It is not stable: the map
probe alone measured 1.1 s, 2 min 13 s and 4 min 43 s within the same
hour, depending on what the other build was doing to the database at that
moment. Treat it as "this can be minutes rather than seconds when the
machine is busy", not as a figure to plan against. The idle column is the
one the nightly meets.

The rehearsal is ~3x the probes, not less, and the reason is structural:
it runs the tag census over all three merged layers three times (inverted
config, allowlist removed, as it stands) plus nine single-country passes —
18 `osmium` passes against the probes' 3. An earlier version of this table
said the rehearsal was the cheaper of the two, which stopped being
possible the moment the census became unconditional.

So a nightly with the browser stage is **about eight and a half minutes**
on a machine that is otherwise idle. Without the build
(`with-pages: false` on a manual run) it is **well under a minute**.

The contended column is not an aside; it is the reason for two design
decisions. The schedule is 02:00 UTC so the run meets an idle machine,
and `concurrency: group: scale-check` stops two of these from queueing at
the same database. Almost all of the contended cost is waiting on
Postgres, not computing anything — which is also why the map probe asks
for its twelve sample chunks at once rather than one after another: the
sequential version took 4 min 43 s where the batched one took 2 min 13 s
on the same contended machine. (Two samples, minutes apart. The argument
for batching does not rest on them: thirteen requests that each wait on
the same queue should wait on it once.)

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
ceiling is at 1% over 72 rows and — as one file with today's packer over
today's 61 422 rows — 6.1x over. (The card's 6.9 MB is the 25.09.2026
measurement, before the packer learned to derive `text` and the slug and
before the dataset grew again; the test prints what it just measured
rather than quoting either number.) A "realistic"
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
- the OSM export with `include_tags` turned into `exclude_tags` → 3 380
  columns, fires. That mutation is one word and it survived the first
  version of this check, which looked only for the presence of a config
  file and never at which key it wrote.
- the deleted whole-world snapshot's request
  (`/spots/map/points?bbox=-180,-85,180,85&limit=20000`) → truncated,
  fires. The same request over Slovenia and Croatia → 1 624 markers,
  silent. (The request and the verdict, rewritten in four lines — the
  deleted route itself is gone, so its own error path is not re-run.)

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

The runner refuses to start if `API_BUILD_TOKEN` is unset, if nothing is
listening at `API_BASE_URL`, if what is listening does not answer in
180 s, if the campsite count comes back as anything but a number, or if
that number is under 10 000. Those last two are not hypothetical:
pointing this at the CI fixture is one wrong variable away, and a
non-numeric count used to slip through entirely — `[ "$SPOTS" -lt 10000 ]`
on `undefined` prints an error, returns 2, and because it is an `if`
condition the run simply carries on.

The 180 s is deliberate rather than generous. It read 10 s and printed
"no API"; measured on a machine that was also running a full build, the
API answered correctly in 15.1 s having connected in 7 ms. A guard that
stops the run and names the wrong cause sends somebody hunting in the
wrong place — the same failure as the redirect guard that halted the
EU-27 import and blamed the region name.

**Never** print the token, and never commit it. `camp-tribe-eu/camp` is
public; see `docs/ci-and-public-repo.md`. In the workflow it is
`secrets.SCALE_API_BUILD_TOKEN`, by name only.
