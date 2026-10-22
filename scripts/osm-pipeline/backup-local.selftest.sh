#!/usr/bin/env bash
# Self-test для backup-local.sh — половина з повним дампом (CAMP-386).
#
#   ./scripts/osm-pipeline/backup-local.selftest.sh
#   CAMPTRIBE_SELFTEST_PG_BASE=postgres://…  CAMPTRIBE_SELFTEST_PREFIX=…   # як у move-table
#
# 🔴 ЩО ТУТ СПРАВЖНЄ. Справжній Postgres, справжні pg_dump, pg_restore і
# psql, справжній скрипт. Підмінників немає взагалі: кожну відмову нижче
# створює або Postgres, або сам файл на диску.
#
# 🔴 НАВІЩО. До картки нічний бекап вивантажував вісім CSV і жодної
# таблиці directus_* — а активація ліцензії привʼязана до
# directus_settings.project_id, якого в CSV не було. Тепер поруч лягає
# повний дамп, і єдине, що тут доводиться, — що verify дивиться на його
# ВМІСТ, а не на наявність. Тому головні випадки — підсунути перевірці
# дамп, який існує, має правильну суму й не несе directus_*: кожен
# такий мусить почервоніти. Зелений verify над таким дампом — той самий
# дефект, що й до картки, тільки з новим імʼям.
#
# 🔴 І ДАМП ВІДНОВЛЮЄТЬСЯ У ДРУГУ БАЗУ. «pg_restore -l показує таблицю»
# доводить, що запис є в TOC; що з нього повертається ТОЙ САМИЙ
# project_id, доводить лише відновлення в порожню базу й порівняння.
#
# 🔴 І СТАРИЙ ЗРІЗ НЕ ЗАБОРОНЯЄТЬСЯ. Тека без ключа "dump" — це кожен
# бекап, зроблений до картки; verify над нею попереджає й проходить, а
# restore з неї повертає CSV. Падати тут означало б два тижні не мати
# жодного придатного бекапу (рецензія PR #318). Але ключ "dump" із
# чимось не тим усередині — тверда відмова, як і була.
#
# 🔴 ЛІЧИЛЬНИК. «N випадків» — підпис, а не перевірка. EXPECTED записано;
# останній рядок друкується лише коли виконаних стільки ж і жоден не впав.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${CAMPTRIBE_BACKUP_BIN:-$HERE/backup-local.sh}"
EXPECTED=23
# Де брати базу: локально сокет і поточний користувач, у CI — сервіс
# postgres. Назви з префіксом, щоб два прогони поруч не скидали бази
# одне одного.
PG_BASE="${CAMPTRIBE_SELFTEST_PG_BASE:-postgres://localhost:5432}"
PREFIX="${CAMPTRIBE_SELFTEST_PREFIX:-camptribe_bk}"
SRC_DB="${PREFIX}_src"
RESTORED_DB="${PREFIX}_restored"
SRC_URL="$PG_BASE/$SRC_DB"
RESTORED_URL="$PG_BASE/$RESTORED_DB"

[ -f "$SCRIPT" ] || { echo "немає $SCRIPT" >&2; exit 1; }
for tool in psql pg_dump pg_restore createdb dropdb python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "немає $tool" >&2; exit 1; }
done
psql -At -d "$PG_BASE/postgres" -c 'select 1' >/dev/null 2>&1 || { echo 'локальний Postgres не відповідає' >&2; exit 1; }

