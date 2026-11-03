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
  curl -fsL -I --max-time "${2:-15}" --retry 1 --retry-delay 3 \
    -o /dev/null -w '%{url_effective}' "$1"
}

# 🔴 Скільки проб завершились таймаутом. Потрібне в кінці, щоб остання
# фраза не звинувачувала Geofabrik у тому, що він нічого не опублікував,
# коли насправді ми просто жодної відповіді не дочекались.
TIMEOUTS=0

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
  # 🔴 ТАЙМАУТ — ОКРЕМИЙ ВИПАДОК, І ЦЕ КОШТУВАЛО НАМ ТИЖНІВ.
  #
  # Заміряно 03.11.2026: тижневий імпорт Німеччини падав із
  # `curl exited 28 on germany-261103.osm.pbf`. Проба САМЕ СЬОГОДНІШНЬОГО
  # файлу спекулятивна — його зазвичай ще не вирізали, — і її таймаут
  # убивав увесь прогін для найбільшої країни, хоч `germany-261102` лежав
  # поруч із чинним md5 і віком D-1.
  #
  # Тобто запобіжник коштував дорожче за дефект, від якого боронив.
  # Правило проєкту тут читається дослівно: площа ураження сторожа не
  # має перевищувати площу дефекту.
  #
  # Що змінено, і тільки це: 28 (таймаут) отримує ОДНУ повторну спробу з
  # удвічі більшою стелею, і якщо вона теж мовчить — кандидат вважається
  # НЕВИЗНАЧЕНИМ, а не відсутнім, і цикл іде до старішого. Решта кодів
  # (6 — DNS, 7 — зʼєднання) падають одразу, як і раніше: вони стосуються
  # хоста, а не кандидата, тож наступна проба дасть те саме, і мовчазний
  # обхід перетворив би аварію мережі на «нічого не опубліковано».
  #
  # 🔴 Чому відступ безпечний. Вік друкується третім полем і доходить до
  # виклику: `osm-weekly.yml` передає `--max-age-days 9`, а STALE_FROM
  # кричить із D-4. Тобто протухле не може проїхати мовчки — його
  # зупиняє окремий замок, не цей.
  if [ "$rc" = 28 ]; then
    echo "::warning::$REGION: проба $YMD мовчала 15 с — повторюю з 30 с" >&2
    set +e
    FINAL=$(probe "$CAND" 30)
    rc=$?
    set -e
  fi

  case "$rc" in
    0) ;;
    22) continue ;;
    28)
      TIMEOUTS=$((TIMEOUTS + 1))
      echo "::warning::$REGION: $YMD лишився невизначеним (таймаут двічі) — беру старіший" >&2
      continue
      ;;
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
  if ! grep -qE "/${BASE}-${YMD}\.osm\.pbf$" <<<"$FINAL"; then
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
# 🔴 І ОСТАННЯ ФРАЗА НЕ СМІЄ БРЕХАТИ ПРО ПРИЧИНУ.
#
# Якщо жодна проба не дала відповіді, «нічого не опубліковано» — це
# твердження про Geofabrik, якого ми не перевіряли. Саме таке злиття
# подій цей файл і виправляв на рівень нижче.
if [ "$TIMEOUTS" -gt 0 ]; then
  echo "::error::$REGION: $TIMEOUTS із $((BACK + 1)) проб завершились таймаутом, решта не знайшлась — це мережа, а не відсутність файлу" >&2
  exit 1
fi
echo "::error::$REGION: no dated extract in the last $((BACK + 1)) days (tried ${BASE}-YYMMDD from D-0 to D-$BACK) — nothing published that recently" >&2
exit 1
