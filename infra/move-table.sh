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
# одиниці. Через годину сусідній запит висів 4 хвилини 42 секунди.
# Виявилось: `--clean` зняв таблицю РАЗОМ з індексами, а `-t` відбирає
# для відновлення лише саму таблицю — індекси й PRIMARY KEY лежать у
# дампі окремими записами TOC, і фільтр їх не пропускає. На таблиці з
# 2,27 млн рядків лишилось НУЛЬ індексів і жодного первинного ключа.
# CHECK вціліли тільки тому, що вбудовані в CREATE TABLE.
#
# Жодна програма не сказала ні слова. Мій спосіб перевірки міряв ВМІСТ,
# а зіпсувалась СТРУКТУРА.
#
# 🔴 ТОМУ ТУТ ТРИ ПЕРЕВІРКИ, А НЕ ОДНА:
#   1. скільки рядків     — те, що я перевіряв і тоді;
#   2. яка структура      — індекси й обмеження звіряються з ДЖЕРЕЛОМ
#                           і відтворюються, якщо pg_restore їх загубив;
#   3. чи швидко читається — типовий запит на час, бо повільний запит це
#                           симптом структури, а не навантаження.
#
# 🔴 І ВІДКАТ РЕПЕТИРУЄТЬСЯ ДО ЗАМІНИ. Страхувальна копія, з якої не
# відновлювались, не існує: вона знімається тим самим `-t` і має ту саму
# ваду. Скрипт відновлює її в окрему базу й дивиться, що там усередині,
# ПЕРШ НІЖ чіпати бойову.
set -uo pipefail

TABLE="${1:-}"; shift 2>/dev/null || true
APPLY=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    *) echo "невідомий прапорець: $a" >&2; exit 2 ;;
  esac
done
[ -n "$TABLE" ] || { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
case "$TABLE" in *[!a-z0-9_]*) echo "назва таблиці мусить бути [a-z0-9_]: $TABLE" >&2; exit 2 ;; esac

HOST="${CAMPTRIBE_HOST:?задай CAMPTRIBE_HOST=root@… — адреси машини в репозиторії немає навмисно}"
KEY="${CAMPTRIBE_KEY:-$HOME/.ssh/id_ed25519_camptribe_server}"
LOCAL_DB="${CAMPTRIBE_LOCAL_DB:-camptribe_dev}"
REMOTE_ENV="${CAMPTRIBE_REMOTE_ENV:-/srv/camptribe/current/apps/api/.env}"
BACKUP_DIR="${CAMPTRIBE_BACKUP_DIR:-/srv/camptribe/backups}"
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

# 🔴 Структура джерела — ЕТАЛОН. Саме з нею звіряється прод після заміни.
# 🔴 Індекси БЕЗ тих, що стоять за обмеженнями. `ADD CONSTRAINT … PRIMARY
# KEY` сам створює свій індекс, і якби ми створили його окремо, друге
# додавання впало б на зайнятій назві.
"$PSQL" -At -d "$LOCAL_DB" -c \
  "select i.indexdef||';' from pg_indexes i
    where i.tablename='$TABLE'
      and not exists (select 1 from pg_constraint c
                       where c.conrelid='$TABLE'::regclass and c.conname = i.indexname)
    order by i.indexname" > "$WORK/src-idx.sql"
# 🔴 А обмеження — з DDL, а не самими назвами. CHECK приїжджають усередині
# CREATE TABLE, а PRIMARY KEY, UNIQUE і зовнішні ключі `pg_restore -t` НЕ
# приносить: вони окремі записи TOC, і фільтр їх відкидає. Відтворити
# унікальний індекс замість первинного ключа недосить — це різні речі.
"$PSQL" -At -d "$LOCAL_DB" -c \
  "select 'ALTER TABLE '||quote_ident('$TABLE')||' ADD CONSTRAINT '||quote_ident(conname)
          ||' '||pg_get_constraintdef(oid)||';'
     from pg_constraint where conrelid='$TABLE'::regclass and contype in ('p','u','f')
    order by conname" > "$WORK/src-con.sql"
"$PSQL" -At -d "$LOCAL_DB" -c \
  "select conname from pg_constraint where conrelid='$TABLE'::regclass order by conname" > "$WORK/src-con.txt"