BASE="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-backup-selftest.XXXXXX")"
cleanup() {
  dropdb --if-exists --force "$SRC_DB" 2>/dev/null
  dropdb --if-exists --force "$RESTORED_DB" 2>/dev/null
  rm -rf "$BASE"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

PASS=0; FAIL=0; RUN=0
pass() { RUN=$((RUN+1)); PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { RUN=$((RUN+1)); FAIL=$((FAIL+1)); printf '  ✗ %s\n     %s\n' "$1" "${2-}"; }
ok()   { if [ "$1" = 0 ]; then pass "$2"; else fail "$2" "${3-}"; fi; }

# --- світ: одна база з тим, що бекапить CSV-половина, і з Directus ------
# Три таблиці directus_* у реальній формі колонок (project_id — uuid, як
# заміряно 22.10.2026 у camptribe_dev). pg_dump байдуже, хто їх створив;
# тут важливо, що CSV їх ніколи не возили — і що дамп мусить.
build_world() {
  dropdb --if-exists --force "$SRC_DB" 2>/dev/null
  createdb "$SRC_DB" || { echo "не можу створити $SRC_DB" >&2; exit 1; }
  psql -q -v ON_ERROR_STOP=1 -d "$SRC_URL" <<'SQL'
CREATE TABLE camping_spots (
  id serial PRIMARY KEY, osm_ref text NOT NULL UNIQUE,
  context jsonb NOT NULL DEFAULT '{}', context_computed_at timestamptz,
  owner_overrides jsonb NOT NULL DEFAULT '{}',
  missing_since timestamptz, content_changed_at timestamptz);
INSERT INTO camping_spots (osm_ref, context, context_computed_at)
  VALUES ('n/1', '{"elevation": 900}', now());
CREATE TABLE guides (id serial PRIMARY KEY, slug text NOT NULL);
INSERT INTO guides (slug) VALUES ('rehearsal');

CREATE TABLE directus_settings (id integer PRIMARY KEY, project_name varchar(100), project_id uuid);
INSERT INTO directus_settings (id, project_name, project_id) VALUES (1, 'CampTribe', gen_random_uuid());
CREATE TABLE directus_flows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL);
INSERT INTO directus_flows (name) VALUES ('publish-guide'), ('notify-owner');
CREATE TABLE directus_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(128), password varchar(255));
INSERT INTO directus_users (email, password) VALUES ('owner@example.test', 'argon2-hash-stub');
SQL
}

run_backup() { OUT="$(DATABASE_URL="$SRC_URL" "$SCRIPT" backup "$1" 2>&1)"; RC=$?; }
run_verify() { OUT="$(DATABASE_URL="$SRC_URL" "$SCRIPT" verify "$1" 2>&1)"; RC=$?; }

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
mode_of() { ls -l "$1" | cut -c1-10; }

# Після підміни дампа маніфест отримує ПРАВИЛЬНУ суму підміненого файла:
# інакше verify впаде на сумі, і про вміст він так і не скаже нічого.
patch_manifest_sha() {
  python3 - "$1" <<'PY'
import hashlib, json, sys
d = sys.argv[1]
m = json.load(open(d + "/manifest.json"))
data = open(d + "/" + m["dump"]["file"], "rb").read()
m["dump"]["sha256"] = hashlib.sha256(data).hexdigest()
m["dump"]["bytes"] = len(data)
json.dump(m, open(d + "/manifest.json", "w"), indent=2)
PY
}
drop_manifest_dump() {
  python3 - "$1" <<'PY'
import json, sys
d = sys.argv[1]
m = json.load(open(d + "/manifest.json"))
m.pop("dump", None)
json.dump(m, open(d + "/manifest.json", "w"), indent=2)
PY
}
strip_manifest_dump_sha() {
  python3 - "$1" <<'PY'
import json, sys
d = sys.argv[1]
m = json.load(open(d + "/manifest.json"))
m["dump"].pop("sha256", None)
json.dump(m, open(d + "/manifest.json", "w"), indent=2)
PY
}
set_manifest_dump_file() {
  python3 - "$1" "$2" <<'PY'
import json, sys
d = sys.argv[1]
m = json.load(open(d + "/manifest.json"))
m["dump"]["file"] = sys.argv[2]
json.dump(m, open(d + "/manifest.json", "w"), indent=2)
PY
}
# Підмінити дамп у зрізі дампом, зробленим із ДОДАТКОВИМИ прапорцями
# pg_dump, і вирівняти суму. Усе інше в теці лишається, як було.
swap_dump() {
  local dir="$1"; shift
  pg_dump -Fc "$@" -d "$SRC_URL" -f "$dir/camptribe.dump" || return 1
  patch_manifest_sha "$dir"
}

echo '— справний бекап: дамп є, закритий, і несе Directus'
build_world
DIR="$BASE/good"
run_backup "$DIR"
ok "$RC" 'backup проходить (код 0) і сам себе звіряє' "rc=$RC $OUT"

pg_restore -l "$DIR/camptribe.dump" >/dev/null 2>&1
r=$?; ok "$r" 'camptribe.dump лежить поруч із CSV і читається pg_restore -l' "$(ls -l "$DIR" 2>&1)"

MODE="$(mode_of "$DIR/camptribe.dump")"
[ "$MODE" = '-rw-------' ]
r=$?; ok "$r" "права дампа рівно -rw------- (хеші паролів directus_users усередині)" "mode=$MODE"

TOC="$(pg_restore -l "$DIR/camptribe.dump" 2>/dev/null)"
S=$(grep -cE ' TABLE DATA [^ ]+ directus_settings ' <<<"$TOC" || true)
F=$(grep -cE ' TABLE DATA [^ ]+ directus_flows ' <<<"$TOC" || true)
[ "${S:-0}" -ge 1 ] && [ "${F:-0}" -ge 1 ]
r=$?; ok "$r" "pg_restore -l показує TABLE DATA для directus_settings ($S) і directus_flows ($F) — заміряно тут, не зі слів скрипта" "$TOC"

