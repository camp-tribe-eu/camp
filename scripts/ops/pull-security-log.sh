#!/usr/bin/env bash
# CAMP-353, пункт 5 — копія безпекового журналу ПОЗА машиною.
#
# Рішення власника 19.10.2026: без додаткових витрат, копію тримаємо
# локально. Це єдине, що переживе зломщика з root: він не зітре того,
# чого в нього немає.
#
#   ./scripts/ops/pull-security-log.sh          # забрати свіже
#   ./scripts/ops/pull-security-log.sh --check  # лише перевірити свіжість
#
# 🔴 КУДИ ЦЕ ЛЯГАЄ — ПОЗА РЕПОЗИТОРІЄМ, І ЦЕ НЕ СТИЛЬ. У рядках журналу
# справжні адреси читачів, тобто персональні дані; репозиторій
# публічний. Тека за замовчуванням живе в домівці, а не під git.
#
# 🔴 СТРОК ТОЙ САМИЙ — 14 ДІБ. Копія, що живе довше за оригінал, робить
# опубліковану обіцянку неправдою так само надійно, як конфіг на
# машині. Прибирання нижче — не прибирання місця, а дотримання строку.
set -euo pipefail

# Адреса машини живе ПОЗА репозиторієм — той публічний. Файл не
# обовʼязковий: у ручному прогоні змінну задають у командному рядку.
#
# 🔴 `set -a; . file` — і ніколи `export $(cat file)`: порожня
# підстановка там друкує весь environment, і так у лог уже потрапляли
# токени (23.09.2026).
ENV_FILE="${CAMPTRIBE_ENV:-$HOME/.config/camptribe/mirror.env}"
if [ -f "$ENV_FILE" ] && [ -z "${CAMPTRIBE_HOST:-}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

HOST="${CAMPTRIBE_HOST:?задай CAMPTRIBE_HOST=root@… або поклади його в ~/.config/camptribe/mirror.env — адреси машини в репозиторії немає навмисно}"
KEY="${CAMPTRIBE_KEY:-$HOME/.ssh/id_ed25519_camptribe_server}"
DEST="${CAMPTRIBE_LOG_MIRROR:-$HOME/CampTribe/security-log}"
REMOTE_DIR=/var/log/caddy
DAYS=14

CHECK=no
INSTALL=no
for a in "$@"; do
  case "$a" in
    --check) CHECK=yes ;;
    --install-schedule) INSTALL=yes ;;
    *) echo "невідомий прапорець: $a" >&2; exit 2 ;;
  esac
done

# 🔴 РОЗКЛАД, А НЕ «КОЛИ ЗГАДАЮ». Копія, яку роблять вручну, — це не
# запобіжник, а намір. Plist пишеться ТУТ, а не лежить у репозиторії,
# бо містить абсолютні шляхи цієї машини; у git їм місця немає.
INSTALLED="$HOME/.local/bin/camptribe-log-mirror"

if [ "$INSTALL" = yes ]; then
  SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  # 🔴 КОПІЯ ПОЗА ~/Documents, І ЦЕ НЕ ПРИМХА. Перша редакція вказувала
  # plist просто на файл у репозиторії — завдання стартувало й падало з
  # `Operation not permitted` (код 126): macOS не дає процесам launchd
  # читати з ~/Documents без Full Disk Access. Виявлено `kickstart`-ом,
  # а не роздумами; розклад, якого не запускали, виглядає точно так
  # само, як розклад, що працює.
  #
  # Просити власника видати Full Disk Access для /bin/bash було б гірше
  # за проблему. ~/.local/bin під TCC не підпадає.
  mkdir -p "$(dirname "$INSTALLED")"
  cp "$SELF" "$INSTALLED"
  chmod 700 "$INSTALLED"
  PLIST="$HOME/Library/LaunchAgents/eu.camptribe.security-log-mirror.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>eu.camptribe.security-log-mirror</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALLED</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>30</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/camptribe-log-mirror.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/camptribe-log-mirror.log</string>