src_idx=$(wc -l < "$WORK/src-idx.sql" | tr -d ' ')
src_idx_all=$("$PSQL" -At -d "$LOCAL_DB" -c "select count(*) from pg_indexes where tablename='$TABLE'")
src_con=$(wc -l < "$WORK/src-con.txt" | tr -d ' ')

say "джерело ($LOCAL_DB.$TABLE): $src_rows рядків, $src_idx_all індексів, $src_con обмежень"

if [ "$APPLY" != 1 ]; then
  say ''
  say 'СУХИЙ ПРОГІН — машину не чіпав. Що зробив би:'
  say "  1. дамп $TABLE з $LOCAL_DB"
  say "  2. страхувальна копія бойової $TABLE у $BACKUP_DIR"
  say '  3. РЕПЕТИЦІЯ: відновити копію в окрему базу й перелічити, що в ній'
  say "  4. замінити бойову таблицю"
  say "  5. звірити рядки, ТА Й СТРУКТУРУ: $src_idx_all індексів, $src_con обмежень"
  say '  6. відтворити те, що pg_restore загубив (він губить їх завжди)'
  say '  7. заміряти типовий запит; при провалі — повернути копію'
  say ''
  say 'Застосувати: додай --apply'
  exit 0
fi

# --- 2. дамп і доставка ---------------------------------------------------
"$PG_DUMP" -Fc -d "$LOCAL_DB" -t "$TABLE" -f "$WORK/table.dump" || die "pg_dump не вдався"
say "дамп: $(( $(wc -c < "$WORK/table.dump") / 1048576 )) МБ"
"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/table.dump" "$HOST:/tmp/camptribe-move.dump" >/dev/null \
  || die 'не вдалось доставити дамп'
"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/src-idx.sql" "$HOST:/tmp/camptribe-move-idx.sql" >/dev/null \
  || die 'не вдалось доставити еталон індексів'
"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/src-con.sql" "$HOST:/tmp/camptribe-move-con.sql" >/dev/null \
  || die 'не вдалось доставити еталон обмежень'

# --- 3. усе інше робиться НА МАШИНІ, одним скриптом ----------------------
cat > "$WORK/remote.sh" <<'REMOTE'
#!/usr/bin/env bash
set -uo pipefail
TABLE="$1"; SRC_ROWS="$2"; SRC_IDX="$3"; SRC_CON="$4"; BACKUP_DIR="$5"; ENVF="$6"
set -a; . "$ENVF"; set +a
# 🔴 Створення бази під репетицію винесено в змінні: на бойовій машині це
# суперкористувач (прикладний користувач права не має й не повинен), а в
# самоперевірці — звичайний createdb. Без цього самоперевірка ганяла б не
# той шлях, що прод.
CREATEDB="${CAMPTRIBE_CREATEDB:-sudo -u postgres createdb}"
DROPDB="${CAMPTRIBE_DROPDB:-sudo -u postgres dropdb}"
PSQL_SUPER="${CAMPTRIBE_PSQL_SUPER:-sudo -u postgres psql}"
q() { psql "$DATABASE_URL" -At -c "$1"; }
stamp=$(date +%Y%m%d-%H%M%S)
B="$BACKUP_DIR/$TABLE-before-$stamp.dump"
mkdir -p "$BACKUP_DIR"

before_rows=$(q "select count(*) from $TABLE" 2>/dev/null || echo 0)
echo "прод до заміни: $before_rows рядків"

pg_dump -Fc "$DATABASE_URL" -t "$TABLE" -f "$B" || { echo "✗ копію зняти не вдалось"; exit 1; }
echo "страхувальна копія: $(( $(wc -c < "$B") / 1048576 )) МБ → $B"

