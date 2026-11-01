#!/usr/bin/env bash
# Self-test for extract-route-poi.sh — the weekly route-POI cut, from a PBF
# to the file the importer reads.
#
#   ./scripts/osm-pipeline/extract-route-poi.selftest.sh
#
# 🔴 Why this file exists (CAMP-113, decision of 28.10.2026).
#
# The script runs unattended on a GitHub runner, 27 times a week, and what
# it writes becomes a release asset that import-route-poi.mjs brings into
# the database. Three things can go wrong in it without anything failing:
# the tag list stops reaching osmium (a country of shops exports as a
# country of nothing), the export config stops being handed over (every
# facility column reads 'unknown'), and an EMPTY result is published as a
# country whose every POI has gone. This drives the REAL script on a REAL
# osmium with a PBF built here from a few lines of OPL, and then runs a
# COPY with the zero-guard removed and requires it to exit 0 — proving the
# guard, and not something else, is what refuses an empty country.
#
# Needs osmium on PATH and says so by FAILING, not skipping — a skipped test
# reads as a passed one. CI installs `osmium-tool` for this step. No network
# and no database.
#
# 🔴 THE COUNTER. A printed "N cases" is a label; a suite whose cases
# silently stop running prints a smaller N and exits 0. EXPECTED below is
# written out, and the last line is only printed when what actually ran
# equals it.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/extract-route-poi-selftest.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

# The number of pass/fail calls below. Update it WITH the cases.
EXPECTED=14

PASSED=0
FAILED=0
pass() { echo "  ✓ $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  ✗ $1"; FAILED=$((FAILED + 1)); }

if ! command -v osmium >/dev/null 2>&1; then
  echo "  ✗ osmium is not on PATH — this suite needs the real tool and does not skip"
  echo "extract-route-poi self-test: FAILED (osmium missing)"
  exit 1
fi

# ── the world: a PBF made from OPL ───────────────────────────────────
#
#   n1     a fuel station with fuel:lpg=yes, a phone, and a `brand` tag the
#          export config does NOT list — it must not travel.
#   n2     shop=convenience;gas — a LIST. Only the substring form of the
#          filter selects it (CAMP-327).
#   n3     a campsite: the other layer's object, not ours.
#   n4     a gate: nobody's.
#   n5     amenity=internet_cafe — selected by `*cafe*`, refused later by
#          the classifier; here it proves the `*` reached osmium.
#   w100   a closed supermarket way over four untagged nodes, edited by a
#          named mapper (uid 12345). The name must NOT reach the output.
#          osmium writes a tagged closed way TWICE — the linestring `w100`
#          and the area `a200` — which is the two-rows-per-object shape
#          load-route-poi.sh's header documents and canonicalRefSql folds.
#          (No digit run of the fixture may spell 12345 — the phone once
#          did, and the privacy case matched its own fixture.)
cat > "$ROOT/fixture.opl" <<'OPL'
n1 v3 dV c0 t2026-08-28T21:39:27Z i0 u Tamenity=fuel,name=Petrol%20%One,fuel:lpg=yes,phone=%2b%356%2020%209876,brand=Shell x14.5000000 y35.9000000
n2 v1 dV c0 t2019-06-14T08:00:00Z i0 u Tshop=convenience;gas,name=Corner x14.5100000 y35.9000000
n3 v1 dV c0 t2019-06-14T08:00:00Z i0 u Ttourism=camp_site,name=Camp x14.5200000 y35.9000000
n4 v1 dV c0 t2019-06-14T08:00:00Z i0 u Tbarrier=gate x14.5300000 y35.9000000
n5 v1 dV c0 t2019-06-14T08:00:00Z i0 u Tamenity=internet_cafe x14.5400000 y35.9000000
n10 v1 dV c0 t2011-02-03T04:05:06Z i0 u T x14.7000000 y35.9000000
n11 v1 dV c0 t2011-02-03T04:05:06Z i0 u T x14.7010000 y35.9000000
n12 v1 dV c0 t2011-02-03T04:05:06Z i0 u T x14.7010000 y35.9010000
n13 v1 dV c0 t2011-02-03T04:05:06Z i0 u T x14.7000000 y35.9010000
w100 v7 dV c777 t2023-06-14T10:11:12Z i12345 uJohnDoe Tshop=supermarket,name=Big%20%Shop,opening_hours=Mo-Sa%20%08:00-20:00 Nn10,n11,n12,n13,n10
OPL

