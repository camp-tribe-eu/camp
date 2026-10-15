#!/usr/bin/env bash
# Self-test для infra/move-table.sh.
#
#   ./infra/move-table.selftest.sh          # потрібен локальний Postgres і право створювати ролі
#
# 🔴 ЩО ТУТ СПРАВЖНЄ. Дві справжні бази Postgres, справжні `pg_dump`,
# `pg_restore` і `psql`. Підмінено рівно двоє: `ssh` і `scp` — бо другої
# машини тут немає. Підмінник ssh НЕ імітує результат: він запускає той самий
# виконавець `remote.sh` локально, проти справжньої «бойової» бази. Жодного
# гачка у `pg_restore`/`psql`: усі відмови нижче створює сам Postgres.
#
# 🔴 СВІТ МУСИТЬ МІСТИТИ ТЕ, ЧОГО ПЕРША ВЕРСІЯ НЕ БАЧИЛА. Таблиця — це
# `id serial PRIMARY KEY`, UNIQUE, CHECK, EXCLUDE, два індекси, тригер і
# коментар; на проді вона належить НЕТИПОВОМУ власнику й має ГРАНТ для ролі
# застосунку (на таблицю й на послідовність). Без власника й грантів набір
# був би сліпий до того, що `--no-owner --no-acl` на відкаті віддає таблицю,
# з якою застосунок отримує `permission denied`.
#
# 🔴 ЧУЖІ ПРОЦЕСИ. Те, чого скрипт не контролює — подання, що з'явилось між
# пробою й заміною, читач, що тримає блокування, чужий CREATE INDEX — тут
# робить окремий фоновий psql, який чекає на справжню подію (з'явилась копія;
# чиясь заміна стала в чергу на ACCESS EXCLUSIVE). Скрипт не знає про нього.
#
# 🔴 ЯК СТВОРЮЮТЬСЯ ВІДМОВИ БЕЗ ПІДМІН. `pg_dump -t` не возить ТИПИ й
# ФУНКЦІЇ (у TOC 0 записів TYPE). Звідси: тип є лише в джерелі → заміна падає;
# тип є лише на проді → копія не відновлюється в чистій базі; функції тригера
# немає → CREATE TRIGGER падає. А event trigger на проді дає те, чого не дає
# жодна відмова: заміна ПРОХОДИТЬ (код 0), а схема розходиться.
#
# 🔴 ЛІЧИЛЬНИК. «N cases» — підпис, а не перевірка. EXPECTED записано;
# останній рядок друкується лише коли виконаних стільки ж.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOVE="${CAMPTRIBE_MOVE_BIN:-$HERE/move-table.sh}"
EXPECTED=42
# 🔴 Де брати базу. Локально це сокет і поточний користувач; у CI —
# сервіс postgis/postgis із користувачем postgres. Один рядок замість
# двох шляхів у коді.
PG_BASE="${CAMPTRIBE_SELFTEST_PG_BASE:-postgres://localhost:5432}"
# 🔴 Назви баз і ролей із префіксом: два прогони поруч (чужий і мій) не мають
# права скидати бази одне одного.
PREFIX="${CAMPTRIBE_SELFTEST_PREFIX:-camptribe_mv}"
SRC_DB="${PREFIX}_src"
DST_DB="${PREFIX}_dst"
REHEARSAL_DB="${PREFIX}_rehearsal"
ROLE_OWNER="${PREFIX}_owner"
ROLE_API="${PREFIX}_api"
TABLE=mv_probe

[ -f "$MOVE" ] || { echo "немає $MOVE" >&2; exit 1; }
command -v psql >/dev/null || { echo 'немає psql' >&2; exit 1; }
psql -At -d "$PG_BASE/postgres" -c 'select 1' >/dev/null 2>&1 || { echo 'локальний Postgres не відповідає' >&2; exit 1; }

