#!/usr/bin/env bash
# CAMP-34: administrative boundaries, so a campsite knows which region it is in.
#
#   ./scripts/osm-pipeline/load-boundaries.sh
#
# Why this exists at all: the URL of every campsite page is
# /camping/{country}/{region}/{slug} - a structure fixed in the project map
# (CAMP-21) and the SEO plan. But OSM gives us a region for almost nobody:
# measured on the Slovenian extract, addr:state or addr:province was present
# on 0 of 448 campsites. Without this join there is no URL to publish, and
# CAMP-87 is explicit that a URL published once must not move afterwards.
#
# Natural Earth, 1:10m admin-1. Public domain, from their terms of use:
#
#   "All versions of Natural Earth raster + vector map data found on this
#    website are in the public domain... invites you to use them for personal,
#    educational, and commercial purposes. No permission is needed to use
#    Natural Earth."
#
# So: no key, no rate limit, no attribution obligation, no owner action -
# which is the whole reason it beats a geocoding API here. Geocoding
# (CAMP-44) stays for addresses typed by people; this is a point-in-polygon
# join we can run offline as often as we like.
#
# 🔴 Granularity is NOT uniform across Europe. admin-1 means regions in
# France (13) and Italy (20), but municipalities in Slovenia (212). A
# campsite is correctly placed either way, so spot URLs are fine; it is the
# hub pages (CAMP-71) that must decide their own grouping and apply a
# publication threshold, or half of them would be thin pages with one
# campsite on them.

set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"

# shellcheck source=_pgconn.sh
. "$(dirname "$0")/_pgconn.sh"
OGR_CONN="$(pg_conninfo "$DB_URL")"
# \U0001f534 NOT /tmp \u2014 the same reasoning as load-context.sh, which was
# moved on 25.09.2026 after /tmp swallowed 22 GB of extracts. Same
# pipeline, same kind of artefact, and leaving one of the pair behind
# would only mean rediscovering the lesson on the other one.
if [ -z "${WORK_DIR:-}" ] && [ -z "${HOME:-}" ]; then
  echo "::error::neither WORK_DIR nor HOME is set \u2014 pass WORK_DIR=/somewhere." >&2
  exit 1
fi
WORK_DIR="${WORK_DIR:-$HOME/camptribe-boundaries}"
NE_URL="https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip"

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

if [ ! -f ne_10m_admin_1_states_provinces.shp ]; then
  echo "→ downloading Natural Earth admin-1…"
  # -L because the CDN redirects; without it curl saves the redirect page
  # and ogr2ogr fails with something unhelpful. Same trap as Geofabrik.
  curl -sSL --retry 3 -o ne_admin1.zip "$NE_URL"

  SIZE=$(wc -c < ne_admin1.zip)
  if [ "$SIZE" -lt 1000000 ]; then
    echo "::error::download is only $SIZE bytes - not the shapefile archive"
    exit 1
  fi
  unzip -o -q ne_admin1.zip
fi

echo "→ loading into PostGIS as ne_admin1…"
# Only the columns the import actually reads. iso_a2 is what corrects the
# country: it comes from the polygon the point falls in, not from an
# argument somebody typed.
ogr2ogr -f PostgreSQL "PG:$OGR_CONN" \
  ne_10m_admin_1_states_provinces.shp \
  -nln ne_admin1 -overwrite \
  -lco GEOMETRY_NAME=geom -nlt PROMOTE_TO_MULTI \
  -select "name,name_en,admin,iso_a2,iso_3166_2,type_en"

psql "$DB_URL" -q -c 'CREATE INDEX IF NOT EXISTS ne_admin1_geom_idx ON ne_admin1 USING GIST (geom);'

psql "$DB_URL" -c "SELECT count(*) AS polygons FROM ne_admin1;"
echo "✓ boundaries ready — import-spots.ts will now resolve region and country"
