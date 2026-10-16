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
EXPECTED=20

# The database the run is asked for. Nothing connects to it: every tool that
# would is a shim, and the name says so.
ASKED='postgres://localhost:5432/selftest_never_used'

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
# 🔴 ONE LINE PER CALL, and the line carries what that call saw. It used to
# be two lines — the call, then `DATABASE_URL=…` — printed by the ogr2ogr
# shim as well as the npx one, and the case that read them used two
# unconnected greps. The ogr2ogr shim's line was the TEST's own environment
# handed back (ogr2ogr is given its database in a `PG:` argument, never
# through DATABASE_URL), so it matched whatever the loader was run
# against: the loader pointed at `postgres://WRONG` still passed 17 of 17.
# Only the loader reads DATABASE_URL, so only its line carries it; ogr2ogr
# and psql are judged by their arguments, which is where the script puts the
# database.
cat > "$BIN/ogr2ogr" <<'SHIM'
#!/usr/bin/env bash
printf 'ogr2ogr %s\n' "$*" >> "$SELFTEST_CALLS"
exit 0
SHIM
cat > "$BIN/npx" <<'SHIM'
#!/usr/bin/env bash
printf 'npx %s [DATABASE_URL=%s]\n' "$*" "${DATABASE_URL:-}" >> "$SELFTEST_CALLS"
exit 0
SHIM
# The row check compares psql's count with `wc -l` of the export: two.
cat > "$BIN/psql" <<'SHIM'
#!/usr/bin/env bash
printf 'psql %s\n' "$*" >> "$SELFTEST_CALLS"
echo 2
SHIM
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
  # a file that a glob in the script's filter list would match
  if [ -n "${SELFTEST_EXTRA_FILE:-}" ]; then
    mkdir -p "$(dirname "$wd/$SELFTEST_EXTRA_FILE")"
    : > "$wd/$SELFTEST_EXTRA_FILE"
  fi
}

