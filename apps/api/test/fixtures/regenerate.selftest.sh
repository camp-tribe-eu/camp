#!/usr/bin/env bash
# Self-test for regenerate.sh — the wiring around the fixture guard.
#
# 🔴 Why this file exists (CAMP-172).
#
# check-fixture-not-shrunk.mjs proves that the COMPARISON is right. It says
# nothing about whether regenerate.sh still calls it, calls it BEFORE the
# fixture is overwritten, stops when it fails, or still lets psql fail
# loudly. Each of those is a line a later edit can delete while the
# comparison's own self-test stays green — and the failure is the one this
# card is about: a regeneration that says "done" over a smaller fixture.
#
# So this drives the real regenerate.sh, the real _select.sql and the real
# guard, in a copy of the repository's layout, and asserts on what happens
# to ci-seed.sql.
#
# 🔴 It needs no database. `psql` is a shim on PATH, and the shim is not
# free-form: it prints INSERTs for every table the REAL _select.sql names
# in a string literal `'INSERT INTO <table>`. Delete the bathing_waters
# select from _select.sql and the shim stops printing it, so the first
# scenario below goes red. What the shim cannot tell you is whether the
# SQL is right — a run against a real database does that, and is how the
# card was verified.
#
# 🔴 It models one behaviour of real psql that matters and that was
# measured, not remembered: without `-v ON_ERROR_STOP=1` a failing
# statement prints an error and psql still exits 0.
#
#   ./apps/api/test/fixtures/regenerate.selftest.sh

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/regenerate-selftest.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

FAILURES=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILURES=$((FAILURES + 1)); }
expect() { # expect "name" actual wanted
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$2', wanted '$3')"; fi
}
expect_nonzero() { # expect_nonzero "name" code
  if [ "$2" != "0" ]; then pass "$1"; else fail "$1 (exited 0; stdout: $(head -c 400 "$ROOT/out.txt" | tr '\n' '|'))"; fi
}
expect_in_stderr() { # expect_in_stderr "name" pattern
  if grep -q "$2" "$ROOT/err.txt"; then pass "$1"; else fail "$1 (stderr: $(head -c 300 "$ROOT/err.txt"))"; fi
}

# ── the world regenerate.sh runs in ─────────────────────────────────
BIN="$ROOT/bin"
mkdir -p "$BIN"
cat > "$BIN/psql" <<'SHIM'
#!/usr/bin/env bash
# Enough of psql to drive regenerate.sh.
#   SHIM_ROWS   rows printed per table (default 3)
#   SHIM_MODE   ok | error   (error: a trailing statement fails after every
#               row has been printed — the case only ON_ERROR_STOP catches)
file=""
stop=0
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    -f) file="${args[i + 1]}" ;;
    ON_ERROR_STOP=1) stop=1 ;;
  esac
done
[ -n "$file" ] || { echo "shim psql: no -f" >&2; exit 99; }
rows="${SHIM_ROWS:-3}"
tables="$(grep -oE "'INSERT INTO [a-z_]+" "$file" | sed "s/'INSERT INTO //" | awk '!seen[$0]++')"
for t in $tables; do
  for ((n = 1; n <= rows; n++)); do
    echo "INSERT INTO $t (a) VALUES ($n);"
  done
done
if [ "${SHIM_MODE:-ok}" = error ]; then
  echo "psql:$file:99: ERROR:  relation \"later\" does not exist" >&2
  if [ "$stop" = 1 ]; then exit 3; fi
fi
exit 0
SHIM
chmod +x "$BIN/psql"

# A fresh miniature of the repository: the REAL script, sources and guard;
# a small stand-in for what they replace.
fresh() {
  rm -rf "$ROOT/repo"
  FX="$ROOT/repo/apps/api/test/fixtures"
  mkdir -p "$FX" "$ROOT/repo/scripts/ci"
  cp "$REPO/scripts/ci/check-fixture-not-shrunk.mjs" "$ROOT/repo/scripts/ci/"
  cp "$HERE/regenerate.sh" "$HERE/_select.sql" "$FX/"
  # The file being replaced: three tables, one of them a multi-row INSERT
  # the way CAMP-168 wrote it by hand.
  cat > "$FX/ci-seed.sql" <<'OLD'
-- header line one
-- header line two

INSERT INTO camping_spots (a) VALUES (1);
INSERT INTO camping_spots (a) VALUES (2);
INSERT INTO camping_spots (a) VALUES (3);
INSERT INTO bathing_waters (a) VALUES (1), (2), (3);
INSERT INTO osm_route_poi (a) VALUES (1), (2);
OLD
  printf '%s\n' "UPDATE camping_spots SET a = a; -- from the gone file" > "$FX/ci-seed-gone.sql"
  printf '%s\n' "INSERT INTO osm_route_poi (a) VALUES (10);" "INSERT INTO osm_route_poi (a) VALUES (11);" \
    > "$FX/ci-seed-route-poi.sql"
}

# runargs "ENV=.. ENV2=.." [args]: sets CODE; stdout and stderr go to $ROOT/{out,err}.txt
runargs() {
  local envs="$1"
  shift
  # shellcheck disable=SC2086  # $envs is deliberately split into NAME=value words
  ( cd "$ROOT/repo" && env $envs PATH="$BIN:$PATH" DATABASE_URL="postgres://shim/none" \
      "$FX/regenerate.sh" "$@" ) >"$ROOT/out.txt" 2>"$ROOT/err.txt"
  CODE=$?
}
sum() { cksum < "$FX/ci-seed.sql"; }
leftovers() { find "$FX" -name '.ci-seed.candidate.*' | wc -l | tr -d ' '; }
count() { grep -c "$1" "$FX/ci-seed.sql" || true; }

