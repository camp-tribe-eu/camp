#!/usr/bin/env bash
# Перенести ОДНУ таблицю з ноутбука на бойову машину — так, щоб вона
# приїхала цілою.
#
#   CAMPTRIBE_HOST=root@… ./infra/move-table.sh osm_route_poi            # сухий прогін
#   CAMPTRIBE_HOST=root@… ./infra/move-table.sh osm_route_poi --apply
#
# 🔴 ЧОМУ ЦЕЙ СКРИПТ ІСНУЄ. 15.10.2026 я переніс `osm_route_poi` руками:
#
#   pg_restore -d "$DATABASE_URL" --clean --if-exists -t osm_route_poi dump
#
# Перевірив як годиться: 2 271 596 рядків, види збіглися з локальними до
# одиниці. Через годину сусідній запит висів 4 хвилини 42 секунди: на
# таблиці лишилось НУЛЬ індексів і жодного первинного ключа. CHECK вціліли
# тільки тому, що вбудовані в CREATE TABLE. Жодна програма не сказала ні
# слова: мій спосіб перевірки міряв ВМІСТ, а зіпсувалась СТРУКТУРА.
#
# 🔴 ПРИЧИНА — НЕ «pg_restore губить індекси». Дамп, знятий
# `pg_dump -Fc -t T`, УЖЕ містить усе: індекси, первинний ключ, послідовність,
# DEFAULT, тригери. Губить їх `-t` НА ВІДНОВЛЕННІ: він фільтрує записи TOC за
# назвою й лишає з дампу лише TABLE та TABLE DATA. Дамп однієї таблиці цього
# фільтра не потребує — в ньому й так лише вона. Тож `-t` там нічого не дає
# і коштує всієї структури. Заміряно на двох базах (id serial PRIMARY KEY,
# CHECK, два індекси, 50 рядків):
#
#   pg_restore --clean --if-exists -t t dump   50 рядків, 0 індексів, немає послідовності
#   pg_restore --clean --if-exists    dump     50 рядків, 3 індекси, є послідовність і nextval()
#
# Тому `-t` тут є лише на ЗНЯТТІ дампа (pg_dump) і ніколи — на відновленні:
# ні на заміні, ні на відкаті, ні на репетиції.
#
# 🔴 ЯК ЦЕ ВІДНОВЛЮЄТЬСЯ, І ЧОМУ НЕ ПРОСТО `pg_restore`.
#   • Заміна й відкат — це ОДНА ТРАНЗАКЦІЯ (`psql -1`) над скриптом, який дає
#     `pg_restore -f`. Без `-t` pg_restore --clean виконує всі записи дампа по
#     черзі: спершу знімає індекси, обмеження, DEFAULT і тригери, і лише тоді
#     таблицю. Якщо таблицю зняти не можна (подання, що з'явилось уже після
#     проби; чужий зовнішній ключ), у кілька-хвилинному вікні це лишало таблицю
#     без ключів із подвоєними рядками (заміряно: 500 → 1000 → 1500, 0
#     індексів). В одній транзакції це або відбувається ціле, або не відбувається.
#   • `lock_timeout` не можна поставити на самому pg_restore: кожен його скрипт
#     починається з `SET lock_timeout = 0` і скасовує і PGOPTIONS (заміряно:
#     чекав 5,5 с при ліміті 1 с і замінив таблицю), і сесійні налаштування.
#     Тому цей рядок у скрипті ПІДМІНЯЄТЬСЯ на наш. Без ліміту заявка на
#     ACCESS EXCLUSIVE стоїть у черзі й блокує на живій таблиці всіх, хто
#     прийшов за нею.
#   • ВЛАСНИК І ПРАВА. Дамп джерела — з ноутбука: їх у ньому або немає, або
#     вони чужі. Нова таблиця належала б тому, хто в DATABASE_URL, без грантів
#     (роль застосунку отримала б `permission denied`). Тому власника й гранти
#     (на таблицю й на послідовність) беремо з дампа ПРОДА до заміни й дописуємо
#     в ту саму транзакцію; після заміни звіряємо, що нічого не загублено.
#   • ВІДКАТ — із копії прода БЕЗ `--no-owner --no-acl`: копія це і є прод.
#
# Що зроблено інакше, ніж першою спробою (яка лікувала симптом: звіряла три
# лічильники — рядки, індекси, обмеження — і відтворювала втрачене сама):
#   1. Структуру не відтворюємо, бо вона не губиться. Лічильників немає:
#      вони були сліпі до послідовностей, DEFAULT, тригерів і EXCLUDE.
#   2. Після заміни звіряється ТЕКСТ `pg_dump --schema-only -t T` джерела й
#      прода (див. norm_schema нижче: що саме нормалізується і чому), рядки,
#      власник і права.
#   3. Відкат репетирується ДО заміни. Він потрібен ЛИШЕ тоді, коли заміна
#      закомітилась, а звірка не пройшла; після атомарного обриву відкочувати
#      нічого, і відкат лише перезаписав би старішою копією те, що встигли
#      дописати. Після відкату стан ЗВІРЯЄТЬСЯ з тим, що було до заміни.
#   4. До будь-яких змін пробується `DROP TABLE` у відкочуваній транзакції.
#      Це швидка зупинка з назвою залежного об'єкта ДО копії, що триває хвилини;
#      безпека заміни від неї не залежить.
#
# 🔴 ВОРОТА. Заміна тримає ACCESS EXCLUSIVE на таблиці весь час завантаження
# й побудови індексів. Заміряно на справжній `osm_route_poi` (2 273 710 рядків,
# 1295 МБ), `psql -1 -f swap.sql`, ноутбук, локальний SSD: 28 с у рецензента,
# 45 с у мене під навантаженням 24 на 8 ядрах; на VPS більше. Не «хвилини», але й
# не нічого: до відкриття сайту це не важить, після — читачі таблиці (сторінки
# маршрутів) у цей час чекають, а за lock_timeout отримують помилку.
# Коментар запобіжником не є, тому скрипт ВІДМОВЛЯЄТЬСЯ (код 1, нічого не змінено),
# коли передзапусковий замок знято: `gate.conf` показує не на `gate-closed.conf`.
# Перевіряється двічі: на початку й перед самою заміною (її передує копія й
# репетиція, тобто хвилини, за які ворота могли відчинити). Свідомо перекрити:
# `--apply --allow-open-site`. Шляхи й змінні ті самі, що в infra/bin/camptribe-launch
# (CAMPTRIBE_CADDY_DIR, CAMPTRIBE_GATE, CAMPTRIBE_GATE_OPEN, CAMPTRIBE_GATE_CLOSED):
# читається ЦІЛЬ симлінка, не вміст, а закритим вважається лише gate-closed.conf.
#
# Коди виходу:
#   0  заміна пройшла й звірена
#   1  нічого не змінено (зупинка до заміни, або заміна не відбулась, і прод
#      перевірено: структура, власник і права такі самі; або ВІДМОВА через
#      ворота: сайт відкритий, див. нижче)
#   2  невірний виклик
#   3  заміна закомітилась, звірка не пройшла; прод повернуто з копії й ЗВІРЕНО
#   4  прод у невідомому стані (відкат не звірився, або структуру прода змінили
#      під час спроби); копія лежить у BACKUP_DIR — розбиратись вручну
set -uo pipefail

