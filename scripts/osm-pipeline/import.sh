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

echo "==> 1/2 extract campsites (shared with osm-weekly.yml)"
# 🔴 ONE script, called from here AND from the workflow that builds the
# published release. It used to be two copies, and when the duplicate /
# stray-node bug was fixed, it was fixed in the copy that does not ship.
# See extract-campsites.sh for what that cost.
"$(dirname "$0")/extract-campsites.sh" "$PBF_PATH" "$GEOJSON"

FEATURE_COUNT="$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['features']))" "$GEOJSON")"
echo "    campsites found: $FEATURE_COUNT"


echo "==> 2/2 ogr2ogr -> PostGIS ($TABLE)"
ogr2ogr -f "PostgreSQL" "PG:$DB_URL" "$GEOJSON" \
  -nln "$TABLE" -overwrite -lco GEOMETRY_NAME=geom -t_srs EPSG:4326

echo "Done. Row count:"
psql "$DB_URL" -c "SELECT count(*) FROM \"$TABLE\";"
