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
# Тому `-t` тут є лише на ЗНЯТТІ дампу (pg_dump) і ніколи — на відновленні:
# ні на заміні, ні на відкаті, ні на репетиції.
#
# Що зроблено інакше, ніж першою спробою (яка лікувала симптом: звіряла три
# лічильники — рядки, індекси, обмеження — і відтворювала втрачене сама):
#   1. Структуру не відтворюємо, бо вона не губиться. Лічильників немає:
#      вони були сліпі до послідовностей, DEFAULT, тригерів і EXCLUDE.
#   2. Після заміни звіряється ТЕКСТ `pg_dump --schema-only -t T` джерела й
#      прода (див. norm_schema нижче: що саме нормалізується і чому), плюс
#      код виходу pg_restore і кількість рядків.
#   3. Відкат репетирується ДО заміни, а після відкату ЗВІРЯЄТЬСЯ з тим, що
#      було до заміни (рядки й схема). Код виходу: 3 — повернули й звірили,
#      4 — відкат не звірився, прод у невідомому стані.
#   4. До будь-яких змін пробується `DROP TABLE` у відкочуваній транзакції:
#      без `-t` pg_restore --clean знімає індекси ПЕРЕД таблицею, і якщо таблицю
#      зняти не можна (подання, чужий зовнішній ключ), залишає її зі зламаною
#      структурою та подвоєними рядками. Це ціна прибраного `-t`, заміряна.
set -uo pipefail

TABLE="${1:-}"; shift 2>/dev/null || true
APPLY=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
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
# Куди на машині класти те, що їде з ноутбука. На проді /tmp; самоперевірка
# підставляє свою теку, щоб два прогони поруч не топтали файли один одного.
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
  say "  1. дамп $TABLE з $LOCAL_DB (pg_dump -Fc -t) і її схема текстом (pg_dump --schema-only -t)"
  say '  2. перевірити, що DROP TABLE на проді пройде (подання чи чужий зовнішній ключ його б зупинили)'
  say "  3. страхувальна копія бойової $TABLE у $BACKUP_DIR"
  say '  4. РЕПЕТИЦІЯ: відновити копію в окрему базу й порахувати рядки в ній'
  say '  5. замінити бойову таблицю: pg_restore --clean --if-exists, БЕЗ -t'
  say "  6. звірити: pg_restore без помилок, $src_rows рядків, схема прода = схема джерела (текстом)"
  say '  7. невдача — повернути копію й ЗВІРИТИ відкат: рядки й схема такі самі, як до заміни'
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
cat > "$WORK/remote.sh" <<'REMOTE'
#!/usr/bin/env bash
set -uo pipefail
TABLE="$1"; SRC_ROWS="$2"; BACKUP_DIR="$3"; ENVF="$4"; RTMP="$5"
set -a
# shellcheck source=/dev/null
. "$ENVF"
set +a
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
# Власник і права прибрано не тут, а прапорцями --no-owner --no-acl на знятті.
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

before_rows=$(q "select count(*) from $TABLE" 2>/dev/null || echo 0)
echo "прод до заміни: $before_rows рядків"

# 🔴 ЧИ ТАБЛИЦЮ ВЗАГАЛІ МОЖНА ЗНЯТИ. Без `-t` pg_restore --clean виконує ВСІ
# записи дампа по черзі: спершу знімає індекси, обмеження, DEFAULT і тригери,
# і лише потім саму таблицю. Якщо таблицю зняти не можна (від неї залежить
# подання чи зовнішній ключ іншої таблиці), структуру вже знято, а дані
# дописано поверх старих. Заміряно на поданні: на проді 1000 рядків без жодного
# ключа, а відкат дописав ще 500 (1500). З `-t` цього не бувало лише тому, що
# `-t` не знімав і індексів. Тож пробуємо ТЕ САМЕ `DROP TABLE` у транзакції,
# яку одразу відкочуємо: Postgres сам називає залежний об'єкт.
if ! drop_err=$(psql -q "$DATABASE_URL" -At -c "begin; set local lock_timeout = '10s'; drop table if exists $TABLE; rollback" 2>&1); then
  echo "✗ DROP TABLE на проді не пройде — заміну НЕ роблю, нічого не змінено:"
  printf '%s\n' "$drop_err" | head -4
  exit 1