TABLE="${1:-}"; shift 2>/dev/null || true
APPLY=0; ALLOW_OPEN=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --allow-open-site) ALLOW_OPEN=1 ;;
    *) echo "невідомий прапорець: $a" >&2; exit 2 ;;
  esac
done
[ -n "$TABLE" ] || { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
# 🔴 Літери перелічено, а не діапазоном: `[a-z]` залежить від локалі, і під
# en_US.UTF-8 у bash 3.2 (macOS — саме там цей скрипт і запускається) пускав
# `RV_UP`.
case "$TABLE" in *[!abcdefghijklmnopqrstuvwxyz0123456789_]*) echo "назва таблиці мусить бути [a-z0-9_]: $TABLE" >&2; exit 2 ;; esac

HOST="${CAMPTRIBE_HOST:?задай CAMPTRIBE_HOST=root@… — адреси машини в репозиторії немає навмисно}"
KEY="${CAMPTRIBE_KEY:-$HOME/.ssh/id_ed25519_camptribe_server}"
LOCAL_DB="${CAMPTRIBE_LOCAL_DB:-camptribe_dev}"
REMOTE_ENV="${CAMPTRIBE_REMOTE_ENV:-/srv/camptribe/current/apps/api/.env}"
BACKUP_DIR="${CAMPTRIBE_BACKUP_DIR:-/srv/camptribe/backups}"
# Скільки заявка на ACCESS EXCLUSIVE (проба, заміна) чекає на читачів, перш ніж
# здатись, і скільки — відкат (чекає довше: таблицю мусить бути повернено).
LOCK_TIMEOUT="${CAMPTRIBE_LOCK_TIMEOUT:-10s}"
RB_LOCK_TIMEOUT="${CAMPTRIBE_ROLLBACK_LOCK_TIMEOUT:-60s}"
# 🔴 Одиниця ОБОВ'ЯЗКОВА. Голе число Postgres читає як МІЛІСЕКУНДИ (заміряно:
# `set lock_timeout='60'; show lock_timeout` дає 60ms), тож `…=120` у голові людини
# це «2 хвилини», а в базі 120 мс: відкат здається миттєво й дає код 4. Нуль
# (`0`, `0s`) Postgres читає як «без ліміту» — рівно те, від чого цей параметр
# захищає (непотримана заявка на ACCESS EXCLUSIVE блокує всіх, хто прийшов за нею),
# тож це теж відмова.
for pair in "CAMPTRIBE_LOCK_TIMEOUT=$LOCK_TIMEOUT" "CAMPTRIBE_ROLLBACK_LOCK_TIMEOUT=$RB_LOCK_TIMEOUT"; do
  v="${pair#*=}"
  [[ $v =~ ^[0-9]+(ms|s|min)$ ]] && ! [[ $v =~ ^0+(ms|s|min)$ ]] \
    || { echo "${pair%%=*}: потрібне число з ОДИНИЦЕЮ (ms, s, min) і більше нуля, а не «${v}» (голе число Postgres читає як мілісекунди, нуль знімає ліміт)" >&2; exit 2; }
