#!/usr/bin/env bash
# Ставить клієнт PostgreSQL тієї ж мажорної версії, що й сервер, до якого
# під'єднані, і кладе його попереду в PATH.
#
# 🔴 Чому не досить прибити раннер до ubuntu-24.04: версія клієнта в образі
# раннера — НЕ наша змінна. 08.11.2026 `ubuntu-latest` поїхав на 26.04 і зламав
# відновлення дампів; пін на 24.04 цього не вилікував, бо й там клієнт уже не
# збігається з сервером. Premise «на 24.04 лежить клієнт 16» була здогадом, і
# сусідній сторож (assert-pg-client-matches-server.sh) її спростував заміром.
# Тому версію більше не успадковуємо, а задаємо — від сервера.
#
# Ціна ХИБНОГО спрацювання: крок падає з назвою пакета, якого не знайшов у
# pgdg. Це гучно й однозначно, на відміну від дампа, що мовчки не відновлюється.
set -euo pipefail

CONN="${1:-${CAMPTRIBE_SELFTEST_PG_BASE:-${DATABASE_URL:-}}}"
[ -n "$CONN" ] || { echo "🔴 нема рядка під'єднання" >&2; exit 2; }

num=$(psql "$CONN" -tAqc 'SHOW server_version_num')
[ -n "$num" ] || { echo "🔴 порожня відповідь на SHOW server_version_num" >&2; exit 2; }
major=$(( num / 10000 ))

have=$(pg_dump --version | sed -nE 's/^pg_dump \(PostgreSQL\) ([0-9]+).*/\1/p' || true)
if [ "$have" = "$major" ]; then
  echo "клієнт уже збігається з сервером: major ${major}"
  exit 0
fi
echo "сервер major ${major}, клієнт major ${have:-невідомий} — ставлю postgresql-client-${major}"

sudo install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc >/dev/null
# shellcheck source=/dev/null
codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq "postgresql-client-${major}"

bin="/usr/lib/postgresql/${major}/bin"
[ -x "${bin}/pg_dump" ] || { echo "🔴 поставив пакет, але ${bin}/pg_dump немає" >&2; exit 1; }
echo "$bin" >> "${GITHUB_PATH:-/dev/stdout}"
echo "у PATH додано ${bin}"
