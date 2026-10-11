#!/usr/bin/env bash
# One PBF in, one GeoJSON of campsites out. The only place that decides
# what a campsite is.
#
#   ./extract-campsites.sh <region.osm.pbf> <out.geojson>
#
# 🔴 WHY THIS FILE EXISTS, AND WHY IT IS NOT A TIDY-UP (CAMP-253).
#
# The filter-and-export lived in TWO places: here-ish in `import.sh`, and
# copied into `.github/workflows/osm-weekly.yml`. The weekly workflow is
# the one that produces the published data release, and `import.sh` is
# what somebody runs by hand against a local extract.
#
# So when the duplicate-and-stray-node bug was fixed in `import.sh`, it
# was fixed in the half that does not ship. Review caught it by running
# the untouched workflow path on Austria and getting the exact state the
# fix claimed to have removed: 1 493 features, 116 gates and flagpoles,
# 603 duplicate copies. Three days of "fixed" with nothing fixed.
#
# Two copies of a rule is one rule and one decoration, and there is no
# way to tell from either file which is which. Hence: one script, called
# by both.

set -euo pipefail

PBF="${1:?usage: extract-campsites.sh <region.osm.pbf> <out.geojson>}"
OUT="${2:?usage: extract-campsites.sh <region.osm.pbf> <out.geojson>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 🔴 `r/` IS NOT OPTIONAL. It was `n/` and `w/`, so every campsite mapped
# as a multipolygon — 1 367 across the EU-27, 25 in Austria alone — did
# not exist for us at all. A relation is how a site with a hole in it, or
# one in several pieces, is drawn.
#
# And note what is deliberately NOT here: `-R`. Dropping referenced
# objects would leave the ways with no nodes to build geometry from, so
# the stray tagged nodes inside a campsite have to come in. The
# normaliser throws them out by their own tags, which is the only place
# that can tell a gate from a campsite.
osmium tags-filter "$PBF" \
  n/tourism=camp_site n/tourism=caravan_site \
  w/tourism=camp_site w/tourism=caravan_site \
  r/tourism=camp_site r/tourism=caravan_site \
  -o "$WORK/filtered.osm.pbf" --overwrite

# 🔴 `-u type_id` is not optional either (CAMP-28). Without it the export
# carries no OSM identifier at all: ogr2ogr then invents `ogc_fid`, a row
# counter that changes between runs, and upserting on that is impossible.
osmium export "$WORK/filtered.osm.pbf" \
  -o "$WORK/raw.geojson" --overwrite -f geojson -u type_id

node "$HERE/normalise-export.mjs" "$WORK/raw.geojson" "$OUT"

# 🔴 A relation that produced no geometry is a campsite we silently do
# not have, so it is counted and named rather than left to arithmetic.
# Measured on Austria 11.10.2026: 25 relations in, 22 out. The three:
#
#   r17354600, r17354630   type=site — a GROUPING of members, not an
#       outline. osmium builds areas from type=multipolygon and
#       type=boundary only, and it is right not to invent one.
#   r7290577               type=multipolygon, "Strandbad und Camping
#       Bruggerhorn", addr:postcode 9430 — St. Margrethen, SWITZERLAND,
#       on the border. Its member ways fall outside the Austrian extract,
#       so the ring cannot be closed. Per-country extracts lose
#       cross-border objects, and nothing told us before.
#
# Neither is a reason to fail. Both are a reason to see the number,
# because the day it moves is the day something else is wrong.
RELS_IN="$(osmium cat -f opl "$WORK/filtered.osm.pbf" 2>/dev/null \
  | grep -cE '^r[0-9]+ .*tourism=(camp|caravan)_site' || true)"
RELS_OUT="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(sum(1 for f in d['features'] if str(f.get('id','')).startswith('a') or str(f.get('id','')).startswith('r')))" "$OUT")"
if [ "${RELS_IN:-0}" -gt 0 ]; then
  echo "    relations: $RELS_IN in the filter"
fi
