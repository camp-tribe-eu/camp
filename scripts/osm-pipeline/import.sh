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

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

FILTERED="$WORKDIR/filtered.osm.pbf"
GEOJSON="$WORKDIR/features.geojson"

echo "==> 1/3 osmium tags-filter (camp_site + caravan_site, nodes+ways)"
osmium tags-filter "$PBF_PATH" \
  n/tourism=camp_site n/tourism=caravan_site \
  w/tourism=camp_site w/tourism=caravan_site \
  -o "$FILTERED" --overwrite

echo "==> 2/3 osmium export -> GeoJSON (with stable OSM id)"
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

FEATURE_COUNT="$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['features']))" "$GEOJSON")"
echo "    features found: $FEATURE_COUNT"

if [ "$FEATURE_COUNT" -eq 0 ]; then
  echo "No camping/caravan features in this extract - nothing to import."
  exit 0
fi

echo "==> 3/3 ogr2ogr -> PostGIS ($TABLE)"
ogr2ogr -f "PostgreSQL" "PG:$DB_URL" "$GEOJSON" \
  -nln "$TABLE" -overwrite -lco GEOMETRY_NAME=geom -t_srs EPSG:4326

echo "Done. Row count:"
psql "$DB_URL" -c "SELECT count(*) FROM \"$TABLE\";"
