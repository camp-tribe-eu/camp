#!/usr/bin/env bash
# Rebuild ci-seed.sql from the local database. Run from apps/api.
set -euo pipefail
DB="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"
DIR="$(cd "$(dirname "$0")" && pwd)"
head -20 "$DIR/ci-seed.sql" | grep '^--' > "$DIR/.header.tmp"
# ci-seed-gone.sql is appended every time: it holds the states that cannot
# come out of the dev database (a campsite OSM has dropped), and without
# this line regenerating the fixture would quietly delete them.
{ cat "$DIR/.header.tmp"; echo; psql "$DB" -t -A -f "$DIR/_select.sql"; \
  cat "$DIR/ci-seed-gone.sql"; } > "$DIR/ci-seed.sql"
rm -f "$DIR/.header.tmp"
echo "ci-seed.sql: $(grep -c '^INSERT' "$DIR/ci-seed.sql") rows"