# Only the two objects that are NOT route POI: the empty-country case.
cat > "$ROOT/empty.opl" <<'OPL'
n3 v1 dV c0 t2019-06-14T08:00:00Z i0 u Ttourism=camp_site,name=Camp x14.5200000 y35.9000000
n4 v1 dV c0 t2019-06-14T08:00:00Z i0 u Tbarrier=gate x14.5300000 y35.9000000
OPL

for f in fixture empty; do
  if ! osmium cat -F opl "$ROOT/$f.opl" -o "$ROOT/$f.osm.pbf" --overwrite 2>"$ROOT/cat.err"; then
    echo "  ✗ could not build the $f PBF: $(cat "$ROOT/cat.err")"
    echo "extract-route-poi self-test: FAILED (fixture)"
    exit 1
  fi
done

# Sorted ids of the features in a file — read from the file the script
# WROTE, not from anything it printed.
ids() {
  node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(d.features.map((f) => f.id).sort().join(" "));
  ' "$1"
}
prop() { # prop <file> <id> <property>
  node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const f = d.features.find((x) => x.id === process.argv[2]);
    const v = f && f.properties[process.argv[3]];
    console.log(v === undefined ? "<absent>" : v);
  ' "$1" "$2" "$3"
}

# ── the script as it is ──────────────────────────────────────────────
STDOUT="$("$HERE/extract-route-poi.sh" "$ROOT/fixture.osm.pbf" "$ROOT/out.geojson" 2>"$ROOT/run.err")"
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  pass "extract-route-poi.sh runs on a PBF and exits 0"
else
  fail "extract-route-poi.sh exited $STATUS: $(tail -3 "$ROOT/run.err")"
fi

if [ "$STDOUT" = "5" ]; then
  pass "stdout is the feature count alone (5), so the workflow can read it without a second count"
else
  fail "stdout was [$STDOUT], wanted exactly 5"
fi

GOT="$(ids "$ROOT/out.geojson" 2>/dev/null || true)"
if [ "$GOT" = "a200 n1 n2 n5 w100" ]; then
  pass "five features out of ten objects: the campsite and the gate are not ours, the closed way is its area and its line, the untagged nodes are nobody"
else
  fail "ids differ — wanted [a200 n1 n2 n5 w100] got [$GOT]"
fi

# 🔴 The list value proves the `*` reached osmium: an equality filter never
# selects `shop=convenience;gas` (CAMP-327).
if [[ " $GOT " == *" n2 "* ]]; then
  pass "shop=convenience;gas is selected — the substring form reached osmium"
else
  fail "the list-valued shop was not selected: the filter is an equality again"
fi

if [ "$(prop "$ROOT/out.geojson" n1 'fuel:lpg')" = "yes" ]; then
  pass "fuel:lpg travels (it is in export-rpoi.json, and lpgArrivalError needs it)"
else
  fail "fuel:lpg did not reach the output: $(prop "$ROOT/out.geojson" n1 'fuel:lpg')"
fi

if [ "$(prop "$ROOT/out.geojson" n1 brand)" = "<absent>" ]; then
  pass "a tag the export config does not list (brand) does not travel — the config was handed to osmium"
else
  fail "brand reached the output: the export is not using export-rpoi.json"
fi

if [ "$(prop "$ROOT/out.geojson" a200 opening_hours)" = "Mo-Sa 08:00-20:00" ]; then
  pass "the way's tags arrive on its area (opening_hours)"
else
  fail "opening_hours of the way: $(prop "$ROOT/out.geojson" a200 opening_hours)"
fi

