#!/usr/bin/env bash
# Self-test для infra/move-table.sh.
#
#   ./infra/move-table.selftest.sh          # потрібен локальний Postgres
#
# 🔴 ЩО ТУТ СПРАВЖНЄ, І ЧОМУ ЦЕ ВАЖЛИВО САМЕ ТУТ. Дві справжні бази
# Postgres, справжній `pg_dump -Fc -t`, справжній `pg_restore --clean -t`.
# Підмінено рівно двоє: `ssh` і `scp` — бо другої машини тут немає.
# Підмінник ssh НЕ імітує результат: він запускає той самий виконавець
# `remote.sh` локально, проти справжньої «бойової» бази.
#
# Тому дефект, заради якого скрипт написаний — `pg_restore -t` приносить
# таблицю БЕЗ індексів і без первинного ключа — тут ВІДТВОРЮЄТЬСЯ самим
# Postgres, а не вигадується фікстурою. Якщо колись Postgres почне
# відновлювати їх сам, цей набір про це скаже: випадок «індекси загублено»
# перестане відтворюватись, і лічильник не зійдеться.
#
# 🔴 ЛІЧИЛЬНИК. «N cases» — підпис, а не перевірка. EXPECTED записано;
# останній рядок друкується лише коли виконаних стільки ж.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOVE="${CAMPTRIBE_MOVE_BIN:-$HERE/move-table.sh}"
EXPECTED=16
# 🔴 Де брати базу. Локально це сокет і поточний користувач; у CI —
# сервіс postgis/postgis із користувачем postgres. Один рядок замість
# двох шляхів у коді.
PG_BASE="${CAMPTRIBE_SELFTEST_PG_BASE:-postgres://localhost:5432}"
SRC_DB=camptribe_mv_src
DST_DB=camptribe_mv_dst
TABLE=mv_probe

[ -f "$MOVE" ] || { echo "немає $MOVE" >&2; exit 1; }
command -v psql >/dev/null || { echo 'немає psql' >&2; exit 1; }
psql -At -d "$PG_BASE/postgres" -c 'select 1' >/dev/null 2>&1 || { echo 'локальний Postgres не відповідає' >&2; exit 1; }

