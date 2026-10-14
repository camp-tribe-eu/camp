#!/usr/bin/env bash
# CAMP-296: where each EU country ends, from OpenStreetMap itself.
#
#   ./scripts/osm-pipeline/load-country-boundaries.sh              # everything
#   ./scripts/osm-pipeline/load-country-boundaries.sh --tag-only   # seconds
#
# Two things, in this order:
#   1. builds `osm_country_area` — where each EU country ends — from the 27
#      extracts (build-country-area.sql);
#   2. stamps every town, supermarket and station in osm_ctx_place and
#      osm_ctx_poi with the country it stands in (tag-ctx-country.sql).
# compute-context.ts then looks for the nearest town, shop and station
# INSIDE the Union. Without this the nearest town of five campsites in
# Warmia-Masuria was Крылово, in Kaliningrad, and the page said so.
#
# 🔴 `--tag-only` IS FOR AFTER load-context.sh. That script runs
# `ogr2ogr -overwrite`, which re-creates osm_ctx_place and osm_ctx_poi
# WITHOUT the country column; compute-context refuses to run until it is
# back. Re-tagging reads no extracts and takes seconds, so it does not
# need the 5-minute osmium pass: the boundaries only change when the
# extracts do, and a fresh load-context.sh has not changed them.
#
# It does NOT download anything. load-context.sh owns the downloading, the
# checksums and the "is this the file I verified" marker; this reads the
# 27 extracts it left in WORK_DIR, exactly as load-route-poi.sh does.
#
# 🔴 THE MEMBER LIST COMES FROM eu-member-states.json, NOT FROM *.osm.pbf.
# A stray extract of a country we do not serve (Switzerland, say) would
# otherwise be read and its polygon loaded beside the 27.
#
# 🔴 NO PARTIAL MODE. The area table is replaced as a whole or not at all:
# build-country-area.sql refuses to swap unless every one of the 27 has a
# polygon, so a run that cannot see all of them leaves the previous table
# in place. A partial mode would be a way to load 26.
#
# Then (stored contexts keep the old numbers until this runs):
#   cd apps/api && npx ts-node src/osm/refresh-context-near.ts            # dry run
#   cd apps/api && npx ts-node src/osm/refresh-context-near.ts --apply
set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"

# shellcheck source=_pgconn.sh
. "$(dirname "$0")/_pgconn.sh"
OGR_CONN="$(pg_conninfo "$DB_URL")"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
MEMBERS_JSON="$REPO_ROOT/apps/api/src/osm/eu-member-states.json"

TAG_ONLY=0
case "${1:-}" in
  '') ;;
  --tag-only) TAG_ONLY=1 ;;
  *) echo "Usage: $0 [--tag-only]" >&2; exit 1 ;;
esac

# Stamps the two layers. Needs osm_country_area, and says so rather than
# letting `UPDATE … FROM a table that is not there` read as a SQL error.
tag_layers() {
  if [ "$(psql "$DB_URL" -t -A -c "SELECT to_regclass('public.osm_country_area') IS NOT NULL")" != t ]; then
    echo "::error::osm_country_area does not exist. Run this without --tag-only first." >&2
    exit 1
  fi
  echo "→ tagging osm_ctx_place and osm_ctx_poi with their country"
  local t0
  t0=$(date +%s)
  psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$HERE/tag-ctx-country.sql"
  # 🔴 A freshly rewritten table has no statistics, and the first query
  # after it is compute-context — the one that matters.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "ANALYZE osm_ctx_place; ANALYZE osm_ctx_poi;"
  psql "$DB_URL" -t -A -F ' ' -c "
    SELECT 'place', count(*), count(*) FILTER (WHERE country = ''), count(*) FILTER (WHERE country IS NULL) FROM osm_ctx_place
    UNION ALL
    SELECT 'poi',   count(*), count(*) FILTER (WHERE country = ''), count(*) FILTER (WHERE country IS NULL) FROM osm_ctx_poi" |
    awk '{printf "  %-6s %7d rows, %6d in no polygon, %d untagged\n", $1, $2, $3, $4}'
  echo "  tagged in $(( $(date +%s) - t0 )) s"
}

if [ "$TAG_ONLY" = 1 ]; then
  tag_layers
  echo "✓ countries stamped"
  exit 0
fi

# Same directory and the same reasoning as load-context.sh: NOT /tmp,
# where 22 GB were lost on 25.09.2026.
if [ -z "${WORK_DIR:-}" ] && [ -z "${HOME:-}" ]; then
  echo "::error::neither WORK_DIR nor HOME is set, so there is nowhere to work." >&2
  exit 1