# 🔴 No edit stamps and NO MAPPER. The script passes no `-a`; the day
# somebody adds one "for parity with the campsites" this says what it may
# not widen into.
if grep -qE 'JohnDoe|12345|@user|@uid|@changeset' "$ROOT/out.geojson"; then
  fail "a mapper's identity reached the output: $(grep -oE '"@(user|uid|changeset)":[^,}]*' "$ROOT/out.geojson" | head -3 | tr '\n' ' ')"
else
  pass "no mapper name, uid or changeset reaches the output"
fi
FIXTURE_OPL="$(osmium cat -f opl "$ROOT/fixture.osm.pbf")"
if [[ "$FIXTURE_OPL" == *uJohnDoe* ]]; then
  pass "the fixture PBF really does carry the mapper's name (so the case above bit)"
else
  fail "the fixture lost its mapper — the privacy case above proves nothing"
fi

# ── an empty country is refused ──────────────────────────────────────
EMPTY_OUT="$("$HERE/extract-route-poi.sh" "$ROOT/empty.osm.pbf" "$ROOT/empty-out.geojson" 2>"$ROOT/empty.err")"
ESTATUS=$?
if [ "$ESTATUS" -ne 0 ]; then
  pass "a PBF with no route POI makes the script FAIL, instead of publishing an empty country"
else
  fail "an empty result exited 0 (stdout [$EMPTY_OUT]) — the import would read it as 'every POI here has gone'"
fi
if grep -q 'produced 0 route POI' "$ROOT/empty.err"; then
  pass "…and the failure names the zero"
else
  fail "the failure does not name the zero: $(tail -2 "$ROOT/empty.err")"
fi
if [ ! -e "$ROOT/empty-out.geojson" ]; then
  pass "…and writes no file for the publish job to pick up"
else
  fail "a file was written anyway: $ROOT/empty-out.geojson"
fi

# ── the same script with the zero-guard removed ─────────────────────
#
# 🔴 The mutation, run inside the suite, so that "the guard is what refuses"
# is proved on every run rather than once by hand. The script and the two
# files it sources are copied into a scratch tree; the guard is taken out
# of the COPY — the real file is never touched.
MUT="$ROOT/mutant"
mkdir -p "$MUT/scripts/osm-pipeline"
cp "$HERE/extract-route-poi.sh" "$HERE/route-poi-filters.sh" "$HERE/export-rpoi.json" "$MUT/scripts/osm-pipeline/"
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const s = fs.readFileSync(p, "utf8");
  const out = s.replace(/if \[ "\$COUNT" -eq 0 \]; then\n[\s\S]*?\nfi\n/, "");
  fs.writeFileSync(p, out);
  process.exit(out === s ? 3 : 0);
' "$MUT/scripts/osm-pipeline/extract-route-poi.sh"
ANCHOR=$?
if [ "$ANCHOR" -eq 0 ]; then
  pass "the copy really lost its zero-guard (the mutation landed)"
else
  fail "the mutation did not land (exit $ANCHOR) — the cases below prove nothing"
fi

MOUT="$("$MUT/scripts/osm-pipeline/extract-route-poi.sh" "$ROOT/empty.osm.pbf" "$ROOT/mutant-out.geojson" 2>"$ROOT/mutant.err")"
MSTATUS=$?
if [ "$MSTATUS" -eq 0 ] && [ "$MOUT" = "0" ] && [ -e "$ROOT/mutant-out.geojson" ]; then
  pass "without the guard the copy exits 0 and writes a file of 0 features — so the guard is what refuses, not osmium"
else
  fail "the copy without the guard exited $MSTATUS with stdout [$MOUT] — something else refuses, and the guard is untested: $(tail -2 "$ROOT/mutant.err")"
fi

# ── the verdict ──────────────────────────────────────────────────────
RAN=$((PASSED + FAILED))
if [ "$RAN" -ne "$EXPECTED" ]; then
  echo "  ✗ $RAN cases ran, expected $EXPECTED"
  FAILED=$((FAILED + 1))
fi
if [ "$FAILED" -eq 0 ]; then
  echo ""
  echo "extract-route-poi self-test: $PASSED cases passed"
  exit 0
fi
echo ""
echo "extract-route-poi self-test: FAILED $FAILED"
exit 1
