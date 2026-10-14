#!/usr/bin/env bash
# CAMP-306: розкласти юніти й скрипти З РЕПОЗИТОРІЮ на машину.
#
#   ./infra/deploy-infra.sh            # показати, що зміниться
#   ./infra/deploy-infra.sh --apply    # розкласти й перезавантажити systemd
#
# 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. «Файли лежать у git» і «файли розкладаються з
# git» — різні твердження, і 13.10.2026 правдивим було лише перше, та й
# те наполовину: юнітів у репозиторії не було взагалі, а продакшн-
# конфігурацію я правив текстовим редактором на машині. Зміни не було
# ні в рецензії, ні в історії.
#
# 🔴 СУХИЙ ПРОГІН ЗА ЗАМОВЧУВАННЯМ. Розкладка без `--apply` нічого не
# чіпає: `-overwrite` заради налагодження вже коштував цьому проєкту
# даних.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 🔴 Без значення за замовчуванням: репозиторій публічний, і адреси
# продакшн-машини в ньому немає навмисно.
HOST="${CAMPTRIBE_HOST:?задай CAMPTRIBE_HOST=root@… — адреси машини в репозиторії немає навмисно}"
KEY="${CAMPTRIBE_KEY:-$HOME/.ssh/id_ed25519_camptribe_server}"
APPLY=no
for a in "$@"; do
  case "$a" in
    --apply) APPLY=yes ;;
    *) echo "невідомий прапорець: $a" >&2; exit 2 ;;
  esac
done

ssh_() { ssh -i "$KEY" -o ConnectTimeout=10 "$HOST" "$@"; }

changed=0
for local in "$HERE"/systemd/* "$HERE"/bin/*; do
  name="$(basename "$local")"
  case "$local" in
    */systemd/*) remote="/etc/systemd/system/$name" ;;
    */bin/*)     remote="/usr/local/bin/$name" ;;
  esac
  if ssh_ "cat $remote 2>/dev/null" | diff -q - "$local" >/dev/null 2>&1; then
    echo "=  $remote"
    continue
  fi
  changed=$((changed + 1))
  echo "→  $remote"
  [ "$APPLY" = yes ] || continue
  # 🔴 Копія того, що перезаписуємо, із датою. Відкотити мусить бути
  # можливо без git на машині, де git може й не бути.
  ssh_ "mkdir -p /root/infra-backups && [ -f $remote ] && cp -a $remote /root/infra-backups/$name.$(date -u +%Y%m%dT%H%M%SZ) || true"
  scp -q -i "$KEY" "$local" "$HOST:$remote"
  case "$local" in */bin/*) ssh_ "chmod +x $remote" ;; esac
done

if [ "$changed" -eq 0 ]; then
  echo "нічого не змінилось"
  exit 0
fi
if [ "$APPLY" != yes ]; then
  echo
  echo "$changed файл(ів) розійшлися. Сухий прогін — нічого не змінено."
  echo "Щоб розкласти: ./infra/deploy-infra.sh --apply"
  exit 1
fi
ssh_ 'systemctl daemon-reload'
# 🔴 Перевірити ПІСЛЯ перезавантаження: юніт із помилкою синтаксису
# приймається файловою системою й відмовляє лише на запуску.
ssh_ 'systemd-analyze verify /etc/systemd/system/camptribe-*.service'

# 🔴 СКОПІЙОВАНИЙ ТАЙМЕР НЕ Є УВІМКНЕНИМ ТАЙМЕРОМ, і до 14.10.2026 цей
# скрипт цієї різниці не знав. Файл лягає на машину, `daemon-reload`
# його приймає, `systemd-analyze verify` каже «ок» — і він не
# спрацьовує ЖОДНОГО РАЗУ, бо ніхто не зробив `enable --now`. Розклад,
# якого ніхто не вмикав, виглядає точно так само, як розклад.
#
# Глоб розкриває віддалена оболонка, тому `cd` обовʼязковий: без нього
# `camptribe-*.timer` шукалось би в домашній теці root.
ssh_ 'cd /etc/systemd/system && systemctl enable --now camptribe-*.timer'

# 🔴 І ДОКАЗ, А НЕ НАМІР. `enable` може відпрацювати, а таймер лишитись
# без наступного спрацювання — наприклад, якщо `OnCalendar` не
# розібрався. Друкуємо те, що systemd СОБІ ЗАПЛАНУВАВ.
ssh_ 'systemctl list-timers --no-pager "camptribe-*"'
echo "розкладено: $changed, systemd перезавантажено, перевірено, таймери ввімкнено"
