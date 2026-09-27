#!/usr/bin/env bash
# CAMP-134: everything that has to be asked of the FULL dataset, in order.
#
#   ./scripts/scale-check/run.sh               probes only  (~10 s)
#   ./scripts/scale-check/run.sh --with-pages  probes + a browser pass
#   ./scripts/scale-check/run.sh --pages-only  the browser pass alone
#   ./scripts/scale-check/run.sh --rehearse    prove every probe can fail
#
# 🔴 WHY THERE IS A SEPARATE RUNNER AT ALL.
#
# CI's fixture is 72 campsites in 2 countries and 4 regions. On
# 25.09.2026 six defects out of eighteen were invisible on it and obvious
# on 61 557, and CI was green through all six. Twice it was the other way
# round: the test failed BECAUSE the data was small. So the fixture does
# not merely miss things, it invents them — and no number of tests written
# against it can reach any of this, because none of it is about what
# somebody guessed. It is about size.
#
# What runs here is deliberately narrow. See docs/scale-check.md for the
# decision and what it costs.
#
# 🔴 THE TWO ENVIRONMENT VARIABLES, and why the run stops without them.
#
#   API_BASE_URL     where the full-scale API is. Not the CI fixture.
#   API_BUILD_TOKEN  the rate-limit bypass. The bulk routes answer 429
#                    without it, and a probe that treated 429 as "no data"
#                    would report an empty dataset as a healthy small one.
#
# Neither is ever printed. The repository is public.

set -euo pipefail

cd "$(dirname "$0")/../.."

WITH_PAGES=0
# 🔴 `--pages-only` exists so the workflow does not run the probes twice.
#
# The workflow runs the probes in their own step (they are seconds, and a
# failure there should be readable on its own) and then the browser stage.
# With only `--with-pages` the second call repeated the probes — harmless,
# but a log that runs the same check twice makes a reader wonder which one
# counted. By hand, `--with-pages` is still the one you want.
SKIP_PROBES=0
REHEARSE=0
for arg in "$@"; do
  case "$arg" in
    --with-pages) WITH_PAGES=1 ;;
    --pages-only) WITH_PAGES=1; SKIP_PROBES=1 ;;
    --rehearse|--self-test) REHEARSE=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

API="${API_BASE_URL:-http://localhost:3001}"

if [ -z "${API_BUILD_TOKEN:-}" ]; then
  echo "::error::API_BUILD_TOKEN is not set." >&2
  echo "          The bulk routes are rate-limited and every probe here is a" >&2
  echo "          bulk caller. Without it they get 429 and would have to" >&2
  echo "          guess what that means." >&2
  exit 1
fi

# 🔴 "Not there" and "too slow to answer" are different failures, and
# saying the wrong one sends somebody hunting in the wrong place.
#
# This read `-m 10` and printed "no API at …". Measured 27.09.2026, with
# another full build running on the same machine: /spots/countries took
# **15.1 s**, connected in 7 ms. So the API was perfectly healthy and this
# stopped the run claiming it did not exist — the same shape as the
# redirect guard that halted the EU-27 import and blamed the region name.
#
# A connect timeout answers "is anything listening"; the total timeout is
# generous because how fast the API is under load is not what this
# workflow measures. `curl` exits 7 when it cannot connect and 28 on a
# timeout, and the two get different sentences.
set +e
curl -fsS --connect-timeout 5 -m 180 "$API/spots/countries" > /dev/null 2>&1
REACH=$?
set -e
if [ "$REACH" = 7 ]; then
  echo "::error::nothing is listening at $API." >&2
  echo "          This whole workflow is 'ask the real dataset'. There is no" >&2
  echo "          fallback to a fixture: that would be the failure it exists" >&2
  echo "          to prevent, wearing the name of the fix." >&2
  exit 1
