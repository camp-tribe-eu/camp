#!/usr/bin/env bash
# Self-test for load-route-poi.sh — the filter-and-export half.
#
#   ./scripts/osm-pipeline/load-route-poi.selftest.sh
#
# 🔴 Why this file exists (CAMP-119).
#
# The export list used to be a heredoc inside load-route-poi.sh, and it
# dropped `toilets`, `fee` and `shower` for every object we hold. Nothing
# downstream could tell: a tag the export did not carry looks exactly like
# a tag nobody wrote, and the page says "unknown" for both. The fix is a
# committed file, scripts/osm-pipeline/export-rpoi.json, and this suite
# drives the SCRIPT — with osmium, ogr2ogr, psql and npx shimmed on PATH —
# and asserts on what it hands to each of them, which is the only place
# the contract can be read: the file on disk and the call that uses it can
# each be right while the call uses something else.
#
# Never touches the network or a database. md5/stat are not involved.
#
# 🔴 THE COUNTER. A printed "N cases" is a label; a suite whose cases
# silently stop running prints a smaller N and exits 0. EXPECTED below is
# written out, and the last line is only printed when what actually ran
# equals it — so a case deleted, or skipped by a bad `if`, is a red run.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/load-route-poi.sh"
COMMITTED_CONFIG="$HERE/export-rpoi.json"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/load-route-poi-selftest.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

# The number of pass/fail calls below. Update it WITH the cases.
EXPECTED=17

PASSED=0
FAILED=0
pass() { echo "  ✓ $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  ✗ $1"; FAILED=$((FAILED + 1)); }

# ── the world the script runs in ─────────────────────────────────────
BIN="$ROOT/bin"
CALLS="$ROOT/calls"
mkdir -p "$BIN"
: > "$CALLS"

# osmium records every call. `export` also keeps the config it was given,
# byte for byte, and writes the two features the row check expects.
cat > "$BIN/osmium" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
printf 'osmium %s\n' "$*" >> "$SELFTEST_CALLS"
out=''; cfg=''
for arg in "$@"; do
  case "$arg" in
    --config=*) cfg="${arg#--config=}" ;;
  esac
done
for ((i=1; i<=$#; i++)); do [ "${!i}" = '-o' ] && { j=$((i+1)); out="${!j}"; }; done
case "$1" in
  export)
    [ -n "$cfg" ] && cp "$cfg" "$SELFTEST_SEEN_CONFIG"
    printf '{"type":"Feature"}\n{"type":"Feature"}\n' > "$out" ;;
  *) : > "$out" ;;
esac
SHIM
for tool in ogr2ogr npx; do
  cat > "$BIN/$tool" <<SHIM
#!/usr/bin/env bash
printf '$tool %s\n' "\$*" >> "\$SELFTEST_CALLS"
printf 'DATABASE_URL=%s\n' "\${DATABASE_URL:-}" >> "\$SELFTEST_CALLS"
exit 0
SHIM
done
# The row check compares psql's count with `wc -l` of the export: two.
printf '#!/usr/bin/env bash\necho 2\n' > "$BIN/psql"
chmod +x "$BIN/osmium" "$BIN/ogr2ogr" "$BIN/npx" "$BIN/psql"

# 🔴 The shims are asked before anything relies on them: a broken shim
# looks exactly like a broken script, and has twice in this directory.
SELFTEST_CALLS="$CALLS" SELFTEST_SEEN_CONFIG="$ROOT/shim-probe.json" \
  "$BIN/osmium" export x.pbf -o "$ROOT/shim-probe.out" --config="$COMMITTED_CONFIG"
if [ "$(wc -l < "$ROOT/shim-probe.out" | tr -d ' ')" != 2 ] ||
   ! cmp -s "$ROOT/shim-probe.json" "$COMMITTED_CONFIG"; then
  echo "::error::the osmium shim does not copy its --config; that is a broken fixture, not a broken script." >&2
  exit 1
fi
: > "$CALLS"

# One fake extract; the script only checks that it is a file.
make_world() {
  local wd="$1"
  mkdir -p "$wd"
  : > "$wd/europe-malta.osm.pbf"
}

