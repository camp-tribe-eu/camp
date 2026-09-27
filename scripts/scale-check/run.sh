#!/usr/bin/env bash
# CAMP-134: everything that has to be asked of the FULL dataset, in order.
#
#   ./scripts/scale-check/run.sh               probes only  (~5 s)
#   ./scripts/scale-check/run.sh --with-pages  probes + a browser pass
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
REHEARSE=0
for arg in "$@"; do
  case "$arg" in
    --with-pages) WITH_PAGES=1 ;;
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
  echo "::error::$API is listening but did not answer in 180 s." >&2
  echo "          That is a busy machine, not a missing API. The nightly runs" >&2
  echo "          at 02:00 UTC for exactly this reason; a run started beside a" >&2
  echo "          full build is competing with it for the same database." >&2
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
SPOTS=$(curl -fsS --connect-timeout 5 -m 180 -H "x-build-token: $API_BUILD_TOKEN" "$API/spots/summary" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).spots)))')
# 🔴 A non-number is a failure, not a small number.
#
# This went straight to `[ "$SPOTS" -lt 10000 ]`, and review drove what
# that does: with SPOTS as `undefined`, `null` or empty, bash prints
# "integer expression expected", `[` returns 2 — and because it is an
# `if` CONDITION, the then-branch is skipped and the run carries on.
# `set -e` does not fire inside an `if`. The banner then reads
# "scale-check against undefined campsites" and every probe runs against
# whatever answered.
#
# Reachable without anything going wrong: line above does
# `String(JSON.parse(s).spots)`, so renaming that field, or a null,
# yields "undefined" with node exiting 0. This is the "empty result
# treated as success" shape, inside the gate written to stop it.
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
else
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
  step "the map and the search, in a browser, on the built site" \
    env SCALE=1 npx playwright test --config=apps/web/playwright.config.ts
fi

if [ "$FAILED" -gt 0 ]; then
  echo "✗ $FAILED scale check(s) failed"
  exit 1
fi
echo "✓ every scale check passed"
