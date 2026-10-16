#!/usr/bin/env bash
# Self-test for extract-campsites.sh — the date of the last OSM edit must
# survive the whole script, from a PBF to the file the importer reads.
#
#   ./scripts/osm-pipeline/extract-campsites.selftest.sh
#
# 🔴 Why this file exists (CAMP-256).
#
# `osmium export` drops an object's edit date unless it is asked for with
# `-a timestamp,version`. When the flag is missing nothing fails: the
# campsites still load, every count still matches, and every record reads
# "Not known". That is the one failure on this card that looks exactly
# like success, and the normaliser's own self-test cannot see it — it is
# handed a file, not a PBF, so it never learns whether the script above it
# asked for the date.
#
# So this drives the REAL script on a REAL osmium, with a PBF built here
# from a few lines of OPL whose dates are typed out below. Nothing is
# shimmed: a shim of osmium that "supports -a" would test the shim.
#
# Needs osmium on PATH and says so by FAILING, not skipping — a skipped
# test reads as a passed one. CI installs `osmium-tool` for this step.
# No network and no database.
#
# 🔴 THE COUNTER. A printed "N cases" is a label; a suite whose cases
# silently stop running prints a smaller N and exits 0. EXPECTED below is
# written out, and the last line is only printed when what actually ran
# equals it.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/extract-campsites-selftest.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

# The number of pass/fail calls below. Update it WITH the cases.
EXPECTED=9

PASSED=0
FAILED=0
pass() { echo "  ✓ $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  ✗ $1"; FAILED=$((FAILED + 1)); }

if ! command -v osmium >/dev/null 2>&1; then
  echo "  ✗ osmium is not on PATH — this suite needs the real tool and does not skip"
  echo "extract-campsites self-test: FAILED (osmium missing)"
  exit 1
fi

# ── the world: a PBF made from OPL ───────────────────────────────────
#
# 🔴 THE DATES ARE TYPED, in two forms that were worked out apart: the
# OPL timestamps below, and the Unix seconds in EXPECTED_TRIPLES. They
# are not computed from each other here. 2026-08-28T21:39:27Z is the
# value osmium itself wrote as 1787953167 for Rinella Scout Centre on
# Malta (15.10.2026); the other two were converted with Python's
# calendar.timegm, which shares no code with osmium.
#
#   n1     a camp_site node, edited 28.08.2026, version 4.
#   n2     a caravan_site node, edited 14.06.2019, version 1.
#   w100   a closed camp_site way, edited 14.06.2023, version 7 — and by
#          a named mapper, uid 12345. The extract must NOT carry that
#          name out (see the last cases).
#   n13    a gate on the way's outline: tagged, not a campsite.
cat > "$ROOT/fixture.opl" <<'OPL'
n1 v4 dV c0 t2026-08-28T21:39:27Z i0 u Ttourism=camp_site,name=Camp%20%One x14.5000000 y35.9000000
n2 v1 dV c0 t2019-06-14T08:00:00Z i0 u Ttourism=caravan_site x14.6000000 y35.9000000
n10 v1 dV c0 t2011-02-03T04:05:06Z i0 u T x14.7000000 y35.9000000
n11 v1 dV c0 t2011-02-03T04:05:06Z i0 u T x14.7010000 y35.9000000
n12 v1 dV c0 t2011-02-03T04:05:06Z i0 u T x14.7010000 y35.9010000
n13 v1 dV c0 t2011-02-03T04:05:06Z i0 u Tbarrier=gate x14.7000000 y35.9010000
w100 v7 dV c777 t2023-06-14T10:11:12Z i12345 uJohnDoe Ttourism=camp_site,name=Camp%20%Way Nn10,n11,n12,n13,n10
OPL

EXPECTED_TRIPLES='a200 1686737472 7
n1 1787953167 4
n2 1560499200 1'

if ! osmium cat -F opl "$ROOT/fixture.opl" -o "$ROOT/fixture.osm.pbf" --overwrite 2>"$ROOT/cat.err"; then
  echo "  ✗ could not build the fixture PBF: $(cat "$ROOT/cat.err")"
  echo "extract-campsites self-test: FAILED (fixture)"
  exit 1
fi

# `id timestamp version`, one line per feature, sorted — read from the file
# the script WROTE, not from anything it printed.
triples() {
  node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const rows = d.features.map((f) => [f.id, f.properties["@timestamp"], f.properties["@version"]].join(" "));
    console.log(rows.sort().join("\n"));
  ' "$1"
}

# ── the script as it is ──────────────────────────────────────────────
"$HERE/extract-campsites.sh" "$ROOT/fixture.osm.pbf" "$ROOT/out.geojson" >"$ROOT/run.out" 2>&1
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  pass "extract-campsites.sh runs on a PBF and exits 0"
else
  fail "extract-campsites.sh exited $STATUS: $(tail -3 "$ROOT/run.out")"