done
# Куди на машині класти те, що їде з ноутбука. На проді /tmp; самоперевірка
# підставляє свою теку, щоб два прогони поруч не топтали файли один одного.
# 🔴 РОЗМІР тимчасових файлів там — питання кожної нової машини. Заміряно на
# `osm_route_poi` (2 273 710 рядків; відновлена таблиця з індексами — 676 МБ):
#   дамп                      102 МБ  (≈ 15% таблиці)
#   swap.sql, текст заміни    521 МБ  (≈ 77%; на ноутбуці, де таблиця роздута до
#                                      1358 МБ, це ≈ 38%)
#   rb.sql, текст відкату     ≈ 521 МБ, лише коли відкат потрібен
# Пік у $RTMP ≈ 1,1 ГБ, тобто ≈ 1,7 × розмір таблиці. Страхувальна копія лежить
# окремо, у BACKUP_DIR (≈ 100 МБ). Бойовий /tmp перевірено 16.10.2026 (головна
# сесія): ext4 на /dev/sda1, 112 ГБ вільних, не tmpfs, тож пік проходить; на
# іншій машині (tmpfs у пам'яті, малий диск) цього не припускай.
RTMP="${CAMPTRIBE_REMOTE_TMP:-/tmp}"
WORK="${TMPDIR:-/tmp}/camptribe-move-$TABLE.$$"
PSQL="${CAMPTRIBE_PSQL:-psql}"
PG_DUMP="${CAMPTRIBE_PG_DUMP:-pg_dump}"
SSH="${CAMPTRIBE_SSH:-ssh}"
SCP="${CAMPTRIBE_SCP:-scp}"

say()  { printf '%s\n' "$*"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }
mkdir -p "$WORK" || die "не можу створити $WORK"
trap 'rm -rf "$WORK"' EXIT

ssh_() { "$SSH" -i "$KEY" -o ConnectTimeout=15 -o BatchMode=yes "$HOST" "$@"; }

# --- 1. що в джерелі ------------------------------------------------------
src_rows=$("$PSQL" -At -d "$LOCAL_DB" -c "select count(*) from $TABLE") \
  || die "локальна таблиця $TABLE не читається"
[ "${src_rows:-0}" -gt 0 ] || die "у локальній $TABLE нуль рядків — переносити нічого"

say "джерело ($LOCAL_DB.$TABLE): $src_rows рядків"

if [ "$APPLY" != 1 ]; then
  say ''
  say 'СУХИЙ ПРОГІН — машину не чіпав. Що зробив би:'
  say '  0. ворота: ВІДМОВИТИСЬ, якщо сайт відкритий (gate.conf не показує на gate-closed.conf); свідомо перекрити — --allow-open-site'
  say "  1. дамп $TABLE з $LOCAL_DB (pg_dump -Fc -t) і її схема текстом (pg_dump --schema-only -t)"
  say "  2. перевірити, що DROP TABLE на проді пройде (відкочувана транзакція, lock_timeout $LOCK_TIMEOUT)"
  say "  3. страхувальна копія бойової $TABLE у $BACKUP_DIR"
  say '  4. РЕПЕТИЦІЯ: відновити копію в окрему базу й порахувати рядки в ній'
  say "  5. замінити бойову таблицю ОДНІЄЮ транзакцією (psql -1 над скриптом pg_restore --clean, БЕЗ -t, lock_timeout $LOCK_TIMEOUT);"
  say '     власник і права прода (з його дампа) дописуються в ту саму транзакцію'
  say "  6. звірити: $src_rows рядків, схема прода = схема джерела (текстом), власник і права не загублено"
  say "  7. заміна закомітилась, а звірка ні — повернути копію (БЕЗ --no-owner/--no-acl, lock_timeout $RB_LOCK_TIMEOUT)"
  say '     й ЗВІРИТИ відкат: рядки, схема, власник і права такі самі, як до заміни'
  say ''
  say 'Застосувати: додай --apply'
  exit 0
fi

# --- 2. дамп і доставка ---------------------------------------------------
"$PG_DUMP" -Fc -d "$LOCAL_DB" -t "$TABLE" -f "$WORK/table.dump" || die "pg_dump не вдався"
# 🔴 Схема джерела — ЕТАЛОН для звірки. Без власника й прав: на ноутбуці й на
# проді вони різні навмисно.
"$PG_DUMP" --schema-only --no-owner --no-acl -d "$LOCAL_DB" -t "$TABLE" -f "$WORK/src-schema.sql" \
  || die "не вдалось зняти схему джерела"
