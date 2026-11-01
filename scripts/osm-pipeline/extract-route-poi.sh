#!/usr/bin/env bash
# One PBF in, one GeoJSON of route POI out — fuel, charging, water, dump
# stations, rest areas, shops, food and lodging: the services a driver
# needs BETWEEN campsites (CAMP-113 / CAMP-119). Prints the feature count
# on stdout; everything else goes to stderr.
#
#   ./extract-route-poi.sh <region.osm.pbf> <out.geojson>
#
# 🔴 WHY THIS FILE EXISTS (decision of 28.10.2026).
#
# `osm_route_poi` was refreshed by load-route-poi.sh, by hand, on a machine
# holding all 27 extracts — and went 14+ days stale, the last position of
# ours in the freshness sentry's daily mail. The production machine cannot
# take the job: it needs osmium, ogr2ogr and ~25 GB of extracts next to a
# live site. The weekly workflow already downloads every extract for the
# campsites; this script cuts the second layer from the SAME file, in the
# same job, and the result travels as a release asset the machine pulls
# (import-route-poi.mjs) — the chain that already works for camping_spots.
#
# 🔴 ONE TAG LIST, SOURCED. route-poi-filters.sh is the array
# load-route-poi.sh uses; extract-campsites.sh's header records what a
# second copy of a filter cost that project. The export list is the same
# file, too: export-rpoi.json, the one route-poi-export.ts reads to know
# which staging columns to expect.
#
# 🔴 NO `-a timestamp,version`, DELIBERATELY. The campsite extract carries
# the last-edit date because a page shows it; nothing reads it for route
# POI, the staging table never had the columns, and widening `-a` is the
# one way a mapper's name could start travelling (see extract-campsites.sh).
#
# 🔴 ZERO IS A REFUSAL, NOT A RESULT. No member state has zero fuel
# stations, shops and restaurants; a count of 0 means the filter, the
# config or the download broke. The file is written under a scratch name
# and only renamed on success, so a failed run leaves nothing for the
# publish job to pick up and the import never sees an empty country as
# "every POI of this country has gone". The self-test runs a copy with this
# guard removed and requires it to exit 0 on an empty fixture — proving
# the guard is what refuses, not something else.

set -euo pipefail

PBF="${1:?usage: extract-route-poi.sh <region.osm.pbf> <out.geojson>}"
OUT="${2:?usage: extract-route-poi.sh <region.osm.pbf> <out.geojson>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 🔴 Checked by name BEFORE it is sourced: with the EXIT trap armed, bash
# 3.2 reports the trap's code for a failed `.`, i.e. 0 (measured
# 01.11.2026). A script that ran nothing would read as a pass.
FILTERS_FILE="$HERE/route-poi-filters.sh"
[ -f "$FILTERS_FILE" ] || { echo "::error::$FILTERS_FILE is missing" >&2; exit 1; }
# shellcheck source=route-poi-filters.sh
. "$FILTERS_FILE"

EXPORT_CONFIG="$HERE/export-rpoi.json"
[ -f "$EXPORT_CONFIG" ] || { echo "::error::$EXPORT_CONFIG is missing" >&2; exit 1; }

# Nodes and ways (TAG_ARGS carries the `n/` and `w/` forms), and NOT `-R`:
# a way's nodes have to come along or there is no geometry to build.
# `*value*` is osmium's substring match, applied once in the sourced loop —
# `shop=convenience;gas` is a list, and an equality never selects it.
osmium tags-filter "$PBF" "${TAG_ARGS[@]}" \
  -o "$WORK/filtered.osm.pbf" --overwrite

# 🔴 `-u type_id` is not optional (CAMP-28, same reason as the campsites):
# without it the export carries no OSM identifier and nothing can be
# upserted. A FeatureCollection (`-f geojson`), not a sequence: the
# importer's streaming reader (import-release.mjs, shared) reads exactly
# that shape, one feature at a time, whatever the size of the country.
osmium export "$WORK/filtered.osm.pbf" \
  -o "$WORK/out.geojson" --overwrite -f geojson -u type_id \
  --config="$EXPORT_CONFIG"

# One feature, one `{"type":"Feature"` — osmium writes the type first and
# the closing quote keeps `"type":"FeatureCollection"` out of the count;
# a tag VALUE saying the same thing arrives with its quotes escaped and
# cannot match. No JSON.parse of a 130 MB file for one integer.
#
# 🔴 `|| true` ON THE GREP, and the self-test is why it is there. grep exits
# 1 when it matches nothing, `pipefail` carries that into the substitution,
# and `set -e` then ends the script — exit 1, no message, no file. The
# empty-country case "failed" exactly as wanted, and the mutant copy with
# the guard removed failed too: something else was refusing, and the
# guard below was never exercised. Zero is a value here, not an error.
COUNT="$({ grep -o -F '"type":"Feature"' "$WORK/out.geojson" || true; } | wc -l | tr -d ' ')"

if [ "$COUNT" -eq 0 ]; then
  echo "::error::$(basename "$PBF") produced 0 route POI — refusing to publish an empty country" >&2
  exit 1
fi

mv "$WORK/out.geojson" "$OUT"
echo "  $(basename "$PBF"): $COUNT route POI features" >&2
echo "$COUNT"
