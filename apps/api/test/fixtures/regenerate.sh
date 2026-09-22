#!/usr/bin/env bash
# Rebuild ci-seed.sql from the local database. Run from apps/api.
set -euo pipefail
DB="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"
DIR="$(cd "$(dirname "$0")" && pwd)"
head -20 "$DIR/ci-seed.sql" | grep '^--' > "$DIR/.header.tmp"
{ cat "$DIR/.header.tmp"; echo; psql "$DB" -t -A -f "$DIR/_select.sql"; } > "$DIR/ci-seed.sql"
rm -f "$DIR/.header.tmp"
echo "ci-seed.sql: $(grep -c '^INSERT' "$DIR/ci-seed.sql") rows"
