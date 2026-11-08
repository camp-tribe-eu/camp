#!/usr/bin/env bash
# 🔴 КЛІЄНТ POSTGRES НЕ МОЖЕ БУТИ НОВІШИЙ ЗА СЕРВЕР.
#
# 08.11.2026 main почервонів без жодної зміни коду: GitHub перевів
# `ubuntu-latest` з 24.04 на 26.04, клієнтський pg_dump поїхав із 16 на новіший,
# а сервісний образ лишився postgis/postgis:16-3.4. pg_dump ≥17 пише в дамп
# `SET transaction_timeout = 0;`, параметра, якого в PG 16 немає, — і кожне
# відновлення падало з «unrecognized configuration parameter». У
# move-table.selftest.sh це виглядало як 25 провалених випадків, а в
# backup-verify — як сліпий сторож бекапа. Жодне з повідомлень не називало
# справжньої причини.
#
# Цей скрипт називає її до того, як щось почне падати: звіряє мажор pg_dump із
# мажором СЕРВЕРА, до якого ми під'єднані. Сервер — єдине джерело; версія
# клієнта з нього й виводиться, а не дублюється константою поруч.
#
# Ціна ХИБНОГО спрацювання: збірка червоніє з повідомленням, яке друкує обидва
# числа і команду, якою їх отримано. Це дешевше за мовчазний дамп, який не
# відновлюється, бо саме такий дамп ми й возимо в бекап.
set -euo pipefail

CONN="${1:-${CAMPTRIBE_SELFTEST_PG_BASE:-${DATABASE_URL:-}}}"
[ -n "$CONN" ] || { echo "🔴 нема рядка під'єднання: ні аргумент, ні CAMPTRIBE_SELFTEST_PG_BASE, ні DATABASE_URL" >&2; exit 2; }

# Підміна лише для самоперевірки: доводить, що сторож ЧЕРВОНІЄ.
server_major="${CAMPTRIBE_FAKE_SERVER_MAJOR:-}"
if [ -z "$server_major" ]; then
  num=$(psql "$CONN" -tAqc 'SHOW server_version_num')
  [ -n "$num" ] || { echo "🔴 порожня відповідь на SHOW server_version_num — це збій, а не версія" >&2; exit 2; }
  server_major=$(( num / 10000 ))
fi

client_major="${CAMPTRIBE_FAKE_CLIENT_MAJOR:-}"
if [ -z "$client_major" ]; then
  ver=$(pg_dump --version)
  client_major=$(printf '%s' "$ver" | sed -nE 's/^pg_dump \(PostgreSQL\) ([0-9]+).*/\1/p')
  [ -n "$client_major" ] || { echo "🔴 не розпізнав версію з «${ver}» — мовчати на цьому не можна" >&2; exit 2; }
fi

if [ "$client_major" != "$server_major" ]; then
  cat >&2 <<MSG
🔴 pg_dump/pg_restore major $client_major, а сервер major $server_major.
   Дамп, знятий новішим клієнтом, НЕ відновлюється на старішому сервері
   (pg_dump ≥17 пише SET transaction_timeout, якого в PG 16 немає).
   Сервер заданий образом сервісу в .github/workflows/; клієнт — образом раннера
   (runs-on). Зрівняйте їх, а не глушіть цю перевірку.
   psql "\$CONN" -tAqc 'SHOW server_version_num'  →  сервер
   pg_dump --version                              →  клієнт
MSG
  exit 1
fi

echo "pg client і server збігаються: major $client_major"
