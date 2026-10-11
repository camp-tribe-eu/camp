#!/usr/bin/env bash
# One region in, one DATED Geofabrik URL out. The only place that decides
# which extract file we are allowed to download.
#
#   ./geofabrik-url.sh europe/germany [max-days-back]
#   → prints "<url> <yymmdd> <days-back>" on stdout
#
# 🔴 WHY THIS FILE EXISTS (CAMP-267), AND WHY IT IS NOT A TIDY-UP.
#
# The rule lived in TWO places, and they were fixed in OPPOSITE
# directions by two people who never saw each other's work:
#
#   .github/workflows/osm-weekly.yml  demanded a dated name, so the
#       weekly import died on Germany and stayed dead 13 days.
#   scripts/osm-pipeline/load-context.sh  hit the same wall on
#       25.09.2026 and RELAXED its rule to accept `-latest` too —
#       which means it happily downloads the mirror's undated file and
#       cannot say which day's data it just loaded.
#
# One of those is an outage and the other is silent data of unknown age.
# Neither file says it has a twin. Hence: one script, called by both.
#
# 🔴 AND THE RELAXATION WAS THE WRONG DIRECTION. `-latest` is not
# needed: the dated file exists on the main host for every region,
# Germany included (measured 11.10.2026, all 27 EU countries). Asking
# for the name we want is strictly stronger than following a redirect
# and hoping.

set -euo pipefail

REGION="${1:?usage: geofabrik-url.sh <region> [max-days-back]}"
BACK="${2:-7}"
HOST="https://download.geofabrik.de"
BASE="${REGION##*/}"

# 🔴 Measured 11.10.2026 across all 27: 24 countries at D-3, three at
# D-2. So D-0..D-3 is the normal band and anything older means Geofabrik
# itself is behind. `-latest` could never hand back a stale file — it is
# always the newest — so a window without this warning would be a
# REGRESSION in loudness, not a fix. Review caught exactly that.
STALE_FROM="${GEOFABRIK_STALE_FROM:-4}"

probe() {
  # -s without -S: a miss is expected (today's file usually does not
  # exist yet). The exit code carries the difference, and the caller
  # reads it — see below.
  curl -fsL -I --max-time 15 --retry 1 --retry-delay 3 \
    -o /dev/null -w '%{url_effective}' "$1"
}

for d in $(seq 0 "$BACK"); do
  YMD=$(date -u -d "-$d day" +%y%m%d 2>/dev/null || date -u -v-"${d}"d +%y%m%d)
  CAND="$HOST/$REGION-$YMD.osm.pbf"

  set +e
  FINAL=$(probe "$CAND")
  rc=$?
  set -e

  # 🔴 A MISSING FILE AND A BROKEN NETWORK ARE NOT THE SAME EVENT.
  #
  # With a bare `|| continue` they were: review reproduced 404, DNS
  # failure, a 200 landing on the site root and an empty body all
  # producing the SAME final sentence, "Geofabrik layout or the region
  # name has changed" — a diagnosis for three cases nobody checked.
  # curl's 22 is "HTTP >= 400", which is the only one that means "not
  # published yet". Everything else stops here and says what it was.
  case "$rc" in
    0) ;;
    22) continue ;;
    *)
      echo "::error::$REGION: curl exited $rc on $CAND — that is a transport failure, not a missing file" >&2
      exit 1
      ;;
  esac

  # A 302 onto the site index also answers 200, so the only thing that
  # proves identity is the name we end up on.
  #
  # 🔴 AND A MISMATCH IS NOT A MISS. Landing on Geofabrik's index, or on
  # another country's extract, is a different event from "today's file
  # is not cut yet", and folding both into "no dated extract in N days"
  # is the same collapse review caught one layer down. The first
  # mismatch is kept and named at the end, so the message says what was
  # actually seen.
  if ! printf '%s' "$FINAL" | grep -qE "/${BASE}-${YMD}\.osm\.pbf$"; then
    [ -z "${MISMATCH:-}" ] && MISMATCH="$FINAL"
    continue
  fi

  if [ "$d" -ge "$STALE_FROM" ]; then
    echo "::warning::$REGION: newest extract is $YMD, $d days old — Geofabrik is behind, the data we publish is too" >&2
  fi
  printf '%s %s %s\n' "$CAND" "$YMD" "$d"
  exit 0
done

if [ -n "${MISMATCH:-}" ]; then
  echo "::error::$REGION resolves to $MISMATCH" >&2
  echo "          That is not an extract named for '$BASE'. Either the" >&2
  echo "          region name is wrong or Geofabrik has moved it." >&2
  exit 1
fi
echo "::error::$REGION: no dated extract in the last $((BACK + 1)) days (tried ${BASE}-YYMMDD from D-0 to D-$BACK) — nothing published that recently" >&2
exit 1