say "дамп: $(( $(wc -c < "$WORK/table.dump") / 1048576 )) МБ"
"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/table.dump" "$HOST:$RTMP/camptribe-move.dump" >/dev/null \
  || die 'не вдалось доставити дамп'
"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/src-schema.sql" "$HOST:$RTMP/camptribe-move-schema.sql" >/dev/null \
  || die 'не вдалось доставити еталон схеми'

# --- 3. усе інше робиться НА МАШИНІ, одним скриптом ----------------------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 🔴 Функція читання .env ВШИВАЄТЬСЯ сюди з `infra/lib/env-value.sh`, а
# не дублюється: на машині немає нашого репозиторію, туди їде лише цей
# один файл. Одне означення, два споживачі (CAMP-349).
{
  printf '%s\n' '#!/usr/bin/env bash' 'set -uo pipefail'
  cat "$HERE/lib/env-value.sh"
  cat <<'REMOTE'
TABLE="$1"; SRC_ROWS="$2"; BACKUP_DIR="$3"; ENVF="$4"; RTMP="$5"; LOCK_TIMEOUT="$6"; RB_LOCK_TIMEOUT="$7"; ALLOW_OPEN="${8:-0}"
# 🔴 Читаємо, а не виконуємо: пароль із `)` у .env клав цей скрипт так
# само, як клав щонічний бекап три ночі поспіль.
DATABASE_URL="$(env_value "$ENVF" DATABASE_URL)" \
  || { echo "у $ENVF немає DATABASE_URL" >&2; exit 2; }
# 🔴 Порожнє значення — теж «немає». `DATABASE_URL=` дає код 0, і далі
# `psql ""` пішов би в типову базу libpq, тобто не туди. Сторож, що
# обіцяє саме цей випадок, мусить його ловити.
[ -n "$DATABASE_URL" ] || { echo "у $ENVF порожній DATABASE_URL" >&2; exit 2; }
export DATABASE_URL
# 🔴 Створення бази під репетицію винесено в змінні: на бойовій машині це
# суперкористувач (прикладний користувач права не має й не повинен), а в
# самоперевірці — звичайний createdb. Без цього самоперевірка ганяла б не
# той шлях, що прод.
CREATEDB="${CAMPTRIBE_CREATEDB:-sudo -u postgres createdb}"
DROPDB="${CAMPTRIBE_DROPDB:-sudo -u postgres dropdb}"
PSQL_SUPER="${CAMPTRIBE_PSQL_SUPER:-sudo -u postgres psql}"
REHEARSAL_DB="${CAMPTRIBE_REHEARSAL_DB:-camptribe_move_rehearsal}"
q() { psql "$DATABASE_URL" -At -c "$1"; }
RW="$(mktemp -d "$RTMP/camptribe-move-r.XXXXXX")" || { echo "✗ не можу створити робочу теку"; exit 1; }
trap 'rm -rf "$RW"' EXIT
stamp=$(date +%Y%m%d-%H%M%S)
B="$BACKUP_DIR/$TABLE-before-$stamp.dump"

# 🔴 ВОРОТА (див. шапку: заміна тримає ACCESS EXCLUSIVE десятки секунд). Ті самі
# змінні й та сама логіка, що `lock_gate` в infra/bin/camptribe-launch: читається
# ЦІЛЬ симлінка gate.conf. Закритим вважається лише gate-closed.conf; усе інше
# (gate-open.conf, рукописний файл, чужа ціль, немає файлу) означає «закритості
# не доведено». Гілка `open` стоїть ПЕРШОЮ: якщо обидва файли воріт відсутні,
# порожній рядок дорівнює порожньому, і хибний збіг має дати «відчинено», а не «закрито».
CADDY_DIR="${CAMPTRIBE_CADDY_DIR:-/etc/caddy}"
GATE="${CAMPTRIBE_GATE:-$CADDY_DIR/gate.conf}"
GATE_OPEN="${CAMPTRIBE_GATE_OPEN:-$CADDY_DIR/gate-open.conf}"
GATE_CLOSED="${CAMPTRIBE_GATE_CLOSED:-$CADDY_DIR/gate-closed.conf}"
gate_state() {
  case "$(readlink -f "$GATE")" in
    "$(readlink -f "$GATE_OPEN")")   echo 'open' ;;
    "$(readlink -f "$GATE_CLOSED")") echo 'closed' ;;
    *) echo 'чуже' ;;
  esac
}
# $1 — коли саме перевіряємо (для повідомлення). 0 — можна далі, 1 — відмова.
need_closed_gate() {
  local g; g="$(gate_state)"
  if [ "$g" = closed ]; then
    echo "ворота: gate.conf → gate-closed.conf, сайт закритий ($1)"; return 0
  fi
  if [ "$ALLOW_OPEN" = 1 ]; then
    echo "⚠ ворота «${g}» ($GATE), але задано --allow-open-site ($1): продовжую; читачі таблиці чекатимуть на ACCESS EXCLUSIVE"; return 0
  fi
  echo "✗ ВІДМОВА ($1): ворота «${g}» ($GATE) — закритості сайту не доведено."
  echo "  Заміна тримає ACCESS EXCLUSIVE на таблиці десятки секунд (на 2,27 млн рядків заміряно 28–45 с, на VPS більше):"
  echo '  на відкритому сайті сторінки, що читають цю таблицю, у цей час не відповідають.'
  echo '  Свідомо перекрити: додай --allow-open-site (і переконайся, що читачі таблиці це витримають).'
  return 1
}
need_closed_gate 'до початку' || { echo 'нічого не змінено'; exit 1; }

