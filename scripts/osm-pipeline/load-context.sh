#!/usr/bin/env bash
# CAMP-33: the OSM layers a campsite's surroundings are measured against.
#
#   ./scripts/osm-pipeline/load-context.sh europe/slovenia
#   ./scripts/osm-pipeline/load-context.sh europe/slovenia europe/austria
#
# Then:
#   cd apps/api && npx ts-node src/osm/compute-context.ts
#
# Three layers, because a campsite is described by different things:
#
#   water   lakes, reservoirs, rivers and the coastline. 🔴 NOT streams:
#           the Slovenian extract holds 26,654 streams against 338 lakes,
#           so "nearest water" including them is almost always a drainage
#           ditch a few metres away. Measured on Camping Bled, that rule
#           is the difference between "98 m from an unnamed stream" and
#           "365 m from Lake Bled" — the second is the true statement a
#           person is looking for.
#   places  city and town only. Villages are 4,000+ in Slovenia alone and
#           "1.2 km from a hamlet of forty people" helps nobody.
#   poi     supermarkets and railway stations — the two errands that
#           decide whether a site works without a car.
#
# The filters keep ways and relations, not just nodes, because a lake is
# a polygon and distance to its shore is the number that matters.

set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"

# shellcheck source=_pgconn.sh
. "$(dirname "$0")/_pgconn.sh"
OGR_CONN="$(pg_conninfo "$DB_URL")"
WORK_DIR="${WORK_DIR:-/tmp/camptribe-context}"
REGIONS=("$@")

if [ ${#REGIONS[@]} -eq 0 ]; then
  echo "Usage: $0 <geofabrik-path> [more…]    e.g. europe/slovenia" >&2
  exit 1
fi

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

MERGE_WATER=() MERGE_PLACE=() MERGE_POI=()

for REGION in "${REGIONS[@]}"; do
  SLUG="$(echo "$REGION" | tr '/' '-')"

  URL="https://download.geofabrik.de/$REGION-latest.osm.pbf"

  # 🔴 The expected size comes from Geofabrik, every run.
  #
  # A one-byte ranged GET returns `Content-Range: bytes 0-0/<total>`;
  # a HEAD is answered with a 302 and no length, which is why it is done
  # this way. France is 5 087 360 116 bytes, Slovenia 313 211 467.
  REMOTE_SIZE=$(curl -sL -D - -o /dev/null --range 0-0 --max-time 60 "$URL" \
    | awk -F'/' '/[Cc]ontent-[Rr]ange/ {gsub(/\r/,"",$2); print $2}')
  if ! [ "${REMOTE_SIZE:-0}" -gt 100000 ] 2>/dev/null; then
    echo "::error::could not read the size of $REGION from Geofabrik" >&2
    exit 1
  fi

  # 🔴 A PARTIAL DOWNLOAD IS NOT A DOWNLOAD.
  #
  # The old check was `[ ! -f "$SLUG.osm.pbf" ]` plus "is it at least
  # 100 kB". An interrupted transfer leaves a large, plausible file that
  # passes both — and France's extract takes hours, so an interruption is
  # not a remote possibility, it is the expected case. osmium may or may
  # not notice a truncated PBF; if it does not, the layers come out
  # quietly incomplete and every distance computed against them is wrong
  # in a way nothing downstream can see.
  LOCAL_SIZE=0
  [ -f "$SLUG.osm.pbf" ] && LOCAL_SIZE=$(wc -c < "$SLUG.osm.pbf" | tr -d ' ')

  if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
    if [ "$LOCAL_SIZE" -gt 0 ]; then
      echo "→ $REGION (have $LOCAL_SIZE of $REMOTE_SIZE bytes, resuming)"
    else
      echo "→ $REGION ($REMOTE_SIZE bytes)"
    fi
    # -L: Geofabrik answers 302 and curl without it writes a 244-byte
    # HTML page that osmium then rejects with something unhelpful.
    # -C -: resume rather than start again, which on a multi-gigabyte
    # extract is the difference between a retry and another three hours.
    curl -sSL -C - --retry 5 --retry-delay 10 \
      -o "$SLUG.osm.pbf" "$URL"

    LOCAL_SIZE=$(wc -c < "$SLUG.osm.pbf" | tr -d ' ')
    if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
      echo "::error::$REGION is $LOCAL_SIZE bytes, Geofabrik says $REMOTE_SIZE" >&2
      exit 1
    fi
  fi

  osmium tags-filter "$SLUG.osm.pbf" -o "$SLUG.water.pbf" --overwrite \
    n/natural=water w/natural=water r/natural=water \
    w/waterway=river w/waterway=stream w/natural=coastline
  osmium tags-filter "$SLUG.osm.pbf" -o "$SLUG.place.pbf" --overwrite \
    n/place=city n/place=town n/place=village
  osmium tags-filter "$SLUG.osm.pbf" -o "$SLUG.poi.pbf" --overwrite \
    n/shop=supermarket w/shop=supermarket \
    n/railway=station n/railway=halt

  MERGE_WATER+=("$SLUG.water.pbf")
  MERGE_PLACE+=("$SLUG.place.pbf")
  MERGE_POI+=("$SLUG.poi.pbf")
done

load_layer() {
  local name="$1"; shift
  local files=("$@")

  if [ ${#files[@]} -gt 1 ]; then
    osmium merge "${files[@]}" -o "merged.$name.pbf" --overwrite
  else
    cp "${files[0]}" "merged.$name.pbf"
  fi

  # -u type_id gives every feature a stable id; nothing upserts on it
  # here, but it makes a row traceable back to the OSM object.
  osmium export "merged.$name.pbf" -o "ctx_$name.geojson" \
    --overwrite -f geojson -u type_id

  ogr2ogr -f PostgreSQL "PG:$OGR_CONN" "ctx_$name.geojson" \
    -nln "osm_ctx_$name" -overwrite \
    -lco GEOMETRY_NAME=geom -nlt PROMOTE_TO_MULTI -lco SPATIAL_INDEX=GIST

  # 🔴 Check that the rows actually arrived, and fail loudly if not.
  #
  # ogr2ogr can print "ERROR 1" and still leave the previous table in
  # place. That happened: the layers kept their old, Slovenia-only
  # contents while the script reported nothing wrong, and the next step
  # would have measured every Croatian campsite's surroundings against a
  # country that was not there. A load that silently does nothing is the
  # worst possible outcome, because everything downstream still runs.
  local expected n
  expected=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['features']))" "ctx_$name.geojson")
  n=$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM osm_ctx_$name;" 2>/dev/null || echo 0)
  if [ "$n" != "$expected" ]; then
    echo "::error::osm_ctx_$name holds $n rows but the export had $expected — the load did not take" >&2
    exit 1
  fi
  echo "  osm_ctx_$name: $n features"
}

echo "→ loading layers"
load_layer water "${MERGE_WATER[@]}"
load_layer place "${MERGE_PLACE[@]}"
load_layer poi   "${MERGE_POI[@]}"

echo "✓ context layers ready — now run:"
echo "    cd apps/api && npx ts-node src/osm/compute-context.ts"
