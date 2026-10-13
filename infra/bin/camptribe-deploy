#!/usr/bin/env bash
# CampTribe — викладка і відкат на сервері.
#
# 🔴 ЧОМУ СИМЛІНК, А НЕ "git pull && build" НА МІСЦІ.
#
# Збірка триває ~400 с і займає 8.6 ГБ (заміряно 12.10.2026 на CPX32).
# Якщо збирати в каталозі, з якого сайт віддається, то всі ці хвилини
# він віддає половину старого й половину нового. Тому кожен реліз —
# окремий каталог, а `current` перемикається однією операцією, яку
# ядро виконує атомарно.
#
# Відкат доведений, не припущений: 12.10.2026 викладено реліз
# 73d1710, BUILD_ID на сайті змінився з V68nKUfZ… на HwgXdu8w…,
# після `rollback` повернувся на V68nKUfZ…. Перевірено ЧЕРЕЗ
# Cloudflare, не локально.
set -euo pipefail

ROOT=/srv/camptribe
REPO=https://github.com/camp-tribe-eu/camp.git
KEEP=3          # скільки релізів тримати, не рахуючи чинного
USER_=camptribe

say() { printf '%s\n' "$*" >&2; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

current_release() { readlink "$ROOT/current" | sed 's|releases/||'; }

# BUILD_ID, який ВІДДАЄТЬСЯ, а не той, що лежить у файлі: саме він
# доводить, що перемикання дійшло до читача.
#
# 🔴 ДВІ ПАСТКИ, ОБИДВІ ЗАМІРЯНІ 12.10.2026.
#
# 1. Тут було `curl … | head -c 200`. `head` закриває канал, curl падає
#    з кодом 23 («Failure writing output to destination»), і під
#    `set -o pipefail` це вбиває весь скрипт. Та сама пастка, через яку
#    29 кроків CI віддавали 141 (CAMP-285). Тому відповідь читається
#    ЦІЛКОМ у змінну, а вже потім ріжеться.
#
# 2. Next друкує BUILD_ID у коментарі, замінюючи `-` на `_`: у файлі
#    `V68nKUfZ_V5ox5K-e3J3c`, у HTML `V68nKUfZ_V5ox5K_e3J3c`. Тому
#    порівнювати можна лише нормалізовані значення.
normalise_id() { printf '%s' "$1" | tr '-' '_'; }

# 🔴 ЖОДНОГО КОНВЕЄРА. Я наступив на цю пастку ТРИЧІ в цій функції:
# спершу `head -c` (код 23), потім `grep -m1` (код 141) — обидва
# закривають канал, писар гине, `pipefail` робить із цього падіння
# всього скрипта. Bash уміє витягти підрядок сам, без підпроцесів.
served_build_id() {
  local body
  body=$(curl -sS --max-time 30 http://127.0.0.1:3000/ 2>/dev/null) || return 0
  [[ $body =~ \<!--([A-Za-z0-9_-]{15,})--\> ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}

swap_to() {
  local rel="$1"
  [ -d "$ROOT/releases/$rel" ] || die "релізу $rel немає"
  [ -f "$ROOT/releases/$rel/apps/web/.next/BUILD_ID" ] || die "у релізі $rel немає збірки"
  local before; before=$(served_build_id)
  ln -sfn "releases/$rel" "$ROOT/current"
  chown -h "$USER_:$USER_" "$ROOT/current"
  systemctl restart camptribe-api camptribe-web
  for _ in $(seq 1 30); do
    sleep 2
    [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/ 2>/dev/null)" = "200" ] && break
  done
  local after; after=$(served_build_id)
  local want; want=$(cat "$ROOT/releases/$rel/apps/web/.next/BUILD_ID")
  # 🔴 Перевіряємо ВІДДАНЕ проти ОЧІКУВАНОГО. «Служба active» нічого не
  # доводить: вона буває active і на старому каталозі.
  [ "$(normalise_id "$after")" = "$(normalise_id "$want")" ] \
    || die "перемкнули на $rel, а віддається '$after' (чекали '$want')"
  say "✓ $rel віддається (BUILD_ID $after, було $before)"
}

do_deploy() {
  local sha; sha=$(git ls-remote "$REPO" "${1:-main}" | cut -c1-7)
  [ -n "$sha" ] || die "не знайшов гілку ${1:-main}"
  local dir="$ROOT/releases/$sha"

  if [ -f "$dir/apps/web/.next/BUILD_ID" ]; then
    say "реліз $sha уже зібраний — просто перемикаю"
  else
    rm -rf "$dir"
    sudo -u "$USER_" git clone -q --depth 1 --branch "${1:-main}" "$REPO" "$dir"
    # .env не в репозиторії й ніколи там не буде — беремо з чинного релізу
    install -m 600 -o "$USER_" -g "$USER_" \
      "$ROOT/releases/$(current_release)/apps/api/.env" "$dir/apps/api/.env"
    ( cd "$dir"
      sudo -u "$USER_" npm ci --no-audit --no-fund
      sudo -u "$USER_" npm run build:api
      sudo -u "$USER_" env $(grep -E '^(DATABASE_URL|API_BUILD_TOKEN)=' apps/api/.env | xargs) \
        API_BASE_URL=http://localhost:3001 NODE_OPTIONS=--max-old-space-size=5120 \
        npm run build:web )
  fi

  # 🔴 Збираємо ДО перемикання. Зламана збірка не стає чинною ніколи.
  swap_to "$sha"

  # прибирання: тримаємо KEEP найстаріших… ні, найновіших, і ніколи чинний
  local cur; cur=$(current_release)
  ls -1dt "$ROOT"/releases/* 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    [ "$(basename "$old")" = "$cur" ] && continue
    say "прибираю старий реліз $(basename "$old")"
    rm -rf "$old"
  done
}

do_rollback() {
  local cur; cur=$(current_release)
  local prev
  prev=$(ls -1dt "$ROOT"/releases/* | grep -v "/$cur\$" | head -1 || true)
  [ -n "$prev" ] || die "немає куди відкочуватись: лише один реліз"
  swap_to "$(basename "$prev")"
}

case "${1:-}" in
  deploy)   do_deploy "${2:-main}" ;;
  rollback) do_rollback ;;
  current)  echo "$(current_release)  BUILD_ID=$(served_build_id)" ;;
  *) die "usage: deploy.sh deploy [гілка] | rollback | current" ;;
esac