elif [ "$REACH" = 28 ]; then
  # 🔴 28 is "timed out", not "timed out ANSWERING". A host that drops
  # packets rather than refusing them also times out at the connect
  # stage and lands here — so this says both, rather than confidently
  # naming the wrong one. That confident-wrong-diagnosis is the very
  # thing the comment above is about, and review caught it recurring
  # inside the fix for it.
  echo "::error::$API timed out: either nothing answered the connection" >&2
  echo "          within 5 s, or it connected and did not reply within 180 s." >&2
  echo "          The second is a busy machine, not a missing API — the" >&2
  echo "          nightly runs at 02:00 UTC for exactly that reason." >&2
  exit 1
elif [ "$REACH" != 0 ]; then
  echo "::error::$API answered, but not with success (curl exit $REACH)." >&2
  exit 1
fi

# 🔴 The scale gate, before anything else runs.
#
# Point this at CI's fixture and every check below passes. That is not a
# theoretical risk — it is the single most likely way this workflow stops
# working, because pointing it at the wrong API is one wrong variable.
# 🔴 A non-number is a failure, not a small number — and the check for
# that belongs in node, where `set -e` can act on it.
#
# The first version went straight to `[ "$SPOTS" -lt 10000 ]`. Review
# drove it: with SPOTS as `undefined`, `null` or empty, bash prints
# "integer expression expected", `[` returns 2 — and because it is an
# `if` CONDITION, the then-branch is skipped and the run carries on.
# `set -e` does not fire inside an `if`.
#
# A `case` on digits was the first fix, and review broke that too:
# `99999999999999999999` is all digits, passes the case, and then makes
# `[ … -lt … ]` fail the same way. Every guard written in shell test
# arithmetic has that edge somewhere.
#
# So the number is validated where numbers are: node refuses anything
# that is not a safe non-negative integer and exits 1, which — with
# `set -o pipefail` — fails the assignment and stops the script. The
# `case` below stays as a second line, because a command substitution
# that produced nothing at all is worth naming separately.
SPOTS=$(curl -fsS --connect-timeout 5 -m 180 -H "x-build-token: $API_BUILD_TOKEN" "$API/spots/summary" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let n;
      try { n = JSON.parse(s).spots; } catch { console.error("summary was not JSON"); process.exit(1); }
      if (!Number.isSafeInteger(n) || n < 0) {
        console.error("summary.spots is not a campsite count: " + JSON.stringify(n));
        process.exit(1);
      }
      process.stdout.write(String(n));
    })')
case "$SPOTS" in
  ''|*[!0-9]*)
    echo "::error::$API/spots/summary gave no campsite count (got '$SPOTS')." >&2
    echo "          A gate that cannot read the number cannot guard it." >&2
    exit 1
    ;;
esac

if [ "$SPOTS" -lt 10000 ]; then
  echo "::error::$API holds $SPOTS campsites." >&2
  echo "          That is a fixture, not the dataset. Every check here would" >&2
  echo "          pass, and passing over nothing is what this workflow exists" >&2
  echo "          to stop happening." >&2
  exit 1
fi
echo "scale-check against $SPOTS campsites"
echo

FAILED=0
step() {
  echo "── $1 ──"
  shift
  if "$@"; then
    echo
  else
    FAILED=$((FAILED + 1))
    echo "   ✗ failed"
    echo
  fi
}

if [ "$REHEARSE" = 1 ]; then
  # 🔴 A safeguard nobody has rehearsed does not exist on this project.
  # Each of these drives the BROKEN version of the thing it guards against
  # the same live data, and fails if the guard stays quiet.
  step "the OSM column guard, rehearsed" \
    node scripts/scale-check/check-osm-columns.mjs --self-test
  step "the map snapshot guard, rehearsed" \
    node scripts/scale-check/check-map-index.mjs --self-test
elif [ "$SKIP_PROBES" = 0 ]; then
  step "OSM context export: columns against the Postgres ceiling" \
    node scripts/scale-check/check-osm-columns.mjs
  step "the map index and its chunks" \
    node scripts/scale-check/check-map-index.mjs
fi