run() {
  # run <work-dir-name> <script> — prints combined output, returns the code
  local wd="$ROOT/$1" script="${2:-$SCRIPT}"
  make_world "$wd"
  : > "$CALLS"
  rm -f "$ROOT/seen-config.json"
  env PATH="$BIN:$PATH" WORK_DIR="$wd" \
    SELFTEST_CALLS="$CALLS" SELFTEST_SEEN_CONFIG="$ROOT/seen-config.json" \
    DATABASE_URL='postgres://localhost:5432/selftest_never_used' \
    bash "$script" europe/malta 2>&1
}

echo "load-route-poi.sh self-test"

# ── a: the filters ───────────────────────────────────────────────────
out=$(run a); rc=$?
filter_call=$(grep -m1 '^osmium tags-filter' "$CALLS")

if [ $rc -eq 0 ]; then
  pass "a clean run completes against shimmed tools"
else
  fail "a clean run should complete; rc=$rc: $out"
fi

for want in highway=rest_area highway=services amenity=sanitary_dump_station; do
  # both element types: a rest area is mostly a way, a dump point a node
  if grep -q "n/$want" <<<"$filter_call" && grep -q "w/$want" <<<"$filter_call"; then
    pass "osmium is asked for $want on nodes AND ways"
  else
    fail "osmium was not asked for n/ and w/ $want: $filter_call"
  fi
done

# 🔴 The card says it in so many words: parking is 3.1 million objects and
# a separate conversation.
if ! grep -q 'amenity=parking' <<<"$filter_call"; then
  pass "amenity=parking is not taken"
else
  fail "amenity=parking reached osmium: $filter_call"
fi

# ── b: the export config ─────────────────────────────────────────────
if [ -f "$ROOT/seen-config.json" ] && cmp -s "$ROOT/seen-config.json" "$COMMITTED_CONFIG"; then
  pass "osmium export is given the committed export-rpoi.json, byte for byte"
else
  fail "the config osmium export received is not scripts/osm-pipeline/export-rpoi.json"
fi

# The card's own list. Written out here, NOT read from the loader: this is
# the contract, and a list derived from the code it checks cannot disagree
# with it.
for tag in toilets shower fee drinking_water sanitary_dump_station access hgv maxheight maxlength; do
  if grep -q "\"$tag\"" "$ROOT/seen-config.json" 2>/dev/null; then
    pass "the config osmium receives carries \"$tag\""
  else
    fail "the config osmium receives has no \"$tag\" — it would reach the table as unknown"
  fi
done

# ── c: the loader and the lock ───────────────────────────────────────
if grep -q '^npx ts-node src/osm/load-route-poi.ts' "$CALLS" &&
   grep -q '^DATABASE_URL=postgres://localhost:5432/selftest_never_used' "$CALLS"; then
  pass "the loader is run last, against the database that was asked for"
else
  fail "the loader was not run as expected: $(cat "$CALLS" | tail -3)"
fi

# ── d: a missing export file is a refusal, not an empty export ───────
#
# 🔴 A copy of the script in a tree WITHOUT the config. If the script fell
# back to something else — an inline list, an empty config — osmium would
# be handed it and the run would "succeed".
FAKE="$ROOT/fake-repo"
mkdir -p "$FAKE/scripts/osm-pipeline" "$FAKE/apps/api"
cp "$SCRIPT" "$HERE/_pgconn.sh" "$FAKE/scripts/osm-pipeline/"
out=$(run d "$FAKE/scripts/osm-pipeline/load-route-poi.sh"); rc=$?
if [ $rc -ne 0 ] && grep -q 'export-rpoi.json is missing' <<<"$out" &&
   ! grep -q '^osmium export' "$CALLS"; then
  pass "without export-rpoi.json the run stops before osmium export"
else
  fail "a missing export config was not refused; rc=$rc, calls: $(cat "$CALLS" | head -3)"
fi

echo
EXECUTED=$((PASSED + FAILED))
if [ "$EXECUTED" -ne "$EXPECTED" ]; then
  echo "::error::$EXECUTED cases ran and $EXPECTED were written — a case was skipped or deleted." >&2
  exit 1
fi
if [ "$FAILED" -eq 0 ]; then
  echo "load-route-poi self-test: $EXECUTED cases"
else
  echo "::error::$FAILED of $EXECUTED load-route-poi self-test cases failed" >&2
  exit 1
fi