fi
WORK_DIR="${WORK_DIR:-$HOME/camptribe-osm}"
[ -d "$WORK_DIR" ] || { echo "::error::$WORK_DIR does not exist. Run load-context.sh first." >&2; exit 1; }
cd "$WORK_DIR"

# 🔴 The same mkdir lock the sibling loaders take, and for the same reason:
# two runs sharing a work directory write each other's intermediate files.
LOCK_DIR="$WORK_DIR/.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo '?')
  if [ "$OWNER" != '?' ] && kill -0 "$OWNER" 2>/dev/null; then
    echo "::error::another pipeline run (pid $OWNER) is using $WORK_DIR." >&2
    exit 1
  fi
  echo "  a previous run (pid $OWNER) left a lock behind and is gone — taking it" >&2
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || { echo "::error::cannot lock $WORK_DIR" >&2; exit 1; }
fi
echo $$ > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

# "at europe-austria" per line. A failed node fails the assignment, and
# set -e stops here — an empty list must not be read as "nothing to load".
MEMBERS="$(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).members;
  for (const [code, path] of Object.entries(m)) console.log(code + " " + path.replace(/\//g, "-"));
' "$MEMBERS_JSON")"
[ -n "$MEMBERS" ] || { echo "::error::no members in $MEMBERS_JSON" >&2; exit 1; }
EU_ARRAY="{$(printf '%s\n' "$MEMBERS" | awk '{printf "%s%s", sep, $1; sep=","}')}"

# 🔴 Regions whose relation the extract CLIPS: members are listed that sit
# outside it, so osmium cannot assemble the area, but the ways that ARE
# present close into rings on their own. Written as "ISO3166-2:member".
# Measured 14.10.2026: only Ceuta needs this (14 outer ways listed, 10
# present, two campsites). The Canary Islands are not in europe/spain at
# all, so there is nothing to rebuild.
CLIPPED=("ES-CE:es")

# 🔴 Only the tags something reads — load-context.sh explains why: every
# tag becomes a column and the EU-27 together pass PostgreSQL's 1600.
printf '{"include_tags":["boundary","admin_level","ISO3166-1:alpha2","ISO3166-2"]}\n' > export-bnd.json

# Both exist from the start, empty: build-country-area.sql reads them whether
# or not any region needed rebuilding, and a file with nothing to stage
# must not leave the table uncreated.
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  DROP TABLE IF EXISTS osm_country_staging, osm_country_lines, osm_country_lines_raw;
  CREATE TABLE osm_country_staging (
    ogc_fid serial PRIMARY KEY, iso1 varchar, iso2 varchar, lvl varchar,
    geom geometry(MultiPolygon, 4326));
  CREATE TABLE osm_country_lines (
    ogc_fid serial PRIMARY KEY, iso2 text, geom geometry(MultiLineString, 4326));"

# 🔴 jq, NOT OGR SQL, to pick fields out of the export.
#
# GDAL builds a layer's columns from the properties its features carry, and
# a tag NO feature in a file has is not a column at all. The first version
# selected `"ISO3166-2"` with OGR SQL and died on Estonia, whose level-2
# relations happen to carry none: "Unrecognized field name". jq builds the
# same three fields for every file, null where the tag is absent, and also
# throws away the 99% of the export that is not the answer before ogr2ogr
# has to read it.
#
# `--seq` because osmium writes RFC 8142 GeoJSON text sequences, each
# record prefixed with 0x1e.
stage() {
  local file="$1" table="$2" keep="$3"
  jq --seq -c "select($keep) | {type: \"Feature\", geometry: .geometry,
      properties: {iso1: .properties[\"ISO3166-1:alpha2\"],
                   iso2: .properties[\"ISO3166-2\"],
                   lvl:  .properties.admin_level}}" \
    "$file" > "$file.picked"
  [ -s "$file.picked" ] || return 0
  ogr2ogr -f PostgreSQL "PG:$OGR_CONN" "$file.picked" \
    -nln "$table" -append -lco GEOMETRY_NAME=geom -nlt PROMOTE_TO_MULTI
}

count_rows() { psql "$DB_URL" -t -A -c "$1"; }

started=$(date +%s)
while read -r code slug <&3; do
  pbf="$slug.osm.pbf"
  [ -f "$pbf" ] || { echo "::error::$pbf is not in $WORK_DIR — load-context.sh downloads it" >&2; exit 1; }
  echo "  → $slug"
  # `code` is interpolated into SQL and into a jq program below.
  case "$code" in [a-z][a-z]) ;; *) echo "::error::unexpected member code '$code'" >&2; exit 1 ;; esac
  upper=$(printf '%s' "$code" | tr '[:lower:]' '[:upper:]')

  # 1. the country's own relation. `tags-filter` keeps the relation's
  # members, and sub-relations with them — so the export is far larger than
  # the answer (Poland: 322 MB for one polygon). ogr2ogr's WHERE is what
  # throws the rest away.
  osmium tags-filter "$pbf" r/admin_level=2 -o "$slug.bnd.pbf" -f pbf --overwrite
  osmium export "$slug.bnd.pbf" -f geojsonseq --geometry-types=polygon \
    --config=export-bnd.json -o "$slug.bnd.geojsonl" --overwrite
  stage "$slug.bnd.geojsonl" osm_country_staging \
    '.properties.boundary == "administrative" and .properties.admin_level == "2" and .properties["ISO3166-1:alpha2"] != null'

  # 2. no assembled relation for this country → its regions.
  have=$(count_rows "SELECT count(*) FROM osm_country_staging WHERE lvl = '2' AND lower(iso1) = '$code'")
  if [ "$have" = 0 ]; then
    echo "    no country polygon in the extract — taking its regions (level 3/4, $upper-…)"
    osmium tags-filter "$pbf" r/admin_level=3 r/admin_level=4 -o "$slug.reg.pbf" -f pbf --overwrite
    osmium export "$slug.reg.pbf" -f geojsonseq --geometry-types=polygon \
      --config=export-bnd.json -o "$slug.reg.geojsonl" --overwrite
    stage "$slug.reg.geojsonl" osm_country_staging \
      ".properties.boundary == \"administrative\" and (.properties.admin_level == \"3\" or .properties.admin_level == \"4\") and ((.properties[\"ISO3166-2\"] // \"\") | startswith(\"$upper-\"))"
  fi

  # 3. regions the extract clips.
  for entry in "${CLIPPED[@]}"; do
    [ "${entry#*:}" = "$code" ] || continue
    sub="${entry%%:*}"
    echo "    rebuilding $sub from the ways the extract holds"
    osmium tags-filter "$pbf" "r/ISO3166-2=$sub" -o "$slug.clip.pbf" -f pbf --overwrite
    osmium export "$slug.clip.pbf" -f geojsonseq --geometry-types=linestring \
      --keep-untagged --config=export-bnd.json -o "$slug.clip.geojsonl" --overwrite
    # Untagged ways carry no attributes, so the file has none to alias:
    # load it as it is and label it afterwards.
    ogr2ogr -f PostgreSQL "PG:$OGR_CONN" "$slug.clip.geojsonl" \
      -nln osm_country_lines_raw -overwrite -lco GEOMETRY_NAME=geom -nlt PROMOTE_TO_MULTI
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
      INSERT INTO osm_country_lines (iso2, geom)
        SELECT '$sub', ST_Multi(ST_LineMerge(ST_Force2D(geom)))::geometry(MultiLineString, 4326)
          FROM osm_country_lines_raw;
      DROP TABLE osm_country_lines_raw;"
  done
done 3<<< "$MEMBERS"

echo "→ building osm_country_area"
PGOPTIONS="-c camp.eu=$EU_ARRAY" psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q \
  -f "$HERE/build-country-area.sql"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "ANALYZE osm_country_area;"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "DROP TABLE IF EXISTS osm_country_staging, osm_country_lines;"

tag_layers

echo "  osm_country_area, one line per code the source emitted:"
psql "$DB_URL" -t -A -F ' ' -c \
  "SELECT iso, count(*) AS pieces, round(sum(ST_Area(geom::geography)) / 1e6) AS km2 FROM osm_country_area GROUP BY iso ORDER BY iso"

# 🔴 Reconciled against something this table did not produce: where the
# campsites are. Their country comes from the Geofabrik extract they were
# imported from, not from these polygons, so a polygon that is truncated,
# misplaced or missing a territory shows up here as live campsites outside
# every polygon. A few hundred metres is a coastline; kilometres is a hole.
if [ "$(count_rows "SELECT to_regclass('public.camping_spots') IS NOT NULL")" = t ]; then
  far=$(count_rows "
    SELECT count(*) FROM camping_spots s
     WHERE s.missing_since IS NULL
       AND NOT EXISTS (SELECT 1 FROM osm_country_area a
                        WHERE a.geom && ST_Expand(s.location::geometry, 0.02)
                          AND ST_DWithin(a.geom::geography, s.location, 2000))")
  echo "  live campsites more than 2 km from every polygon: $far (expected 0)"
fi

echo "✓ osm_country_area ready in $(( $(date +%s) - started )) s"