if [ "$WITH_PAGES" = 1 ]; then
  # 🔴 Needs a production build made from this API. `next start` serves
  # what `next build` wrote.
  #
  # This only checks that a build EXISTS, and that is all it can cheaply
  # check — it cannot tell a fresh build from yesterday's. A build made
  # from the FIXTURE is caught downstream, by the size gates in the specs
  # themselves; a stale build from the full database is not caught at all,
  # which is why the workflow always builds immediately before this step
  # rather than trusting what is on disk.
  if [ ! -d apps/web/.next ]; then
    echo "::error::apps/web/.next is not there — build against the full API first:" >&2
    echo "          API_BASE_URL=$API npm run build --workspace=apps/web" >&2
    exit 1
  fi
  # 🔴 `CI=true` on both runs below, for the JSON report.
  #
  # playwright.config.ts only writes playwright-report/report.json when
  # CI is set, and both guards that follow each run read that file. A
  # local run without it would skip the guards silently — which is the
  # very thing they are for. It also turns on `retries: 1`, so what is
  # measured here is what CI measures.
  REPORT=apps/web/playwright-report/report.json

  # ── the ranking suite, which can only run where the real index is ──
  #
  # 🔴 The seventh instance of this card's defect, and the only one that
  # is not about data VOLUME.
  #
  # ranking-quality.spec.ts measures the search against the live index,
  # and it reads that index from a file whose path comes from
  # RANKING_INDEX. CI does not set it, so on CI all five of those tests
  # SKIP — and a skip is green. Measured 27.09.2026:
  #
  #   without RANKING_INDEX   295 passed,   5 skipped
  #   with it, live index     300 passed,   0 skipped
  #
  # Those five have therefore never run on CI, including guards written
  # to hold a hand-maintained lookup table in step with its expectations.
  # This job is the one place in the repository with the real index, so
  # it is the one place they can run for real. It fetches it rather than
  # depending on a cached file, because a cache that has gone missing is
  # how they came to be skipping in the first place.
  RANK_DIR=$(mktemp -d)
  trap 'rm -rf "$RANK_DIR"' EXIT
  if curl -fsS --connect-timeout 5 -m 180 -H "x-build-token: $API_BUILD_TOKEN" \
       "$API/spots/search-index" -o "$RANK_DIR/search-index.json"; then
    # 🔴 `--grep`, and it is doing a job beyond narrowing.
    #
    # Without it this runs all 300 unit tests, of which 295 already run
    # in ci.yml on every push — and, worse, a skip budget of zero would
    # then PASS if the five ranking tests vanished from the report
    # entirely: 295 tests, none skipped, tick. The guard cannot tell
    # "nothing declined" from "nothing was there to decline".
    #
    # Playwright exits 1 with "No tests found" when a filter matches
    # nothing (verified). So naming the describe block makes their
    # absence a failure rather than a silent pass, which is the same
    # lesson as everything else on this card.
    step "ranking quality, against the live index" \
      env CI=true RANKING_INDEX="$RANK_DIR/search-index.json" \
        npx playwright test --config=apps/web/playwright.config.ts \
          --project=unit --grep 'ranking quality, measured on the live index'
    step "nothing in the ranking suite declined to run" \
      node scripts/ci/check-skips.mjs "$REPORT" --max 0
  else
    # Not a skip. The whole point of this block is that a missing index
    # must not quietly turn five tests into passes.
    echo "::error::could not fetch the search index for the ranking suite" >&2
    FAILED=$((FAILED + 1))
  fi

  step "the map and the search, in a browser, on the built site" \
    env CI=true SCALE=1 npx playwright test --config=apps/web/playwright.config.ts

  # 🔴 Budget zero, and that is a decision rather than a default.
  #
  # Every spec in tests/scale was written to FAIL rather than skip when
  # its precondition is missing — including the WebGL check, which began
  # life as a `test.skip` and would have turned five of six map tests
  # into silent passes on a runner with a changed driver. Nothing in this
  # suite has a legitimate reason to decline, so anything that does is a
  # defect in the runner and this says so.
  step "nothing in the scale suite declined to run" \
    node scripts/ci/check-skips.mjs "$REPORT" --max 0
fi

if [ "$FAILED" -gt 0 ]; then
  echo "✗ $FAILED scale check(s) failed"
  exit 1
fi
echo "✓ every scale check passed"