BASE="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-move-selftest.XXXXXX")"
cleanup() { dropdb --if-exists "$SRC_DB" 2>/dev/null; dropdb --if-exists "$DST_DB" 2>/dev/null;
            dropdb --if-exists camptribe_move_rehearsal 2>/dev/null; rm -rf "$BASE"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

PASS=0; FAIL=0; RUN=0; SKIPPED=0
pass() { RUN=$((RUN+1)); PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { RUN=$((RUN+1)); FAIL=$((FAIL+1)); printf '  ✗ %s\n     %s\n' "$1" "${2-}"; }
ok()   { if [ "$1" = 0 ]; then pass "$2"; else fail "$2" "${3-}"; fi; }

# --- світ: дві бази, у джерелі таблиця з ключем і двома індексами --------
build_world() {
  dropdb --if-exists "$SRC_DB" 2>/dev/null; dropdb --if-exists "$DST_DB" 2>/dev/null
  createdb "$SRC_DB"; createdb "$DST_DB"
  local ddl="CREATE TABLE $TABLE (
      ref text PRIMARY KEY,
      kind text NOT NULL,
      n int,
      CONSTRAINT ${TABLE}_kind_check CHECK (kind IN ('a','b','unknown'))
    );
    CREATE INDEX idx_${TABLE}_kind_a ON $TABLE (n) WHERE kind = 'a';
    CREATE INDEX idx_${TABLE}_n ON $TABLE (n);"
  psql -q -d "$SRC_DB" -c "$ddl"
  psql -q -d "$DST_DB" -c "$ddl"
  psql -q -d "$SRC_DB" -c "INSERT INTO $TABLE SELECT 'r'||i, (ARRAY['a','b','unknown'])[1+i%3], i FROM generate_series(1,500) i"
  psql -q -d "$DST_DB" -c "INSERT INTO $TABLE SELECT 'r'||i, 'b', i FROM generate_series(1,300) i"
}

# --- підмінники: ssh запускає виконавця локально, scp копіює ------------
mkdir -p "$BASE/bin"
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

run() {
  OUT="$(CAMPTRIBE_HOST=stub@localhost CAMPTRIBE_KEY=/dev/null \
        CAMPTRIBE_LOCAL_DB="$SRC_DB" CAMPTRIBE_REMOTE_ENV="$ENVF" \
        CAMPTRIBE_BACKUP_DIR="$BASE/backups" \
        CAMPTRIBE_SSH="$BASE/bin/ssh" CAMPTRIBE_SCP="$BASE/bin/scp" \
        bash "$MOVE" "$@" 2>&1)"; RC=$?
}
dst() { psql -At -d "$DST_DB" -c "$1"; }

echo '— сухий прогін'
build_world
run "$TABLE"
[ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'СУХИЙ ПРОГІН'; ok $? 'без --apply: каже «сухий прогін»' "rc=$RC $OUT"
[ "$(dst "select count(*) from $TABLE")" = 300 ]; ok $? 'без --apply: бойова таблиця не змінилась' "$(dst "select count(*) from $TABLE")"
printf '%s' "$OUT" | grep -q '500 рядків, 3 індексів, 2 обмежень'
ok $? 'сухий прогін називає структуру джерела: 3 індекси, 2 обмеження' "$OUT"

echo '— справжнє перенесення'
run "$TABLE" --apply
[ "$RC" = 0 ]; ok $? '--apply: код 0' "rc=$RC $OUT"
[ "$(dst "select count(*) from $TABLE")" = 500 ]; ok $? 'рядки приїхали: 500' "$(dst "select count(*) from $TABLE")"
# 🔴 Головне. Саме цього не було 15.10.
[ "$(dst "select count(*) from pg_indexes where tablename='$TABLE'")" = 3 ]
ok $? '🔴 індекси на місці: 3 (а pg_restore -t їх не приносить)' "$(dst "select count(*) from pg_indexes where tablename='$TABLE'")"
[ "$(dst "select count(*) from pg_constraint where conrelid='$TABLE'::regclass")" -ge 2 ]
ok $? 'обмеження на місці' "$(dst "select count(*) from pg_constraint where conrelid='$TABLE'::regclass")"
[ "$(dst "select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='p'")" = 1 ]
ok $? 'первинний ключ на місці' "$(dst "select count(*) from pg_constraint where conrelid='$TABLE'::regclass and contype='p'")"
printf '%s' "$OUT" | grep -q 'відтворюю'; ok $? 'скрипт сказав уголос, що відтворює втрачене' "$OUT"
# 🔴 Не слово «репетиція», а ЇЇ РЕЗУЛЬТАТ. Рядок про репетицію друкується
# навіть тоді, коли відновлення нічого не відновило, — і перевірка на
# текст лишалась зеленою під мутацією «репетиції немає».
reh="$(printf '%s' "$OUT" | sed -n 's/.*репетиція відкату: [0-9]* с, \([0-9]*\) рядків.*/\1/p' | tail -1)"
[ -n "$reh" ] && [ "$reh" = 300 ]
ok $? 'репетиція відкату ВІДНОВИЛА ті самі 300 рядків, що були на проді' "у копії=$reh"
ls "$BASE/backups/$TABLE-before-"*.dump >/dev/null 2>&1; ok $? 'страхувальна копія лежить на місці' "$(ls "$BASE/backups" 2>&1)"

echo '— порожнє джерело не має шансу стерти прод'
psql -q -d "$SRC_DB" -c "TRUNCATE $TABLE"
run "$TABLE" --apply
[ "$RC" != 0 ] && [ "$(dst "select count(*) from $TABLE")" = 500 ]
ok $? 'нуль рядків у джерелі: відмова, прод цілий' "rc=$RC dst=$(dst "select count(*) from $TABLE")"

echo '— чужа назва таблиці'
run 'drop table x; --' --apply
[ "$RC" = 2 ]; ok $? 'назва поза [a-z0-9_]: код 2, нічого не робить' "rc=$RC $OUT"

echo '— таблиці немає в джерелі'
run 'mv_absent' --apply
[ "$RC" != 0 ] && [ "$(dst "select count(*) from $TABLE")" = 500 ]
ok $? 'немає такої таблиці: відмова, прод цілий' "rc=$RC $OUT"

echo '— на проді є подання, що залежить від таблиці'
# 🔴 Єдиний випадок, який доводить ВІДКАТ. Подання не дає `--clean` зняти
# таблицю, відновлення не відбувається, рядки лишаються старими — і
# скрипт мусить це помітити й повернути копію, а не вийти нулем.
# Без цього випадку мутація «ніколи не відкочуватись» виживає.
# 🔴 Світ будується заново НАВМИСНО. Якби прод уже ніс ті самі 500 рядків
# від попереднього випадку, «нічого не зробив» і «зробив успішно» дали б
# однакові числа, і перевірка не змогла б їх розрізнити.
build_world
psql -q -d "$DST_DB" -c "CREATE VIEW mv_probe_v AS SELECT ref FROM $TABLE"
run "$TABLE" --apply
# 🔴 Не «код не нуль», а САМЕ 3 і слова про повернення копії. «Таблиця
# лишилась на 500» тут істинне й тоді, коли скрипт просто нічого не
# зробив, — тобто мутація «ніколи не відкочуватись» таку перевірку
# переживала. Код 3 означає рівно «повернув і перевірив».
[ "$RC" = 3 ] && printf '%s' "$OUT" | grep -q 'повертаю страхувальну копію' \
  && [ "$(dst "select count(*) from $TABLE")" = 300 ]
ok $? 'подання блокує заміну: код 3, копію повернуто, прод на своїх 300' "rc=$RC rows=$(dst "select count(*) from $TABLE")"
psql -q -d "$DST_DB" -c 'DROP VIEW IF EXISTS mv_probe_v'

echo '— на машині немає того, що таблиці потрібне'
# 🔴 Справжній шлях відмови, без тестових гачків: у джерелі таблиця з
# геометрією, на «проді» PostGIS немає. Копію зняти не вийде — і скрипт
# мусить зупинитись ДО того, як щось чіпати.
psql -q -d "$SRC_DB" -c 'CREATE EXTENSION IF NOT EXISTS postgis' >/dev/null 2>&1
if psql -At -d "$SRC_DB" -c "select 1 from pg_extension where extname='postgis'" | grep -q 1; then
  psql -q -d "$SRC_DB" -c "CREATE TABLE mv_geo (ref text PRIMARY KEY, g geometry(Point,4326));
                           CREATE INDEX idx_mv_geo_g ON mv_geo USING gist (g);
                           INSERT INTO mv_geo VALUES ('a', ST_SetSRID(ST_MakePoint(1,1),4326));"
  before="$(dst "select count(*) from $TABLE")"
  run mv_geo --apply
  # 🔴 Не просто «код не нуль»: без згадки про невдалу копію цей випадок
  # міряв би поведінку Postgres, а не мого скрипта, і не червонів би ні
  # від якої мутації. Вимагаємо, щоб скрипт зупинився САМЕ на копії.
  [ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'копію зняти не вдалось' \
    && [ "$(dst "select count(*) from $TABLE")" = "$before" ]
  ok $? 'на проді немає PostGIS: зупинився на копії, сусідня таблиця ціла' "rc=$RC $OUT"
else
  # 🔴 Пропущений випадок НЕ рахується пройденим: інакше машина без
  # PostGIS давала б зелений набір, а «не перевіряли» читалось би як
  # «перевірили». Лічильник росте, SKIPPED теж — і підсумковий рядок
  # не друкується.
  echo '  — PostGIS немає, випадок ПРОПУЩЕНО (це не «пройдено»)'
  RUN=$((RUN+1)); SKIPPED=$((SKIPPED+1))
fi

printf '\n%s\n' "$PASS passed, $FAIL failed"
if [ "$RUN" != "$EXPECTED" ]; then
  printf '🔴 виконано %s випадків, а записано %s — набір мовчки схуд\n' "$RUN" "$EXPECTED"; exit 1
fi
[ "$FAIL" = 0 ] || exit 1
if [ "$SKIPPED" != 0 ]; then
  printf '🔴 %s випадків пропущено — набір неповний, підсумку не друкую\n' "$SKIPPED"; exit 1
fi
printf 'move-table self-test: усе гаразд, %s випадків\n' "$EXPECTED"
