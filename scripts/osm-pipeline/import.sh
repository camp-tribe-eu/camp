#!/usr/bin/env bash
# OSM data pipeline (CAMP-10): Osmium Tool -> GeoJSON -> ogr2ogr -> PostGIS.
#
# Usage:
#   ./import.sh <path-to-region.osm.pbf> <target-table> [database-url]
#
# Example (tiny smoke-test region, ~3MB):
#   curl -L -o li.osm.pbf https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
#   ./import.sh li.osm.pbf osm_camping_staging
#
# -L on the curl above is required: Geofabrik answers 302 and without it you
# save a 244-byte HTML redirect page instead of the extract.
#
# Lands raw OSM camping/caravan features into a staging table with their
# original tags as columns. Mapping staging rows onto the camping_spots
# schema (type enum, amenities jsonb) is a separate transform step, not
# done by this script - OSM tags don't map 1:1 onto our enum and need
# per-tag decisions (e.g. which combination of fee/tents/caravans implies
# "wild" vs "paid").

set -euo pipefail

PBF_PATH="${1:?usage: import.sh <region.osm.pbf> <target-table> [database-url]}"
TABLE="${2:?usage: import.sh <region.osm.pbf> <target-table> [database-url]}"
DB_URL="${3:-dbname=camptribe_dev}"

# shellcheck source=_pgconn.sh
. "$(dirname "$0")/_pgconn.sh"
DB_URL="$(pg_conninfo "$DB_URL")"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

FILTERED="$WORKDIR/filtered.osm.pbf"
GEOJSON="$WORKDIR/features.geojson"

echo "==> 1/4 osmium tags-filter (camp_site + caravan_site, nodes+ways+relations)"
# 🔴 `r/` IS NOT OPTIONAL EITHER (CAMP-253). It was `n/` and `w/`, so
# every campsite mapped as a multipolygon — 1 367 of them across the
# EU-27, 25 in Austria alone — simply did not exist for us. A relation
# is how a site with a hole in it, or one in several pieces, is drawn.
#
# And note what is deliberately NOT here: `-R`. Dropping referenced
# objects would leave the ways with no nodes to build geometry from, so
# the stray tagged nodes inside a campsite have to come in. Step 3
# throws them out by their own tags, which is the only place that can
# tell a gate from a campsite.
osmium tags-filter "$PBF_PATH" \
  n/tourism=camp_site n/tourism=caravan_site \
  w/tourism=camp_site w/tourism=caravan_site \
  r/tourism=camp_site r/tourism=caravan_site \
  -o "$FILTERED" --overwrite

echo "==> 2/4 osmium export -> GeoJSON (with stable OSM id)"
# 🔴 -u type_id is not optional (CAMP-28).
#
# Without it the export carries no OSM identifier at all: ogr2ogr then
# invents `ogc_fid`, a row counter that changes between runs. Upserting on
# that is impossible, so every weekly import would duplicate the entire
# dataset instead of updating it.
#
# `type_id` emits values like `n2601234` / `w871234` - the type prefix
# matters because a node and a way can share the same number.
osmium export "$FILTERED" -o "$GEOJSON" --overwrite -f geojson -u type_id

echo "==> 3/4 keep only campsites, and give each its real OSM id back"
# 🔴 Measured on Austria 11.10.2026, before this step existed: the export
# produced 1 493 features for 799 real objects. 611 of them were the same
# closed ways arriving a second time as areas, and 116 were gates,
# flagpoles and lift gates that happen to sit inside a campsite polygon —
# each one landing in the table as a PAID CAMPSITE with its own page.
# Across the EU-27 that was 5 755 rows, 10.9% of everything from OSM.
NORMALISED="$WORKDIR/campsites.geojson"
node "$(dirname "$0")/normalise-export.mjs" "$GEOJSON" "$NORMALISED"
GEOJSON="$NORMALISED"

FEATURE_COUNT="$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['features']))" "$GEOJSON")"
echo "    campsites found: $FEATURE_COUNT"

# 🔴 A relation that produced no geometry is a campsite we silently do not
# have, so it is counted and named rather than left to the arithmetic.
# Measured on Austria 11.10.2026: 25 relations in, 22 out. The three:
#
#   r17354600, r17354630   type=site — a GROUPING of members, not an
#       outline. osmium builds areas from type=multipolygon and
#       type=boundary only, and it is right not to invent one.
#   r7290577               type=multipolygon, "Strandbad und Camping
#       Bruggerhorn", addr:postcode 9430 — that is St. Margrethen in
#       SWITZERLAND, on the border. Its member ways fall outside the
#       Austrian extract, so the ring cannot be closed. Per-country
#       extracts lose cross-border objects, and nothing told us before.
#
# Neither is a reason to fail an import. Both are a reason to see the
# number, because the day it moves is the day something else is wrong.
RELS_IN="$(osmium cat -f opl "$FILTERED" 2>/dev/null | grep -cE '^r[0-9]+ .*tourism=(camp|caravan)_site' || true)"
RELS_OUT="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(sum(1 for f in d['features'] if str(f.get('id','')).startswith('r')))" "$GEOJSON")"
if [ "${RELS_IN:-0}" -gt "${RELS_OUT:-0}" ]; then
  echo "    relations with no geometry: $((RELS_IN - RELS_OUT)) of $RELS_IN (type=site, or members outside this extract)"
fi

if [ "$FEATURE_COUNT" -eq 0 ]; then
  echo "No camping/caravan features in this extract - nothing to import."
  exit 0
fi

echo "==> 4/4 ogr2ogr -> PostGIS ($TABLE)"
ogr2ogr -f "PostgreSQL" "PG:$DB_URL" "$GEOJSON" \
  -nln "$TABLE" -overwrite -lco GEOMETRY_NAME=geom -t_srs EPSG:4326

echo "Done. Row count:"
psql "$DB_URL" -c "SELECT count(*) FROM \"$TABLE\";"
