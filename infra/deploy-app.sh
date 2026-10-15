#!/usr/bin/env bash
# CAMP-61: викотити, перевірити й відкотити ЗАСТОСУНОК на сервері — з ноутбука.
# (`deploy-infra.sh` розкладає юніти systemd; цей файл — код сайту.)
#
#   ./infra/deploy-app.sh                              # сухий прогін: що буде викочено з origin/main
#   ./infra/deploy-app.sh --apply [--migrate]          # викотити
#   ./infra/deploy-app.sh --status                     # що зараз на проді
#   ./infra/deploy-app.sh --rollback [--to REL]        # сухий прогін відкату
#   ./infra/deploy-app.sh --rollback --apply           # відкотити
#   ./infra/deploy-app.sh --rehearse [--apply] [--keep] # відрепетирувати відкат у паралельному світі
#   ./infra/deploy-app.sh --rehearse --teardown [--apply]  # прибрати залишок після --keep (сухий прогін без --apply)
#   ./infra/deploy-app.sh --sha <sha> | --ref <гілка>  # що викочувати (за замовчуванням origin/main)
#
# 🔴 СУХИЙ ПРОГІН ЗА ЗАМОВЧУВАННЯМ. Без `--apply` на машині не змінюється
# нічого: скрипт, що без прапорця щось міняє, рано чи пізно запустять «просто
# подивитись». Це перевіряє infra/deploy.selftest.sh: сухий прогін
# звіряється з відбитком дерева і журналом викликів.
#
# 🔴 ЦЕЙ ФАЙЛ МАЙЖЕ НІЧОГО НЕ ЗНАЄ ПРО ДЕПЛОЙ. Уся логіка живе в
# bin/camptribe-deploy, і сюди її не дублюємо: два списки правил — це
# половина виправлення. Тут лише те, що можна зробити на ноутбуці:
# розв'язати гілку в ПОВНИЙ SHA, дістати з git список міграцій цього
# коміту, і покласти на машину РІВНО той файл виконавця, що лежить поруч,
# а не встановлений колись у /usr/local/bin (він міг розійтись із репо).
#
# 🔴 ДЕПЛОЇТЬСЯ SHA, А НЕ ГІЛКА. Гілка за ті хвилини, що йде збірка, може
# піти вперед; тоді «викотили main» означало б щось інше, ніж ти перевірив.
#
# Адреси машини в репозиторії немає навмисно (він публічний):
#   CAMPTRIBE_HOST=root@…   обовʼязково
#   CAMPTRIBE_KEY=…         за замовчуванням ~/.ssh/id_ed25519_camptribe_server
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
EXECUTOR="$HERE/bin/camptribe-deploy"
HOST="${CAMPTRIBE_HOST:?задай CAMPTRIBE_HOST=root@… — адреси машини в репозиторії немає навмисно}"
KEY="${CAMPTRIBE_KEY:-$HOME/.ssh/id_ed25519_camptribe_server}"
REMOTE_TMP="${CAMPTRIBE_REMOTE_TMP:-/run}"

die() { printf '✗ %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }

# Прапорець зі значенням: значення мусить бути, і не мусить саме бути прапорцем.
# 🔴 Раніше `--to` останнім аргументом вбивав розбірник через `set -e` на `shift`: код 1 і жодного слова.
need_value() { # прапорець [значення …]
  if [ $# -lt 2 ]; then printf 'прапорець %s потребує значення\n' "$1" >&2; exit 2; fi
  case "$2" in -*) printf 'прапорець %s потребує значення, а не прапорець (отримано %s)\n' "$1" "$2" >&2; exit 2 ;; esac
}

mode=deploy; apply=""; migrate=""; sha=""; ref=""; to=""; keep=""; teardown=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=--apply ;;
    --migrate) migrate=--migrate ;;
    --status) mode=status ;;
    --rollback) mode=rollback ;;
    --rehearse) mode=rehearse ;;
    --keep) keep=--keep ;;
    --teardown) teardown=--teardown ;;
    --to) need_value "$@"; to="$2"; shift ;;
    --sha) need_value "$@"; sha="$2"; shift ;;
    --ref) need_value "$@"; ref="$2"; shift ;;
    -h|--help) usage ;;
    *) echo "невідомий прапорець: $1" >&2; exit 2 ;;
  esac
  shift