mkdir -p "$BACKUP_DIR"

# 🔴 Схема як ТЕКСТ. Один фільтр і для еталона з ноутбука, і для прода. Він
# прибирає РІВНО це, і кожне з причини; решта має збігтися до символу:
#   рядки `--…`         заголовок із версіями сервера й pg_dump («Dumped from…»)
#                       та підписи «Name/Type/Owner». Самі DDL-команди під ними
#                       лишаються й звіряються. (Рядок усередині COMMENT-тексту,
#                       що сам починається з `--`, теж піде — нехтуємо.)
#   `\restrict`,        випадковий токен, який pg_dump ≥17.6 пише в КОЖЕН дамп;
#   `\unrestrict`       без цього звірка червоніла б завжди.
#   `SET <сесійне>`     перелічені поіменно (timeouts, client_encoding, xmloption,
#                       row_security…) і `set_config('search_path')`: залежать від
#                       версії pg_dump (`transaction_timeout` є лише з 17), до
#                       самої таблиці не належать. `SET default_tablespace` і
#                       `SET default_table_access_method` НЕ прибираються — вони
#                       описують таблицю.
#   порожні рядки       лише пробіли між командами.
# Власник і права прибрано не тут, а прапорцями --no-owner --no-acl на знятті:
# для них є окрема звірка (prod_acl), бо їх у дампі джерела немає.
# Порожній результат — теж провал (grep тоді повертає 1, pipefail його не губить).
norm_schema() {
  grep -Ev \
    -e '^--' \
    -e '^\\(un)?restrict ' \
    -e '^SET (statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout|client_encoding|standard_conforming_strings|check_function_bodies|xmloption|client_min_messages|row_security) ' \
    -e '^SELECT pg_catalog\.set_config\(.search_path' \
    -e '^$'
}
prod_schema() { pg_dump --schema-only --no-owner --no-acl -t "$TABLE" "$DATABASE_URL" | norm_schema > "$1"; }
# 🔴 ВЛАСНИК І ПРАВА: рівно ті команди дампа прода, що їх задають — власник
# таблиці й послідовності та GRANT/REVOKE (на таблицю, колонки, послідовність).
# Ті самі рядки і ЗАСТОСОВУЮТЬСЯ до нової таблиці (порядок pg_dump: REVOKE
# раніше за GRANT), і ЗВІРЯЮТЬСЯ. Порожнє — провал (grep тоді повертає 1).
prod_acl() {
  pg_dump --schema-only -t "$TABLE" "$DATABASE_URL" \
    | grep -E '^(ALTER (TABLE|SEQUENCE) .* OWNER TO |GRANT |REVOKE )' > "$1"
}
# Стан прода дорівнює тому, що було ДО заміни: схема, власник і права. Рядки
# порівнює той, хто викликає (в таблицю можуть писати). $1 — ім'я знімка.
same_as_pre() {
  prod_schema "$RW/$1.sql" && diff -u "$RW/pre.sql" "$RW/$1.sql" > "$RW/$1.diff" \
    && prod_acl "$RW/$1.acl" && diff <(sort "$RW/pre_acl.sql") <(sort "$RW/$1.acl") > "$RW/$1.acldiff"
}
show_diff() { head -20 "$RW/$1.diff" 2>/dev/null; head -10 "$RW/$1.acldiff" 2>/dev/null; }

# Скрипт відновлення з lock_timeout, який діє. pg_restore пише в кожен скрипт
# `SET lock_timeout = 0` — його підмінено на наш (і наш стоїть першим рядком,
# якщо pg_restore цього рядка колись перестане писати).
# $1 = дамп, $2 = куди, $3 = lock_timeout, решта — прапорці pg_restore.
make_script() {
  local dump="$1" out="$2" lt="$3"; shift 3
  # Потоком, без проміжного файлу: текстовий скрипт таблиці на 2,27 млн рядків
  # у кілька разів більший за дамп, і другий екземпляр поруч із ним — зайвий
  # диск на проді. pipefail лишає код pg_restore, а не sed.
  pg_restore --clean --if-exists "$@" -f - "$dump" \
    | { printf "SET lock_timeout = '%s';\n" "$lt"
        sed "1,80s/^SET lock_timeout = 0;\$/SET lock_timeout = '$lt';/"; } > "$out"
}

