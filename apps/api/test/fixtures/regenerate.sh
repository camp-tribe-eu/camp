#!/usr/bin/env bash
# Rebuild ci-seed.sql from the local database.
#
#   ./regenerate.sh                        rebuild, and refuse to write a smaller fixture
#   ./regenerate.sh --allow-shrink=t1,t2   the named tables may lose rows, or vanish
#   ./regenerate.sh --check                build a candidate, compare, write NOTHING
#
# 🔴 THE STANDARD WAY OF UPDATING A THING DESTROYS THE THING (CAMP-172).
# This script rebuilt ci-seed.sql from three files and bathing_waters was
# in none of them: the next person to run the standard tool would have
# deleted 43 rows, and every page would have rendered a correct "no
# bathing water nearby" — so the three-state tests would have kept
# passing. The same day `check-dependencies.mjs --update` deleted 123
# lines of reasoning from its baseline (CAMP-171). A tool that rebuilds a
# thing from a list somebody keeps by hand reproduces what the list
# remembers and says "done"; so this one compares what it is about to
# write with what it is about to replace, and refuses when the result has
# fewer tables or fewer rows in one. The scope of that comparison is the
# file being replaced, not a second list of names — see
# scripts/ci/check-fixture-not-shrunk.mjs for the reasoning and for what
# it does NOT catch (it counts rows; it does not say which rows).
#
# Three things this script no longer does, each one a way of losing data
# without saying so:
#
#   * Write ci-seed.sql before it knows the result is good. It used to
#     redirect straight into the file, so a failing psql left the fixture
#     truncated. Everything now goes to a temporary file, is checked, and
#     is copied over ci-seed.sql last.
#   * Let psql carry on after a failed statement. Without ON_ERROR_STOP a
#     select that names a missing table prints an error and psql exits 0
#     with the rest of the output (measured 29.09.2026; the development
#     database had not yet run the bathing_waters migration).
#   * Keep a list of the files to append. Every ci-seed-*.sql beside this
#     script is appended, in name order, so a new one cannot be forgotten
#     and a file that must follow another has to sort after it.
#
# What goes into the fixture, and from where:
#
#   _select.sql          camping_spots and bathing_waters, chosen from the
#                        database (the bathing waters near the campsites).
#   ci-seed-*.sql        appended verbatim, because their rows cannot be
#                        selected, and each says why in its own header:
#     ci-seed-gone.sql       the states the development database cannot
#                            produce (a campsite OSM has dropped) and the
#                            source attribution the seeded rows need,
#                            because migrations run BEFORE the seed in CI
#                            and the backfill therefore never sees them.
#     ci-seed-hourly-air-quality.sql
#                            seven synthetic air quality stations and three
#                            1 km model values (CAMP-164), DESIGNED beside
#                            the campsites in the fixture with every time
#                            relative to now(). The states the page must
#                            render — a silent station, a model that has
#                            aged out, a station 20.5 km away — are not
#                            ones a sample of the real table reliably
#                            holds, and every real timestamp would be a
#                            fortnight old by the time CI read it. It sorts
#                            AFTER ci-seed-gone.sql on purpose: that file
#                            marks a campsite as dropped, and this one must
#                            not pick it.
#     ci-seed-route-poi.sql  six route-service points CHOSEN next to a real
#                            route stage. The development database holds
#                            2 248 490 of them, so they cannot be sampled;
#                            selecting them by a LIMIT would seed rows
#                            nowhere near a stage and every page would
#                            render "we hold none" seven times, passing
#                            over nothing.
#
# --check is for CI, where the database IS the fixture: it runs the real
# _select.sql against it and fails if any table the fixture seeds has no
# statement that produces it. It compares tables, not rows, because a
# database loaded from the fixture legitimately selects fewer of them.
set -euo pipefail

DB="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/ci-seed.sql"
GUARD="$DIR/../../../../scripts/ci/check-fixture-not-shrunk.mjs"

CHECK=0
ALLOW=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --allow-shrink=*) ALLOW="${arg#--allow-shrink=}" ;;
    *)
      echo "usage: regenerate.sh [--check] [--allow-shrink=table,table]" >&2
      exit 2
      ;;
  esac
done

# Same directory as the target, so the temporary file is on the same
# filesystem; removed on any exit, including a failed guard.
CANDIDATE="$(mktemp "$DIR/.ci-seed.candidate.XXXXXX")"
trap 'rm -f "$CANDIDATE"' EXIT

# The header is read from the file being replaced. If it has none, grep
# fails and so does the script: better than writing a fixture without the
# licence line.
HEADER="$(head -20 "$OUT" | grep '^--')"

{
  printf '%s\n\n' "$HEADER"
  psql "$DB" -X -q -t -A -v ON_ERROR_STOP=1 -f "$DIR/_select.sql"
  for f in "$DIR"/ci-seed-*.sql; do
    cat "$f"
  done
} > "$CANDIDATE"

GUARD_ARGS=()
if [ -n "$ALLOW" ]; then GUARD_ARGS+=("--allow-shrink=$ALLOW"); fi
if [ "$CHECK" = 1 ]; then GUARD_ARGS+=("--tables-only"); fi

# ${arr[@]+"${arr[@]}"}: an empty array is an unbound variable to bash 3.2,
# which is what macOS ships and what this is developed on.
node "$GUARD" "$OUT" "$CANDIDATE" ${GUARD_ARGS[@]+"${GUARD_ARGS[@]}"}


if [ "$CHECK" = 1 ]; then
  echo "regenerate.sh --check: every table the fixture seeds is still produced; nothing written"
  exit 0
fi

# cp, not mv: it keeps ci-seed.sql's own permissions, and by now every
# check has passed, so this is the only step that touches the fixture.
cp "$CANDIDATE" "$OUT"
echo "ci-seed.sql written"
# 🔴 CAMP-173. The guard above counts ROWS. It cannot see that a
# regeneration lost Slovenia, kept one id out of 72, and left nothing for
# the gone block to mark — all of which happened, and all of which passed
# "not smaller".
#
# scripts/ci/check-fixture-shape.mjs asks the other question, and CI runs
# it on every pull request. It is deliberately NOT run here: this script's
# own self-test drives it with a psql shim whose rows have one column, and
# bending the shape check to accept that would be bending the only check
# that would have caught the bad fixture. The gate is the commit, not the
# write — a regenerated fixture that lost a subject cannot merge.
echo "run: node scripts/ci/check-fixture-shape.mjs   # before committing it"