BASE="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-move-selftest.XXXXXX")"
cleanup() {
  # фонових psql прибираємо першими: сесія на базі не дає її скинути
  # shellcheck disable=SC2046
  kill $(jobs -p) 2>/dev/null; wait 2>/dev/null
  dropdb --if-exists --force "$SRC_DB" 2>/dev/null; dropdb --if-exists --force "$DST_DB" 2>/dev/null
  dropdb --if-exists --force "$REHEARSAL_DB" 2>/dev/null
  psql -q -d "$PG_BASE/postgres" -c "DROP ROLE IF EXISTS \"$ROLE_API\", \"$ROLE_OWNER\"" 2>/dev/null
  rm -rf "$BASE"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

PASS=0; FAIL=0; RUN=0; SKIPPED=0
pass() { RUN=$((RUN+1)); PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { RUN=$((RUN+1)); FAIL=$((FAIL+1)); printf '  ✗ %s\n     %s\n' "$1" "${2-}"; }
ok()   { if [ "$1" = 0 ]; then pass "$2"; else fail "$2" "${3-}"; fi; }

# Ролі кластера: власник таблиці на проді (НЕ той, хто підключається) і роль
# застосунку, що лише читає. Створюються тут, скидаються в cleanup.
for r in "$ROLE_OWNER" "$ROLE_API"; do
  psql -q -d "$PG_BASE/postgres" -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$r') THEN CREATE ROLE \"$r\"; END IF; END \$\$" 2>&1 \
    || { echo "не можу створити роль $r — набору потрібне право CREATEROLE" >&2; exit 1; }
done

# --- світ: дві бази, у джерелі 500 рядків, на «проді» 300 -----------------
# За замовчуванням обидві з однаковою структурою. `build_world bare` робить
# прод ГОЛИМ: ті самі колонки, але без ключа, індексів, послідовності, тригера
# й коментаря. Це не косметика: коли старий прод уже має всю структуру,
# перевірка «структура приїхала» пасує і новій таблиці, і старій, яку скрипт
# повернув відкатом, — тобто нічого не доводить. На голому проді структура
# може взятись лише з дампа.
# Тригер потребує функції, і вона є в обох (pg_dump -t функцій не возить).
# На проді таблиця належить $ROLE_OWNER і має грант SELECT для $ROLE_API.
build_world() {
  dropdb --if-exists --force "$SRC_DB" 2>/dev/null; dropdb --if-exists --force "$DST_DB" 2>/dev/null
  createdb "$SRC_DB"; createdb "$DST_DB"
  local fn="CREATE FUNCTION mv_touch() RETURNS trigger LANGUAGE plpgsql
      AS \$f\$ BEGIN NEW.touched := true; RETURN NEW; END \$f\$;"
  local ddl="$fn
    CREATE TABLE $TABLE (
      id serial PRIMARY KEY,
      ref text NOT NULL UNIQUE,
      kind text NOT NULL,
      n int,
      rng int4range,
      touched boolean,
      CONSTRAINT ${TABLE}_kind_check CHECK (kind IN ('a','b','unknown')),
      CONSTRAINT ${TABLE}_no_overlap EXCLUDE USING gist (rng WITH &&)
    );
    CREATE INDEX idx_${TABLE}_kind_a ON $TABLE (n) WHERE kind = 'a';
    CREATE INDEX idx_${TABLE}_n ON $TABLE (n);
    CREATE TRIGGER ${TABLE}_touch BEFORE INSERT ON $TABLE FOR EACH ROW EXECUTE FUNCTION mv_touch();
    COMMENT ON TABLE $TABLE IS 'пробна таблиця самоперевірки';"
  psql -q -d "$SRC_DB" -c "$ddl"
  if [ "${1:-}" = bare ]; then
    # Послідовність у голого прода НАЛЕЖИТЬ колонці (інакше `pg_dump -t` її не
    # візьме) і має грант USAGE для ролі застосунку: нова послідовність з дампа
    # джерела його не має, і без перенесення застосунок не вставить жодного рядка.
    psql -q -d "$DST_DB" -c "$fn
      CREATE TABLE $TABLE (id integer, ref text, kind text, n int, rng int4range, touched boolean);
      CREATE SEQUENCE ${TABLE}_id_seq OWNED BY $TABLE.id"
  else
    psql -q -d "$DST_DB" -c "$ddl"
  fi
  psql -q -d "$SRC_DB" -c "INSERT INTO $TABLE (ref,kind,n,rng) SELECT 'r'||i, (ARRAY['a','b','unknown'])[1+i%3], i, int4range(i,i+1) FROM generate_series(1,500) i"
  psql -q -d "$DST_DB" -c "INSERT INTO $TABLE (ref,kind,n,rng) SELECT 'r'||i, 'b', i, int4range(i,i+1) FROM generate_series(1,300) i"
  psql -q -d "$DST_DB" -c "ALTER TABLE $TABLE OWNER TO \"$ROLE_OWNER\"" -c "GRANT SELECT ON $TABLE TO \"$ROLE_API\"" \
    -c "GRANT USAGE ON SEQUENCE ${TABLE}_id_seq TO \"$ROLE_API\""
}

# --- підмінники: ssh запускає виконавця локально, scp копіює ------------
mkdir -p "$BASE/bin" "$BASE/rtmp"
cat > "$BASE/bin/ssh" <<EOF
#!/usr/bin/env bash
# Підмінник ssh. Відкидає прапорці й хост, решту виконує ТУТ — тобто
# справжній remote.sh проти справжньої бази.
args=(); seen_host=0
while [ \$# -gt 0 ]; do
  case "\$1" in
    -i|-o) shift 2; continue ;;
    *) if [ "\$seen_host" = 0 ]; then seen_host=1; shift; continue; fi; args+=("\$1"); shift ;;
  esac
done
CAMPTRIBE_CREATEDB=createdb CAMPTRIBE_DROPDB=dropdb CAMPTRIBE_PSQL_SUPER=psql \
  bash -c "\${args[*]}"
EOF
cat > "$BASE/bin/scp" <<'EOF'
#!/usr/bin/env bash
# Підмінник scp: останній аргумент має вигляд host:/шлях — кладемо локально.
args=(); while [ $# -gt 0 ]; do case "$1" in -i|-o) shift 2;; *) args+=("$1"); shift;; esac; done
src="${args[0]}"; dst="${args[1]#*:}"
cp "$src" "$dst"
EOF
chmod +x "$BASE/bin/ssh" "$BASE/bin/scp"

ENVF="$BASE/prod.env"
# 🔴 Параметр підключення в URL (на проді це `?sslmode=…`): репетиційна база мусить
# отримати його теж, а `${DATABASE_URL%/*}` його губив.
printf 'DATABASE_URL=%s/%s?application_name=mvapp\n' "$PG_BASE" "$DST_DB" > "$ENVF"

# LOCALE, T_LOCK, T_RBLOCK (якщо задано) діють лише на скрипт, що тестується.
LOCALE=; T_LOCK=; T_RBLOCK=
run() {
  OUT="$(CAMPTRIBE_HOST=stub@localhost CAMPTRIBE_KEY=/dev/null \
        CAMPTRIBE_LOCAL_DB="$SRC_DB" CAMPTRIBE_REMOTE_ENV="$ENVF" \
        CAMPTRIBE_BACKUP_DIR="$BASE/backups" CAMPTRIBE_REMOTE_TMP="$BASE/rtmp" \
        CAMPTRIBE_REHEARSAL_DB="$REHEARSAL_DB" \
        CAMPTRIBE_LOCK_TIMEOUT="$T_LOCK" CAMPTRIBE_ROLLBACK_LOCK_TIMEOUT="$T_RBLOCK" \
        CAMPTRIBE_SSH="$BASE/bin/ssh" CAMPTRIBE_SCP="$BASE/bin/scp" \
        LC_ALL="${LOCALE:-${LC_ALL:-}}" \
        bash "$MOVE" "$@" 2>&1)"; RC=$?
}
dst() { psql -At -d "$DST_DB" -c "$1"; }
rows() { dst "select count(*) from $TABLE" 2>&1; }

# 🔴 Відбиток структури ЧИТАЄТЬСЯ З КАТАЛОГІВ, а не з pg_dump: набір не має
# ділити поле зі скриптом, який перевіряє. Усе, чого три старі лічильники
# не бачили (послідовність, DEFAULT, тригер, EXCLUDE, коментар), і те, чого
# не бачила звірка схем (власник, права на таблицю й на послідовність).
fp() {
  psql -At -d "$1" -c "select format('idx=%s p=%s u=%s x=%s c=%s seq=%s nextval=%s trg=%s cmt=%s own=%s api=%s apiseq=%s',
    (select count(*) from pg_indexes where tablename='$TABLE'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='p'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='u'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='x'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='c'),
    (select count(*) from pg_class where relkind='S' and relname='${TABLE}_id_seq'),
    (select count(*) from pg_attrdef d where d.adrelid='$TABLE'::regclass and pg_get_expr(d.adbin,d.adrelid) like 'nextval(%'),
    (select count(*) from pg_trigger where tgrelid='$TABLE'::regclass and not tgisinternal),
    (select count(*) from pg_description where classoid='pg_class'::regclass and objoid='$TABLE'::regclass and objsubid=0),
    (select pg_get_userbyid(relowner) from pg_class where oid='$TABLE'::regclass),
    has_table_privilege('$ROLE_API','$TABLE','SELECT')::text,
    case when to_regclass('${TABLE}_id_seq') is null then 'na' else has_sequence_privilege('$ROLE_API','${TABLE}_id_seq','USAGE')::text end)" 2>&1
}
field() { fp "$1" | tr ' ' '\n' | grep "^$2=" ; }
# Умови перед `ok $?` — через функцію, а не голе `[`: shellcheck (SC2319) не
# вважає `$?` після виклику функції станом умови, яку легко перебити.
eq() { [ "$1" = "$2" ]; }
S_FULL='idx=5 p=1 u=1 x=1 c=1 seq=1 nextval=1 trg=1 cmt=1'
FULL="$S_FULL own=$ROLE_OWNER api=true apiseq=true"
BARE="idx=0 p=0 u=0 x=0 c=0 seq=1 nextval=0 trg=0 cmt=0 own=$ROLE_OWNER api=true apiseq=true"
# Те, що зробить застосунок: INSERT без id. Відкочується, щоб не міняти стан.
app_insert() {
  psql -At -q -d "$1" -c begin \
    -c "insert into $TABLE (ref,kind,n,rng) values ('app','a',1,int4range(9000,9001)) returning id||'|'||touched" \
    -c rollback 2>&1
}
# Те, що зробить роль застосунку: читає таблицю від свого імені.
api_read() { psql -At -q -d "$DST_DB" -c "set role \"$ROLE_API\"" -c "select count(*) from $TABLE" 2>&1; }

# --- чужі процеси ---------------------------------------------------------
# Скрипт уже ЗНЯВ копію => проба DROP давно пройшла, а заміна ще не почалась.
wait_for_backup() {
  local i=0
  until ls "$BASE/backups/$TABLE-before-"*.dump >/dev/null 2>&1; do
    sleep 0.02; i=$((i+1)); [ "$i" -gt 1000 ] && return 1
  done
  # 🔴 Явне `return 0`: без нього функція повертала статус останнього
  # `[ … ] && return 1` з тіла циклу — тобто 1 навіть тоді, коли копію знайдено,
  # і `wait_for_backup && …` мовчки не виконував того, що йшло після `&&`.
  return 0
}
# Хтось стоїть у черзі на блокування $1 (непотримана заявка) — справжня подія
# в pg_locks, а не пауза: пауза залежить від навантаження машини (заміряно: коли
# вона зайнята, репетиція йде довше, і читач із фіксованим часом уже скінчився).
wait_waiter() {
  local i=0 n
  while :; do
    n="$(dst "select count(*) from pg_locks l join pg_class c on c.oid=l.relation where c.relname='$TABLE' and not l.granted and l.mode='$1'")"
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 0.02; i=$((i+1)); [ "$i" -gt 1000 ] && return 1
  done
}
wait_reader_holds() {
  local i=0 n
  while :; do
    n="$(dst "select count(*) from pg_locks l join pg_class c on c.oid=l.relation where c.relname='$TABLE' and l.granted and l.mode='AccessShareLock' and l.pid<>pg_backend_pid()")"
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 0.02; i=$((i+1)); [ "$i" -gt 1000 ] && return 1
  done
}
# Читач: відкрита транзакція з ACCESS SHARE на $1 секунд. Його блокування не
# дає ACCESS EXCLUSIVE (DROP TABLE) отримати чергу.
reader() { psql -q -d "$DST_DB" -c begin -c "select count(*) from $TABLE" -c "select pg_sleep($1)" -c commit >/dev/null 2>&1; }
# Завершити бекенди читачів: `kill` клієнта не допомагає, pg_sleep не помічає обриву.
# $1 — частина тексту запиту (напр. «pg_sleep(60)»); без аргументу — усіх читачів.
stop_readers() {
  dst "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DST_DB' and pid<>pg_backend_pid() and query like '%${1:-pg_sleep(}%'" >/dev/null 2>&1
}

echo '— сухий прогін'
build_world bare
bare_fp="$(fp "$DST_DB")"
run "$TABLE"
eq "$RC" 0 && printf '%s' "$OUT" | grep -q 'СУХИЙ ПРОГІН'; ok $? 'без --apply: каже «сухий прогін»' "rc=$RC $OUT"
eq "$(rows)" 300; ok $? 'без --apply: бойова таблиця не змінилась' "$(rows)"
printf '%s' "$OUT" | grep -q 'джерело (.*): 500 рядків'
ok $? 'сухий прогін називає, скільки рядків їде: 500' "$OUT"

echo '— справжнє перенесення (прод голий, але з нетиповим власником і грантом)'
rm -rf "$BASE/backups"
run "$TABLE" --apply
eq "$RC" 0; ok $? '--apply: код 0' "rc=$RC $OUT"
eq "$(rows)" 500; ok $? 'рядки приїхали: 500' "$(rows)"
# 🔴 Головне. Саме цього не було 15.10: індекси, ключ, послідовність, DEFAULT.
[ "$bare_fp" = "$BARE" ] && eq "$(field "$DST_DB" idx)" 'idx=5'
ok $? '🔴 індекси на місці: 5 (PK, UNIQUE, EXCLUDE і два звичайних); до того на проді не було жодного' "до=$bare_fp після=$(fp "$DST_DB")"
[ "$(field "$DST_DB" p)" = 'p=1' ] && [ "$(field "$DST_DB" u)" = 'u=1' ] && eq "$(field "$DST_DB" c)" 'c=1'
ok $? 'PRIMARY KEY, UNIQUE і CHECK на місці' "$(fp "$DST_DB")"
eq "$(field "$DST_DB" x)" 'x=1'; ok $? 'обмеження EXCLUDE на місці' "$(fp "$DST_DB")"
[ "$(field "$DST_DB" seq)" = 'seq=1' ] && eq "$(field "$DST_DB" nextval)" 'nextval=1'
ok $? '🔴 послідовність і DEFAULT nextval(...) на місці' "$(fp "$DST_DB")"
eq "$(field "$DST_DB" trg)" 'trg=1'; ok $? 'тригер на місці' "$(fp "$DST_DB")"
eq "$(field "$DST_DB" cmt)" 'cmt=1'; ok $? 'коментар таблиці на місці' "$(fp "$DST_DB")"
# 🔴 Не наявність послідовності, а те, що застосунок із нею зробить: id
# продовжується з 501 (позиція приїхала з джерела) і тригер спрацьовує.
ins="$(app_insert "$DST_DB")"
eq "$ins" '501|true'
ok $? '🔴 застосунковий INSERT працює: id=501 з послідовності, тригер спрацював' "$ins"
# 🔴 Власник і гранти прода: їх у дампі ДЖЕРЕЛА немає (це ноутбук), тож без
# явного переносу з прода нова таблиця належить тому, хто в DATABASE_URL, і
# роль застосунку отримує `permission denied`.
eq "$(field "$DST_DB" own)" "own=$ROLE_OWNER"
ok $? '🔴 власник таблиці лишився тим, що був на проді (а не тим, хто в DATABASE_URL)' "$(fp "$DST_DB")"
rd="$(api_read)"; eq "$rd" 500
ok $? '🔴 роль застосунку читає таблицю: 500 рядків, а не permission denied' "$rd"
# Грант на послідовність: без нього `INSERT` від ролі застосунку падає на nextval().
eq "$(field "$DST_DB" apiseq)" 'apiseq=true'
ok $? '🔴 грант USAGE на послідовність пережив заміну (нова послідовність з дампа джерела його не мала)' "$(fp "$DST_DB")"
# 🔴 Не слово «репетиція», а ЇЇ РЕЗУЛЬТАТ: рядок про репетицію друкується
# навіть тоді, коли відновлення нічого не відновило.
reh="$(printf '%s' "$OUT" | sed -n 's/.*репетиція відкату: [0-9]* с, \([0-9]*\) рядків.*/\1/p' | tail -1)"
[ -n "$reh" ] && eq "$reh" 300
ok $? 'репетиція відкату ВІДНОВИЛА ті самі 300 рядків, що були на проді' "у копії=$reh"
ls "$BASE/backups/$TABLE-before-"*.dump >/dev/null 2>&1; ok $? 'страхувальна копія лежить на місці' "$(ls "$BASE/backups" 2>&1)"

echo '— великий прод: параметри підключення з URL доходять до репетиційної бази'
# 🔴 `?sslmode=…` та інші параметри URL прода мусять дійти й до репетиційної бази
# (`${DATABASE_URL%/*}` їх губив, і репетиція йшла б не так, як прод). Тут це
# `application_name`, і його видно в pg_stat_activity — але підключення живе
# соті частки секунди, а опитування кожні кілька мс його не ловить надійно
# (заміряно: 1–2 вибірки, і то не завжди). Тому прод тут ВЕЛИКИЙ (150 тис.
# рядків): відновлення копії триває секунди, і опитування раз на 20 мс влучає
# завжди. Заодно це заміна таблиці, що не поміщається в мілісекунди.
build_world
psql -q -d "$DST_DB" -c "INSERT INTO $TABLE (ref,kind,n,rng) SELECT 'bulk'||i, 'b', 100000+i, int4range(100000+i*2, 100000+i*2+1) FROM generate_series(1,150000) i"
rm -f "$BASE/appname.seen"
( i=0
  until [ "$(psql -At -d "$PG_BASE/postgres" -c "select count(*) from pg_stat_activity where datname='$REHEARSAL_DB' and application_name='mvapp'" 2>/dev/null)" = 1 ]; do
    sleep 0.02; i=$((i+1)); [ "$i" -gt 1500 ] && exit 1
  done
  : > "$BASE/appname.seen" ) & ww=$!
run "$TABLE" --apply
wait "$ww" 2>/dev/null; kill "$ww" 2>/dev/null
eq "$RC" 0 && eq "$(rows)" 500 && printf '%s' "$OUT" | grep -q 'репетиція відкату: [0-9]* с, 150300 рядків'
r=$?
ok "$r" 'великий прод (150300 рядків): репетиція відновила їх усі, заміна пройшла, код 0' "rc=$RC rows=$(rows) $OUT"
ls "$BASE/appname.seen" >/dev/null 2>&1
ok $? '🔴 параметри підключення з URL прода дійшли до репетиційної бази (application_name видно на її підключенні)' "не побачено; репетиція: $(printf '%s' "$OUT" | grep 'репетиція')"

echo '— порожнє джерело не має шансу стерти прод'
psql -q -d "$SRC_DB" -c "TRUNCATE $TABLE"
run "$TABLE" --apply
[ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'нуль рядків' && eq "$(rows)" 500
ok $? 'нуль рядків у джерелі: відмова саме з цієї причини, прод цілий' "rc=$RC dst=$(rows) $OUT"

echo '— чужа назва таблиці'
run 'drop table x; --' --apply
eq "$RC" 2; ok $? 'назва поза [a-z0-9_]: код 2, нічого не робить' "rc=$RC $OUT"

echo '— великі літери в назві: фільтр не залежить від локалі'
# 🔴 `[!a-z0-9_]` у bash 3.2 (macOS) під en_US.UTF-8 пропускав `RV_UP` — а саме
# на macOS цей скрипт і запускається. Тому цей випадок ганяє обидві локалі.
# Чесна межа: у bash ≥5 діапазони за замовчуванням ASCII (globasciiranges), тож
# там старий шаблон був би зеленим і так — набір на CI цього дефекту не ловить,
# ловить лише на bash 3.2/4. Нижче друкується, яким є поточний bash.
LOCALE=C; run 'RV_UP' --apply; LOCALE=
[ "$RC" = 2 ] && printf '%s' "$OUT" | grep -q 'назва таблиці мусить бути'
ok $? 'RV_UP під LC_ALL=C: код 2' "rc=$RC $OUT"
if [ "$(LC_ALL=en_US.UTF-8 locale charmap 2>/dev/null)" = UTF-8 ]; then
  LOCALE=en_US.UTF-8; run 'RV_UP' --apply; LOCALE=
  [ "$RC" = 2 ] && printf '%s' "$OUT" | grep -q 'назва таблиці мусить бути'
  ok $? 'RV_UP під LC_ALL=en_US.UTF-8: код 2' "rc=$RC $OUT"
  if LC_ALL=en_US.UTF-8 bash -c 'case RV_UP in *[!a-z0-9_]*) exit 1;; esac'; then
    echo '    (цей bash під en_US.UTF-8 пропускає `[a-z]` над RV_UP — випадок здатен зловити старий шаблон)'
  else
    echo '    (цей bash діапазонів за локаллю не робить — випадок підтверджує поточну поведінку, старий шаблон не зловив би)'
  fi
else
  # 🔴 Пропущений випадок НЕ рахується пройденим.
  echo '  — en_US.UTF-8 немає, випадок ПРОПУЩЕНО (це не «пройдено»)'
  RUN=$((RUN+1)); SKIPPED=$((SKIPPED+1))
fi

echo '— таблиці немає в джерелі'
run 'mv_absent' --apply
[ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'не читається' && eq "$(rows)" 500
ok $? 'немає такої таблиці в джерелі: відмова саме з цієї причини, прод цілий' "rc=$RC $OUT"

echo '— таблиці ще немає на проді'
# 🔴 Перша версія цього випадку називалась «на проді немає PostGIS» і будувала
# геометричну таблицю, але міряла зовсім інше: `mv_geo` просто не існує на
# проді, і pg_dump -t повертає 1. PostGIS тут ні до чого. Тепер каже те, що
# бачить: нову таблицю цей скрипт не везе — він зупиняється на страхувальній
# копії, до будь-яких змін.
build_world
psql -q -d "$SRC_DB" -c "CREATE TABLE mv_new (ref text PRIMARY KEY); INSERT INTO mv_new VALUES ('a')"
run mv_new --apply
[ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'копію зняти не вдалось' && eq "$(rows)" 300
ok $? 'таблиці немає на проді: зупинився на копії, сусідня таблиця ціла' "rc=$RC $OUT"

echo '— на проді є подання, що залежить від таблиці (ДО початку)'
# 🔴 Проба DROP — це швидка зупинка з назвою залежного об'єкта ДО копії, що
# триває хвилини. Безпека заміни від неї НЕ залежить: сама заміна атомарна
# (див. випадки про вікно нижче).
build_world
psql -q -d "$DST_DB" -c "CREATE VIEW mv_probe_v AS SELECT ref FROM $TABLE"
before_fp="$(fp "$DST_DB")"
rm -rf "$BASE/backups"
run "$TABLE" --apply
eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'DROP TABLE на проді не пройде' && printf '%s' "$OUT" | grep -q 'mv_probe_v' \
  && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$before_fp" ] && [ -z "$(ls "$BASE/backups" 2>/dev/null)" ]
r=$?
ok "$r" 'подання блокує DROP: код 1, прод цілий (300 рядків, структура та сама), копії навіть не знімали' "rc=$RC rows=$(rows) fp=$(fp "$DST_DB") $OUT"

echo '— на проді є чужа таблиця із зовнішнім ключем на цю (ДО початку)'
build_world
psql -q -d "$DST_DB" -c "CREATE TABLE mv_child (ref text REFERENCES $TABLE (ref))"
before_fp="$(fp "$DST_DB")"
rm -rf "$BASE/backups"
run "$TABLE" --apply
eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'DROP TABLE на проді не пройде' && printf '%s' "$OUT" | grep -q 'mv_child' \
  && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$before_fp" ] && [ -z "$(ls "$BASE/backups" 2>/dev/null)" ]
r=$?
ok "$r" 'чужий зовнішній ключ блокує DROP: код 1, прод цілий, копії не знімали' "rc=$RC rows=$(rows) fp=$(fp "$DST_DB") $OUT"

echo '— читач тримає таблицю ще до початку: проба не стоїть у черзі вічно'
# 🔴 Проба сама стає в чергу на ACCESS EXCLUSIVE, а непотримана заявка блокує
# всіх, хто прийде за нею. Без lock_timeout на пробі вона чекала б, поки
# читач скінчить, і лише тоді пропустила б скрипт далі.
build_world
rm -rf "$BASE/backups"
reader 8 & rp=$!
wait_reader_holds
T_LOCK=1s; t0=$(date +%s); run "$TABLE" --apply; t1=$(date +%s); T_LOCK=
stop_readers; wait "$rp" 2>/dev/null
eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'DROP TABLE на проді не пройде' && eq "$(rows)" 300 && [ -z "$(ls "$BASE/backups" 2>/dev/null)" ]
ok $? "проба DROP не чекає читача довше за lock_timeout: код 1 за $((t1 - t0)) с, копії не знімали" "rc=$RC rows=$(rows) за $((t1 - t0)) с $OUT"

echo '— подання з'"'"'являється ПІСЛЯ проби, а прод уже такий самий, як джерело'
# 🔴 Проба DROP вікно лише звужувала: між нею й заміною на проді — копія,
# createdb і повна репетиція, тобто хвилини. Подання, що з'явилось у цьому
# вікні, раніше лишало таблицю зі знятими індексами й подвоєними рядками
# (заміряно: 500 → 1000 → 1500, 0 індексів). Тепер заміна атомарна: DROP не
# пройшов — не відбулось нічого.
# 🔴 І це єдиний випадок, де нічого, крім коду виходу, не скаже, що заміна не
# відбулась: стан прода збігається з джерелом ДО заміни, тож рядки й схема
# однакові, чи «нічого не зробив», чи «зробив успішно».
build_world
psql -q -d "$DST_DB" -c "TRUNCATE $TABLE RESTART IDENTITY" \
  -c "INSERT INTO $TABLE (ref,kind,n,rng) SELECT 'r'||i, (ARRAY['a','b','unknown'])[1+i%3], i, int4range(i,i+1) FROM generate_series(1,500) i"
pre_ok=1; [ "$(rows)" = 500 ] && [ "$(fp "$DST_DB")" = "$FULL" ] && pre_ok=0
rm -rf "$BASE/backups"
( wait_for_backup && psql -q -d "$DST_DB" -c "CREATE VIEW mv_probe_v AS SELECT ref FROM $TABLE" ) & wp=$!
run "$TABLE" --apply
wait "$wp"
view_there="$(dst "select count(*) from pg_views where viewname='mv_probe_v'")"
[ "$pre_ok" = 0 ] && [ "$view_there" = 1 ] && eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'заміна не відбулась' \
  && ! printf '%s' "$OUT" | grep -q 'DROP TABLE на проді не пройде' && eq "$(rows)" 500 && [ "$(fp "$DST_DB")" = "$FULL" ]
r=$?
ok "$r" '🔴 подання з'"'"'явилось у вікні: заміна не відбулась, код 1, прод цілий (500 рядків, усі 5 індексів), а не 1000 і 0 індексів' "pre=$pre_ok view=$view_there rc=$RC rows=$(rows) fp=$(fp "$DST_DB") $OUT"

echo '— читач з'"'"'являється ПІСЛЯ проби й тримає таблицю: заміна не чекає вічно'
# 🔴 lock_timeout мусить стояти на ТІЙ СЕСІЇ, що виконує заміну. `pg_restore`
# сам пише в початок кожного скрипта `SET lock_timeout = 0` і скасовує
# PGOPTIONS (заміряно: чекав 5,5 с при ліміті 1 с і замінив таблицю), тому
# заміна — це `psql -1` над скриптом, у якому цей рядок підмінено.
build_world
rm -rf "$BASE/backups"
( wait_for_backup && reader 8 ) & wp=$!
T_LOCK=1s; t0=$(date +%s); run "$TABLE" --apply; t1=$(date +%s); T_LOCK=
stop_readers; wait "$wp" 2>/dev/null
eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'заміна не відбулась' && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$FULL" ]
r=$?
ok "$r" "заміна не чекає читача довше за lock_timeout: код 1 за $((t1 - t0)) с, прод цілий (300 рядків, структура, власник і гранти ті самі)" "rc=$RC rows=$(rows) fp=$(fp "$DST_DB") за $((t1 - t0)) с $OUT"

echo '— хтось змінив структуру прода, поки заміна стояла в черзі й не вдалась'
# 🔴 Після атомарного обриву скрипт каже «прод такий самий» — і мусить це
# ПЕРЕВІРИТИ, а не вірити. Чужий CREATE INDEX стає в чергу за заявкою заміни
# й виконується одразу після її обриву.
build_world
rm -rf "$BASE/backups"
( wait_for_backup && { reader 8 & ra=$!; wait_waiter AccessExclusiveLock && psql -q -d "$DST_DB" -c "CREATE INDEX mv_probe_extra ON $TABLE (kind)"; wait "$ra"; } ) & wp=$!
T_LOCK=1s; run "$TABLE" --apply; T_LOCK=
stop_readers; wait "$wp" 2>/dev/null
eq "$RC" 4 && printf '%s' "$OUT" | grep -q '^+CREATE INDEX mv_probe_extra' && printf '%s' "$OUT" | grep -q 'відрізняється від стану до спроби' \
  && eq "$(rows)" 300
r=$?
ok "$r" 'структуру змінили під час спроби: код 4, діф називає чужий індекс, відкат НЕ роблять (нічого було відкочувати)' "rc=$RC $OUT"

echo '— тип є лише в джерелі: заміна падає, нічого не знято'
# 🔴 Раніше тут стару таблицю знімали, нову створити не вдавалось, і прод
# лишався без таблиці; рецензент заміряв, як перша версія «відкочувала»: 300
# рядків, 0 індексів, 0 послідовностей, код 3 і напис «повернуто». Тепер заміна
# атомарна: цей випадок лишає прод ЦІЛИМ — зі структурою, власником і грантами.
build_world
psql -q -d "$SRC_DB" -c "CREATE TYPE mv_mood AS ENUM ('calm','wild')" -c "ALTER TABLE $TABLE ADD COLUMN mood mv_mood"
before_fp="$(fp "$DST_DB")"
run "$TABLE" --apply
ins="$(app_insert "$DST_DB")"
[ "$before_fp" = "$FULL" ] && eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'відновлення вийшло з кодом' && printf '%s' "$OUT" | grep -q 'заміна не відбулась' \
  && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$FULL" ] && eq "$ins" '301|true'
r=$?
ok "$r" '🔴 заміна не пройшла: код 1, прод цілий (300 рядків, 5 індексів, послідовність, власник, гранти), INSERT дає id=301' "до=$before_fp після=$(fp "$DST_DB") rc=$RC insert=$ins $OUT"

echo '— функції тригера немає на проді: приїхало б усе, крім тригера'
# 🔴 Те, що три лічильники пропускали: рядки 500, індекси й обмеження на місці,
# а тригера немає, — і перша версія друкувала «збігається» та виходила нулем.
# Тепер відновлення не проходить (CREATE TRIGGER падає), і прод лишається цілим.
build_world
psql -q -d "$DST_DB" -c "DROP TRIGGER ${TABLE}_touch ON $TABLE" -c 'DROP FUNCTION mv_touch()'
before_fp="$(fp "$DST_DB")"
run "$TABLE" --apply
[ "$before_fp" = "${FULL/trg=1/trg=0}" ] && eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'відновлення вийшло з кодом' && printf '%s' "$OUT" | grep -q 'mv_touch' \
  && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$before_fp" ]
r=$?
ok "$r" 'функції тригера немає: код 1, помилка називає функцію, прод цілий і без тригера, як був' "до=$before_fp після=$(fp "$DST_DB") rc=$RC $OUT"

echo '— у джерела є дочірня таблиця успадкування: count(*) її бачить, дамп — ні'
# 🔴 Заміна ПРОХОДИТЬ (код 0, схема та сама), розходяться ЛИШЕ рядки; тож це
# єдиний випадок, де відкат МУСИТЬ відпрацювати над таблицею, яку вже замінено:
# повернути рядки, структуру, ВЛАСНИКА і ГРАНТИ (копія прода — це і є прод).
build_world
psql -q -d "$SRC_DB" -c "CREATE TABLE ${TABLE}_child () INHERITS ($TABLE)" \
  -c "INSERT INTO ${TABLE}_child (ref,kind,n,rng) SELECT 'c'||i, 'a', 1000+i, int4range(5000+i,5001+i) FROM generate_series(1,100) i"
before_fp="$(fp "$DST_DB")"
run "$TABLE" --apply
[ "$before_fp" = "$FULL" ] && eq "$RC" 3 && printf '%s' "$OUT" | grep -q 'рядків 500 проти 600 у джерелі' \
  && ! printf '%s' "$OUT" | grep -q 'відновлення вийшло з кодом [1-9]' && ! printf '%s' "$OUT" | grep -q 'структура прода не збігається' \
  && printf '%s' "$OUT" | grep -q 'повернуто й звірено' && eq "$(rows)" 300
r=$?
ok "$r" 'розійшлись лише рядки (500 проти 600): таблицю замінено, відкат, код 3, 300 рядків' "до=$before_fp rc=$RC rows=$(rows) $OUT"
rd="$(api_read)"; ins="$(app_insert "$DST_DB")"
[ "$(fp "$DST_DB")" = "$FULL" ] && eq "$rd" 300 && eq "$ins" '301|true'
r=$?
ok "$r" '🔴 після відкату ВСЕ як було: структура, власник, гранти на таблицю й на послідовність; роль застосунку читає 300; INSERT дає 301' "після=$(fp "$DST_DB") api=$rd insert=$ins"

echo '— event trigger на проді: заміна проходить (код 0), а схема розходиться'
# 🔴 Єдиний природний вхід «відновлення без помилок, рядки ті самі, схема інша»:
# на проді стоїть event trigger, що вмикає RLS на кожній новій таблиці. Заміна
# закомічена, звірка схем її відхиляє — а ВІДКАТ відтворює стару таблицю тим
# самим CREATE TABLE, тож event trigger знову вмикає RLS, і стан не збігається
# з тим, що було до заміни. Скрипт мусить це сказати (код 4), а не «повернуто».
build_world
psql -q -d "$DST_DB" -c "CREATE FUNCTION mv_harden() RETURNS event_trigger LANGUAGE plpgsql AS \$f\$ DECLARE r record; BEGIN FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE object_type='table' LOOP EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.object_identity); END LOOP; END \$f\$" \
  -c "CREATE EVENT TRIGGER mv_harden_new_tables ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION mv_harden()"
run "$TABLE" --apply
eq "$RC" 4 && printf '%s' "$OUT" | grep -q '^+ALTER TABLE public.mv_probe ENABLE ROW LEVEL SECURITY' \
  && printf '%s' "$OUT" | grep -q 'структура прода не збігається з джерелом' && printf '%s' "$OUT" | grep -q 'ВІДКАТ НЕ ЗВІРИВСЯ' \
  && ! printf '%s' "$OUT" | grep -q 'повернуто й звірено'
r=$?
ok "$r" '🔴 схема розійшлась при коді 0 відновлення; відкат теж не відтворює стан: код 4, діф називає RLS, «повернуто» не друкується' "rc=$RC $OUT"

echo '— event trigger на проді знімає тригер: заміна проходить (код 0), тригера немає'
# 🔴 Те, що три лічильники пропускали, і клас дефекту, заради якого схема
# звіряється ТЕКСТОМ: відновлення без помилок, рядки 500, індекси й обмеження на
# місці, а тригера немає. (Відсутня ФУНКЦІЯ тригера дає не це, а помилку
# відновлення — її ловить код виходу; тут помилки немає взагалі.) Відкат
# відтворює тригер, і охоронець знімає його знову: код 4.
build_world
psql -q -d "$DST_DB" -c "CREATE FUNCTION mv_nokill() RETURNS event_trigger LANGUAGE plpgsql AS \$f\$ DECLARE r record; BEGIN FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag='CREATE TRIGGER' LOOP EXECUTE format('DROP TRIGGER %s', r.object_identity); END LOOP; END \$f\$" \
  -c "CREATE EVENT TRIGGER mv_no_triggers ON ddl_command_end WHEN TAG IN ('CREATE TRIGGER') EXECUTE FUNCTION mv_nokill()"
run "$TABLE" --apply
eq "$RC" 4 && printf '%s' "$OUT" | grep -q 'після заміни: 500 рядків, відновлення вийшло з кодом 0' \
  && printf '%s' "$OUT" | grep -q '^-CREATE TRIGGER mv_probe_touch' && printf '%s' "$OUT" | grep -q 'ВІДКАТ НЕ ЗВІРИВСЯ' \
  && ! printf '%s' "$OUT" | grep -q 'повернуто й звірено'
r=$?
ok "$r" '🔴 тригера немає, а відновлення вийшло з кодом 0: діф називає тригер, відкат теж його не повертає: код 4' "rc=$RC $OUT"

echo '— event trigger на проді скасовує гранти: заміна проходить, права зникають'
# 🔴 Звірка «власник і права не загублено» потребує свого природного входу:
# відновлення без помилок, рядки й текст схеми однакові — а грант роли
# застосунку зник. Охоронець, що скасовує гранти після кожного GRANT, дає саме це.
# Відкат (його GRANT-и теж скасовуються) стан до заміни не відтворює: код 4.
build_world
psql -q -d "$DST_DB" -c "CREATE FUNCTION mv_grantguard() RETURNS event_trigger LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', '$ROLE_API'); END \$f\$" \
  -c "CREATE EVENT TRIGGER mv_grant_guard ON ddl_command_end WHEN TAG IN ('GRANT') EXECUTE FUNCTION mv_grantguard()"
run "$TABLE" --apply
eq "$RC" 4 && printf '%s' "$OUT" | grep -q 'власник чи права, які мав прод до заміни, загублено' && printf '%s' "$OUT" | grep -q 'ВІДКАТ НЕ ЗВІРИВСЯ' \
  && ! printf '%s' "$OUT" | grep -q 'структура прода не збігається' && ! printf '%s' "$OUT" | grep -q 'повернуто й звірено'
r=$?
ok "$r" '🔴 заміна закомітилась без помилок, але грант роли застосунку зник: код 4, названо втрату прав (схема й рядки мовчать)' "rc=$RC $OUT"

echo '— у таблицю пишуть між підрахунком рядків і копією'
# 🔴 `before_rows` знято ДО копії. Читач тримає таблицю, проба стає в чергу, і
# в цьому вікні дописується рядок (стає в чергу за заявкою проби й виконується
# одразу після неї): у копії 301 рядок, а лічильник каже 300. Відкат мусить
# звірятись із тим, що лежить у КОПІЇ (її рахує репетиція), а не з лічильником:
# інакше успішний відкат дав би хибний код 4.
# Передумови друкує сам скрипт: «прод до заміни: 300» і «у копії 301» — якщо
# вікно не відтворилось, випадок червоніє, а не мовчки зеленіє.
build_world
psql -q -d "$SRC_DB" -c "CREATE TABLE ${TABLE}_child () INHERITS ($TABLE)" \
  -c "INSERT INTO ${TABLE}_child (ref,kind,n,rng) SELECT 'c'||i, 'a', 1000+i, int4range(5000+i,5001+i) FROM generate_series(1,100) i"
reader 3 & rp=$!
wait_reader_holds
( wait_waiter AccessExclusiveLock && psql -q -d "$DST_DB" -c "INSERT INTO $TABLE (ref,kind,n,rng) VALUES ('late','b',999,int4range(9000,9001))" ) & wp=$!
T_LOCK=10s; run "$TABLE" --apply; T_LOCK=
wait "$wp" 2>/dev/null; stop_readers; wait "$rp" 2>/dev/null
printf '%s' "$OUT" | grep -q 'прод до заміни: 300 рядків' && printf '%s' "$OUT" | grep -q 'репетиція відкату: [0-9]* с, 301 рядків' \
  && eq "$RC" 3 && printf '%s' "$OUT" | grep -q 'повернуто й звірено: 301 рядків' && eq "$(rows)" 301
r=$?
ok "$r" 'запис між підрахунком і копією: лічильник 300, у копії 301; відкат звіряється з копією — код 3, а не хибний 4' "rc=$RC rows=$(rows) $OUT"

echo '— відкат не може взяти блокування: читач став у чергу за заявкою заміни'
# 🔴 Єдиний детермінований спосіб довести, що відкат не стоїть у черзі вічно
# (мутація «прибрати lock_timeout із відкату» мусить червоніти): читач A тримає
# таблицю, заміна стає в чергу на ACCESS EXCLUSIVE, читач B стає в чергу ЗА неї
# (Postgres не пропускає нових читачів повз заявку) — і після коміту заміни
# B першим отримує блокування вже на НОВУ таблицю. Відкат упирається в нього.
build_world
psql -q -d "$SRC_DB" -c "CREATE TABLE ${TABLE}_child () INHERITS ($TABLE)" \
  -c "INSERT INTO ${TABLE}_child (ref,kind,n,rng) SELECT 'c'||i, 'a', 1000+i, int4range(5000+i,5001+i) FROM generate_series(1,100) i"
rm -rf "$BASE/backups"
# Читач A тримає, ДОКИ B не стане в чергу за заявкою заміни; лише тоді A іде.
( wait_for_backup && {
    reader 60 & ra=$!
    wait_waiter AccessExclusiveLock
    reader 6 & rb=$!
    wait_waiter AccessShareLock
    stop_readers 'pg_sleep(60)'
    wait "$ra" "$rb"
  } ) & wp=$!
T_LOCK=10s; T_RBLOCK=1s; t0=$(date +%s); run "$TABLE" --apply; t1=$(date +%s); T_LOCK=; T_RBLOCK=
stop_readers; wait "$wp" 2>/dev/null
eq "$RC" 4 && printf '%s' "$OUT" | grep -q 'ВІДКАТ НЕ ЗВІРИВСЯ' && printf '%s' "$OUT" | grep -q 'рядків 500 проти 600 у джерелі' \
  && ! printf '%s' "$OUT" | grep -q 'повернуто й звірено' && eq "$(rows)" 500
r=$?
ok "$r" "відкат не дочекався читача: код 4, 🔴 ВІДКАТ НЕ ЗВІРИВСЯ (а не «повернуто» після його 6 с), прод лишився на замінених 500" "rc=$RC за $((t1 - t0)) с rows=$(rows) $OUT"

echo '— копія не відновлюється в чистій базі: заміну не робимо'
# 🔴 Ворота репетиції. Прод залежить від типу, якого в чистій репетиційній базі
# немає (pg_dump -t типів не везе), тож копія відновлюється з 0 рядків. Скрипт
# мусить зупинитись ДО заміни: прод лишається таким, яким був (300 рядків, своя
# колонка mood), а не стає тим, що в джерелі (500 рядків, без mood).
build_world
psql -q -d "$DST_DB" -c "CREATE TYPE mv_mood AS ENUM ('calm','wild')" -c "ALTER TABLE $TABLE ADD COLUMN mood mv_mood"
before_fp="$(fp "$DST_DB")"
run "$TABLE" --apply
[ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q 'репетиція відкату: [0-9]* с, 0 рядків' && printf '%s' "$OUT" | grep -q 'заміну НЕ роблю' \
  && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$before_fp" ] \
  && eq "$(dst "select count(*) from information_schema.columns where table_name='$TABLE' and column_name='mood'")" 1
r=$?
ok "$r" 'коротка копія зупиняє заміну: код 1, прод не торкнуто (300 рядків, колонка mood на місці)' "rc=$RC rows=$(rows) $OUT"

echo '— порожня таблиця на проді, а копія не відновлюється: ворота не сліпі при нулі'
# 🔴 Ворота «менше половини рядків» при 0 рядках на проді порожні: 0 < 0
# ніколи не істинне. Порожню копію від копії, яка просто не відновилась, відрізняє
# лише код відновлення.
build_world
psql -q -d "$DST_DB" -c "CREATE TYPE mv_mood AS ENUM ('calm','wild')" -c "ALTER TABLE $TABLE ADD COLUMN mood mv_mood" -c "TRUNCATE $TABLE"
before_fp="$(fp "$DST_DB")"
run "$TABLE" --apply
[ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q 'заміну НЕ роблю' && eq "$(rows)" 0 && [ "$(fp "$DST_DB")" = "$before_fp" ] \
  && eq "$(dst "select count(*) from information_schema.columns where table_name='$TABLE' and column_name='mood'")" 1
r=$?
ok "$r" 'порожній прод + копія, що не відновлюється: код 1, прод не торкнуто (0 рядків, колонка mood на місці)' "rc=$RC rows=$(rows) $OUT"

printf '\n%s\n' "$PASS passed, $FAIL failed"
if [ "$RUN" != "$EXPECTED" ]; then
  printf '🔴 виконано %s випадків, а записано %s — набір мовчки схуд\n' "$RUN" "$EXPECTED"; exit 1
fi
[ "$FAIL" = 0 ] || exit 1
if [ "$SKIPPED" != 0 ]; then
  printf '🔴 %s випадків пропущено — набір неповний, підсумку не друкую\n' "$SKIPPED"; exit 1
fi
printf 'move-table self-test: усе гаразд, %s випадків\n' "$EXPECTED"
