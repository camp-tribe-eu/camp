#!/usr/bin/env bash
# Rebuild ci-seed.sql from the local database. Run from apps/api.
set -euo pipefail
DB="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"
DIR="$(cd "$(dirname "$0")" && pwd)"
head -20 "$DIR/ci-seed.sql" | grep '^--' > "$DIR/.header.tmp"
# ci-seed-gone.sql is appended every time: it holds the states that cannot
# come out of the dev database (a campsite OSM has dropped) and the
# source attribution the seeded rows need, because migrations run BEFORE
# the seed in CI and the backfill therefore never sees them. Without this
# line regenerating the fixture would quietly delete both.
# ci-seed-route-poi.sql is appended for the same reason and one of its
# own: the dev database holds 2 248 490 route-service points, so they
# cannot be sampled into a fixture — six were CHOSEN, next to a real
# route stage, to exercise every branch the services block has. Selecting
# them by a LIMIT would seed rows nowhere near a stage and every page
# would render "we hold none" seven times, passing over nothing.
{ cat "$DIR/.header.tmp"; echo; psql "$DB" -t -A -f "$DIR/_select.sql"; \
  cat "$DIR/ci-seed-gone.sql"; cat "$DIR/ci-seed-route-poi.sql"; } > "$DIR/ci-seed.sql"
rm -f "$DIR/.header.tmp"
echo "ci-seed.sql: $(grep -c '^INSERT' "$DIR/ci-seed.sql") rows"