</dict>
</plist>
PLISTEOF
  launchctl bootout "gui/$UID/eu.camptribe.security-log-mirror" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
  # 🔴 ЗАПИТУЄМО НАПРЯМУ, А НЕ ЧЕРЕЗ `launchctl list | grep -q`. Перша
  # редакція робила саме так — і сказала «не зареєструвався» про
  # завдання, яке зареєструвалось: `grep -q` закриває канал на першому
  # збігу, `launchctl` дістає SIGPIPE, а `pipefail` перетворює це на
  # провал усього конвеєра. Успіх і провал там виглядають однаково.
  launchctl print "gui/$UID/eu.camptribe.security-log-mirror" >/dev/null 2>&1 || {
    echo "розклад не зареєструвався" >&2; exit 1; }
  echo "розклад увімкнено: щодня о 21:30, журнал прогонів у ~/Library/Logs/camptribe-log-mirror.log"
  echo "виконуваний файл: $INSTALLED (копія з репозиторію)"
  exit 0
fi

mkdir -p "$DEST"
chmod 700 "$DEST"

ssh_() { ssh -n -i "$KEY" -o ConnectTimeout=10 "$HOST" "$@"; }

# Скільки діб тримає машина — беремо з КОНФІГУ, а не з памʼяті. Якщо
# строк колись змінять, копія поїде за ним, а не лишиться довшою.
remote_days() {
  local r
  # 🔴 `head -1`, А НЕ СКЛЕЮВАННЯ. Перша редакція пропускала вивід awk
  # через `tr -d '[:space:]'` — і якби в конфігу колись стало ДВА блоки
  # `maxage`, два числа злиплись би в одне (14 і 30 → `1430`). Воно
  # проходить `^[0-9]+$`, cutoff їде на десять років назад, і прибирання
  # мовчки перестає прибирати. Знайдено рецензією 19.10.2026.
  r="$(ssh_ "awk '/^[[:space:]]*maxage[[:space:]]/ {print \$2; exit}' /etc/logrotate.d/camptribe-caddy" 2>/dev/null | tr -d '\r\n[:space:]')"
  # Межа згори теж потрібна: строк, якого ми не очікували, краще
  # прочитати як помилку, ніж тихо подовжити зберігання вдвічі.
  if [[ "$r" =~ ^[0-9]{1,3}$ ]] && [ "$r" -ge 1 ] && [ "$r" -le 90 ]; then
    echo "$r"
  else
    echo "$DAYS"
  fi
}

prune() {
  # Імʼя файла несе дату: 2026-10-19-<хеш>.log
  #
  # 🔴 `DAYS - 1`, А НЕ `DAYS`, І ЦЕ ВИПРАВЛЕННЯ РЕЦЕНЗІЇ. Строк 14 діб
  # означає, що зберігаються ДНІ `today-13 … today` — рівно чотирнадцять
  # штук. Межа `today-14` зі строгим `<` лишала файл за `today-14`
  # живим ще добу, тобто 15. Сусідній `infra/logrotate/camptribe-caddy`
  # обирає `rotate 13` саме з цієї причини, і копія мусить рахувати так
  # само, інакше вона переживає оригінал.
  local cutoff back
  back=$(( DAYS - 1 ))
  cutoff="$(date -u -v-"${back}"d +%Y-%m-%d 2>/dev/null || date -u -d "$back days ago" +%Y-%m-%d)"
  local removed=0
  for f in "$DEST"/*.log "$DEST"/*.log.gz; do
    [ -e "$f" ] || continue
    local d="${f##*/}"; d="${d:0:10}"
    [[ "$d" < "$cutoff" ]] || continue
    rm -f "$f"; removed=$((removed + 1))
  done
  echo "$removed"
}

# 🔴 ДИВИТИСЬ ТРЕБА НА ВМІСТ, А НЕ НА ІМʼЯ. Перша редакція брала
# найсвіжіше імʼя — і `--check` зеленів над файлом у НУЛЬ байтів, тобто
# рівно тоді, коли копії фактично немає. Імʼя — це підпис, не перевірка.
newest_date() {
  local n best=""
  while IFS= read -r n; do
    [ -s "$DEST/$n" ] || continue
    best="$n"
  done < <(ls -1 "$DEST" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}-' | sort)
  [ -n "$best" ] && echo "${best:0:10}" || echo ""
}

