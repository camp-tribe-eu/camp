#!/usr/bin/env bash
# CAMP-33: the OSM layers a campsite's surroundings are measured against.
#
#   ./scripts/osm-pipeline/load-context.sh europe/slovenia
#   ./scripts/osm-pipeline/load-context.sh europe/slovenia europe/croatia europe/france
#
# 🔴 PASS EVERY REGION YOU WANT, EVERY TIME.
#
# ogr2ogr runs with -overwrite, so each run REPLACES the three tables
# rather than adding to them. Loading France on its own would silently
# drop Slovenia and Croatia, and the next compute-context run would
# measure their campsites against a country that is no longer there —
# the same silent-wrong-data shape the row check below exists to stop,
# arriving through the front door instead.
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
  # 🔴 Fetch, verify, and on a checksum failure fetch again — ONCE.
  #
  # The old code deleted the bad file and told a person to "run again for
  # a clean download". That reads like a safe default and is not a
  # process: Geofabrik re-cuts every extract daily, so a list of 27
  # regions downloaded yesterday fails this check 27 times, once per run,
  # and somebody has to start the script 27 times to get through it.
  # Measured 25.09.2026 on europe/austria: yesterday's 810 746 083 bytes
  # against today's 810 840 932, resumed, spliced, and correctly refused.
  #
  # The retry is deliberately blind to WHY the first attempt failed — a
  # resumed splice, a truncation and a corrupt transfer all have the same
  # cure, and guessing between them would only add a way to guess wrong.
  # Twice and no more: a checksum that fails on a file we fetched from
  # scratch is not a transfer problem, and looping would hide it.
  fetch_verified() {
    local attempt=$1
    local resume=$2

    if [ "$resume" = 'resume' ]; then
      curl -sSL -C - --retry 5 --retry-delay 10 -o "$SLUG.osm.pbf" "$URL"
    else
      rm -f "$SLUG.osm.pbf"
      curl -sSL --retry 5 --retry-delay 10 -o "$SLUG.osm.pbf" "$URL"
    fi

    # 🔴 The expected size is re-read here, not reused from before the
    # download. A re-cut that lands mid-transfer changes it, and
    # comparing against a stale number would report a size failure for a
    # file that is perfectly whole.
    local remote
    remote=$(curl -sL -D - -o /dev/null --range 0-0 --max-time 60 "$URL" \
      | awk -F'/' '/[Cc]ontent-[Rr]ange/ {gsub(/\r/,"",$2); print $2}')
    local local_size
    local_size=$(wc -c < "$SLUG.osm.pbf" | tr -d ' ')
    if [ "$local_size" != "${remote:-0}" ]; then
      echo "  attempt $attempt: $local_size bytes, Geofabrik says ${remote:-unknown}" >&2
      return 1
    fi

    local expect got
    expect=$(curl -sSL --max-time 60 "$URL.md5" | awk '{print $1}')
    if [ -z "$expect" ]; then
      echo "::error::no .md5 published for $REGION — refusing to trust the download" >&2
      exit 1
    fi
    if command -v md5sum >/dev/null 2>&1; then
      got=$(md5sum "$SLUG.osm.pbf" | awk '{print $1}')
    else
      got=$(md5 -q "$SLUG.osm.pbf")
    fi
    if [ "$got" != "$expect" ]; then
      echo "  attempt $attempt: checksum $got, expected $expect" >&2
      return 1
    fi
    return 0
  }

  LOCAL_SIZE=0
  [ -f "$SLUG.osm.pbf" ] && LOCAL_SIZE=$(wc -c < "$SLUG.osm.pbf" | tr -d ' ')

  if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
    if [ "$LOCAL_SIZE" -gt 0 ]; then
      echo "→ $REGION (have $LOCAL_SIZE of $REMOTE_SIZE bytes, resuming)"
    else
      echo "→ $REGION ($REMOTE_SIZE bytes)"
    fi

    # First attempt resumes, because on a multi-gigabyte extract that is
    # the difference between a retry and another three hours.
    if ! fetch_verified 1 resume; then
      echo "  resumed copy is not the file Geofabrik has — starting clean"
      if ! fetch_verified 2 clean; then
        echo "::error::$REGION failed twice, the second time from scratch." >&2
        echo "          That is not a transfer problem — look at the source." >&2
        exit 1
      fi
    fi
    echo "  checksum ok"
  fi

  # 🔴 No streams. The comment at the top of this file has said so since
  # CAMP-33, but the filter kept taking them anyway — and compute-context
  # never asks for them (`x.waterway = 'river'`, nothing else). Measured
  # on the Slovenia+Croatia layers before France was loaded: 39 585 of
  # 82 278 water rows were streams, 48% of the table, read by nothing.
  #
  # On a 313 MB extract that is waste. On France's 4.74 GB it is waste
  # that has to be exported, parsed and indexed first, and France has far
  # more streams than Slovenia has anything.
  osmium tags-filter "$SLUG.osm.pbf" -o "$SLUG.water.pbf" --overwrite \
    n/natural=water w/natural=water r/natural=water \
    w/waterway=river w/natural=coastline
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
  #
  # 🔴 GeoJSONSeq (one feature per line), not one big GeoJSON object.
  #
  # The count below used to be `python3 -c "json.load(...)"`, which holds
  # the entire export in memory. That was fine for Slovenia. France is
  # 4.74 GB of source data and its water export is not something to load
  # into a Python dict on a 16 GB machine — the check meant to protect
  # the load would have been the thing that killed it.
  #
  # One feature per line makes the count `wc -l`, which is O(1) memory
  # whatever the country, and GDAL reads the format natively.
  osmium export "merged.$name.pbf" -o "ctx_$name.geojsonl" \
    --overwrite -f geojsonseq -u type_id

  ogr2ogr -f PostgreSQL "PG:$OGR_CONN" "ctx_$name.geojsonl" \
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
  expected=$(wc -l < "ctx_$name.geojsonl" | tr -d ' ')
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