fi

GOT="$(triples "$ROOT/out.geojson" 2>/dev/null || true)"
if [ "$GOT" = "$EXPECTED_TRIPLES" ]; then
  pass "every campsite leaves with the edit date and version it had in the PBF"
else
  fail "dates differ — wanted [$(echo "$EXPECTED_TRIPLES" | tr '\n' ';')] got [$(echo "$GOT" | tr '\n' ';')]"
fi

COUNT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).features.length)' "$ROOT/out.geojson" 2>/dev/null || echo '?')"
if [ "$COUNT" = "3" ]; then
  pass "three campsites out of seven objects: the gate is not one, the way is not doubled"
else
  fail "wanted 3 features, got $COUNT"
fi

# 🔴 A NAMED MAPPER MUST NOT TRAVEL. The fixture's way was edited by
# "JohnDoe" (uid 12345, changeset 777). The public extracts blank these,
# but a different extract might not, and the day one does is the day a
# widened `-a` list starts printing a private person's name into our data.
if grep -qE 'JohnDoe|12345|@user|@uid|@changeset' "$ROOT/out.geojson"; then
  fail "a mapper's identity reached the output: $(grep -oE '"@(user|uid|changeset)":[^,}]*' "$ROOT/out.geojson" | head -3 | tr '\n' ' ')"
else
  pass "no mapper name, uid or changeset reaches the output"
fi

# The prerequisite the privacy case stands on. Without it the case above
# could pass because the fixture never carried a name at all.
# 🔴 Captured, then matched — not `osmium … | grep -q`. grep -q exits on
# the first hit, the writer then dies of SIGPIPE, and `pipefail` turns that
# into a failed `if` on a fixture that DOES carry the name.
FIXTURE_OPL="$(osmium cat -f opl "$ROOT/fixture.osm.pbf")"
if [[ "$FIXTURE_OPL" == *uJohnDoe* ]]; then
  pass "the fixture PBF really does carry the mapper's name (so the case above bit)"
else
  fail "the fixture lost its mapper — the privacy case above proves nothing"
fi

# ── the same script with the flag removed ────────────────────────────
#
# 🔴 The mutation, run inside the suite so that "the guard bites through
# the shell" is something this file proves on every run rather than
# something a reviewer did once by hand. The script and its two imports
# are copied into a scratch tree, and the flag is taken out of the COPY —
# the real file is never touched.
MUT="$ROOT/mutant"
mkdir -p "$MUT/scripts/osm-pipeline" "$MUT/scripts/lib"
cp "$HERE/extract-campsites.sh" "$MUT/scripts/osm-pipeline/extract-campsites.sh"
cp "$HERE/normalise-export.mjs" "$MUT/scripts/osm-pipeline/normalise-export.mjs"
cp "$HERE/../lib/entrypoint.mjs" "$MUT/scripts/lib/entrypoint.mjs"
# Remove `-a timestamp,version` and the line-continuation that led to it.
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const s = fs.readFileSync(p, "utf8");
  const out = s.replace(/ -u type_id \\\n  -a timestamp,version\n/, " -u type_id\n");
  fs.writeFileSync(p, out);
  process.exit(out === s ? 3 : 0);
' "$MUT/scripts/osm-pipeline/extract-campsites.sh"
ANCHOR=$?
if [ "$ANCHOR" -eq 0 ]; then
  pass "the copy really lost its -a flag (the mutation landed)"
else
  fail "the mutation did not land (exit $ANCHOR) — the cases below prove nothing"
fi

"$MUT/scripts/osm-pipeline/extract-campsites.sh" "$ROOT/fixture.osm.pbf" "$ROOT/mutant-out.geojson" >"$ROOT/mutant.out" 2>&1
MSTATUS=$?
if [ "$MSTATUS" -ne 0 ]; then
  pass "without -a the script FAILS, instead of loading date-less campsites"
else
  fail "without -a the script exited 0 — every record would have read \"Not known\""
fi
if grep -q '@timestamp' "$ROOT/mutant.out"; then
  pass "…and the failure names @timestamp"
else
  fail "the failure does not name the attribute: $(tail -2 "$ROOT/mutant.out")"
fi
if [ ! -s "$ROOT/mutant-out.geojson" ]; then
  pass "…and writes no file for the importer to pick up"
else
  fail "a file was written anyway: $ROOT/mutant-out.geojson"
fi

# ── the verdict ──────────────────────────────────────────────────────
RAN=$((PASSED + FAILED))
if [ "$RAN" -ne "$EXPECTED" ]; then
  echo "  ✗ $RAN cases ran, expected $EXPECTED"
  FAILED=$((FAILED + 1))
fi
if [ "$FAILED" -eq 0 ]; then
  echo ""
  echo "extract-campsites self-test: $PASSED cases passed"
  exit 0
fi
echo ""
echo "extract-campsites self-test: FAILED $FAILED"
exit 1
