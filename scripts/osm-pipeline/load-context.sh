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
# 🔴 `${HOME:-}` and an explicit check, not `$HOME` bare.
#
# `set -u` catches HOME being UNSET, with a message naming neither the
# cause nor the cure. It does NOT catch HOME being EMPTY — and then
# `$HOME/camptribe-osm` is `/camptribe-osm`, a mkdir at the filesystem
# root, which fails on macOS and SUCCEEDS in a container running as
# root. Cron, launchd and containers without a passwd entry all reach
# here, so this is not a theoretical shell.
if [ -z "${WORK_DIR:-}" ] && [ -z "${HOME:-}" ]; then
  echo "::error::neither WORK_DIR nor HOME is set, so there is nowhere to put" >&2
  echo "          the extracts. Pass WORK_DIR=/somewhere/with/room." >&2
  exit 1
fi
WORK_DIR="${WORK_DIR:-$HOME/camptribe-osm}"
REGIONS=("$@")

if [ ${#REGIONS[@]} -eq 0 ]; then
  echo "Usage: $0 <geofabrik-path> [more…]    e.g. europe/slovenia" >&2
  exit 1
fi

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# 🔴 One run at a time in a work directory.
#
# Two runs sharing one WORK_DIR corrupt each other two ways: both write
# the same .osm.pbf (one’s fresh download lands under the other’s
# osmium), and both `ogr2ogr -overwrite` the same three tables while
# each checks the row count against its own export. Measured: two
# concurrent Malta runs ended with `osm_ctx_water holds 5078 rows but
# the export had 2539` — exactly twice, two loads into one table. That
# was loud only because the counts happened to disagree.
#
# mkdir, not flock: mkdir is atomic on every filesystem we care about
# and macOS ships no flock binary. The PID inside lets a later run tell
# a crashed lock from a live one, and say which it was.
LOCK_DIR="$WORK_DIR/.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo '?')
  if [ "$OWNER" != '?' ] && kill -0 "$OWNER" 2>/dev/null; then
    echo "::error::another load-context run (pid $OWNER) is using $WORK_DIR." >&2
    echo "          Wait for it, or pass a different WORK_DIR." >&2
    exit 1
  fi
  echo "  a previous run (pid $OWNER) left a lock behind and is gone — taking it" >&2
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || { echo "::error::cannot lock $WORK_DIR" >&2; exit 1; }
fi
echo $$ > "$LOCK_DIR/pid"
# Released on every exit, including the `exit 1`s below and a Ctrl-C.
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

MERGE_WATER=() MERGE_PLACE=() MERGE_POI=()

# 🔴 Size and mtime of a file, printed as "<bytes> <epoch>".
#
# GNU FIRST, and that order is the whole correctness of this function.
#
# The previous version tried `stat -f` first "because BSD and GNU
# disagree about flags". They do — but GNU's `-f` is `--file-system`,
# a perfectly valid option with a different meaning, and coreutils
# prints `?` for a directive it does not recognise and **exits 0**
# (src/stat.c: `print_statfs` initialises `bool fail = false`, assigns
# it nowhere, and `default:` does `fputc('?')` then `break`). So on
# Linux every file fingerprinted as "? ?" and the `||` never reached
# the GNU form — which quietly reduced the marker to "the md5 we saw
# once", exactly the check this was added to strengthen. Found in
# review; confirmed against the coreutils source, not assumed.
#
# BSD genuinely rejects `-c` (`stat: illegal option -- c`, exit 1,
# measured), so GNU-then-BSD is right on both.
#
# 🔴 And it FAILS CLOSED. The old fallback was `|| echo 'unknown'`,
# under a comment claiming "no fingerprint, no skip" — the reverse of
# what it did: `unknown` was written into the marker and matched
# `unknown` next run, so two different files compared equal. A
# fingerprint we could not take must stop the skip, not stand in for it.
file_fingerprint() {
  stat -c '%s %Y' "$1" 2>/dev/null && return 0
  stat -f '%z %m' "$1" 2>/dev/null && return 0
  echo "::error::cannot read size and mtime of $1 — refusing to trust any marker beside it" >&2
  return 1
}

# 🔴 Fetch one extract and prove it is the file Geofabrik published.
#
# Defined once, above the loop, and told everything it needs. It used to
# live inside the loop and read $SLUG and $URL as globals — correct, but
# redefined twenty-seven times and inviting a reader to assume capture.
#
# \U0001f534 Three outcomes, not two:
#   0  the file on disk matches the published md5
#   1  the transfer failed — the partial file is WORTH KEEPING
#   2  the bytes arrived and are not what Geofabrik published
#
# They used to be indistinguishable, and the caller deleted the file
# either way while printing "that is not a transfer problem — look at
# the source". France is 4.7 GB and about three hours: a link that drops
# twice in one run then left nothing to resume from, so a flaky
# connection could never accumulate progress. That treadmill is the
# thing this card was opened to remove.
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
    return 2
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
  # \U0001f534 --retry here too. This request and the .md5 one below are
  # small, but there are two of them per region and they run BEFORE the
  # skip check \u2014 so a fully cached 27-region run still makes 54 of them.
  # Without a retry, one blink of the network ends the whole run, and
  # the message it ends with blames Geofabrik.
  HEAD_OUT=$(curl -fsSL -I --retry 3 --retry-delay 5 --max-time 60 \
               -w '\n%{url_effective}\n' "$LATEST") || {
    echo "::error::could not reach Geofabrik for $REGION" >&2
    exit 1
  }
  URL=$(printf '%s' "$HEAD_OUT" | tail -1)
  REMOTE_SIZE=$(printf '%s' "$HEAD_OUT" |
    awk 'tolower($1)=="content-length:"{n=$2} END{gsub(/\r/,"",n); print n+0}')

  # \U0001f534 The redirect has to still be the region we asked for.
  #
  # An md5 proves INTEGRITY, never IDENTITY: it says "these bytes are
  # the bytes published at this URL", and says nothing about the URL
  # being the one we wanted. Geofabrik answers an unknown or renamed
  # region with a 302 to its site index \u2014 measured: europe/atlantis,
  # europe/holland and europe/england all land on
  # https://download.geofabrik.de/ with HTTP 200, so `curl -f` does not
  # fail and the run dies later blaming a missing .md5. A redirect onto
  # a DIFFERENT extract would be worse: it would download, verify and
  # load another country's data under a \u2713.
  REGION_BASE="${REGION##*/}"
  if ! printf '%s' "$URL" | grep -qE "/${REGION_BASE}-[0-9]{6}\.osm\.pbf$"; then
    echo "::error::$REGION resolves to $URL" >&2
    echo "          That is not a dated extract for '$REGION_BASE'. Either the" >&2
    echo "          region name is wrong or Geofabrik has moved it." >&2
    exit 1
  fi

  # 🔴 -f, so an HTTP error page cannot become the expected checksum.
  # Without it a 404 body — "<html><head><title>404…" — is a non-empty
  # string, sails past the emptiness check, and costs a full re-download
  # before the script gives up with the wrong reason.
  EXPECT_MD5=$(curl -fsSL --retry 3 --retry-delay 5 --max-time 60 "$URL.md5" |
    awk '{print $1}') || EXPECT_MD5=''
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
  # 🔴 The fingerprint is taken into a VARIABLE and checked, never
  # spliced straight into the comparison.
  #
  # `[ "$(cat "$STAMP")" = "$MD5 $(file_fingerprint "$PBF")" ]` fails
  # closed — but the matching `printf ... > "$STAMP"` did not: a failed
  # fingerprint wrote "<md5> " into the marker, and next run the same
  # failure produced the same empty string and the two MATCHED. The
  # fail-open hole simply moved from the read to the write. Nothing may
  # be written that we could not also verify.
  HAVE_FP=''
  if [ -f "$PBF" ]; then
    HAVE_FP="$(file_fingerprint "$PBF")" || HAVE_FP=''
  fi

  if [ -n "$HAVE_FP" ] && [ -f "$STAMP" ] &&
     [ "$(cat "$STAMP")" = "$EXPECT_MD5 $HAVE_FP" ]; then
    echo "→ $REGION (already verified)"
  else
    # The marker is removed first, so an interrupted run can never leave
    # a stale proof beside a half-written file.
    rm -f "$STAMP"
    if [ -f "$PBF" ]; then
      # 🔴 Say what is on disk and what is coming. `-s` gives curl no
      # voice, and a bare "→ europe/france" in front of three silent
      # hours is indistinguishable from a hung transfer — which matters
      # precisely because the operator's instinct is then to kill it.
      echo "→ $REGION (have $(wc -c < "$PBF" | tr -d ' ') of $REMOTE_SIZE bytes, resuming)"
    else
      echo "→ $REGION ($REMOTE_SIZE bytes)"
    fi

    fetch_verified 1 resume "$URL" "$PBF" "$EXPECT_MD5" && RC=0 || RC=$?
    if [ "$RC" -ne 0 ]; then
      if [ "$RC" -eq 2 ]; then
        echo "  resumed copy is not the file Geofabrik has — starting clean" >&2
      else
        echo "  transfer failed — starting clean" >&2
      fi
      fetch_verified 2 clean "$URL" "$PBF" "$EXPECT_MD5" && RC=0 || RC=$?
    fi

    if [ "$RC" -eq 2 ]; then
      # 🔴 Deleted only when the BYTES ARE WRONG. A rejected file of
      # the right length is a trap for anything else reading this
      # directory, and keeping it buys nothing.
      rm -f "$PBF"
      echo "::error::$REGION: the bytes that arrived are not what Geofabrik publishes." >&2
      echo "          Checked twice, the second time from scratch, and deleted." >&2
      echo "          That is not a transfer problem — look at the source." >&2
      exit 1
    elif [ "$RC" -ne 0 ]; then
      # 🔴 Kept. The transfer never finished, so what is on disk is a
      # prefix of the right file and the next run resumes from it. The
      # marker is already gone, so nothing vouches for it.
      echo "::error::$REGION: the download did not complete, twice." >&2
      echo "          What arrived has been KEPT — the next run resumes from it." >&2
      echo "          Nothing vouches for it: the marker was removed first." >&2
      exit 1
    fi

    NEW_FP="$(file_fingerprint "$PBF")" || {
      echo "::error::$REGION verified, but its size and mtime could not be read." >&2
      echo "          No marker written, so the next run will verify again." >&2
      exit 1
    }
    printf '%s %s' "$EXPECT_MD5" "$NEW_FP" > "$STAMP"
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
