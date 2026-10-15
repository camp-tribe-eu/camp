#!/usr/bin/env bash
# Self-test для infra/move-table.sh.
#
#   ./infra/move-table.selftest.sh          # потрібен локальний Postgres
#
# 🔴 ЩО ТУТ СПРАВЖНЄ. Дві справжні бази Postgres, справжні `pg_dump` і
# `pg_restore`. Підмінено рівно двоє: `ssh` і `scp` — бо другої машини тут
# немає. Підмінник ssh НЕ імітує результат: він запускає той самий виконавець
# `remote.sh` локально, проти справжньої «бойової» бази. Жодного гачка у
# `pg_restore`: усі випадки відмови нижче створює сам Postgres.
#
# 🔴 СВІТ МУСИТЬ МІСТИТИ ТЕ, ЧОГО ПЕРША ВЕРСІЯ НЕ БАЧИЛА. Таблиця світу — це
# `id serial PRIMARY KEY`, UNIQUE, CHECK, обмеження EXCLUDE, два індекси,
# тригер і коментар. Без послідовності, DEFAULT, тригера й EXCLUDE набір
# підтверджував би сам себе: три лічильники рядків/індексів/обмежень були
# сліпі саме до них, і скрипт друкував «збігається» та виходив нулем над
# прод-таблицею без послідовності.
#
# 🔴 ЯК ВІДТВОРЮЄТЬСЯ ДЕФЕКТ. `pg_restore -t` губить структуру, але виправлений
# скрипт його вже не вживає — тож у нормальному прогоні дефекту немає. Він
# з'являється, коли `-t` повернути на відновлення (мутація №1 матриці): тоді
# червоніє перенесення і відкат. Набір доведено мутаціями, а не вірою.
#
# 🔴 ЯК СТВОРЮЮТЬСЯ ВІДМОВИ БЕЗ ПІДМІН. `pg_dump -t` не возить ТИПИ й ФУНКЦІЇ
# (у TOC дампа 0 записів TYPE). Звідси природні випадки:
#   • тип є лише в джерелі  → на проді DROP старої таблиці проходить, а
#                             CREATE нової падає: відкат МУСИТЬ спрацювати;
#   • тип є лише на проді   → у чистій репетиційній базі копія не відновлюється:
#                             ворота репетиції мусять зупинити заміну;
#   • функції тригера немає на проді → усе приїздить, крім тригера: рядки,
#                             індекси й обмеження ті самі, схема — ні.
#
# 🔴 ЛІЧИЛЬНИК. «N cases» — підпис, а не перевірка. EXPECTED записано;
# останній рядок друкується лише коли виконаних стільки ж.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOVE="${CAMPTRIBE_MOVE_BIN:-$HERE/move-table.sh}"
EXPECTED=27
# 🔴 Де брати базу. Локально це сокет і поточний користувач; у CI —
# сервіс postgis/postgis із користувачем postgres. Один рядок замість
# двох шляхів у коді.
PG_BASE="${CAMPTRIBE_SELFTEST_PG_BASE:-postgres://localhost:5432}"
# 🔴 Назви баз із префіксом: два прогони поруч (чужий і мій) не мають права
# скидати бази одне одного.
PREFIX="${CAMPTRIBE_SELFTEST_PREFIX:-camptribe_mv}"
SRC_DB="${PREFIX}_src"
DST_DB="${PREFIX}_dst"
REHEARSAL_DB="${PREFIX}_rehearsal"
TABLE=mv_probe

[ -f "$MOVE" ] || { echo "немає $MOVE" >&2; exit 1; }
command -v psql >/dev/null || { echo 'немає psql' >&2; exit 1; }
psql -At -d "$PG_BASE/postgres" -c 'select 1' >/dev/null 2>&1 || { echo 'локальний Postgres не відповідає' >&2; exit 1; }

