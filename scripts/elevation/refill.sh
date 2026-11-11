#!/bin/bash
# Добрати висоту новим кемпінгам — CAMP-493. Запускає таймер
# `camptribe-elevation.timer`; вручну: `DATABASE_URL=… bash refill.sh [--dry-run]`.
#
# 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. PR #534 (CAMP-484) прибрав із compute-context
# виклик api.open-meteo.com, який давав висоту кожному новому кемпінгу, і
# замінив його РАЗОВИМ заповненням. Разове спрацювало (на проді 0 без
# висоти із 57 135), але нічого не заповнювало НАДАЛІ: імпорт OSM щотижня
# приносить нові кемпінги, і кожен приходив без висоти, а сторінка просто
# мовчала — так само, як для місця, де даних справді немає.
#
# 🔴 СЕРЕДОВИЩЕ НЕ ЖИВЕ В ДЗЕРКАЛІ. Перше заповнення поставило venv
# усередину `/srv/camptribe/tools/dem`, тобто ПОРЯД із 4,3 ГБ плиток:
# видалення дзеркала забрало б і інтерпретатор. Тут venv — у
# `StateDirectory` юніта (/var/lib/camptribe-elevation), плитки — у
# `CacheDirectory`, і від дзеркала нічого не залежить.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
STATE=${STATE_DIRECTORY:-${ELEVATION_STATE:-}}
[ -n "$STATE" ] || { echo "🔴 немає STATE_DIRECTORY (запуск не з юніта?) — задай ELEVATION_STATE=тека" >&2; exit 2; }
VENV="$STATE/venv"
mkdir -p "$STATE"

# Створення venv — разове; перевіряємо ІМПОРТОМ, а не наявністю теки:
# обірваний `pip install` лишає теку, у якій нічого не працює.
if ! "$VENV/bin/python" -c 'import omfiles, numpy, psycopg2' 2>/dev/null; then
  echo "venv: ставлю залежності в $VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --disable-pip-version-check -r "$HERE/requirements.txt"
  "$VENV/bin/python" -c 'import omfiles, numpy, psycopg2'
fi

export ELEVATION_TILES=${ELEVATION_TILES:-${CACHE_DIRECTORY:-$STATE/tiles}}
exec "$VENV/bin/python" "$HERE/refill.py" "$@"