# 🔴 Нова таблиця стартує БЕЗ статистики (заміряно на 2,27 млн рядків, і рецензентом,
# і мною: одразу після заміни pg_stats = 0 рядків, last_analyze NULL), і планувальник
# сліпий, доки не прийде autoanalyze (у рецензента він сів за 15 с). ANALYZE на цій
# таблиці 1,6 с — дешевше за це вікно; так робить і
# scripts/osm-pipeline/load-route-poi.sh. Заміна створює таблицю заново, і відкат
# теж: статистики немає в обох випадках.
# Викликається ПІСЛЯ коміту, окремою командою, а не в транзакції заміни: там він
# продовжив би ACCESS EXCLUSIVE. Блокує лише інші ANALYZE/VACUUM; читачів і запис
# не чіпає. Збій тут не вирок (код виходу не міняє, autoanalyze дожене), але й не
# мовчить: попередження psql теж друкується (не власник і не суперкористувач:
# ANALYZE пропускає таблицю й виходить з кодом 0).
analyze_table() {
  local out rc t0
  t0=$(date +%s)
  out="$(psql "$DATABASE_URL" -q -c "analyze $TABLE" 2>&1)"; rc=$?
  if [ "$rc" = 0 ] && [ -z "$out" ]; then
    echo "ANALYZE $TABLE: статистику зібрано за $(( $(date +%s) - t0 )) с"
  else
    echo "⚠ ANALYZE $TABLE не вдався чисто (код $rc), статистику дожене autoanalyze: $(printf '%s' "$out" | head -2)"
  fi
}

before_rows=$(q "select count(*) from $TABLE" 2>/dev/null || echo 0)
echo "прод до заміни: $before_rows рядків"

# 🔴 ЧИ ТАБЛИЦЮ ВЗАГАЛІ МОЖНА ЗНЯТИ. Це швидка зупинка з назвою залежного
# об'єкта (подання, чужий зовнішній ключ) ДО копії, що на проді триває хвилини.
# Безпека заміни від проби НЕ залежить: проба лише звужує вікно, а подання
# може з'явитись і після неї — тому сама заміна атомарна. Проба сама стає в
# чергу на ACCESS EXCLUSIVE, тож обмежена тим самим lock_timeout.
if ! drop_err=$(psql -q "$DATABASE_URL" -At -c "begin; set local lock_timeout = '$LOCK_TIMEOUT'; drop table if exists $TABLE; rollback" 2>&1); then
  echo "✗ DROP TABLE на проді не пройде — заміну НЕ роблю, нічого не змінено:"
  printf '%s\n' "$drop_err" | head -4
  exit 1
fi

pg_dump -Fc "$DATABASE_URL" -t "$TABLE" -f "$B" || { echo "✗ копію зняти не вдалось"; exit 1; }
echo "страхувальна копія: $(( $(wc -c < "$B") / 1048576 )) МБ → $B"

# Стан прода ДО заміни — з ним звіряється відкат і перевірка «нічого не змінилось».
prod_schema "$RW/pre.sql" || { echo "✗ схему прода зняти не вдалось — відкат звіряти було б нема з чим, заміну НЕ роблю"; exit 1; }
prod_acl "$RW/pre_acl.sql" || { echo "✗ власника й права прода зняти не вдалось — відкат звіряти було б нема з чим, заміну НЕ роблю"; exit 1; }
norm_schema < "$RTMP/camptribe-move-schema.sql" > "$RW/src.sql" || { echo "✗ схема джерела порожня — звіряти нема з чим, заміну НЕ роблю"; exit 1; }

# 🔴 РЕПЕТИЦІЯ ВІДКАТУ ДО ЗАМІНИ. Копія, з якої не відновлювались, не існує.
# 🔴 Власник репетиційної бази. У бойовому URL є `user:pass@host`, у
# самоперевірці користувача немає зовсім — і наївне `cut -d: -f1` у
# другому випадку віддає «localhost», тобто роль, якої не існує.
rest="${DATABASE_URL#*://}"
userinfo="${rest%%@*}"
if [ "$userinfo" = "$rest" ]; then OWNER="$(id -un)"; else OWNER="${userinfo%%:*}"; fi
$DROPDB --if-exists "$REHEARSAL_DB"
$CREATEDB -O "$OWNER" "$REHEARSAL_DB" || { echo "✗ репетиційну базу не створив"; exit 1; }
$PSQL_SUPER -q -d "$REHEARSAL_DB" -c 'CREATE EXTENSION IF NOT EXISTS postgis'
# URL репетиційної бази: назву бази підміняємо, а `?sslmode=…` та інші параметри
# підключення лишаємо (`${DATABASE_URL%/*}` губив їх, і репетиція йшла б не так, як прод).
url_base="${DATABASE_URL%%\?*}"; url_query=""
case "$DATABASE_URL" in *\?*) url_query="?${DATABASE_URL#*\?}" ;; esac
SCRATCH="${url_base%/*}/$REHEARSAL_DB$url_query"
t0=$(date +%s)
pg_restore -d "$SCRATCH" --clean --if-exists --no-owner --no-acl "$B" >/dev/null 2>"$RW/rehearsal.err"
rc_reh=$?
t1=$(date +%s)
R=$(psql "$SCRATCH" -At -c "select count(*) from $TABLE" 2>/dev/null || echo 0)
$DROPDB "$REHEARSAL_DB"
echo "репетиція відкату: $(( t1 - t0 )) с, $R рядків у відновленій копії"
# 🔴 Порожній результат — це провал, а не тиша.
if [ "${R:-0}" -lt $(( before_rows / 2 )) ]; then
  echo "✗ копія віддала $R рядків проти $before_rows на проді — відкотитись на неї не вийде, заміну НЕ роблю"
  head -3 "$RW/rehearsal.err"
  exit 1
