#!/usr/bin/env bash
# CAMP-113: the services a driver needs BETWEEN campsites.
#
#   ./scripts/osm-pipeline/load-route-poi.sh
#   ./scripts/osm-pipeline/load-route-poi.sh europe/slovenia europe/croatia
#
# With no arguments it uses every `*.osm.pbf` already in WORK_DIR, which
# after a full load-context.sh run is the EU-27. It does NOT download
# anything: load-context.sh owns the downloading, the checksums and the
# "is this the file I verified" marker, and a second copy of that logic
# is a second place for it to go wrong.
#
# 🔴 THE NO-ARGUMENT FORM IS THE SAFE ONE. READ THIS BEFORE PASSING A
# REGION.
#
# `load-route-poi.ts` deletes every row this run did not see, because
# that is how a point removed from OpenStreetMap stops being published.
# So naming two countries does not ADD two countries — it replaces the
# table with those two and removes the other twenty-five, and the route
# pages then say "our database holds no fuel station within 25 km" all
# across Europe, which reads exactly like an honest gap.
#
# load-context.sh has the same shape and its header spends thirty lines
# warning about it, because it happened. The difference here is the
# DEFAULT: with no arguments this takes everything in WORK_DIR, so the
# ordinary run is the correct one and you have to type a region to get
# the dangerous one. Arguments are for a scratch database.
#
# 🔴 THIS SCRIPT DOES NOT TOUCH osm_ctx_water / osm_ctx_place /
# osm_ctx_poi. Those three are `ogr2ogr -overwrite`d by load-context.sh
# and read by compute-context.ts. Everything here lives in
# `osm_route_poi_staging` (ours, overwritable) and `osm_route_poi`
# (declared by a TypeORM migration, written transactionally).
#
# 🔴 Why this exists at all, rather than a query over osm_ctx_poi.
# Measured 28.09.2026: osm_ctx_poi holds 252 858 rows, and all of them
# are supermarkets (214 906) or railway stations and halts (37 389).
# CAMP-33 built it to answer "does this campsite work without a car" and
# load-context.sh exports only `name`, `shop`, `railway`. There is no
# fuel, no charging, no water, no dump station and no contact field in
# it — so there was nothing to query.
#
# Then:
#   cd apps/api && npx ts-node src/osm/load-route-poi.ts
# (this script runs that for you at the end)
#
# 🔴 NOT WIRED INTO .github/workflows/osm-weekly.yml, DELIBERATELY.
#
# That workflow builds a campsite-only extract, publishes it as a release
# asset and leaves the import to a person on the machine that holds the
# database. Adding a second, much larger layer to it is a change to the
# release format and to what the owner downloads every Monday — a
# decision with a cost, not a detail to slip into this card. Until it is
# made, refreshing these rows is this script, run by hand against the
# extracts load-context.sh already has on disk. `last_seen_at` records
# when each row was last confirmed, so the staleness is measurable rather
# than assumed.
#
# Cost on the machine this was built on, 28.09.2026: about 9 minutes of
# osmium over the 27 extracts, and 3 m 37 s of the point-in-polygon pass
# that enforces the EU-27 scope. The extracts themselves are already
# there — nothing is downloaded.
set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"

# shellcheck source=_pgconn.sh
. "$(dirname "$0")/_pgconn.sh"
OGR_CONN="$(pg_conninfo "$DB_URL")"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Same directory and the same reasoning as load-context.sh: NOT /tmp,
# where 22 GB were lost on 25.09.2026.
if [ -z "${WORK_DIR:-}" ] && [ -z "${HOME:-}" ]; then
  echo "::error::neither WORK_DIR nor HOME is set, so there is nowhere to work." >&2
  exit 1
fi
WORK_DIR="${WORK_DIR:-$HOME/camptribe-osm}"
[ -d "$WORK_DIR" ] || { echo "::error::$WORK_DIR does not exist. Run load-context.sh first." >&2; exit 1; }
cd "$WORK_DIR"

# 🔴 The same mkdir lock load-context.sh takes, and for the same reason:
# two runs sharing a work directory write each other's intermediate files
# and each checks its own row count against the other's export. mkdir
# rather than flock — macOS ships no flock binary.
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