done

bash -n "$EXECUTOR" || die "у $EXECUTOR синтаксична помилка — на машину не кладу"

ssh_() { ssh -i "$KEY" -o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$HOST" "$@"; }

args=()
deployer="$(git -C "$REPO_ROOT" config user.email 2>/dev/null || true)"
[ -n "$deployer" ] || deployer="$(id -un)"
deployer="$deployer@$(hostname -s)"

case "$mode" in
  status) cmd=status ;;
  rollback) cmd=rollback; [ -z "$to" ] || args+=(--to "$to") ;;
  rehearse) cmd=rehearse; [ -z "$keep" ] || args+=("$keep"); [ -z "$teardown" ] || args+=("$teardown") ;;
  deploy)
    cmd=deploy
    git -C "$REPO_ROOT" fetch -q origin || die "git fetch origin не вдався — не знаю, що на origin"
    if [ -n "$sha" ]; then
      full="$(git -C "$REPO_ROOT" rev-parse --verify "$sha^{commit}" 2>/dev/null)" || die "'$sha' — не коміт"
      # Не `--sha …`: цей підпис їде виконавцю значенням `--ref`, а значення з тире виконавець відхиляє.
      label="sha $sha"
    else
      ref="${ref:-main}"
      full="$(git -C "$REPO_ROOT" rev-parse --verify "origin/$ref^{commit}" 2>/dev/null)" || die "немає origin/$ref"
      label="origin/$ref"
    fi
    # Машина бере коміт з GitHub; якщо його там немає, збірка впаде через 30 секунд, а не через 400.
    [ -n "$(git -C "$REPO_ROOT" branch -r --contains "$full" 2>/dev/null)" ] \
      || die "коміт $full не лежить ні в одній гілці origin — машина його не отримає. Спершу push."
    subject="$(git -C "$REPO_ROOT" log -1 --format=%s "$full")"
    echo "ціль: $full  ($label)"
    echo "      \"$subject\""
    # Міграції ЦЬОГО коміту, з git, а не з теки, якої ще немає: скрипт при --apply
    # перераховує їх із того, що справді отримав, і звіряє.
    migrations="$(git -C "$REPO_ROOT" ls-tree --name-only "$full" apps/api/src/migrations/ | sed 's|.*/||; s|\.ts$||' | paste -sd, -)"
    args+=(--sha "$full" --ref "$label" --migrations "$migrations")
    [ -z "$migrate" ] || args+=("$migrate")
    ;;
esac
[ -z "$apply" ] || args+=("$apply")
args+=(--deployer "$deployer")

# Виконавця кладемо у тимчасовий файл, а не підсовуємо в `bash -s` через stdin:
# команди всередині (git, npm) читають stdin і з'їли б решту скрипта.
remote="$(ssh_ "f=\$(mktemp $REMOTE_TMP/camptribe-deploy.XXXXXX) && cat > \"\$f\" && chmod 700 \"\$f\" && echo \"\$f\"" < "$EXECUTOR")" \
  || die "не вдалось покласти виконавця на машину"
[ -n "$remote" ] || die "машина не назвала шлях до виконавця"
trap 'ssh_ rm -f "$remote" >/dev/null 2>&1 || true' EXIT

quoted=""
for a in "${args[@]}"; do quoted+=" $(printf '%q' "$a")"; done
set +e
# 🔴 `bash <файл>`, а не `<файл>`: /run на Ubuntu змонтовано noexec, і прямий запуск
# дає «Permission denied» (код 126). Заміряно 15.10.2026 на першому ж сухому прогоні.
ssh_ "bash $(printf '%q' "$remote") $cmd$quoted"
rc=$?
set -e
exit "$rc"