fi

pg_dump -Fc "$DATABASE_URL" -t "$TABLE" -f "$B" || { echo "✗ копію зняти не вдалось"; exit 1; }
echo "страхувальна копія: $(( $(wc -c < "$B") / 1048576 )) МБ → $B"

# Стан прода ДО заміни — з ним звіряється відкат.
prod_schema "$RW/pre.sql" || { echo "✗ схему прода зняти не вдалось — відкат звіряти було б нема з чим, заміну НЕ роблю"; exit 1; }
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
SCRATCH="${DATABASE_URL%/*}/$REHEARSAL_DB"
t0=$(date +%s)
pg_restore -d "$SCRATCH" --clean --if-exists --no-owner --no-acl "$B" >/dev/null 2>"$RW/rehearsal.err"
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

# --- заміна ---
# 🔴 БЕЗ `-t`: дамп однієї таблиці його не потребує, а він відкидає індекси,
# ключі, послідовність, DEFAULT і тригери (див. шапку).
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-acl "$RTMP/camptribe-move.dump" 2>"$RW/restore.err"
rc_restore=$?
rows=$(q "select count(*) from $TABLE" 2>/dev/null || echo 'таблиці немає')
echo "після заміни: $rows рядків, pg_restore вийшов з кодом $rc_restore"

# Три незалежні сигнали, кожен названо окремо. Рядки й схема самі не відрізнять
# «заміна відбулась» від «нічого не змінилось», коли прод уже був таким, як
# джерело, — це відрізняє лише код виходу pg_restore.
ok=1
if [ "$rc_restore" != 0 ]; then
  echo "🔴 pg_restore вийшов з кодом $rc_restore:"; head -3 "$RW/restore.err"; ok=0
fi
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

if [ "$ok" != 1 ]; then
  echo "повертаю страхувальну копію"
  # 🔴 Теж БЕЗ `-t`, і код виходу не ховається: першою спробою відкат
  # відтворював той самий інцидент — таблицю без жодного індексу — і писав
  # «повернуто». Тому після нього звіряється стан із тим, що був ДО заміни.
  pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-acl "$B" 2>"$RW/rollback.err"
  rc_rb=$?
  rb_rows=$(q "select count(*) from $TABLE" 2>/dev/null || echo 'таблиці немає')
  if prod_schema "$RW/rb.sql" && diff -u "$RW/pre.sql" "$RW/rb.sql" > "$RW/rb.diff"; then rb_schema=1; else rb_schema=0; fi
  if [ "$rb_rows" = "$before_rows" ] && [ "$rb_schema" = 1 ]; then
    echo "повернуто й звірено: $rb_rows рядків, структура така сама, як до заміни (pg_restore відкату: код $rc_rb)"
    exit 3
  fi
  echo "🔴 ВІДКАТ НЕ ЗВІРИВСЯ (pg_restore відкату: код $rc_rb): рядків $rb_rows проти $before_rows до заміни"
  if [ "$rb_schema" != 1 ]; then
    echo "   структура відрізняється від тієї, що була до заміни (- до, + тепер):"
    if [ -s "$RW/rb.diff" ]; then head -20 "$RW/rb.diff"; else echo "   схему прода зняти не вдалось"; fi
  fi
  head -3 "$RW/rollback.err"
  echo "   прод у невідомому стані; копія лежить у $B — віднови вручну й перевір"
  exit 4
fi
echo "✓ pg_restore без помилок, $rows рядків, структура збігається з джерелом"
REMOTE

"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/remote.sh" "$HOST:$RTMP/camptribe-move-remote.sh" >/dev/null \
  || die 'не вдалось доставити виконавця'
set +e
ssh_ "bash $RTMP/camptribe-move-remote.sh $(printf '%q %q %q %q %q' "$TABLE" "$src_rows" "$BACKUP_DIR" "$REMOTE_ENV" "$RTMP")"
rc=$?
set -e
ssh_ "rm -f $RTMP/camptribe-move.dump $RTMP/camptribe-move-schema.sql $RTMP/camptribe-move-remote.sh" >/dev/null 2>&1 || true
exit $rc