WANT="$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["dump"]["file"], m["dump"]["sha256"], m["dump"]["bytes"])' "$DIR/manifest.json")"
GOT="camptribe.dump $(sha "$DIR/camptribe.dump") $(wc -c < "$DIR/camptribe.dump" | tr -d ' ')"
[ "$WANT" = "$GOT" ]
r=$?; ok "$r" 'маніфест несе імʼя, суму й розмір дампа, і вони збігаються з файлом' "manifest: $WANT / disk: $GOT"

G=$(gzip -dc "$DIR/guides.csv.gz" | wc -l | tr -d ' ')
C=$(gzip -dc "$DIR/camping_spots_context.csv.gz" | wc -l | tr -d ' ')
[ "$G" = 2 ] && [ "$C" = 2 ]
r=$?; ok "$r" 'CSV-половина не постраждала: guides і контекст кемпінгів — по одному рядку' "guides lines=$G context lines=$C"

run_verify "$DIR"
[ "$RC" = 0 ] && [[ "$OUT" == *"TABLE DATA для directus_settings directus_flows"* ]]
r=$?; ok "$r" 'verify проходить і НАЗИВАЄ, що знайшов у дампі' "rc=$RC $OUT"

echo '— друга аварія: бази немає — дамп у порожню базу, project_id той самий'
dropdb --if-exists --force "$RESTORED_DB" 2>/dev/null
createdb "$RESTORED_DB"
R_OUT="$(pg_restore --no-owner --exit-on-error -d "$RESTORED_URL" "$DIR/camptribe.dump" 2>&1)"
r=$?; ok "$r" 'pg_restore --exit-on-error у порожню базу проходить' "$R_OUT"

PID_SRC="$(psql -tAc 'SELECT project_id FROM directus_settings WHERE id = 1' -d "$SRC_URL")"
PID_DST="$(psql -tAc 'SELECT project_id FROM directus_settings WHERE id = 1' -d "$RESTORED_URL" 2>&1)"
[ -n "$PID_SRC" ] && [ "$PID_SRC" = "$PID_DST" ]
r=$?; ok "$r" "🔴 project_id після відновлення ТОЙ САМИЙ — слот активації не згорає" "src=$PID_SRC dst=$PID_DST"

FL="$(psql -tAc 'SELECT count(*) FROM directus_flows' -d "$RESTORED_URL" 2>&1)"
US="$(psql -tAc "SELECT count(*) FROM directus_users WHERE password = 'argon2-hash-stub'" -d "$RESTORED_URL" 2>&1)"
[ "$FL" = 2 ] && [ "$US" = 1 ]
r=$?; ok "$r" 'флоу (2) і користувач із хешем (1) повернулись — те, чого CSV не возили ніколи' "flows=$FL users=$US"

DDL="$(psql -tAc "SELECT to_regclass('public.camping_spots_osm_ref_key') IS NOT NULL" -d "$RESTORED_URL" 2>&1)"
[ "$DDL" = t ]
r=$?; ok "$r" 'DDL приїхав: унікальний ключ camping_spots є в новій базі' "got=$DDL"

echo '— 🔴 мутації: дамп існує, сума правильна, вмісту немає — verify мусить червоніти'
DIR="$BASE/mut"; rm -rf "$DIR"; run_backup "$DIR"
[ "$RC" = 0 ] || { echo "backup для мутацій не пройшов: $OUT" >&2; exit 1; }
cp -R "$DIR" "$BASE/mut-pristine"
reset_mut() { rm -rf "$DIR"; cp -R "$BASE/mut-pristine" "$DIR"; }

swap_dump "$DIR" -T 'directus_*'
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"немає TABLE DATA для directus_settings"* ]]
r=$?; ok "$r" "🔴 дамп без directus_* (-T 'directus_*'), сума вирівняна → verify червоний і називає directus_settings" "rc=$RC $OUT"

reset_mut; swap_dump "$DIR" -T directus_settings
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"немає TABLE DATA для directus_settings"* ]]
r=$?; ok "$r" '🔴 дамп без САМЕ directus_settings (флоу є) → червоний: перевірка по таблиці, а не «є хоч щось directus_»' "rc=$RC $OUT"

reset_mut; swap_dump "$DIR" --schema-only
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"немає TABLE DATA для directus_settings"* ]]
r=$?; ok "$r" '🔴 --schema-only: TABLE є, TABLE DATA немає → червоний: рядок project_id не їде зі схемою' "rc=$RC $OUT"