run() {
  # run <work-dir-name> <script> — prints combined output, returns the code.
  # With SELFTEST_UNSET_DB=1 the run is given NO DATABASE_URL at all.
  local wd="$ROOT/$1" script="${2:-$SCRIPT}"
  make_world "$wd"
  : > "$CALLS"
  rm -f "$ROOT/seen-config.json"
  if [ "${SELFTEST_UNSET_DB:-}" = 1 ]; then
    env -u DATABASE_URL PATH="$BIN:$PATH" WORK_DIR="$wd" \
      SELFTEST_CALLS="$CALLS" SELFTEST_SEEN_CONFIG="$ROOT/seen-config.json" \
      bash "$script" europe/malta 2>&1
  else
    env PATH="$BIN:$PATH" WORK_DIR="$wd" \
      SELFTEST_CALLS="$CALLS" SELFTEST_SEEN_CONFIG="$ROOT/seen-config.json" \
      DATABASE_URL="$ASKED" \
      bash "$script" europe/malta 2>&1
  fi
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

# 🔴 CAMP-327: EVERY VALUE IS ASKED FOR AS A SUBSTRING, `key=*value*`, ON
# NODES AND WAYS. osmium compares the whole value, so `amenity=restaurant`
# selects nothing that says `amenity=restaurant;ice_cream`; before this card
# only `shop=*gas*` was written that way (CAMP-258) and the other seventeen
# were equalities, which is how 30 objects of one country never reached
# staging. The 18 values are written out here, NOT read from the script or from
# route-poi.ts: this is the contract, and a list derived from the code it
# checks cannot disagree with it. Each argument is compared WHOLE (`grep -x`),
# so `n/amenity=*fuel*x` does not stand in for `n/amenity=*fuel*`.
WANT=(
  amenity=fuel amenity=charging_station amenity=drinking_water
  amenity=water_point man_made=water_tap amenity=sanitary_dump_station
  highway=rest_area highway=services shop=gas shop=supermarket
  shop=convenience amenity=restaurant amenity=cafe amenity=fast_food
  tourism=hotel tourism=motel tourism=hostel tourism=guest_house
)
filter_args=$(tr ' ' '\n' <<<"$filter_call")
missing=''
for want in "${WANT[@]}"; do
  for el in n w; do
    # both element types: a rest area is mostly a way, a dump point a node
    grep -qxF "$el/${want%%=*}=*${want#*=}*" <<<"$filter_args" \
      || missing="$missing $el/${want%%=*}=*${want#*=}*"
  done
done
if [ -z "$missing" ]; then
  pass "osmium is asked for all ${#WANT[@]} values as a substring, on nodes AND ways"
else
  fail "osmium was not handed:$missing  (call: $filter_call)"
fi

# …and for nothing else: 18 values on two element types, no more. A value
# added to the script and not to the rules would be a row loaded and thrown
# away (the spec compares the pairs with STORED_POI_RULES; this is what the
# shell actually hands over).
asked=$(grep -cE '^[nw]/' <<<"$filter_args" || true)
if [ "$asked" = "$(( ${#WANT[@]} * 2 ))" ]; then
  pass "osmium is handed exactly $asked tag expressions, no more"
else
  fail "osmium was handed $asked tag expressions, expected $(( ${#WANT[@]} * 2 )): $filter_call"
fi

# 🔴 CAMP-258/327: the `*`s must reach osmium as `*`s. Unquoted in the
# script's loop they are a GLOB over WORK_DIR, and a file whose name matches
# the pattern — here `n/shop=xgas` — would replace the filter with its own
# name, silently, with exit 0. The work directory of this run has such a
# file. MUTATION: take the double quotes off the TAG_ARGS line in
# load-route-poi.sh.
out=$(SELFTEST_EXTRA_FILE='n/shop=xgas' run g); rc=$?
glob_call=$(grep -m1 '^osmium tags-filter' "$CALLS")
if [ $rc -eq 0 ] && grep -qF 'n/shop=*gas*' <<<"$glob_call" && ! grep -qF 'shop=xgas' <<<"$glob_call"; then
  pass "shop=*gas* reaches osmium as written, though a file called n/shop=xgas sits in the work directory"
else
  fail "the * in shop=*gas* was globbed; rc=$rc: $glob_call"
fi

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
# CAMP-258: `fuel:lpg` is the tag; the column it becomes is called `lpg`.
for tag in toilets shower fee drinking_water sanitary_dump_station access hgv maxheight maxlength fuel:lpg; do
  if grep -q "\"$tag\"" "$ROOT/seen-config.json" 2>/dev/null; then
    pass "the config osmium receives carries \"$tag\""
  else
    fail "the config osmium receives has no \"$tag\" — it would reach the table as unknown"
  fi
done

# ── c: the loader, and the database it is run against ────────────────
#
# 🔴 ONE LINE, EXACTLY. The line the npx shim wrote for the loader is the
# last line of the log (the loader is run LAST) and it says, in itself,
# which database the loader's environment named. Two greps over a log that
# held two other lines with the same text proved nothing about which call
# they belonged to.
loader_line="npx ts-node src/osm/load-route-poi.ts [DATABASE_URL=$ASKED]"
if [ "$(tail -n 1 "$CALLS")" = "$loader_line" ]; then
  pass "the loader is run last, against the database that was asked for"
else
  fail "the last call was not the loader on $ASKED: $(tail -n 3 "$CALLS" | tr '\n' '|')"
fi

# ogr2ogr and psql are told the database in their ARGUMENTS. A staging
# table loaded into one database and a loader run against another is the
# quietest failure this script has: the row check counts the first and the
# loader reads the second, and both are satisfied.
ogr_line=$(grep -m1 '^ogr2ogr ' "$CALLS" || true)
psql_other=$(grep '^psql ' "$CALLS" | grep -vcF "psql $ASKED " || true)
psql_all=$(grep -c '^psql ' "$CALLS" || true)
ogr_at=$(grep -n -m1 '^ogr2ogr ' "$CALLS" | cut -d: -f1)
npx_at=$(grep -n -m1 '^npx ' "$CALLS" | cut -d: -f1)
if grep -q 'dbname=selftest_never_used' <<<"$ogr_line" &&
   [ "$psql_all" -ge 2 ] && [ "$psql_other" -eq 0 ] &&
   [ -n "$ogr_at" ] && [ -n "$npx_at" ] && [ "$ogr_at" -lt "$npx_at" ]; then
  pass "ogr2ogr and every psql call use that same database, and run before the loader"
else
  fail "ogr2ogr/psql were not all pointed at $ASKED before the loader: ogr='$ogr_line' psql calls=$psql_all other=$psql_other"
fi

# With NO DATABASE_URL the script resolves a default for ogr2ogr and psql;
# the loader must be handed that same one explicitly, or it reads its own
# (dotenv, then its own default) and loads into a database the staging
# table is not in. The default is not written here: it is whatever psql was
# given.
SELFTEST_UNSET_DB=1 run c2 >/dev/null; rc=$?
resolved=$(grep -m1 '^psql ' "$CALLS" | cut -d' ' -f2)
if [ $rc -eq 0 ] && [ -n "$resolved" ] &&
   [ "$(tail -n 1 "$CALLS")" = "npx ts-node src/osm/load-route-poi.ts [DATABASE_URL=$resolved]" ]; then
  pass "with no DATABASE_URL set the loader is still handed the database the script resolved"
else
  fail "the loader was not handed the resolved database '$resolved'; rc=$rc, last: $(tail -n 1 "$CALLS")"
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