BASE="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-move-selftest.XXXXXX")"
cleanup() { dropdb --if-exists "$SRC_DB" 2>/dev/null; dropdb --if-exists "$DST_DB" 2>/dev/null
            dropdb --if-exists "$REHEARSAL_DB" 2>/dev/null; rm -rf "$BASE"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

PASS=0; FAIL=0; RUN=0; SKIPPED=0
pass() { RUN=$((RUN+1)); PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { RUN=$((RUN+1)); FAIL=$((FAIL+1)); printf '  ✗ %s\n     %s\n' "$1" "${2-}"; }
ok()   { if [ "$1" = 0 ]; then pass "$2"; else fail "$2" "${3-}"; fi; }

# --- світ: дві бази, у джерелі 500 рядків, на «проді» 300 -----------------
# Обидві з однаковою структурою; тригер потребує функції, і вона є в обох.
build_world() {
  dropdb --if-exists "$SRC_DB" 2>/dev/null; dropdb --if-exists "$DST_DB" 2>/dev/null
  createdb "$SRC_DB"; createdb "$DST_DB"
  local ddl="CREATE FUNCTION mv_touch() RETURNS trigger LANGUAGE plpgsql
      AS \$f\$ BEGIN NEW.touched := true; RETURN NEW; END \$f\$;
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
  psql -q -d "$DST_DB" -c "$ddl"
  psql -q -d "$SRC_DB" -c "INSERT INTO $TABLE (ref,kind,n,rng) SELECT 'r'||i, (ARRAY['a','b','unknown'])[1+i%3], i, int4range(i,i+1) FROM generate_series(1,500) i"
  psql -q -d "$DST_DB" -c "INSERT INTO $TABLE (ref,kind,n,rng) SELECT 'r'||i, 'b', i, int4range(i,i+1) FROM generate_series(1,300) i"
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
printf 'DATABASE_URL=%s/%s\n' "$PG_BASE" "$DST_DB" > "$ENVF"

# LOCALE (якщо задано) діє лише на скрипт, що тестується.
LOCALE=
run() {
  OUT="$(CAMPTRIBE_HOST=stub@localhost CAMPTRIBE_KEY=/dev/null \
        CAMPTRIBE_LOCAL_DB="$SRC_DB" CAMPTRIBE_REMOTE_ENV="$ENVF" \
        CAMPTRIBE_BACKUP_DIR="$BASE/backups" CAMPTRIBE_REMOTE_TMP="$BASE/rtmp" \
        CAMPTRIBE_REHEARSAL_DB="$REHEARSAL_DB" \
        CAMPTRIBE_SSH="$BASE/bin/ssh" CAMPTRIBE_SCP="$BASE/bin/scp" \
        LC_ALL="${LOCALE:-${LC_ALL:-}}" \
        bash "$MOVE" "$@" 2>&1)"; RC=$?
}
dst() { psql -At -d "$DST_DB" -c "$1"; }
rows() { dst "select count(*) from $TABLE" 2>&1; }

# 🔴 Відбиток структури ЧИТАЄТЬСЯ З КАТАЛОГІВ, а не з pg_dump: набір не має
# ділити поле зі скриптом, який перевіряє. Усе, чого три старі лічильники
# не бачили (послідовність, DEFAULT, тригер, EXCLUDE, коментар), тут є.
fp() {
  psql -At -d "$1" -c "select format('idx=%s p=%s u=%s x=%s c=%s seq=%s nextval=%s trg=%s cmt=%s',
    (select count(*) from pg_indexes where tablename='$TABLE'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='p'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='u'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='x'),
    (select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='c'),
    (select count(*) from pg_class where relkind='S' and relname='${TABLE}_id_seq'),
    (select count(*) from pg_attrdef d where d.adrelid='$TABLE'::regclass and pg_get_expr(d.adbin,d.adrelid) like 'nextval(%'),
    (select count(*) from pg_trigger where tgrelid='$TABLE'::regclass and not tgisinternal),
    (select count(*) from pg_description where classoid='pg_class'::regclass and objoid='$TABLE'::regclass and objsubid=0))" 2>&1
}
field() { fp "$1" | tr ' ' '\n' | grep "^$2=" ; }
# Умови перед `ok $?` — через функцію, а не голе `[`: shellcheck (SC2319) не
# вважає `$?` після виклику функції станом умови, яку легко перебити.
eq() { [ "$1" = "$2" ]; }
FULL='idx=5 p=1 u=1 x=1 c=1 seq=1 nextval=1 trg=1 cmt=1'
# Те, що зробив би застосунок: INSERT без id. Відкочується, щоб не міняти стан.
app_insert() {
  psql -At -q -d "$1" -c begin \
    -c "insert into $TABLE (ref,kind,n,rng) values ('app','a',1,int4range(9000,9001)) returning id||'|'||touched" \
    -c rollback 2>&1
}

echo '— сухий прогін'
build_world
run "$TABLE"
[ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'СУХИЙ ПРОГІН'; ok $? 'без --apply: каже «сухий прогін»' "rc=$RC $OUT"
eq "$(rows)" 300; ok $? 'без --apply: бойова таблиця не змінилась' "$(rows)"
printf '%s' "$OUT" | grep -q 'джерело (.*): 500 рядків'
ok $? 'сухий прогін називає, скільки рядків їде: 500' "$OUT"

echo '— справжнє перенесення'
rm -rf "$BASE/backups"
run "$TABLE" --apply
eq "$RC" 0; ok $? '--apply: код 0' "rc=$RC $OUT"
eq "$(rows)" 500; ok $? 'рядки приїхали: 500' "$(rows)"
# 🔴 Головне. Саме цього не було 15.10: індекси, ключ, послідовність, DEFAULT.
eq "$(field "$DST_DB" idx)" 'idx=5'
ok $? '🔴 індекси на місці: 5 (PK, UNIQUE, EXCLUDE і два звичайних)' "$(fp "$DST_DB")"
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
# 🔴 Не слово «репетиція», а ЇЇ РЕЗУЛЬТАТ: рядок про репетицію друкується
# навіть тоді, коли відновлення нічого не відновило.
reh="$(printf '%s' "$OUT" | sed -n 's/.*репетиція відкату: [0-9]* с, \([0-9]*\) рядків.*/\1/p' | tail -1)"
[ -n "$reh" ] && eq "$reh" 300
ok $? 'репетиція відкату ВІДНОВИЛА ті самі 300 рядків, що були на проді' "у копії=$reh"
ls "$BASE/backups/$TABLE-before-"*.dump >/dev/null 2>&1; ok $? 'страхувальна копія лежить на місці' "$(ls "$BASE/backups" 2>&1)"

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

echo '— на проді є подання, що залежить від таблиці'
# 🔴 Без `-t` pg_restore --clean знімає індекси, обмеження й DEFAULT ПЕРЕД
# таблицею. Подання не дає зняти таблицю — і без перевірки наперед прод лишався
# б зі зламаною структурою та подвоєними рядками (заміряно: 1000, а відкат
# дописував ще 300). Тому скрипт пробує DROP TABLE в транзакції, що відкочується,
# і зупиняється ДО копії та до будь-яких змін.
build_world
psql -q -d "$DST_DB" -c "CREATE VIEW mv_probe_v AS SELECT ref FROM $TABLE"
before_fp="$(fp "$DST_DB")"
rm -rf "$BASE/backups"
run "$TABLE" --apply
eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'DROP TABLE на проді не пройде' && printf '%s' "$OUT" | grep -q 'mv_probe_v' \
  && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$before_fp" ] && [ -z "$(ls "$BASE/backups" 2>/dev/null)" ]
r=$?
ok "$r" 'подання блокує DROP: код 1, прод цілий (300 рядків, структура та сама), копії навіть не знімали' "rc=$RC rows=$(rows) fp=$(fp "$DST_DB") $OUT"

echo '— на проді є чужа таблиця із зовнішнім ключем на цю'
build_world
psql -q -d "$DST_DB" -c "CREATE TABLE mv_child (ref text REFERENCES $TABLE (ref))"
before_fp="$(fp "$DST_DB")"
rm -rf "$BASE/backups"
run "$TABLE" --apply
eq "$RC" 1 && printf '%s' "$OUT" | grep -q 'DROP TABLE на проді не пройде' && printf '%s' "$OUT" | grep -q 'mv_child' \
  && eq "$(rows)" 300 && [ "$(fp "$DST_DB")" = "$before_fp" ] && [ -z "$(ls "$BASE/backups" 2>/dev/null)" ]
r=$?
ok "$r" 'чужий зовнішній ключ блокує DROP: код 1, прод цілий, копії не знімали' "rc=$RC rows=$(rows) fp=$(fp "$DST_DB") $OUT"

echo '— тип є лише в джерелі: заміна падає ПІСЛЯ того, як стару таблицю знято'
# 🔴 Єдиний випадок, де відкат МУСИТЬ спрацювати: стару таблицю знято, нову
# створити не вдалось (типу немає), прод лишається без таблиці. Рецензент
# заміряв, як перша версія тут «відкочувала»: 300 рядків, 0 індексів, 0
# послідовностей, код 3 і напис «повернуто».
build_world
psql -q -d "$SRC_DB" -c "CREATE TYPE mv_mood AS ENUM ('calm','wild')" -c "ALTER TABLE $TABLE ADD COLUMN mood mv_mood"
before_fp="$(fp "$DST_DB")"
run "$TABLE" --apply
[ "$RC" = 3 ] && printf '%s' "$OUT" | grep -q 'після заміни: таблиці немає' \
  && printf '%s' "$OUT" | grep -q 'повертаю страхувальну копію' && printf '%s' "$OUT" | grep -q 'повернуто й звірено' \
  && eq "$(rows)" 300
ok $? 'відкат ПОТРІБЕН (таблиці після заміни не було) і спрацював: код 3, 300 рядків' "rc=$RC rows=$(rows) $OUT"
ins="$(app_insert "$DST_DB")"
[ "$before_fp" = "$FULL" ] && [ "$(fp "$DST_DB")" = "$FULL" ] && eq "$ins" '301|true'
ok $? '🔴 після відкату СТРУКТУРА така сама (а не 0 індексів і 0 послідовностей); INSERT дає id=301' "до=$before_fp після=$(fp "$DST_DB") insert=$ins"

echo '— функції тригера немає на проді: приїхало все, крім тригера'
# 🔴 Те, що три лічильники пропускали: рядки 500, індекси й обмеження на місці,
# а тригера немає. Перша версія тут друкувала «збігається» й виходила нулем.
build_world
psql -q -d "$DST_DB" -c "DROP TRIGGER ${TABLE}_touch ON $TABLE" -c 'DROP FUNCTION mv_touch()'
before_fp="$(fp "$DST_DB")"
run "$TABLE" --apply
# 🔴 Не просто код 3: діф мусить НАЗИВАТИ відсутній тригер. Код виходу
# pg_restore теж не нуль, тож без вимоги до тексту діфа мутація «звірка схем
# завжди зелена» цей випадок переживала б.
[ "$RC" = 3 ] && printf '%s' "$OUT" | grep -q '^-CREATE TRIGGER mv_probe_touch' \
  && printf '%s' "$OUT" | grep -q 'повернуто й звірено' && eq "$(rows)" 300
ok $? 'схема не збіглась: діф називає тригер, відкат, код 3, прод на своїх 300' "rc=$RC rows=$(rows) $OUT"
[ "$before_fp" = "${FULL/trg=1/trg=0}" ] && eq "$(fp "$DST_DB")" "$before_fp"
ok $? 'після відкату структура така сама, як до заміни' "до=$before_fp після=$(fp "$DST_DB")"

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
  && [ "$(rows)" = 300 ] && [ "$(fp "$DST_DB")" = "$before_fp" ] \
  && eq "$(dst "select count(*) from information_schema.columns where table_name='$TABLE' and column_name='mood'")" 1
ok $? 'коротка копія зупиняє заміну: код 1, прод не торкнуто (300 рядків, колонка mood на місці)' "rc=$RC rows=$(rows) $OUT"

printf '\n%s\n' "$PASS passed, $FAIL failed"
if [ "$RUN" != "$EXPECTED" ]; then
  printf '🔴 виконано %s випадків, а записано %s — набір мовчки схуд\n' "$RUN" "$EXPECTED"; exit 1
fi
[ "$FAIL" = 0 ] || exit 1
if [ "$SKIPPED" != 0 ]; then
  printf '🔴 %s випадків пропущено — набір неповний, підсумку не друкую\n' "$SKIPPED"; exit 1
fi
printf 'move-table self-test: усе гаразд, %s випадків\n' "$EXPECTED"