fi
# 🔴 Ворота за рядками сліпі при нулі: 0 < 0 ніколи не істинне, тож порожню
# копію від копії, що просто не відновилась, там відрізняє лише код відновлення.
if [ "$before_rows" = 0 ] && [ "$rc_reh" != 0 ]; then
  echo "✗ порожню таблицю копія не відновила без помилок (код $rc_reh) — відкотитись на неї не вийде, заміну НЕ роблю"
  head -3 "$RW/rehearsal.err"
  exit 1
fi

# --- заміна: ОДНА транзакція ---
# 🔴 БЕЗ `-t`: дамп однієї таблиці його не потребує, а він відкидає індекси,
# ключі, послідовність, DEFAULT і тригери (див. шапку). `--no-owner --no-acl`:
# власник і права джерела (ноутбука) прод не стосуються — власник і права
# ПРОДА дописуються нижче в ту саму транзакцію.
make_script "$RTMP/camptribe-move.dump" "$RW/swap.sql" "$LOCK_TIMEOUT" --no-owner --no-acl \
  || { echo "✗ не вдалось зібрати скрипт заміни — прод не торкнуто"; exit 1; }
cat "$RW/pre_acl.sql" >> "$RW/swap.sql"
# 🔴 Ворота ще раз: між першою перевіркою й цим місцем — копія й репетиція, тобто
# хвилини. Відмова тут чиста: прод ще не торкнуто.
need_closed_gate 'перед заміною' || { echo "прод не торкнуто; копія лежить у $B"; exit 1; }
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -1 -f "$RW/swap.sql" >/dev/null 2>"$RW/restore.err"
rc_restore=$?
rows=$(q "select count(*) from $TABLE" 2>/dev/null || echo 'таблиці немає')
echo "після заміни: $rows рядків, відновлення вийшло з кодом $rc_restore"

# Код виходу — перша ознака, і єдина, що відрізнить «заміна відбулась» від
# «нічого не змінилось», коли прод уже збігався з джерелом: рядки й схема
# однакові в обох випадках.
if [ "$rc_restore" != 0 ]; then
  echo "🔴 відновлення вийшло з кодом $rc_restore, транзакцію відкотив сам psql:"; head -4 "$RW/restore.err"
  # Не вірити, а ПЕРЕВІРИТИ, що прод справді такий, як був. Рядки не порівнюємо:
  # в таблицю можуть писати. Відкату тут НЕМАЄ: нічого не закомічено, а копія
  # старіша за те, що встигли дописати.
  if same_as_pre abort; then
    echo "заміна не відбулась: структура, власник і права прода такі самі, як до спроби (рядків зараз $rows)"
    exit 1
  fi
  echo "🔴 прод відрізняється від стану до спроби: структура, власник чи права (- до, + тепер):"; show_diff abort
  echo "   відкат НЕ роблю: заміна не закомітилась, відкочувати нічого; хтось змінював прод під час спроби. Копія: $B"
  exit 4
fi

ok=1
if [ "$rows" != "$SRC_ROWS" ]; then
  echo "🔴 рядків $rows проти $SRC_ROWS у джерелі"; ok=0
fi
if prod_schema "$RW/post.sql" && diff -u "$RW/src.sql" "$RW/post.sql" > "$RW/schema.diff"; then
  schema_ok=1
else
  schema_ok=0
fi
if [ "$schema_ok" != 1 ]; then
  echo "🔴 структура прода не збігається з джерелом (- джерело, + прод):"
  if [ -s "$RW/schema.diff" ]; then head -20 "$RW/schema.diff"; else echo "   схему прода зняти не вдалось"; fi
  ok=0
fi
# Власник і права прода: кожен рядок, що був до заміни, мусить бути й після.
acl_lost="$(prod_acl "$RW/post.acl" && comm -23 <(sort "$RW/pre_acl.sql") <(sort "$RW/post.acl") || echo 'власника й права прода зняти не вдалось')"
if [ -n "$acl_lost" ]; then
  echo "🔴 власник чи права, які мав прод до заміни, загублено:"; printf '%s\n' "$acl_lost" | head -5
  ok=0