if [ "$CHECK" = yes ]; then
  # 🔴 «Немає файлів» — ЦЕ ПРОВАЛ, А НЕ ТИША. Порожній результат
  # виглядає точно так само спокійно, як свіжа копія.
  nd="$(newest_date)"
  if [ -z "$nd" ]; then
    echo "копії немає взагалі: $DEST" >&2
    exit 1
  fi
  limit="$(date -u -v-2d +%Y-%m-%d 2>/dev/null || date -u -d '2 days ago' +%Y-%m-%d)"
  if [[ "$nd" < "$limit" ]]; then
    echo "копія застаріла: найсвіжіша за $nd, межа $limit" >&2
    exit 1
  fi
  # 🔴 ВСТАНОВЛЕНА КОПІЯ МОЖЕ ВІДСТАТИ ВІД РЕПОЗИТОРІЮ. Розклад
  # виконує саме її, тож правка тут без повторного `--install-schedule`
  # нічого б не змінила — і дізнатись про це не було б звідки.
  SELF_NOW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  if [ "$SELF_NOW" != "$INSTALLED" ] && [ -f "$INSTALLED" ]; then
    if ! diff -q "$SELF_NOW" "$INSTALLED" >/dev/null 2>&1; then
      echo "встановлена копія відстала від репозиторію — перезапусти --install-schedule" >&2
      exit 1
    fi
  fi
  echo "копія свіжа: $nd, файлів $(ls -1 "$DEST" | wc -l | tr -d ' ')"
  exit 0
fi

DAYS="$(remote_days)"

# 🔴 ЗАБИРАЄМО ДВА ФАЙЛИ, А НЕ ОДИН. Активний містить сьогоднішнє; якщо
# прогін трапився одразу після опівнічної ротації, сьогоднішнього там
# майже немає, зате вчорашнє щойно лягло в `.1.gz`. Один файл лишив би
# дірку рівно в ті доби, коли ноутбук вмикали вранці.
pulled=0
for name in access.log access.log.1.gz; do
  # Дата джерела й хеш вмісту — щоб імена, які на машині ЩОДНЯ
  # означають різне (`.1.gz` — це вчора, потім позавчора…), не
  # склеювались у пласкій теці в один файл.
  meta="$(ssh_ "[ -f $REMOTE_DIR/$name ] && date -u -r $REMOTE_DIR/$name +%Y-%m-%d && sha256sum $REMOTE_DIR/$name | cut -c1-8 || true")"
  [ -n "$meta" ] || continue
  day="$(echo "$meta" | sed -n 1p)"
  hash="$(echo "$meta" | sed -n 2p)"
  [ -n "$day" ] && [ -n "$hash" ] || continue
  case "$name" in
    *.gz)
      ext=log.gz
      # 🔴 ВІДРОТОВАНИЙ ФАЙЛ МОЛОДШИЙ ЗА СВІЙ ВМІСТ НА ДОБУ. Його
      # `mtime` — це момент ротації, тобто СЬОГОДНІ, а рядки в ньому
      # вчорашні. Підписати його сьогоднішньою датою означало б
      # тримати вчорашній вміст на добу довше за строк — рецензія
      # нарахувала так 16 діб замість 14.
      day="$(date -u -v-1d -j -f %Y-%m-%d "$day" +%Y-%m-%d 2>/dev/null || date -u -d "$day -1 day" +%Y-%m-%d)"
      ;;
    *) ext=log ;;
  esac
  out="$DEST/$day-$hash.$ext"
  if [ -e "$out" ]; then
    echo "=  $(basename "$out")"
    continue
  fi
  scp -q -i "$KEY" "$HOST:$REMOTE_DIR/$name" "$out"
  chmod 600 "$out"
  pulled=$((pulled + 1))
  echo "→  $(basename "$out") ($(wc -c < "$out" | tr -d ' ') байт)"
done

removed="$(prune)"
echo "забрано: $pulled, прибрано старших за $DAYS діб: $removed, разом файлів: $(ls -1 "$DEST" | wc -l | tr -d ' ')"

# Доказ, а не намір: після прогону копія мусить проходити власну ж
# перевірку свіжості.
"$0" --check >/dev/null