# ── 1. the sources, as they are in the repository ──────────────────
echo "regenerate.sh, against the real _select.sql and the real guard"

fresh
before="$(sum)"
runargs ""
expect "1. a full regeneration exits 0" "$CODE" "0"
expect "1. the guard printed its verdict (a guard that ran and said nothing is a guard that did not run)" \
  "$(grep -c '^fixture guard: ok' "$ROOT/out.txt" || true)" "1"
expect "1. and replaces the fixture" "$([ "$(sum)" != "$before" ] && echo replaced || echo same)" "replaced"
expect "1. the header of the old file is kept" "$(head -1 "$FX/ci-seed.sql")" "-- header line one"
expect "1. bathing_waters is produced by the SOURCES, not left over from the old file" \
  "$(count 'INSERT INTO bathing_waters (a) VALUES (1);')" "1"
gone_at="$(grep -n 'from the gone file' "$FX/ci-seed.sql" | head -1 | cut -d: -f1)"
poi_at="$(grep -n 'VALUES (10)' "$FX/ci-seed.sql" | head -1 | cut -d: -f1)"
expect "1. every ci-seed-*.sql is appended, in name order (gone, then route-poi)" \
  "$([ -n "$gone_at" ] && [ -n "$poi_at" ] && [ "$gone_at" -lt "$poi_at" ] && echo ordered || echo "gone=$gone_at poi=$poi_at")" \
  "ordered"
expect "1. no candidate file is left behind" "$(leftovers)" "0"

# ── 2. a table falls out of the sources ────────────────────────────
echo "a table that stops being produced"

fresh
# The CAMP-172 case: the bathing select is removed from _select.sql.
awk '/^-- CAMP-168: the EU.s designated bathing waters/ { exit } { print }' "$FX/_select.sql" > "$FX/_select.cut"
if cmp -s "$FX/_select.cut" "$FX/_select.sql"; then fail "2. setup: the bathing block was not found in _select.sql"; fi
mv "$FX/_select.cut" "$FX/_select.sql"
before="$(sum)"
runargs ""
expect_nonzero "2. the bathing select removed from _select.sql: non-zero exit" "$CODE"
expect "2. and ci-seed.sql is byte for byte what it was" "$(sum)" "$before"
expect_in_stderr "2. and the message names the table" 'TABLE MISSING bathing_waters'
expect "2. and no candidate file is left behind" "$(leftovers)" "0"

fresh
rm "$FX/ci-seed-route-poi.sql"
before="$(sum)"
runargs ""
expect_nonzero "3. a static source file removed: non-zero exit" "$CODE"
expect "3. and ci-seed.sql is untouched" "$(sum)" "$before"
expect_in_stderr "3. and the message names osm_route_poi" 'TABLE MISSING osm_route_poi'

# ── 3. fewer rows ──────────────────────────────────────────────────
echo "a table that shrinks"

fresh
before="$(sum)"
runargs "SHIM_ROWS=1"
expect_nonzero "4. one row per table where three were: non-zero exit" "$CODE"
expect "4. and ci-seed.sql is untouched" "$(sum)" "$before"
expect_in_stderr "4. and the message says fewer rows" 'FEWER ROWS in'

fresh
runargs "SHIM_ROWS=1" --allow-shrink=camping_spots,bathing_waters
expect "5. --allow-shrink naming both tables lets it through" "$CODE" "0"
expect "5. and it wrote the smaller file" "$(count 'INSERT INTO camping_spots (a) VALUES (1);')" "1"

fresh
before="$(sum)"
runargs "SHIM_ROWS=1" --allow-shrink=camping_spots
expect_nonzero "6. --allow-shrink for ONE table does not excuse the other" "$CODE"
expect "6. and ci-seed.sql is untouched" "$(sum)" "$before"

# ── 4. psql itself fails ───────────────────────────────────────────
echo "psql fails after producing every row"

fresh
before="$(sum)"
runargs "SHIM_MODE=error"
expect_nonzero "7. a failing statement is a failed regeneration" "$CODE"
expect "7. and ci-seed.sql is untouched" "$(sum)" "$before"

# ── 5. --check ─────────────────────────────────────────────────────
echo "--check"

fresh
before="$(sum)"
runargs "" --check
expect "8. --check on a complete source exits 0" "$CODE" "0"
expect "8. and writes nothing" "$(sum)" "$before"
expect "8. and leaves no candidate file" "$(leftovers)" "0"

fresh
runargs "SHIM_ROWS=1" --check
expect "9. --check compares tables, not rows: fewer rows still passes" "$CODE" "0"

fresh
rm "$FX/ci-seed-route-poi.sql"
before="$(sum)"
runargs "" --check
expect_nonzero "10. --check with a table gone: non-zero exit" "$CODE"
expect "10. and writes nothing" "$(sum)" "$before"

# ── 6. the source list is derived ──────────────────────────────────
echo "the files to append are found, not listed"

fresh
printf '%s\n' "INSERT INTO a_new_table (a) VALUES (1);" > "$FX/ci-seed-new-source.sql"
runargs ""
expect "11. a ci-seed-*.sql added later is appended without editing the script" \
  "$(count 'INSERT INTO a_new_table')" "1"

# ── 7. arguments ───────────────────────────────────────────────────
echo "arguments"

fresh
before="$(sum)"
runargs "" --force
expect "12. an unknown option exits 2" "$CODE" "2"
expect "12. and ci-seed.sql is untouched" "$(sum)" "$before"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "✓ regenerate.sh self-test passed"
  exit 0
fi
echo "✗ $FAILURES failure(s)"
exit 1
