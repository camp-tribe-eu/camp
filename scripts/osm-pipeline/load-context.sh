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
# 🔴 NOT /tmp. Twenty-two gigabytes were lost there on 25.09.2026.
#
# The extracts are hours of downloading — France alone is 4.7 GB — and
# /tmp is cleared by the system, by a reboot, and by whatever tidies up
# after a process that exits. A default that quietly throws away a
# night's work is a bad default however convenient it reads.
#
# ~/camptribe-osm is on the home volume, survives a reboot, and is the
# one place a person would think to look for it.
WORK_DIR="${WORK_DIR:-$HOME/camptribe-osm}"
REGIONS=("$@")

if [ ${#REGIONS[@]} -eq 0 ]; then
  echo "Usage: $0 <geofabrik-path> [more…]    e.g. europe/slovenia" >&2
  exit 1
fi

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

MERGE_WATER=() MERGE_PLACE=() MERGE_POI=()

# 🔴 Fetch one extract and prove it is the file Geofabrik published.
#
# Defined once, above the loop, and told everything it needs. It used to
# live inside the loop and read $SLUG and $URL as globals — correct, but
# redefined twenty-seven times and inviting a reader to assume capture.
#
# Returns 0 only when the file on disk matches the published md5.
fetch_verified() {
  local attempt=$1 mode=$2 url=$3 path=$4 expect=$5

  if [ "$mode" = 'resume' ]; then
    # -C -: resume rather than start again, which on a multi-gigabyte
    # extract is the difference between a retry and another three hours.
    curl -fsSL -C - --retry 5 --retry-delay 10 -o "$path" "$url" || {
      echo "  attempt $attempt: download failed" >&2
      return 1
    }
  else
    rm -f "$path"
    curl -fsSL --retry 5 --retry-delay 10 -o "$path" "$url" || {
      echo "  attempt $attempt: download failed" >&2
      return 1
    }
  fi

  local got
  if command -v md5sum >/dev/null 2>&1; then
    got=$(md5sum "$path" | awk '{print $1}')
  else
    got=$(md5 -q "$path")
  fi
  if [ "$got" != "$expect" ]; then
    echo "  attempt $attempt: checksum $got, expected $expect" >&2
    return 1
  fi
  return 0
}

for REGION in "${REGIONS[@]}"; do
  SLUG="$(echo "$REGION" | tr '/' '-')"
  PBF="$SLUG.osm.pbf"
  # 🔴 What we have already proved about the file beside it.
  #
  # The gate used to be "is the file the expected number of bytes", and
  # that is how a rejected download became a silent success: a resumed
  # splice is EXACTLY the expected length (the comment below says so),
  # so a file the script had refused twice was skipped past the checksum
  # on the next run and loaded into PostGIS with "✓ context layers
  # ready". Found in review, and it was a regression I introduced.
  #
  # A marker holding the md5 we verified answers the right question —
  # "is this the file Geofabrik publishes NOW" — and answers it for one
  # cent instead of re-hashing five gigabytes on every run. A re-cut
  # changes the published md5, the marker stops matching, and the
  # extract is fetched again.
  STAMP="$SLUG.verified-md5"

  LATEST="https://download.geofabrik.de/$REGION-latest.osm.pbf"

  # 🔴 Resolve `-latest` ONCE, and use the dated URL for everything.
  #
  # `-latest` is a 302 to a dated file, so the download, the size and the
  # md5 were three independent requests that could each land on a
  # different version. A re-cut between them failed a perfectly whole
  # file and then reported "that is not a transfer problem", which is a
  # confident wrong diagnosis.
  URL=$(curl -fsSLI -o /dev/null -w '%{url_effective}' --max-time 60 "$LATEST") || {
    echo "::error::could not reach Geofabrik for $REGION" >&2
    exit 1
  }

  # 🔴 -f, so an HTTP error page cannot become the expected checksum.
  # Without it a 404 body — "<html><head><title>404…" — is a non-empty
  # string, sails past the emptiness check, and costs a full re-download
  # before the script gives up with the wrong reason.
  EXPECT_MD5=$(curl -fsSL --max-time 60 "$URL.md5" | awk '{print $1}') || EXPECT_MD5=''
  if ! printf '%s' "$EXPECT_MD5" | grep -qE '^[0-9a-f]{32}$'; then
    echo "::error::no usable .md5 for $REGION — refusing to trust the download" >&2
    exit 1
  fi

  # 🔴 The marker records the file it was written FOR, not just a hash.
  #
  # An md5 on its own only says "at some moment this file hashed to X".
  # If anything writes to the extract afterwards — a half-finished copy,
  # a disk fault, another process — the marker keeps vouching for a file
  # that has changed. Size and modification time cost nothing to read
  # and catch every accidental write, because any write moves mtime.
  #
  # It is not a defence against someone deliberately forging all three;
  # it is a defence against the file quietly not being what we checked.
  file_fingerprint() {
    # BSD stat and GNU stat disagree about flags, so both are tried.
    # The shell pipeline fails closed: no fingerprint, no skip.
    stat -f '%z %m' "$1" 2>/dev/null || stat -c '%s %Y' "$1" 2>/dev/null || echo 'unknown'
  }

  if [ -f "$PBF" ] && [ -f "$STAMP" ] &&
     [ "$(cat "$STAMP")" = "$EXPECT_MD5 $(file_fingerprint "$PBF")" ]; then
    echo "→ $REGION (already verified)"
  else
    # The marker is removed first, so an interrupted run can never leave
    # a stale proof beside a half-written file.
    rm -f "$STAMP"
    echo "→ $REGION"

    if ! fetch_verified 1 resume "$URL" "$PBF" "$EXPECT_MD5"; then
      echo "  resumed copy is not the file Geofabrik has — starting clean" >&2
      if ! fetch_verified 2 clean "$URL" "$PBF" "$EXPECT_MD5"; then
        # 🔴 Deleted, not left behind. The whole point of the marker is
        # that the next run re-checks — but a rejected file of the right
        # length is still a trap for anything else that reads this
        # directory, and keeping it buys nothing.
        rm -f "$PBF"
        echo "::error::$REGION failed twice, the second time from scratch." >&2
        echo "          The file has been deleted. That is not a transfer" >&2
        echo "          problem — look at the source." >&2
        exit 1
      fi
    fi
    printf '%s %s' "$EXPECT_MD5" "$(file_fingerprint "$PBF")" > "$STAMP"
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