fi

if [ "$ok" != 1 ]; then
  echo "повертаю страхувальну копію"
  # 🔴 Теж БЕЗ `-t`, і БЕЗ `--no-owner --no-acl`: копія прода — це і є прод, а
  # з цими прапорцями вона віддавала таблицю без грантів і з чужим власником
  # (роль застосунку отримувала `permission denied`), а звірка їх не бачила.
  # Після відкату стан звіряється з тим, що було ДО заміни.
  if make_script "$B" "$RW/rb.sql" "$RB_LOCK_TIMEOUT"; then
    psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -1 -f "$RW/rb.sql" >/dev/null 2>"$RW/rollback.err"
    rc_rb=$?
  else
    rc_rb=1; echo "✗ не вдалось зібрати скрипт відкату з копії" > "$RW/rollback.err"
  fi
  rb_rows=$(q "select count(*) from $TABLE" 2>/dev/null || echo 'таблиці немає')
  # Рядки — проти того, що лежить у КОПІЇ (R, порахував репетицією), а не проти
  # `before_rows`, знятого до неї: запис у таблицю між ними дав би хибний код 4.
  # 🔴 Код відновлення відкату ГЕЙТИТЬ вердикт. Попередня версія казала «відкат
  # атомарний, вердикт дає звірка стану» — і помилялась: коли прод ПІСЛЯ заміни
  # збігається з продом ДО заміни за всім, що звіряється (рядків у копії стільки ж,
  # скільки в заміненій; структура прода вже дорівнює структурі джерела; власник і
  # права дописано в саму заміну), відкат міг УПАСТИ (читач у черзі, lock_timeout),
  # а звірка однаково була зеленою: «повернуто й звірено» над таблицею, яку не
  # повернули (на проді: 0 рядків прода, 500 джерела, код 3). Саме ЗБІЖНІСТЬ
  # лічильників ховає провал, тож лише код відновлення його відрізняє. Природний
  # вхід на проді: запис у ЛОКАЛЬНУ таблицю між `select count(*)` і `pg_dump`.
  if [ "$rc_rb" = 0 ] && [ "$rb_rows" = "$R" ] && same_as_pre rb; then
    analyze_table
    echo "повернуто й звірено: $rb_rows рядків, структура, власник і права такі самі, як до заміни (відновлення відкату: код $rc_rb)"
    exit 3
  fi
  echo "🔴 ВІДКАТ НЕ ЗВІРИВСЯ (відновлення відкату: код $rc_rb): рядків $rb_rows проти $R у копії"
  [ "$rc_rb" != 0 ] && echo "   відновлення відкату ВПАЛО: таблицю НЕ повернуто, хоч рядки й структура можуть збігатись із копією"
  # Заголовок лише коли діф є: у збіжному випадку (рядки, структура, власник, права
  # однакові, але відкат упав) він стояв би над порожнім місцем.
  if [ -s "$RW/rb.diff" ] || [ -s "$RW/rb.acldiff" ]; then
    echo "   відрізняється від стану до заміни (- до, + тепер):"; show_diff rb
  fi
  head -3 "$RW/rollback.err"
  echo "   прод у невідомому стані; копія лежить у $B — віднови вручну й перевір"
  exit 4
fi
analyze_table
echo "✓ відновлення без помилок, $rows рядків, структура збігається з джерелом, власник і права на місці"
REMOTE
} > "$WORK/remote.sh"
# 🔴 ДОВЕСТИ, ЩО ФУНКЦІЯ ДОЇХАЛА. Скрипт під `set -uo pipefail` без
# `-e`: якщо `cat lib/env-value.sh` упаде, генерація все одно віддасть
# код 0 і запише СИНТАКСИЧНО ВАЛІДНИЙ `remote.sh` без `env_value` — а на
# машині це 127, яке спрацювало б як «у .env немає DATABASE_URL», тобто
# з хибною причиною. Заміряно рецензією.
grep -q '^env_value()' "$WORK/remote.sh" \
  || die 'у згенерованому remote.sh немає env_value — вшивання lib/env-value.sh не вдалось' 

"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/remote.sh" "$HOST:$RTMP/camptribe-move-remote.sh" >/dev/null \
  || die 'не вдалось доставити виконавця'
set +e
ssh_ "bash $RTMP/camptribe-move-remote.sh $(printf '%q %q %q %q %q %q %q %q' "$TABLE" "$src_rows" "$BACKUP_DIR" "$REMOTE_ENV" "$RTMP" "$LOCK_TIMEOUT" "$RB_LOCK_TIMEOUT" "$ALLOW_OPEN")"
rc=$?
set -e
ssh_ "rm -f $RTMP/camptribe-move.dump $RTMP/camptribe-move-schema.sql $RTMP/camptribe-move-remote.sh" >/dev/null 2>&1 || true
exit $rc