reset_mut; head -c 1024 "$BASE/mut-pristine/camptribe.dump" > "$DIR/camptribe.dump"; patch_manifest_sha "$DIR"
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"не читає camptribe.dump"* ]]
r=$?; ok "$r" 'усічений дамп із вирівняною сумою → червоний: pg_restore -l зупиняє перевірку' "rc=$RC $OUT"

reset_mut; printf 'x' >> "$DIR/camptribe.dump"
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"camptribe.dump has changed"* ]]
r=$?; ok "$r" 'змінений байт без правки маніфесту → червоний на сумі' "rc=$RC $OUT"

reset_mut; rm -f "$DIR/camptribe.dump"
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"camptribe.dump is missing"* ]]
r=$?; ok "$r" 'дамп прибрано, маніфест його називає → червоний' "rc=$RC $OUT"

reset_mut; strip_manifest_dump_sha "$DIR"
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"без імені чи суми"* ]]
r=$?; ok "$r" 'ключ "dump" є, але без sha256 → червоний: зіпсований маніфест — не «старий зріз»' "rc=$RC $OUT"

reset_mut; set_manifest_dump_file "$DIR" '../../etc/passwd'
run_verify "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"не імʼя файла в теці"* ]]
r=$?; ok "$r" 'імʼя дампа зі шляхом у маніфесті → відмова до будь-якого читання' "rc=$RC $OUT"

echo '— старий зріз (до CAMP-386): без ключа "dump" — попередження, не відмова'
# 🔴 Рецензія PR #318: перша редакція тут падала, і `restore` з усіх
# 14 наявних тек був заборонений на два тижні. Старий зріз — це тека
# без ключа "dump" І без файла дампа; саме так виглядають усі зрізи,
# зроблені до картки.
reset_mut; drop_manifest_dump "$DIR"; rm -f "$DIR/camptribe.dump"
run_verify "$DIR"
[ "$RC" = 0 ] && [[ "$OUT" == *"зріз зроблено до CAMP-386"* ]] && [[ "$OUT" == *"CSV-половина ціла"* ]]
r=$?; ok "$r" '🔴 маніфест без "dump" → verify виходить 0 і голосно попереджає, що directus_* не відновити' "rc=$RC $OUT"

psql -q -v ON_ERROR_STOP=1 -d "$SRC_URL" -c 'TRUNCATE guides'
R_OUT="$(DATABASE_URL="$SRC_URL" "$SCRIPT" restore "$DIR" 2>&1)"; R_RC=$?
G="$(psql -tAc 'SELECT count(*) FROM guides' -d "$SRC_URL")"
[ "$R_RC" = 0 ] && [ "$G" = 1 ] && [[ "$R_OUT" == *"зріз зроблено до CAMP-386"* ]]
r=$?; ok "$r" '🔴 restore зі старого зрізу ПРОХОДИТЬ: guides повернулись із CSV (1 рядок), попередження надруковано' "rc=$R_RC guides=$G $R_OUT"

echo '— права читаються ПІСЛЯ запису, а не виводяться з umask'
# Заміряно 22.10.2026: pg_dump -f у файл, що ВЖЕ існує, лишає його права.
DIR="$BASE/perm"; mkdir -p "$DIR"; : > "$DIR/camptribe.dump"; chmod 644 "$DIR/camptribe.dump"
run_backup "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"правами -rw-r--r--"* ]] && [ ! -e "$DIR/camptribe.dump" ]
r=$?; ok "$r" '🔴 дамп поверх файла з 0644 → backup червоний, називає права й НЕ лишає такий файл' "rc=$RC exists=$([ -e "$DIR/camptribe.dump" ] && echo yes || echo no) $OUT"

echo '— база без Directus не дає знімка'
psql -q -v ON_ERROR_STOP=1 -d "$SRC_URL" -c 'DROP TABLE directus_settings'
DIR="$BASE/nocms"; run_backup "$DIR"
[ "$RC" != 0 ] && [[ "$OUT" == *"немає TABLE DATA для directus_settings"* ]]
r=$?; ok "$r" '🔴 у базі немає directus_settings → backup сам себе не зараховує' "rc=$RC $OUT"

printf '\n%s\n' "$PASS passed, $FAIL failed"
if [ "$RUN" != "$EXPECTED" ]; then
  printf '🔴 виконано %s випадків, а записано %s — набір мовчки схуд\n' "$RUN" "$EXPECTED"; exit 1
fi
[ "$FAIL" = 0 ] || exit 1
printf 'backup-local dump self-test: усе гаразд, %s випадків\n' "$EXPECTED"