# 🔴 The tag list, and it must stay identical to ROUTE_POI_RULES in
# apps/api/src/osm/route-poi.ts. A tag filtered here and not classified
# there is a row loaded and thrown away; a tag classified there and not
# filtered here is a kind that silently holds nothing — which is the
# failure that does not announce itself. `load-route-poi.ts` fails if any
# kind ends up empty, which is the check that catches both directions.
FILTERS=(
  amenity=fuel
  amenity=charging_station
  amenity=drinking_water
  amenity=water_point
  man_made=water_tap
  amenity=sanitary_dump_station
  shop=supermarket
  shop=convenience
  amenity=restaurant
  amenity=cafe
  amenity=fast_food
  tourism=hotel
  tourism=motel
  tourism=hostel
  tourism=guest_house
)

TAG_ARGS=()
for f in "${FILTERS[@]}"; do
  # Nodes AND ways: a supermarket and a motorway services are usually
  # areas, and "the nearest shop" that skipped every building would be
  # wrong in a way nobody would spot from the page.
  TAG_ARGS+=("n/$f" "w/$f")
done

if [ $# -gt 0 ]; then
  SOURCES=()
  for region in "$@"; do SOURCES+=("${region//\//-}.osm.pbf"); done
else
  SOURCES=(*.osm.pbf)
fi

[ ${#SOURCES[@]} -gt 0 ] || { echo "::error::no .osm.pbf in $WORK_DIR" >&2; exit 1; }

PARTS=()
for pbf in "${SOURCES[@]}"; do
  [ -f "$pbf" ] || { echo "::error::$pbf is not in $WORK_DIR — load-context.sh downloads it" >&2; exit 1; }
  slug="${pbf%.osm.pbf}"
  echo "  → $slug"
  # 🔴 Written under a scratch name and renamed. osmium cannot infer a
  # format from a `.part` suffix, and a half-written file left by a
  # Ctrl-C would otherwise be indistinguishable from a finished one.
  osmium tags-filter "$pbf" -o "part.rpoi.pbf" -f pbf --overwrite "${TAG_ARGS[@]}"
  mv "part.rpoi.pbf" "$slug.rpoi.pbf"
  PARTS+=("$slug.rpoi.pbf")
done

if [ ${#PARTS[@]} -gt 1 ]; then
  osmium merge "${PARTS[@]}" -o merged.rpoi.pbf --overwrite
else
  cp "${PARTS[0]}" merged.rpoi.pbf
fi

# 🔴 Only the tags something reads. load-context.sh's header explains
# what happens without this: osmium writes every OSM tag as a property,
# ogr2ogr makes a column of each, and across the EU-27 that is past
# PostgreSQL's 1600-column ceiling — the load fails and the previous
# contents stay in place looking like data.
cat > export-rpoi.json <<'JSON'
{"include_tags":["name","amenity","shop","tourism","man_made",
"opening_hours","phone","contact:phone","website","contact:website","access"]}
JSON

osmium export merged.rpoi.pbf -o rpoi.geojsonl --config=export-rpoi.json \
  --overwrite -f geojsonseq -u type_id

ogr2ogr -f PostgreSQL "PG:$OGR_CONN" rpoi.geojsonl \
  -nln osm_route_poi_staging -overwrite \
  -lco GEOMETRY_NAME=geom -nlt PROMOTE_TO_MULTI -lco SPATIAL_INDEX=GIST

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "ANALYZE osm_route_poi_staging;"

# 🔴 ogr2ogr can print "ERROR 1" and still leave the previous table in
# place, which is how load-context.sh once computed a whole country's
# surroundings against a country that was no longer loaded.
expected=$(wc -l < rpoi.geojsonl | tr -d ' ')
n=$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM osm_route_poi_staging;" 2>/dev/null || echo 0)
if [ "$n" != "$expected" ]; then
  echo "::error::osm_route_poi_staging holds $n rows but the export had $expected — the load did not take" >&2
  exit 1
fi
echo "  staged: $n features"

cd "$REPO_ROOT/apps/api"
DATABASE_URL="$DB_URL" npx ts-node src/osm/load-route-poi.ts