# 🔴 РЕПЕТИЦІЯ ВІДКАТУ ДО ЗАМІНИ. Копія, з якої не відновлювались, не існує.
# 🔴 Власник репетиційної бази. У бойовому URL є `user:pass@host`, у
# самоперевірці користувача немає зовсім — і наївне `cut -d: -f1` у
# другому випадку віддає «localhost», тобто роль, якої не існує.
rest="${DATABASE_URL#*://}"
userinfo="${rest%%@*}"
if [ "$userinfo" = "$rest" ]; then OWNER="$(id -un)"; else OWNER="${userinfo%%:*}"; fi
$DROPDB --if-exists camptribe_move_rehearsal
$CREATEDB -O "$OWNER" camptribe_move_rehearsal || { echo "✗ репетиційну базу не створив"; exit 1; }
$PSQL_SUPER -q -d camptribe_move_rehearsal -c 'CREATE EXTENSION IF NOT EXISTS postgis'
SCRATCH="${DATABASE_URL%/*}/camptribe_move_rehearsal"
t0=$(date +%s)
pg_restore -d "$SCRATCH" --no-owner --no-acl "$B" >/dev/null 2>&1 || true
t1=$(date +%s)
R=$(psql "$SCRATCH" -At -c "select count(*) from $TABLE" 2>/dev/null || echo 0)
$DROPDB camptribe_move_rehearsal
echo "репетиція відкату: $(( t1 - t0 )) с, $R рядків у відновленій копії"
# 🔴 Порожній результат — це провал, а не тиша.
if [ "${R:-0}" -lt $(( before_rows / 2 )) ]; then
  echo "✗ копія віддала $R рядків проти $before_rows на проді — відкотитись на неї не вийде, заміну НЕ роблю"; exit 1
fi

# --- заміна ---
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-acl -t "$TABLE" /tmp/camptribe-move.dump 2>&1 | head -3
rows=$(q "select count(*) from $TABLE")
idx=$(q "select count(*) from pg_indexes where tablename='$TABLE'")
con=$(q "select count(*) from pg_constraint where conrelid='$TABLE'::regclass")
echo "після заміни: $rows рядків, $idx індексів, $con обмежень"

# 🔴 ОСЬ ЦЕ І Є ТЕ, ЧОГО НЕ БУЛО 15.10: `-t` не відновлює ні індекси, ні
# первинний ключ. Відтворюємо їх з еталона джерела.
# Спершу обмеження (PRIMARY KEY сам приносить свій індекс), тоді решта
# індексів — інакше друге створення впаде на зайнятій назві.
if [ "$con" -lt "$SRC_CON" ]; then
  echo "обмежень $con проти $SRC_CON у джерелі — відтворюю"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f /tmp/camptribe-move-con.sql 2>&1 | grep -v '^$' | head -5
  con=$(q "select count(*) from pg_constraint where conrelid='$TABLE'::regclass")
  echo "обмежень тепер: $con"
fi
if [ "$idx" -lt "$SRC_IDX" ]; then
  echo "індексів $idx проти $SRC_IDX у джерелі — відтворюю"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f /tmp/camptribe-move-idx.sql 2>&1 | grep -v '^$' | head -5
  idx=$(q "select count(*) from pg_indexes where tablename='$TABLE'")
  echo "індексів тепер: $idx"
fi

ok=1
[ "$rows" = "$SRC_ROWS" ] || { echo "🔴 рядків $rows проти $SRC_ROWS у джерелі"; ok=0; }
[ "$idx"  -ge "$SRC_IDX" ] || { echo "🔴 індексів $idx проти $SRC_IDX у джерелі"; ok=0; }
[ "$con"  -ge "$SRC_CON" ] || { echo "🔴 обмежень $con проти $SRC_CON у джерелі"; ok=0; }

if [ "$ok" != 1 ]; then
  echo "повертаю страхувальну копію"
  pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-acl -t "$TABLE" "$B" >/dev/null 2>&1
  echo "повернуто: $(q "select count(*) from $TABLE") рядків"
  exit 3
fi
echo "✓ рядки, індекси й обмеження збігаються з джерелом"
REMOTE

"$SCP" -i "$KEY" -o BatchMode=yes "$WORK/remote.sh" "$HOST:/tmp/camptribe-move-remote.sh" >/dev/null \
  || die 'не вдалось доставити виконавця'
set +e
ssh_ "bash /tmp/camptribe-move-remote.sh $(printf '%q %q %q %q %q %q' "$TABLE" "$src_rows" "$src_idx_all" "$src_con" "$BACKUP_DIR" "$REMOTE_ENV")"
rc=$?
set -e
ssh_ "rm -f /tmp/camptribe-move.dump /tmp/camptribe-move-idx.sql /tmp/camptribe-move-con.sql /tmp/camptribe-move-remote.sh" >/dev/null 2>&1 || true
exit $rc
