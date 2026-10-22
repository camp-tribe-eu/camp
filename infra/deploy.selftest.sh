#!/usr/bin/env bash
# Self-test для infra/bin/camptribe-deploy (CAMP-61).
#
#   ./infra/deploy.selftest.sh
#
# 🔴 ЩО ЦЕ ГАНЯЄ. Справжній скрипт, над справжнім git-репозиторієм, справжніми
# симлінками, справжнім curl і справжніми процесами node, що слухають
# справжні порти. Підмінено лише те, чого тут немає або чіпати не можна:
# systemctl, npm, psql, pg_dump, pg_restore. І підмінники віддають СИРЕ, а не
# готову відповідь: systemctl справді запускає процес із теки, на яку веде
# симлінк У ЦЮ МИТЬ (як це робить systemd), psql віддає рядки файлу, npm
# пише файли збірки. Тому «служба active, а працює старе» тут відтворюється,
# а не вигадується.
#
# 🔴 ПРОЦЕСИ СПОСТЕРІГАЮТЬСЯ НЕЗАЛЕЖНО ВІД СКРИПТА. Тест читає pid-файли
# підмінника й питає ОС, з якої теки вони працюють, власним кодом — не
# функціями скрипта, який перевіряється.
#
# 🔴 Біжить на Linux у CI, і це половина сенсу: на macOS немає ss і /proc,
# і скрипт у цих місцях іде запасним шляхом (lsof). Шлях сервера — ss і
# /proc — перевіряється тут, на раннері.
#
# 🔴 ЛІЧИЛЬНИК. «N cases» — підпис; набір, у якому випадки тихо перестали
# виконуватись, друкує менше N і виходить нулем. EXPECTED записано, і
# останній рядок друкується лише коли виконане дорівнює йому.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="${CAMPTRIBE_DEPLOY_BIN:-$HERE/bin/camptribe-deploy}"
WRAPPER="${CAMPTRIBE_WRAPPER_BIN:-$HERE/deploy-app.sh}"

if [ "$(id -u)" = 0 ]; then echo "не запускай це від root: sudo -u шлях скрипта тут не потрібен і небезпечний" >&2; exit 1; fi
[ -f "$DEPLOY" ] || { echo "немає $DEPLOY" >&2; exit 1; }

BASE="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-deploy-selftest.XXXXXX")"
# 🔴 Прервана перевірка не повинна лишати за собою процеси на портах і тимчасове дерево.
cleanup_all() { stop_world; rm -rf "$BASE"; }
trap cleanup_all EXIT
trap 'exit 130' INT TERM
EXPECTED=135
PASSED=0
FAILED=0
pass() { echo "  ✓ $1"; PASSED=$((PASSED + 1)); }
# 🔴 Хвіст, а не голова: причина падіння — в кінці виводу, і перші 12 рядків лише повторюють план.
fail() {
  echo "  ✗ $1"; FAILED=$((FAILED + 1))
  [ -z "${2:-}" ] || printf '      %s\n' "$2" | tail -n 30
  if [ -n "${W:-}" ] && [ -s "$W/calls" ]; then echo "      -- останні виклики підмінників:"; tail -n 12 "$W/calls" | sed 's/^/      /'; fi
}
section() { echo; echo "── $1"; }

# ── підмінники ───────────────────────────────────────────────────────
STUBBIN="$BASE/stubbin"; STUBDIR="$BASE/stub"
mkdir -p "$STUBBIN" "$STUBDIR"

cat > "$STUBDIR/api.js" <<'JS'
const http = require('http');
const version = '__VERSION__';
// Зламаним буває лише процес, який підняв ЮНІТ, із теки STUB_BAD_RELEASE: тимчасова
// API на час збірки й старий реліз після відкату лишаються здоровими.
const bad = process.env.STUB_UNIT === '1' && process.cwd().includes(process.env.STUB_BAD_RELEASE || '\u0000');
http.createServer((q, s) => {
  if (q.url === '/health') {
    const code = bad && process.env.STUB_API_HEALTH === '503' ? 503 : 200;
    s.writeHead(code, { 'content-type': 'application/json' });
    return s.end(JSON.stringify({ status: code === 200 ? 'ok' : 'down' }));
  }
  if (q.url === '/version') return s.end(version);
  s.writeHead(404); s.end();
}).listen(process.env.PORT, '127.0.0.1');
JS
cat > "$STUBDIR/web.js" <<'JS'
// Як Next на ПРОГРІТОМУ сервері (заміряно 15.10.2026): `/` БЕЗ коментаря з BUILD_ID
// (після ISR-ревалідації він зникає), а статика збірки лежить під /_next/static/<id>/ і
// віддається лише для РІВНО тієї збірки, з теки якої процес ЗАПУЩЕНО: BUILD_ID читається
// з .next/ у cwd на кожен запит.
const http = require('http'), fs = require('fs');
const bad = process.env.STUB_UNIT === '1' && process.cwd().includes(process.env.STUB_BAD_RELEASE || '\u0000');
http.createServer((q, s) => {
  // «поламаний» процес віддає статику ЧУЖОЇ збірки (STUB_WEB_ID), хоч працює з правильної теки
  const id = (bad && process.env.STUB_WEB_ID) || fs.readFileSync('.next/BUILD_ID', 'utf8').trim();
  // …або НЕ РЕНДЕРИТЬ HTML (STUB_WEB_HTML=500): збій рантайму Next, що не заважає віддавати
  // файли з диска. Статика збірки лишається 200, тож її перевірка цього не бачить.
  if (bad && process.env.STUB_WEB_HTML === '500' && !q.url.startsWith('/_next/static/')) {
    s.writeHead(500, { 'content-type': 'text/plain' }); return s.end('Internal Server Error');
  }
  const m = /^\/_next\/static\/([^/]+)\/_buildManifest\.js$/.exec(q.url);
  if (m) {
    if (m[1] === id) { s.writeHead(200, { 'content-type': 'application/javascript' }); return s.end('self.__BUILD_MANIFEST={}'); }
    s.writeHead(404); return s.end('nope');
  }
  s.writeHead(200, { 'content-type': 'text/html' });
  s.end('<!DOCTYPE html><html><body>ok, без коментаря з BUILD_ID</body></html>');
}).listen(process.env.PORT, '127.0.0.1');
JS

cat > "$STUBBIN/systemctl" <<'SH'
#!/usr/bin/env bash
W="${STUB_W:?}"
echo "systemctl $*" >> "$W/calls"
sub="$1"; shift
up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# kind/port/wd юніту: з .conf світу («бойова» пара) або з юніта, який виконавець ВІДРЕНДЕРИВ (репетиція).
unit_info() {
  kind=""; port=""; wd=""
  if [ -f "$W/units/$1.conf" ]; then . "$W/units/$1.conf"; return 0; fi
  local f="${STUB_UNIT_DIR:-/nonexistent}/$1.service" ef
  [ -f "$f" ] || return 1
  wd=$(sed -n 's/^WorkingDirectory=//p' "$f" | head -1)
  case "$1" in *-api) kind=api ;; *) kind=web ;; esac
  if [ "$kind" = web ]; then port=$(sed -n 's/.* -p \([0-9][0-9]*\).*/\1/p' "$f" | head -1)
  else ef=$(sed -n 's/^EnvironmentFile=//p' "$f" | head -1); port=$(sed -n 's/^PORT=//p' "$ef" | head -1); fi
}
stop_unit() {
  local u="$1" pid
  pid=$(cat "$W/units/$u.pid" 2>/dev/null) || return 0
  unit_info "$u" || return 0
  pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  for _ in $(seq 1 40); do up "$port" || break; sleep 0.1; done
  rm -f "$W/units/$u.pid"
}
start_unit() {
  local u="$1" real
  unit_info "$u" || { echo "systemctl shim: немає юніта $u" >&2; exit 5; }
  # systemd розкриває WorkingDirectory ПІД ЧАС СТАРТУ: що веде симлінк у цю мить, те й стає cwd.
  real=$(cd -P "$wd" && pwd -P)
  if [ "$kind" = api ]; then
    STUB_UNIT=1 PORT=$port bash -c 'echo $$ > "$1"; cd "$2"; exec node dist/main.js' _ "$W/units/$u.pid" "$real" >/dev/null 2>&1 &
  else
    STUB_UNIT=1 PORT=$port bash -c 'echo $$ > "$1"; cd "$2"; node "$3" & wait' _ "$W/units/$u.pid" "$real" "$STUB_DIR/web.js" >/dev/null 2>&1 &
  fi
  disown 2>/dev/null || true
  date +%s%N > "$W/units/$u.started" 2>/dev/null || date +%s > "$W/units/$u.started"
  for _ in $(seq 1 50); do up "$port" && break; sleep 0.1; done
}
case "$sub" in
  restart)
    n=$(( $(cat "$W/restart.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$W/restart.count"
    [ "${STUB_RESTART:-}" != fail ] || exit 1
    # перший restart справжній, дальші падають: «перемкнули, воно зламане, а повернути не вдалось»
    if [ "${STUB_RESTART:-}" = fail_after_1 ] && [ "$n" -gt 1 ]; then exit 1; fi
    [ "${STUB_RESTART:-}" != noop ] || exit 0
    for u in "$@"; do stop_unit "$u"; done
    for u in "$@"; do start_unit "$u"; done ;;
  start)
    for u in "$@"; do start_unit "$u"; done
    # вада, яку репетиція мусить ловити: запуск юніта репетиції зачепив БОЙОВІ юніти
    if [ -n "${STUB_TOUCH_PROD:-}" ]; then
      stop_unit camptribe-api; stop_unit camptribe-web; start_unit camptribe-api; start_unit camptribe-web
    fi ;;
  stop) for u in "$@"; do stop_unit "$u"; done ;;
  daemon-reload) ;;
  is-active)
    pid=$(cat "$W/units/$1.pid" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo active; else echo inactive; exit 3; fi ;;
  show)
    prop="$2"; unit="${*: -1}"
    case "$prop" in
      MainPID)
        # «чужий слухач»: лише поки current веде на STUB_BAD_RELEASE, systemd «каже» не той MainPID
        if [ -n "${STUB_MAINPID_OVERRIDE:-}" ] && grep -q "${STUB_BAD_RELEASE:-ZZZZZZZ}" <<<"$(readlink "$STUB_ROOT/$STUB_LINK")"; then echo "$STUB_MAINPID_OVERRIDE"
        else cat "$W/units/$unit.pid" 2>/dev/null || echo 0; fi ;;
      WorkingDirectory)
        if [ -n "${STUB_WD_OVERRIDE:-}" ]; then echo "$STUB_WD_OVERRIDE"; else unit_info "$unit" && echo "$wd"; fi ;;
      ProtectSystem)
        if [ -n "${STUB_PROTECT_OVERRIDE:-}" ]; then echo "$STUB_PROTECT_OVERRIDE"; else sed -n 's/^ProtectSystem=//p' "${STUB_UNIT_DIR:-/nonexistent}/$unit.service" | head -1; fi ;;
      ReadWritePaths)
        if [ -n "${STUB_RWP_OVERRIDE:-}" ]; then echo "$STUB_RWP_OVERRIDE"; else sed -n 's/^ReadWritePaths=//p' "${STUB_UNIT_DIR:-/nonexistent}/$unit.service" | head -1; fi ;;
      ActiveEnterTimestampMonotonic) cat "$W/units/$unit.started" 2>/dev/null || echo 0 ;;
      *) echo ;;
    esac ;;
  *) echo "systemctl shim: не знаю '$sub'" >&2; exit 99 ;;
esac
SH

cat > "$STUBBIN/npm" <<'SH'
#!/usr/bin/env bash
W="${STUB_W:?}"
echo "npm $* [in ${PWD##*/}]${API_BASE_URL:+ API_BASE_URL=$API_BASE_URL}" >> "$W/calls"
migdir() { if [ -d src/migrations ]; then echo src/migrations; else echo apps/api/src/migrations; fi; }
case "$*" in
  ci*) mkdir -p node_modules ;;
  "run build:api")
    mkdir -p apps/api/dist
    sed "s/__VERSION__/$(cat VERSION)/" "$STUB_DIR/api.js" > apps/api/dist/main.js ;;
  "run build:web")
    . "$STUB_DIR/leak.sh"; leakcheck build:web
    # Файл оточення з секретами мусить зникнути ДО того, як збірка (~400 с) почнеться, а не після.
    printf 'DATABASE_URL=%s\nAPI_BUILD_TOKEN=%s\nAPI_BASE_URL=%s\nNODE_OPTIONS=%s\nNEXT_PUBLIC_API_BASE_URL=%s\nNEXT_PUBLIC_SITE_MODE=%s\nENVFILES=%s\n' "${DATABASE_URL-<unset>}" "${API_BUILD_TOKEN-<unset>}" \
      "${API_BASE_URL-<unset>}" "${NODE_OPTIONS-<unset>}" "${NEXT_PUBLIC_API_BASE_URL-<unset>}" "${NEXT_PUBLIC_SITE_MODE-<unset>}" "$(ls "${TMPDIR:-/tmp}"/camptribe-envfile.* 2>/dev/null | wc -l | tr -d ' ')" > "$W/buildenv"
    base="${API_BASE_URL:?}"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$base/health")
    [ "$code" = 200 ] || { echo "build:web: API на $base відповіла '$code'" >&2; exit 1; }
    mkdir -p apps/web/.next
    curl -s "$base/version" > apps/web/.next/built-against
    id="${FAKE_BUILD_ID:-$(node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("base64url").slice(0,21))' "build-$(cat VERSION)")}"
    printf '%s' "$id" > apps/web/.next/BUILD_ID
    # 🔴 CAMP-340. Підмінник запікає у «статику» РІВНО ТЕ, що отримав в
    # оточенні — порожнє, якщо не отримав нічого. Якби він писав сюди
    # правильну адресу, перевірка підтверджувала б сама себе і пройшла б
    # навіть тоді, коли build_web() знову перестане проводити NEXT_PUBLIC_*.
    mkdir -p apps/web/.next/static/chunks
    # STUB_WEB_NO_PUBLIC=1 відтворює «змінна доїхала в оточення, але у
    # статику не потрапила»: інша назва префікса, збірка її проігнорувала,
    # підміна конфіга. Саме цей випадок відрізняє замок, що дивиться на
    # РЕЗУЛЬТАТ, від перевірки, яка дивиться на оточення.
    if [ "${STUB_WEB_NO_PUBLIC:-}" = 1 ]; then
      printf 'var API="";\n' > apps/web/.next/static/chunks/main.js
    else
      printf 'var API=%s;\n' "\"${NEXT_PUBLIC_API_BASE_URL-}\"" > apps/web/.next/static/chunks/main.js
    fi ;;
  "run migration:run")
    [ "${STUB_MIGRATE_FAIL:-}" != 1 ] || { echo "міграція впала" >&2; exit 1; }
    for f in "$(migdir)"/*.ts; do
      b=$(basename "$f" .ts); n="${b#*-}${b%%-*}"
      grep -qx "$n" "$W/db/applied" || echo "$n" >> "$W/db/applied"
    done ;;
  "run migration:revert") echo "REVERT" >&2; exit 1 ;;
  *) echo "npm shim: не знаю '$*'" >&2; exit 99 ;;
esac
SH

cat > "$STUBBIN/psql" <<'SH'
#!/usr/bin/env bash
W="${STUB_W:?}"
echo "psql $*" >> "$W/calls"
. "$STUB_DIR/leak.sh"; leakcheck psql
# Що інструмент справді отримав у ОТОЧЕННІ: так бачить libpq. У argv цього немає, і тест це доводить.
printf 'host=%s port=%s user=%s db=%s ssl=%s pw=%s opts=%s\n' "${PGHOST-<unset>}" "${PGPORT-<unset>}" "${PGUSER-<unset>}" \
  "${PGDATABASE-<unset>}" "${PGSSLMODE-<unset>}" "${PGPASSWORD-<unset>}" "${PGOPTIONS-<unset>}" >> "$W/pgenv.psql"
[ "${STUB_PSQL:-}" != fail ] || exit 2
case "$*" in *"from migrations"*) cat "$W/db/applied" ;; esac
SH
cat > "$STUBBIN/pg_dump" <<'SH'
#!/usr/bin/env bash
W="${STUB_W:?}"
echo "pg_dump $*" >> "$W/calls"
. "$STUB_DIR/leak.sh"; leakcheck pg_dump
printf 'host=%s port=%s user=%s db=%s ssl=%s pw=%s opts=%s\n' "${PGHOST-<unset>}" "${PGPORT-<unset>}" "${PGUSER-<unset>}" \
  "${PGDATABASE-<unset>}" "${PGSSLMODE-<unset>}" "${PGPASSWORD-<unset>}" "${PGOPTIONS-<unset>}" >> "$W/pgenv.pg_dump"
[ "${STUB_PGDUMP:-}" != fail ] || exit 1
f=""; while [ $# -gt 0 ]; do [ "$1" = -f ] && f="$2"; shift; done
if [ "${STUB_PGDUMP:-}" = empty ]; then : > "$f"; else echo "dump of $(tr '\n' ' ' < "$W/db/applied")" > "$f"; fi
# частковий дамп: файл є й читається, але pg_dump впав посередині
[ "${STUB_PGDUMP:-}" != partial ] || exit 1
SH
cat > "$STUBBIN/pg_restore" <<'SH'
#!/usr/bin/env bash
W="${STUB_W:?}"
echo "pg_restore $*" >> "$W/calls"
[ -s "${*: -1}" ]
SH
cat > "$STUBBIN/systemd-run" <<'SH'
#!/usr/bin/env bash
W="${STUB_W:?}"
echo "systemd-run $*" >> "$W/calls"
# Справжній systemd-run з ProtectSystem=strict не пустив би запис: це властивість ЯДРА, тут вона
# відтворена відповіддю. Заміряно на справжньому сервері 15.10.2026: READONLY.
if [ -n "${STUB_PROBE_WRITABLE:-}" ]; then exec /bin/sh -c "${*: -1}"; fi
echo READONLY
SH
# Лічильник: скільки процесів НА МАШИНІ тримають секрет у командному рядку просто зараз.
# Його кличуть підмінники інструментів у ту мить, коли справжні psql/pg_dump/збірка жили б.
# `ps` читає ВЕСЬ перелік процесів, тож він бачить і предків (sudo, bash -c), а не лише сам інструмент.
cat > "$STUBDIR/leak.sh" <<'SH'
leakcheck() { # імʼя інструмента
  [ -n "${STUB_SECRET_MARKS:-}" ] || return 0
  local W="${STUB_W:?}" total n
  # shellcheck disable=SC2086
  printf '%s\n' $STUB_SECRET_MARKS > "$W/leak.marks"
  ps axww -o args= > "$W/leak.ps.$$" 2>/dev/null || true
  total=$(grep -c . "$W/leak.ps.$$" || true)
  n=$(grep -c -F -f "$W/leak.marks" "$W/leak.ps.$$" || true)
  echo "$1 procs=$total leaks=$n" >> "$W/leak.log"
  rm -f "$W/leak.ps.$$"
}
SH

# sudo — як справжній: лишається ПРОЦЕСОМ-БАТЬКОМ на весь час життя дитини (його argv, з усім, що
# йому передали, видно в `ps` увесь цей час), і, як при env_reset, віддає дитині не все оточення.
cat > "$STUBBIN/sudo" <<'SH'
#!/usr/bin/env bash
W="${STUB_W:?}"
echo "sudo $*" >> "$W/calls"
while [ $# -gt 0 ]; do case "$1" in -u) shift 2 ;; -H) shift ;; *) break ;; esac; done
case " $* " in *" ${STUB_SUDO_FAIL:-ZZZNOTHING} "*) exit 1 ;; esac
keep=()
for v in $(compgen -e); do
  case "$v" in PATH|HOME|TERM|TMPDIR|LANG|LC_*|STUB_*|FAKE_BUILD_ID|GIT_*) keep+=("$v=${!v}") ;; esac
done
env -i "${keep[@]}" "$@"
rc=$?   # не останній рядок: bash не підміняє себе дитиною, і argv sudo лишається в `ps`
exit "$rc"
SH
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBBIN/chown"
# stat, що вміє «не прочитатись» (STUB_STAT_FAIL): інакше гілка «лічильник не прочитався» недосяжна.
printf '#!/usr/bin/env bash\n[ -z "${STUB_STAT_FAIL:-}" ] || exit 1\nexec %s "$@"\n' "$(command -v stat)" > "$STUBBIN/stat"
chmod +x "$STUBBIN"/*

# ── репозиторій ──────────────────────────────────────────────────────
SRC="$BASE/src"; REPO="$BASE/repo.git"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
mkdir -p "$SRC/apps/api/src/migrations" "$SRC/apps/web"
# 🔴 `-b main` явно: на раннері init.defaultBranch це master, і обгортка (origin/main) не знаходила гілки.
git init -q -b main "$SRC"; git -C "$SRC" config commit.gpgsign false
: > "$SRC/apps/api/.gitkeep"; : > "$SRC/apps/web/.gitkeep"; echo '{}' > "$SRC/package.json"
mig() { printf 'export class X {}\n' > "$SRC/apps/api/src/migrations/$1.ts"; }
commit() { # index тег
  echo "$2" > "$SRC/VERSION"
  git -C "$SRC" add -A
  GIT_AUTHOR_DATE="2026-10-1$1T10:00:00Z" GIT_COMMITTER_DATE="2026-10-1$1T10:00:00Z" git -C "$SRC" commit -q -m "commit $2"
  eval "SHA$1=$(git -C "$SRC" rev-parse HEAD)"
  eval "S$1=$(git -C "$SRC" rev-parse --short=7 HEAD)"
}
mig 1000000000000-Alpha; mig 1000000000001-Beta
commit 0 v0
commit 1 v1
mig 1000000000002-Gamma
commit 2 v2
commit 3 v3
commit 4 v4
git clone -q --bare "$SRC" "$REPO"; git -C "$REPO" config uploadpack.allowAnySHA1InWant true

# ── світ одного випадку ──────────────────────────────────────────────
W=""
# Порт перевіряється самим bash (/dev/tcp), а не lsof: на раннері lsof може не бути, і тоді «порт вільний»
# було б правдою завжди.
port_up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# 🔴 Порти беруться з 20000–29999: нижче ефемерного діапазону і Linux (32768+), і macOS (49152+).
# Випадковий порт із 30000–50000 міг збігтись із локальним портом клієнтського з'єднання curl і дати
# EADDRINUSE у сервера, який стартує. А реєстр використаних портів — файл: `$(free_port)` виконується
# в підоболонці, і змінна, змінена там, до наступного виклику не доживає.
PORTS_USED="$BASE/ports.used"; : > "$PORTS_USED"
free_port() {
  local p
  while :; do
    p=$((${SELFTEST_PORT_BASE:-20000} + RANDOM % ${SELFTEST_PORT_SPAN:-10000}))
    grep -qx "$p" "$PORTS_USED" && continue
    port_up "$p" || { echo "$p" >> "$PORTS_USED"; echo "$p"; return; }
  done
}

stop_world() {
  [ -n "$W" ] && [ -d "$W/units" ] || return 0
  local f pid
  for f in "$W"/units/*.pid; do
    [ -e "$f" ] || continue
    pid=$(cat "$f"); pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  done
  [ -z "${TPORT:-}" ] || { local lp; lp=$(lsof -nP -iTCP:"$TPORT" -sTCP:LISTEN -t 2>/dev/null || true); [ -z "$lp" ] || kill "$lp" 2>/dev/null; }
  sleep 0.2
}

# Один реліз «як у проді до CAMP-61»: git + збірка, без RELEASE.json.
make_legacy_release() { # short sha
  local d="$W/root/releases/$1"
  mkdir -p "$d"; git -C "$d" init -q; git -C "$d" remote add origin "$REPO"
  git -C "$d" fetch -q --depth 1 origin "$2"; git -C "$d" checkout -q --detach FETCH_HEAD
  printf 'DATABASE_URL=postgres://stub/stub\nAPI_BUILD_TOKEN=tok\nPORT=3001\nNEXT_PUBLIC_API_BASE_URL=https://camptribe.eu/api\n' > "$d/apps/api/.env"
  ( cd "$d" && npm run build:api && STUB_API_BASE=none API_BASE_URL=http://127.0.0.1:"$TPORT" true >/dev/null )
  mkdir -p "$d/apps/web/.next/static/chunks"
  # 🔴 ЦЕ РЕЛІЗ, ЗІБРАНИЙ ДО CAMP-340, І ЙОГО ПОЛОВИНИ НАВМИСНО
  # РОЗХОДЯТЬСЯ. Ключ у `.env` є (оператор дописав його на машині —
  # заміряно на проді 16.10.2026), а статика зібрана раніше й адреси не
  # несе. Рівно так виглядав прод у мить виправлення.
  #
  # Перша редакція цієї фікстури писала статику З ТОГО Ж рядка .env, тож
  # дві половини не могли розійтись за побудовою — і «реліз, зібраний до
  # зміни» зник із набору разом із усіма випадками відкату на нього.
  # Рецензія це відтворила: 131/131 перетворювались на 111/131, щойно
  # фікстуру робили реалістичною.
  printf 'var API="";\n' > "$d/apps/web/.next/static/chunks/main.js"
  printf '%s' "${3:-$(node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("base64url").slice(0,21))' "build-$(cat "$d/VERSION")")}" > "$d/apps/web/.next/BUILD_ID"
}

new_world() { # імʼя [короткий sha, з якого стартує "прод"]
  stop_world
  W="$BASE/w_$1"; rm -rf "$W"
  mkdir -p "$W/db" "$W/units" "$W/root/releases"
  : > "$W/calls"
  APIP=$(free_port); WEBP=$(free_port); TPORT=$(free_port); RWP=$(free_port); RAP=$(free_port)
  # Юніти репетиції генеруються з РЕАЛЬНИХ юнітів репо: лише шляхи й порти підставлено під цей світ.
  mkdir -p "$W/unitsrc" "$W/unitdir"
  for u in api web; do
    sed -e "s|/srv/camptribe/current|$W/root/current|g" -e "s|-p 3000|-p $WEBP|" -e "s|^Environment=PORT=3000|Environment=PORT=$WEBP|" \
        -e "s|API_BASE_URL=http://localhost:3001|API_BASE_URL=http://localhost:$APIP|" "$HERE/systemd/camptribe-$u.service" > "$W/unitsrc/camptribe-$u.service"
  done
  export STUB_UNIT_DIR="$W/unitdir"
  printf 'kind=api\nport=%s\nwd=%s\n' "$APIP" "$W/root/current/apps/api" > "$W/units/camptribe-api.conf"
  printf 'kind=web\nport=%s\nwd=%s\n' "$WEBP" "$W/root/current/apps/web" > "$W/units/camptribe-web.conf"
  printf 'Alpha1000000000000\nBeta1000000000001\n' > "$W/db/applied"
  export STUB_W="$W" STUB_ROOT="$W/root" STUB_LINK=current STUB_DIR="$STUBDIR"
  export PATH="$STUBBIN:$ORIG_PATH"
  make_legacy_release "${2:-$S0}" "$(eval echo \$SHA"${3:-0}")" "${4:-}"
  ln -sfn "releases/${2:-$S0}" "$W/root/current"
  systemctl restart camptribe-api camptribe-web
  : > "$W/calls"; rm -f "$W/restart.count"
}
ORIG_PATH="$PATH"

# Запуск виконуваного скрипта над світом. Результат: $OUT (весь вивід) і $RC.
X() {
  OUT=$(env CAMPTRIBE_ROOT="$W/root" CAMPTRIBE_REPO="$REPO" CAMPTRIBE_API_PORT="$APIP" CAMPTRIBE_WEB_PORT="$WEBP" \
            CAMPTRIBE_BUILD_API_PORT="$TPORT" CAMPTRIBE_READY_TRIES=20 CAMPTRIBE_READY_SLEEP=0.3 CAMPTRIBE_MIN_FREE_GB="${T_MIN_FREE:-0}" \
            CAMPTRIBE_USER=selftest-nobody CAMPTRIBE_DEPLOYER=tester@selftest CAMPTRIBE_UNIT_SRC="$W/unitsrc" CAMPTRIBE_UNIT_DIR="$W/unitdir" \
            CAMPTRIBE_REHEARSAL_ROOT="$W/rehearsal" CAMPTRIBE_REHEARSAL_WEB_PORT="$RWP" CAMPTRIBE_REHEARSAL_API_PORT="$RAP" \
            bash "$DEPLOY" "$@" 2>&1)
  RC=$?
}

# ── спостереження, незалежні від скрипта ─────────────────────────────
# Фізична тека, з якої ЗАРАЗ працює процес юніта (або слухач порту).
os_cwd() { # pid
  if [ -d /proc/self ]; then readlink "/proc/$1/cwd"; else lsof -a -d cwd -p "$1" -Fn 2>/dev/null | sed -n 's/^n//p'; fi
}
listener_of() { # порт
  if command -v ss >/dev/null 2>&1; then ss -H -ltnp "sport = :$1" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
  else lsof -nP -iTCP:"$1" -sTCP:LISTEN -t | head -1; fi
}
phys() { (cd -P "$1" && pwd -P); }
running_from() { # api|web -> тека релізу, з якої реально працює слухач
  local port; if [ "$1" = api ]; then port=$APIP; else port=$WEBP; fi
  local c; c=$(os_cwd "$(listener_of "$port")"); c="${c%/apps/*}"; echo "${c##*/}"
}
# Що живий процес відповідає на запит статики збірки <id>: 200 лише для його власної.
web_serves() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEBP/_next/static/$1/_buildManifest.js"; }
file_id() { cat "$W/root/releases/$1/apps/web/.next/BUILD_ID"; }

# Відбиток дерева: ім'я, тип, розмір, mtime, режим, ціль симлінка.
fingerprint() {
  node -e '
    const fs = require("fs"), path = require("path"), root = process.argv[1], out = [];
    (function walk(d) {
      for (const n of fs.readdirSync(d).sort()) {
        const p = path.join(d, n), s = fs.lstatSync(p);
        out.push([p.slice(root.length), s.isSymbolicLink() ? "l:" + fs.readlinkSync(p) : s.isDirectory() ? "d" : "f:" + s.size + ":" + Math.floor(s.mtimeMs), s.mode, s.uid].join("|"));
        if (s.isDirectory()) walk(p);
      }
    })(root);
    console.log(require("crypto").createHash("sha256").update(out.join("\n")).digest("hex"));
  ' "$1"
}
calls_have() { grep -qE "$1" "$W/calls"; }
mutating_calls() { grep -E '^(npm (ci|run)|pg_dump|systemctl (restart|start|stop))' "$W/calls" || true; }
line_no() { grep -nE "$1" "$W/calls" | head -1 | cut -d: -f1; }
hist() { [ -f "$W/root/deploy-history.jsonl" ] && cat "$W/root/deploy-history.jsonl" || true; }

# ═══════════════════════════════════════════════════════════════════
section "A. Без --apply нічого не міняється"

new_world a1
# Дотик до відстежуваного файлу: тепер `git status` БУВ БИ переписав .git/index, якби йому дозволили.
echo touched >> "$W/root/releases/$S0/VERSION"; git -C "$W/root/releases/$S0" checkout -q -- VERSION; touch "$W/root/releases/$S0/VERSION"
FP=$(fingerprint "$W/root")
X deploy --sha "$SHA1"
[ $RC -eq 0 ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT" && pass "deploy без прапорців: код 0 і написано, що це сухий прогін" || fail "deploy без прапорців: код 0 і написано, що це сухий прогін" "rc=$RC $OUT"
[ "$(fingerprint "$W/root")" = "$FP" ] && pass "deploy без --apply: дерево релізів не змінилось ні на байт" || fail "deploy без --apply: дерево релізів не змінилось ні на байт"
[ -z "$(mutating_calls)" ] && pass "deploy без --apply: жодного npm, pg_dump, restart" || fail "deploy без --apply: жодного npm, pg_dump, restart" "$(mutating_calls)"
[ ! -e "$W/root/deploy-history.jsonl" ] && [ ! -e "$W/root/deploy.log" ] && pass "deploy без --apply: ні історії, ні логу, ні замка" || fail "deploy без --apply: ні історії, ні логу, ні замка"

X deploy --sha "$SHA1" --migrate
[ "$(fingerprint "$W/root")" = "$FP" ] && [ -z "$(mutating_calls)" ] && pass "--migrate без --apply усе ще сухий прогін" || fail "--migrate без --apply усе ще сухий прогін" "$(mutating_calls)"

FP=$(fingerprint "$W/root"); X status
[ "$(fingerprint "$W/root")" = "$FP" ] && pass "status не міняє нічого, зокрема .git/index (--no-optional-locks)" || fail "status не міняє нічого, зокрема .git/index (--no-optional-locks)"

new_world a2
X deploy --sha "$SHA1" --apply >/dev/null; X deploy --sha "$SHA2" --apply --migrate >/dev/null
: > "$W/calls"; FP=$(fingerprint "$W/root")
X rollback
[ $RC -eq 0 ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT" && [ "$(fingerprint "$W/root")" = "$FP" ] && [ -z "$(mutating_calls)" ] \
  && pass "rollback без --apply: показав план і нічого не змінив" || fail "rollback без --apply: показав план і нічого не змінив" "rc=$RC $(mutating_calls)"
X switch "$S1"
[ $RC -eq 0 ] && [ "$(fingerprint "$W/root")" = "$FP" ] && [ -z "$(mutating_calls)" ] && pass "switch без --apply: нічого не змінив" || fail "switch без --apply: нічого не змінив" "rc=$RC $(mutating_calls)"

new_world a3
X deploy --sha "$SHA1" --apply >/dev/null
: > "$W/calls"; FP=$(fingerprint "$W/root"); X rehearse
[ $RC -eq 0 ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT" && [ "$(fingerprint "$W/root")" = "$FP" ] && [ -z "$(mutating_calls)" ] \
  && pass "rehearse без --apply: план, нічого не створено" || fail "rehearse без --apply: план, нічого не створено" "rc=$RC $OUT"

# 🔴 Відбиток дивився лише на $W/root, а teardown руйнує НЕ ТАМ: корінь репетиції, її юніти й порти лежать
# поза ним. Сторож, сліпий до місця, де міняється стан, червоніти не може. Тому тут світ, у якому живе
# ВСЕ, що будь-яка команда могла б зачепити, і відбиток охоплює все це.
new_world a4
X deploy --sha "$SHA1" --apply >/dev/null; X rehearse --apply --keep >/dev/null
fp_all() {
  echo "root=$(fingerprint "$W/root") rehearsal=$(fingerprint "$W/rehearsal" 2>&1) units=$(fingerprint "$W/unitdir")" \
       "rweb=$(port_up "$RWP" && echo up || echo down) rapi=$(port_up "$RAP" && echo up || echo down)"
}
# Дотик до відстежуваного файлу: тепер `git status` БУВ БИ переписав .git/index, якби йому дозволили (як у A1).
touch "$W/root/releases/$S0/VERSION"
FPALL=$(fp_all)
[ -d "$W/rehearsal" ] && [ -f "$W/rehearsal/.camptribe-rehearsal-root" ] && [ -f "$W/unitdir/camptribe-rehearsal-api.service" ] && [ -f "$W/unitdir/camptribe-rehearsal-web.service" ] && port_up "$RWP" && port_up "$RAP" \
  && pass "передумова A4: після rehearse --apply --keep світ репетиції живий (корінь, обидва юніти, обидва порти)" \
  || fail "передумова A4: після rehearse --apply --keep світ репетиції живий (корінь, обидва юніти, обидва порти)" "$(ls "$W" "$W/unitdir" 2>&1)"
dry_case() { # опис очікуваний-код args…
  local label="$1" want="$2"; shift 2
  : > "$W/calls"; X "$@"
  if [ $RC -eq "$want" ] && [ "$(fp_all)" = "$FPALL" ] && [ -z "$(mutating_calls)" ]; then
    pass "без --apply, коли світ репетиції живий: $label — код $want, кореня, юнітів і портів не зачеплено"
  else fail "без --apply, коли світ репетиції живий: $label — код $want, кореня, юнітів і портів не зачеплено" "rc=$RC mutating=[$(mutating_calls)] changed=$([ "$(fp_all)" = "$FPALL" ] && echo no || echo YES) $OUT"; fi
}
dry_case "status" 0 status
dry_case "deploy --sha … --migrate" 0 deploy --sha "$SHA2" --migrate
dry_case "switch" 0 switch "$S0"
dry_case "rollback" 0 rollback
dry_case "rehearse (відмовляє: залишок)" 1 rehearse
dry_case "rehearse --keep" 1 rehearse --keep
dry_case "rehearse --teardown" 0 rehearse --teardown
dry_case "rehearse --keep --teardown (суперечливі прапорці)" 2 rehearse --keep --teardown
: > "$W/calls"; X rehearse --teardown
if [ $RC -eq 0 ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT" && grep -qF "$W/rehearsal" <<<"$OUT" \
   && grep -q 'camptribe-rehearsal-api' <<<"$OUT" && grep -q 'camptribe-rehearsal-web' <<<"$OUT" && grep -q -- '--teardown --apply' <<<"$OUT"; then
  pass "rehearse --teardown без --apply: слова «СУХИЙ ПРОГІН», що саме буде прибрано (корінь, обидва юніти) і як застосувати"
else fail "rehearse --teardown без --apply: слова «СУХИЙ ПРОГІН», що саме буде прибрано (корінь, обидва юніти) і як застосувати" "rc=$RC $OUT"; fi

# ═══════════════════════════════════════════════════════════════════
section "B. Реліз пов'язаний із комітом не лише іменем теки"

new_world b1
X status
grep -q "RELEASE.json немає" <<<"$OUT" && grep -q "$SHA0" <<<"$OUT" && pass "реліз без маніфесту: status каже це й дістає повний SHA з .git" || fail "реліз без маніфесту: status каже це й дістає повний SHA з .git" "$OUT"

X deploy --sha "$SHA1" --apply
M="$W/root/releases/$S1/RELEASE.json"
if [ -f "$M" ] \
  && [ "$(jq -r .sha "$M")" = "$SHA1" ] && [ "$(jq -r .release "$M")" = "$S1" ] \
  && [ "$(jq -r .deployed_by "$M")" = "tester@selftest" ] \
  && [ "$(jq -r .build_id "$M")" = "$(file_id "$S1")" ] \
  && [ "$(jq -r '.modified_tracked_files | length' "$M")" = 0 ] \
  && jq -e '.built_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z$")' "$M" >/dev/null \
  && [ "$(jq -r '.migrations | join(",")' "$M")" = "1000000000000-Alpha,1000000000001-Beta" ]; then
  pass "маніфест, прочитаний з ФАЙЛУ: повний SHA, ім'я теки, хто, коли, BUILD_ID, міграції"
else fail "маніфест, прочитаний з ФАЙЛУ: повний SHA, ім'я теки, хто, коли, BUILD_ID, міграції" "$(cat "$M" 2>&1)"; fi
[ "$(node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$M")" = 444 ] && pass "маніфест записано лише для читання (444)" || fail "маніфест записано лише для читання (444)"
X status
[ $RC -eq 0 ] && grep -q "$SHA1" <<<"$OUT" && grep -q 'commit v1' <<<"$OUT" && grep -q 'ВИСНОВОК: усе збігається' <<<"$OUT" && grep -q 'веб віддає HTML (/ → 200)' <<<"$OUT" \
  && pass "status: повний SHA й тема коміту з маніфесту, і вирок «усе збігається»" || fail "status: повний SHA й тема коміту з маніфесту, і вирок «усе збігається»" "$OUT"

echo tamper >> "$W/root/releases/$S1/apps/api/dist/main.js"
X status
[ $RC -ne 0 ] && grep -q 'ЗМІНЕНО після збірки' <<<"$OUT" && pass "status ловить правку dist API після збірки (хеш з маніфесту)" || fail "status ловить правку dist API після збірки (хеш з маніфесту)" "rc=$RC"

new_world b2
echo "local edit" >> "$W/root/releases/$S0/VERSION"
X status
grep -q 'відрізняються від його коміту' <<<"$OUT" && pass "реліз із правкою поверх коміту: status каже, що ім'я теки не доводить зміст" || fail "реліз із правкою поверх коміту: status каже, що ім'я теки не доводить зміст" "$OUT"

# ═══════════════════════════════════════════════════════════════════
section "C. Після перемикання перевіряється, що саме працює"

new_world c1
X deploy --sha "$SHA1" --apply
if [ $RC -eq 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S1" ] \
   && [ "$(running_from api)" = "$S1" ] && [ "$(running_from web)" = "$S1" ] \
   && [ "$(web_serves "$(file_id "$S1")")" = 200 ] && [ "$(web_serves "$(file_id "$S0")")" = 404 ]; then
  pass "деплой: current, обидва процеси (за ОС) і статика збірки — усе на новому релізі (стара збірка вже 404)"
else fail "деплой: current, обидва процеси (за ОС) і статика збірки — усе на новому релізі (стара збірка вже 404)" "rc=$RC api=$(running_from api) web=$(running_from web) $OUT"; fi
echo "$(hist)" | jq -e 'select(.action=="deploy" and .ok==true and .from=="'"$S0"'" and .to=="'"$S1"'")' >/dev/null \
  && pass "історія: запис deploy ${S0}→${S1}, ok" || fail "історія: запис deploy ${S0}→${S1}, ok" "$(hist)"

new_world c2
STUB_RESTART=noop X deploy --sha "$SHA1" --apply
if [ $RC -eq 3 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && grep -q 'повертаю' <<<"$OUT" && grep -q 'працює з' <<<"$OUT"; then
  pass "службу не перезапущено: перевірка падає, скрипт повертає $S0 і виходить 3"
else fail "службу не перезапущено: перевірка падає, скрипт повертає $S0 і виходить 3" "rc=$RC link=$(readlink "$W/root/current") $OUT"; fi
echo "$(hist)" | jq -e 'select(.action=="deploy" and .ok==false)' >/dev/null && echo "$(hist)" | jq -e 'select(.action=="revert" and .ok==true)' >/dev/null \
  && pass "історія: невдалий deploy і успішний revert записано обидва" || fail "історія: невдалий deploy і успішний revert записано обидва" "$(hist)"

# Той самий BUILD_ID у двох релізах: лише перевірка ПРОЦЕСУ може відрізнити їх.
new_world c3 "$S0" 0 samesamesamesamesame1
FAKE_BUILD_ID=samesamesamesamesame1 STUB_RESTART=noop X deploy --sha "$SHA1" --apply
if [ $RC -eq 3 ] && grep -q 'веб: pid [0-9]* працює з' <<<"$OUT" && ! grep -q 'веб не віддає статику збірки' <<<"$OUT"; then
  pass "однаковий BUILD_ID, health ok: лише перевірка теки процесу ловить «працює старе»"
else fail "однаковий BUILD_ID, health ok: лише перевірка теки процесу ловить «працює старе»" "rc=$RC $OUT"; fi

new_world c4
STUB_BAD_RELEASE="$S1" STUB_WEB_ID=wrongwrongwrongwrongx X deploy --sha "$SHA1" --apply
if [ $RC -eq 3 ] && grep -q 'веб не віддає статику збірки' <<<"$OUT" && ! grep -q 'працює з .*, а чекали' <<<"$OUT"; then
  pass "процес у правильній теці, але віддає статику ЧУЖОЇ збірки: ловить саме перевірка статики"
else fail "процес у правильній теці, але віддає статику ЧУЖОЇ збірки: ловить саме перевірка статики" "rc=$RC $OUT"; fi

new_world c5
STUB_BAD_RELEASE="$S1" STUB_API_HEALTH=503 X deploy --sha "$SHA1" --apply
if [ $RC -eq 3 ] && grep -q 'API /health → 503' <<<"$OUT" && ! grep -q 'працює з .*, а чекали' <<<"$OUT"; then
  pass "API піднялась із правильної теки, але /health 503: деплой не проходить, повернуто $S0"
else fail "API піднялась із правильної теки, але /health 503: деплой не проходить, повернуто $S0" "rc=$RC $OUT"; fi

new_world c6
STUB_BAD_RELEASE="$S1" STUB_API_HEALTH=503 STUB_RESTART=fail_after_1 X deploy --sha "$SHA1" --apply
if [ $RC -eq 4 ] && grep -q 'ПЕРЕВІРЕНИМ НЕ ВДАЛОСЬ' <<<"$OUT" && echo "$(hist)" | jq -e 'select(.action=="revert" and .ok==false)' >/dev/null; then
  pass "перемкнули на зламане, а повернути не вдалось: код 4, гучне «стан невідомий», revert ok=false в історії"
else fail "перемкнули на зламане, а повернути не вдалось: код 4, гучне «стан невідомий», revert ok=false в історії" "rc=$RC $OUT"; fi
new_world c6b
STUB_RESTART=fail X deploy --sha "$SHA1" --apply
if [ $RC -eq 3 ] && grep -q 'systemctl restart завершився з помилкою' <<<"$OUT"; then
  pass "restart падає, але нічого не рушило: скрипт не вмирає посеред перемикання, звіряє й чесно повертає (код 3)"
else fail "restart падає, але нічого не рушило: скрипт не вмирає посеред перемикання, звіряє й чесно повертає (код 3)" "rc=$RC $OUT"; fi

new_world c7
FAKE_BUILD_ID=abcde-fghij_klmno-pqr_s X deploy --sha "$SHA1" --apply
[ $RC -eq 0 ] && [ "$(web_serves abcde-fghij_klmno-pqr_s)" = 200 ] \
  && pass "BUILD_ID з дефісами й підкресленнями проходить перевірку статики (в URL іде як є)" || fail "BUILD_ID з дефісами й підкресленнями проходить перевірку статики (в URL іде як є)" "rc=$RC $OUT"

new_world c9
# systemd каже, що MainPID юніту — це pid самого тесту; а порт слухає зовсім інший процес.
STUB_BAD_RELEASE="$S1" STUB_MAINPID_OVERRIDE=$$ X deploy --sha "$SHA1" --apply
[ $RC -eq 3 ] && grep -q 'не належить юніту' <<<"$OUT" && ! grep -q 'працює з .*, а чекали' <<<"$OUT" \
  && pass "порт слухає процес, що не належить юніту: перевірка падає саме на цьому (cwd і BUILD_ID правильні)" || fail "порт слухає процес, що не належить юніту: перевірка падає саме на цьому (cwd і BUILD_ID правильні)" "rc=$RC $OUT"

new_world c10
FAKE_BUILD_ID='bad/id?x' X deploy --sha "$SHA1" --apply
[ $RC -eq 3 ] && grep -q 'немає придатного .next/BUILD_ID' <<<"$OUT" && [ "$(readlink "$W/root/current")" = "releases/$S0" ] \
  && pass "BUILD_ID, який не можна безпечно вставити в URL, не перевіряється наосліп: деплой не проходить, повернуто $S0" \
  || fail "BUILD_ID, який не можна безпечно вставити в URL, не перевіряється наосліп: деплой не проходить, повернуто $S0" "rc=$RC $OUT"

# 🔴 Збій рантайму Next, що не заважає віддавати файли з диска: `/health` і статика збірки 200, а КОЖНА
# HTML-сторінка 500. Перевірка, що брала лише статику, цього не бачила: деплой проходив, відкату не було.
new_world c11
STUB_BAD_RELEASE="$S1" STUB_WEB_HTML=500 X deploy --sha "$SHA1" --apply
if [ $RC -eq 3 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && grep -q 'веб не віддає HTML: / → 500' <<<"$OUT" \
   && ! grep -q 'веб не віддає статику збірки' <<<"$OUT" && ! grep -q 'працює з .*, а чекали' <<<"$OUT" && ! grep -q '✗ API /health' <<<"$OUT"; then
  pass "кожна HTML-сторінка 500, а /health і статика 200: деплой не проходить, повернуто $S0, код 3 (ловить саме перевірка HTML)"
else fail "кожна HTML-сторінка 500, а /health і статика 200: деплой не проходить, повернуто $S0, код 3 (ловить саме перевірка HTML)" "rc=$RC link=$(readlink "$W/root/current") $OUT"; fi

STUB_BAD_RELEASE="$S0" STUB_WEB_HTML=500 new_world c12
X status
if [ $RC -ne 0 ] && grep -q 'веб не віддає HTML: / → 500' <<<"$OUT" && grep -q 'РОЗБІЖНОСТЕЙ 1,' <<<"$OUT" && ! grep -q 'веб не віддає статику збірки' <<<"$OUT"; then
  pass "status на живому сайті, що віддає 500 на HTML при здоровій статиці: код ≠ 0, рівно одна розбіжність, названа"
else fail "status на живому сайті, що віддає 500 на HTML при здоровій статиці: код ≠ 0, рівно одна розбіжність, названа" "rc=$RC $OUT"; fi

new_world c8
STUB_WD_OVERRIDE=/srv/camptribe/current/apps/api X deploy --sha "$SHA1" --apply
[ $RC -eq 1 ] && grep -q 'WorkingDirectory' <<<"$OUT" && [ -z "$(mutating_calls | grep -v '^systemctl show')" ] \
  && pass "юніт дивиться не в той симлінк: відмова ДО будь-якої зміни" || fail "юніт дивиться не в той симлінк: відмова ДО будь-якої зміни" "rc=$RC $(mutating_calls)"

# ═══════════════════════════════════════════════════════════════════
section "D. Відкат"

new_world d1
X deploy --sha "$SHA1" --apply >/dev/null
X rollback --apply
echo "$(hist)" | jq -e 'select(.action=="rollback" and .ok==true and .from=="'"$S1"'" and .to=="'"$S0"'")' >/dev/null && pass "rollback записано в історію: ${S1}→${S0}, ok" || fail "rollback записано в історію: ${S1}→${S0}, ok" "$(hist)"
if [ $RC -eq 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && [ "$(running_from api)" = "$S0" ] && [ "$(running_from web)" = "$S0" ] \
   && [ "$(web_serves "$(file_id "$S0")")" = 200 ] && [ "$(web_serves "$(file_id "$S1")")" = 404 ] && grep -qE 'перемикання й перевірка: [0-9]+ с' <<<"$OUT"; then
  pass "rollback --apply: current, процеси за ОС і відданий BUILD_ID повернулись на $S0, час названо"
else fail "rollback --apply: current, процеси за ОС і відданий BUILD_ID повернулись на $S0, час названо" "rc=$RC api=$(running_from api) $OUT"; fi
X rollback --apply
[ $RC -eq 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S1" ] && [ "$(running_from web)" = "$S1" ] \
  && pass "другий rollback скасовує перший: знову $S1 (відкат = «скасувати останнє перемикання»)" || fail "другий rollback скасовує перший: знову $S1 (відкат = «скасувати останнє перемикання»)" "rc=$RC $OUT"

new_world d2
X rollback
[ $RC -eq 1 ] && grep -q 'історії перемикань немає' <<<"$OUT" && pass "історії немає: «попередній» не вгадується, просить --to" || fail "історії немає: «попередній» не вгадується, просить --to" "rc=$RC $OUT"
X rollback --to "$S1"
[ $RC -eq 1 ] && grep -q 'релізу .* немає в' <<<"$OUT" && pass "--to на реліз, якого немає чи який не збудований, відмовляє" || fail "--to на реліз, якого немає чи який не збудований, відмовляє" "rc=$RC $OUT"

new_world d3
X deploy --sha "$SHA1" --apply >/dev/null
ln -sfn "releases/$S0" "$W/root/current"
X rollback
[ $RC -eq 1 ] && grep -q 'повз скрипт' <<<"$OUT" && pass "хтось перемкнув повз скрипт: історія й current розходяться, «попередній» ненадійний — відмова" || fail "хтось перемкнув повз скрипт: історія й current розходяться, «попередній» ненадійний — відмова" "rc=$RC $OUT"
X status
[ $RC -ne 0 ] && grep -q 'історія каже, що чинний' <<<"$OUT" && pass "status у тій самій ситуації: розбіжність історії названо, код ≠ 0" || fail "status у тій самій ситуації: розбіжність історії названо, код ≠ 0" "rc=$RC"

new_world d2c
mkdir -p "$W/root/releases/$S1/apps/web"; echo half > "$W/root/releases/$S1/apps/web/leftover"
X rollback --to "$S1"
[ $RC -eq 1 ] && grep -q 'не збудований' <<<"$OUT" && pass "--to на теку без збірки (залишок): відмова «не збудований»" || fail "--to на теку без збірки (залишок): відмова «не збудований»" "rc=$RC $OUT"

new_world d8
X deploy --sha "$SHA1" --apply >/dev/null
printf 'Alpha1000000000000\n' > "$W/db/applied"   # БД «відновлено зі старої копії»: Beta немає
: > "$W/calls"
X rollback
[ $RC -eq 1 ] && grep -q 'очікує міграції, яких немає в БД' <<<"$OUT" && grep -q 'Beta1000000000001' <<<"$OUT" && [ -z "$(mutating_calls)" ] \
  && pass "відкат на код, якому бракує міграції в БД: відмова з іменем міграції" || fail "відкат на код, якому бракує міграції в БД: відмова з іменем міграції" "rc=$RC $OUT"

new_world d9
X deploy --sha "$SHA1" --apply >/dev/null
echo "EXTRA=1" >> "$W/root/releases/$S1/apps/api/.env"   # .env чинного релізу правили після деплою
X rollback
[ $RC -eq 0 ] && grep -q '.env релізу .* відрізняється від чинного' <<<"$OUT" && pass "відкат попереджає, що .env цілі інший за чинний: поверне старі значення" || fail "відкат попереджає, що .env цілі інший за чинний: поверне старі значення" "rc=$RC $OUT"

new_world d6
printf 'Alpha1000000000000\n' > "$W/db/applied"
X status
[ $RC -ne 0 ] && grep -q 'код очікує міграції, яких у БД немає: Beta1000000000001' <<<"$OUT" && pass "status: код знає міграцію, якої БД не має — розбіжність названа поіменно" || fail "status: код знає міграцію, якої БД не має — розбіжність названа поіменно" "rc=$RC $OUT"
new_world d7
STUB_PSQL=fail X status
[ $RC -ne 0 ] && grep -q 'невідомо' <<<"$OUT" && pass "status не може прочитати таблицю migrations: це «НЕ ПЕРЕВІРЕНО», а не «гаразд»" || fail "status не може прочитати таблицю migrations: це «НЕ ПЕРЕВІРЕНО», а не «гаразд»" "rc=$RC $OUT"

new_world d4
X deploy --sha "$SHA1" --apply >/dev/null
STUB_RESTART=noop X deploy --sha "$SHA2" --apply --migrate >/dev/null
X rollback
if [ $RC -eq 0 ] && grep -q "rollback $S1 → $S0" <<<"$OUT"; then
  pass "після невдалого деплою rollback веде до $S0, а не до релізу, що провалився"
else fail "після невдалого деплою rollback веде до $S0, а не до релізу, що провалився" "rc=$RC $OUT"; fi

new_world d5
X deploy --sha "$SHA2" --apply --migrate >/dev/null
X rollback
grep -q 'схема БД ПОПЕРЕДУ' <<<"$OUT" && grep -q 'Gamma1000000000002' <<<"$OUT" && pass "rollback на код без міграції, що вже застосована: попередження з іменем міграції" || fail "rollback на код без міграції, що вже застосована: попередження з іменем міграції" "$OUT"

# ═══════════════════════════════════════════════════════════════════
section "E. Міграції"

new_world e1
X deploy --sha "$SHA2" --apply
if [ $RC -eq 1 ] && grep -q 'Gamma1000000000002' <<<"$OUT" && grep -q -- '--migrate' <<<"$OUT" \
   && ! calls_have '^npm (ci|run)' && ! calls_have '^pg_dump' && [ ! -d "$W/root/releases/$S2" ]; then
  pass "потрібна міграція, --migrate немає: відмова ДО збірки, жодного npm, теку прибрано"
else fail "потрібна міграція, --migrate немає: відмова ДО збірки, жодного npm, теку прибрано" "rc=$RC $(mutating_calls) $OUT"; fi

new_world e2
X deploy --sha "$SHA2" --apply --migrate
A=$(line_no '^pg_dump'); B=$(line_no 'npm run migration:run'); C=$(line_no 'npm run build:web'); D=$(line_no '^systemctl restart')
if [ $RC -eq 0 ] && [ -n "$A" ] && [ -n "$B" ] && [ -n "$C" ] && [ -n "$D" ] && [ "$A" -lt "$B" ] && [ "$B" -lt "$C" ] && [ "$C" -lt "$D" ]; then
  pass "порядок викликів: знімок БД → міграція → збірка вебу → перезапуск"
else fail "порядок викликів: знімок БД → міграція → збірка вебу → перезапуск" "pg_dump=$A migrate=$B web=$C restart=$D rc=$RC $OUT"; fi
grep -qx 'Gamma1000000000002' "$W/db/applied" && pass "після деплою в БД є Gamma (міграцію застосовано)" || fail "після деплою в БД є Gamma (міграцію застосовано)"
[ "$(cat "$W/root/releases/$S2/apps/web/.next/built-against")" = v2 ] \
  && pass "веб зібрано ПРОТИ НОВОЇ API (вона відповіла v2), а не проти чинної (v0)" || fail "веб зібрано ПРОТИ НОВОЇ API (вона відповіла v2), а не проти чинної (v0)" "$(cat "$W/root/releases/$S2/apps/web/.next/built-against" 2>&1)"
! port_up "$TPORT" && pass "тимчасова API після збірки зупинена: її порт знову вільний" || fail "тимчасова API після збірки зупинена: її порт знову вільний"
ls "$W/root/backups/predeploy-$S0"-*.dump >/dev/null 2>&1 && pass "знімок БД лежить у backups/ і названий за релізом, з якого зроблено" || fail "знімок БД лежить у backups/ і названий за релізом, з якого зроблено"

new_world e3
STUB_MIGRATE_FAIL=1 X deploy --sha "$SHA2" --apply --migrate
if [ $RC -ne 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && ! calls_have 'build:web' && ! calls_have '^systemctl restart' \
   && ! calls_have 'migration:revert' && [ ! -d "$W/root/releases/$S2" ]; then
  pass "міграція впала: current не рушив, веб не збирався, нічого не перезапущено, revert не викликано, залишок прибрано"
else fail "міграція впала: current не рушив, веб не збирався, нічого не перезапущено, revert не викликано, залишок прибрано" "rc=$RC $(mutating_calls)"; fi

new_world e_camp340a
# 🔴 Замок CAMP-340 на шляху ВПЕРЕД: збірка пройшла, але адреси у статиці
# немає. Мусить відмовити ДО перемикання — відмова після нього читалась би
# як «стан машини невідомий», і саме так перша редакція цього сторожа
# ламала відкат. Без цього випадку замок не проганяє ніхто: мутація
# «прибрати його» давала 131/131.
STUB_WEB_NO_PUBLIC=1 X deploy --sha "$SHA2" --apply --migrate
if [ $RC -ne 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && ! calls_have '^systemctl restart' \
   && grep -q 'NEXT_PUBLIC_API_BASE_URL' <<<"$OUT"; then
  pass "статика зібралась без адреси API: відмова ДО перемикання, current не рушив, нічого не перезапущено, змінну названо"
else fail "статика зібралась без адреси API: відмова ДО перемикання, current не рушив, нічого не перезапущено, змінну названо" "rc=$RC current=$(readlink "$W/root/current") $(mutating_calls)"; fi

new_world e_camp340b
# Той самий замок, інша причина: ключа немає в .env узагалі. Коди 4 і 5
# мусять вести до різних слів, інакше «не налаштовано» читалося б як
# «збірка зламалась».
sed -i.bak '/^NEXT_PUBLIC_/d' "$W/root/releases/$S0/apps/api/.env"
X deploy --sha "$SHA2" --apply --migrate
if [ $RC -ne 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] \
   && grep -q 'немає NEXT_PUBLIC_API_BASE_URL' <<<"$OUT"; then
  pass "у .env немає NEXT_PUBLIC_API_BASE_URL: деплой відмовляє до перемикання і каже саме це, а не «збірка зламалась»"
else fail "у .env немає NEXT_PUBLIC_API_BASE_URL: деплой відмовляє до перемикання і каже саме це, а не «збірка зламалась»" "rc=$RC current=$(readlink "$W/root/current") $OUT"; fi

new_world e4
STUB_RESTART=noop X deploy --sha "$SHA2" --apply --migrate
if [ $RC -eq 3 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && grep -qx 'Gamma1000000000002' "$W/db/applied" && ! calls_have 'migration:revert'; then
  pass "міграція пройшла, перемикання впало: код повернуто на $S0, БД лишилась мігрованою, revert міграції НЕ викликано"
else fail "міграція пройшла, перемикання впало: код повернуто на $S0, БД лишилась мігрованою, revert міграції НЕ викликано" "rc=$RC $OUT"; fi

new_world e5
STUB_PGDUMP=fail X deploy --sha "$SHA2" --apply --migrate
[ $RC -ne 0 ] && ! calls_have 'migration:run' && pass "pg_dump не вдався: міграцію не запущено" || fail "pg_dump не вдався: міграцію не запущено" "rc=$RC $OUT"
new_world e6
STUB_PGDUMP=empty X deploy --sha "$SHA2" --apply --migrate
[ $RC -ne 0 ] && ! calls_have 'migration:run' && grep -q 'не читається' <<<"$OUT" && pass "порожній знімок не читається (pg_restore -l): міграцію не запущено" || fail "порожній знімок не читається (pg_restore -l): міграцію не запущено" "rc=$RC $OUT"

new_world e7
X deploy --sha "$SHA2" --migrations "1000000000000-Alpha,1000000000001-Beta" --apply --migrate
[ $RC -ne 0 ] && grep -q 'не збігається' <<<"$OUT" && ! calls_have '^npm (ci|run)' && pass "список міграцій з ноутбука ≠ списку в коміті: відмова до збірки" || fail "список міграцій з ноутбука ≠ списку в коміті: відмова до збірки" "rc=$RC $OUT"
new_world e11
X deploy --sha "$SHA2"
[ $RC -eq 0 ] && grep -q 'у сухому прогоні невідомо' <<<"$OUT" && ! grep -q 'нових немає' <<<"$OUT" && pass "сухий прогін без списку міграцій: чесне «невідомо», а не «нових немає»" || fail "сухий прогін без списку міграцій: чесне «невідомо», а не «нових немає»" "rc=$RC $OUT"

new_world e8
X deploy --sha "$SHA2" --migrations "1000000000000-Alpha,1000000000001-Beta,1000000000002-Gamma"
[ $RC -eq 0 ] && grep -q 'ЧЕКАЮТЬ 1' <<<"$OUT" && grep -q 'Gamma1000000000002' <<<"$OUT" && grep -q 'add --apply --migrate\|додай --apply --migrate' <<<"$OUT" \
  && pass "сухий прогін із переданим списком: називає міграцію і підказує --apply --migrate" || fail "сухий прогін із переданим списком: називає міграцію і підказує --apply --migrate" "rc=$RC $OUT"

new_world e9
STUB_PGDUMP=partial X deploy --sha "$SHA2" --apply --migrate
[ $RC -ne 0 ] && ! calls_have 'migration:run' && grep -q 'pg_dump не вдався' <<<"$OUT" && pass "pg_dump впав посередині, лишивши ЧИТАБЕЛЬНИЙ файл: міграцію не запущено (ловить код виходу, не pg_restore -l)" || fail "pg_dump впав посередині, лишивши ЧИТАБЕЛЬНИЙ файл: міграцію не запущено (ловить код виходу, не pg_restore -l)" "rc=$RC $OUT"

new_world e10
mkdir -p "$W/root/backups"
for i in 1 2 3 4; do : > "$W/root/backups/predeploy-old$i-2026010${i}T000000Z.dump"; touch -t "20260101000$i" "$W/root/backups/predeploy-old$i-2026010${i}T000000Z.dump"; done
X deploy --sha "$SHA2" --apply --migrate
N=$(ls "$W/root/backups"/predeploy-*.dump | wc -l | tr -d ' ')
[ $RC -eq 0 ] && [ "$N" = 3 ] && ls "$W/root/backups/predeploy-$S0"-*.dump >/dev/null 2>&1 && [ ! -e "$W/root/backups/predeploy-old1-20260101T000000Z.dump" ] \
  && pass "знімків лишається три: найстарші прибрано, свіжий на місці" || fail "знімків лишається три: найстарші прибрано, свіжий на місці" "rc=$RC n=$N $(ls "$W/root/backups")"

new_world e12
node -e 'require("http").createServer().listen(+process.argv[1], "127.0.0.1")' "$TPORT" & BUSY=$!
for _ in $(seq 1 30); do port_up "$TPORT" && break; sleep 0.1; done
X deploy --sha "$SHA1" --apply
kill $BUSY 2>/dev/null; wait $BUSY 2>/dev/null
[ $RC -eq 1 ] && grep -q 'зайнятий' <<<"$OUT" && ! calls_have 'npm run build:web' && [ ! -d "$W/root/releases/$S1" ] \
  && pass "порт тимчасової API зайнятий чужим: веб не збирається, реліз-залишок прибрано, код 1" || fail "порт тимчасової API зайнятий чужим: веб не збирається, реліз-залишок прибрано, код 1" "rc=$RC $OUT"

# ═══════════════════════════════════════════════════════════════════
section "H. Шляхи, яких бойовий деплой торкається не щодня"

new_world h1
X deploy --sha "$SHA1" --apply >/dev/null; X rollback --apply >/dev/null; : > "$W/calls"
X deploy --sha "$SHA1" --apply
if [ $RC -eq 0 ] && grep -q 'збирати не треба' <<<"$OUT" && ! calls_have '^npm (ci|run)' && [ "$(running_from web)" = "$S1" ]; then
  pass "реліз уже збудований: деплой лише перемикає (жодного npm), процеси на $S1"
else fail "реліз уже збудований: деплой лише перемикає (жодного npm), процеси на $S1" "rc=$RC $(mutating_calls) $OUT"; fi

new_world h_camp340
# 🔴 Сценарій рецензента: гілка `reuse=yes` не кличе build_web, отже
# обходить замок у ньому. Без другого замка `deploy` на вже зібраний
# реліз перемикав current на збірку без адреси API й виходив НУЛЕМ.
X deploy --sha "$SHA1" --apply >/dev/null; X rollback --apply >/dev/null; : > "$W/calls"
# реліз лишається «зібраним», але його статика більше не несе адреси —
# рівно так виглядає все, що зібрано до CAMP-340
printf 'var API="";\n' > "$W/root/releases/$S1/apps/web/.next/static/chunks/main.js"
X deploy --sha "$SHA1" --apply
if [ $RC -ne 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && ! calls_have '^systemctl restart' \
   && grep -q 'NEXT_PUBLIC_API_BASE_URL' <<<"$OUT"; then
  pass "деплой на ВЖЕ ЗІБРАНИЙ реліз без адреси API: відмова до перемикання, current не рушив, змінну названо"
else fail "деплой на ВЖЕ ЗІБРАНИЙ реліз без адреси API: відмова до перемикання, current не рушив, змінну названо" "rc=$RC current=$(readlink "$W/root/current") $(mutating_calls) $OUT"; fi

new_world h2
mkdir -p "$W/root/releases/$S1"; git -C "$W/root/releases/$S1" init -q; git -C "$W/root/releases/$S1" remote add origin "$REPO"; echo junk > "$W/root/releases/$S1/junk"
X deploy --sha "$SHA1" --apply
[ $RC -eq 0 ] && [ ! -e "$W/root/releases/$S1/junk" ] && [ "$(running_from web)" = "$S1" ] && pass "залишок невдалої збірки в теці цілі: прибрано, зібрано наново, викочено" || fail "залишок невдалої збірки в теці цілі: прибрано, зібрано наново, викочено" "rc=$RC $OUT"

new_world h3
# тека з ім'ям цілі, але в ній інший коміт
d="$W/root/releases/$S1"; mkdir -p "$d"; git -C "$d" init -q; git -C "$d" remote add origin "$REPO"; git -C "$d" fetch -q --depth 1 origin "$SHA2"; git -C "$d" checkout -q --detach FETCH_HEAD
X deploy --sha "$SHA1" --apply
[ $RC -eq 1 ] && grep -q 'колізія' <<<"$OUT" && [ -d "$d/.git" ] && ! calls_have '^npm (ci|run)' && pass "тека з ім'ям $S1, у якій інший коміт: відмова, чужу теку не видалено" || fail "тека з ім'ям $S1, у якій інший коміт: відмова, чужу теку не видалено" "rc=$RC $OUT"

new_world h4
T_MIN_FREE=999999 X deploy --sha "$SHA1" --apply
[ $RC -eq 1 ] && grep -q 'збірка може не вміститись' <<<"$OUT" && [ -z "$(mutating_calls)" ] && pass "місця на диску менше за поріг: відмова до будь-якої зміни" || fail "місця на диску менше за поріг: відмова до будь-якої зміни" "rc=$RC $OUT"

new_world h5
X deploy --sha "$SHA1" --apply >/dev/null; X deploy --sha "$SHA2" --apply --migrate >/dev/null; X deploy --sha "$SHA3" --apply >/dev/null
if [ $RC -eq 0 ] && [ ! -d "$W/root/releases/$S0" ] && [ -d "$W/root/releases/$S1" ] && [ -d "$W/root/releases/$S2" ] && [ -d "$W/root/releases/$S3" ]; then
  pass "після успіху прибрано найстарший ($S0); чинний $S3, ціль відкату $S2 і ще один ($S1) на місці"
else fail "після успіху прибрано найстарший ($S0); чинний $S3, ціль відкату $S2 і ще один ($S1) на місці" "rc=$RC $(ls "$W/root/releases" | tr '\n' ' ')"; fi
[ ! -d "$W/root/.deploy.lock" ] && pass "після деплою замок знято" || fail "після деплою замок знято"

new_world h6
mkdir "$W/root/.deploy.lock"; echo 99999999 > "$W/root/.deploy.lock/pid"
X deploy --sha "$SHA1" --apply
[ $RC -eq 0 ] && grep -q 'лишив замок і зник' <<<"$OUT" && pass "замок мертвого процесу не блокує назавжди: взято й деплой пройшов" || fail "замок мертвого процесу не блокує назавжди: взято й деплой пройшов" "rc=$RC $OUT"

# ═══════════════════════════════════════════════════════════════════
section "I. Репетиція відкату: rehearse --apply"

# Світ із двома збудованими релізами з різним BUILD_ID: «старий» S0 (без маніфесту) і «новий» S1 (з маніфестом).
rehearsal_world() { new_world "$1"; X deploy --sha "$SHA1" --apply >/dev/null; : > "$W/calls"; }
prod_pids() { cat "$W/units/camptribe-api.pid" "$W/units/camptribe-web.pid" 2>/dev/null | tr '\n' ' '; }
sha_of() { node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
leftovers() { # що репетиція мусить прибрати; порожньо = усе прибрано
  local r=""
  [ ! -e "$W/rehearsal" ] || r="$r root"
  ls "$W/unitdir"/camptribe-rehearsal-*.service >/dev/null 2>&1 && r="$r units"
  if port_up "$RWP" || port_up "$RAP"; then r="$r ports"; fi
  echo "$r"
}

rehearsal_world i1
BEFORE=$(prod_pids); ENV0=$(sha_of "$W/root/releases/$S0/apps/api/.env"); WP=$(cd -P "$W" && pwd -P)
X rehearse --apply
HARD=ok
if stat -c %h /dev/null >/dev/null 2>&1; then [ "$(stat -c %h "$W/root/releases/$S0/apps/web/.next/BUILD_ID")" = 1 ] || HARD=left; fi
if [ $RC -eq 0 ] && grep -q "старт на $S0" <<<"$OUT" && grep -q "switch $S1 --apply" <<<"$OUT" \
   && grep -q "pid [0-9]* працює з $WP/rehearsal/releases/$S0/apps/web" <<<"$OUT" && grep -q "pid [0-9]* працює з $WP/rehearsal/releases/$S1/apps/web" <<<"$OUT" \
   && grep -q 'відкат відрепетирувано' <<<"$OUT" && [ "$(prod_pids)" = "$BEFORE" ] && [ "$(running_from web)" = "$S1" ] && [ "$(running_from api)" = "$S1" ] \
   && [ "$(sha_of "$W/root/releases/$S0/apps/api/.env")" = "$ENV0" ] && [ -z "$(leftovers)" ] && [ "$HARD" = ok ]; then
  pass "rehearse --apply: старт на старому, switch на новий, rollback; бойові процеси й .env не рушили; нічого не лишилось"
else fail "rehearse --apply: старт на старому, switch на новий, rollback; бойові процеси й .env не рушили; нічого не лишилось" "rc=$RC left='$(leftovers)' hard=$HARD $OUT"; fi

rehearsal_world i2
BEFORE=$(prod_pids)
STUB_BAD_RELEASE="$S1" STUB_API_HEALTH=503 X rehearse --apply
[ $RC -ne 0 ] && grep -q 'switch у репетиції не вдався' <<<"$OUT" && [ "$(prod_pids)" = "$BEFORE" ] && [ -z "$(leftovers)" ] \
  && pass "репетиція, де нове перемикання ламається: падає, але світ усе одно прибрано, а бойове ціле" || fail "репетиція, де нове перемикання ламається: падає, але світ усе одно прибрано, а бойове ціле" "rc=$RC left='$(leftovers)' $OUT"

rehearsal_world i3
STUB_TOUCH_PROD=1 X rehearse --apply
[ $RC -ne 0 ] && grep -q 'БОЙОВЕ РУШИЛО' <<<"$OUT" && [ -z "$(leftovers)" ] \
  && pass "якщо запуск юнітів репетиції зачепив бойові юніти, репетиція це виявляє й падає" || fail "якщо запуск юнітів репетиції зачепив бойові юніти, репетиція це виявляє й падає" "rc=$RC $OUT"

rehearsal_world i4
X rehearse --apply --keep
if [ $RC -eq 0 ] && [ -d "$W/rehearsal" ] && [ -f "$W/unitdir/camptribe-rehearsal-api.service" ] && port_up "$RWP" && grep -q -- '--keep: світ' <<<"$OUT"; then
  pass "rehearse --keep лишає світ: корінь, юніти й працюючий веб репетиції"
else fail "rehearse --keep лишає світ: корінь, юніти й працюючий веб репетиції" "rc=$RC $OUT"; fi
X rehearse --apply
[ $RC -eq 1 ] && grep -q 'уже існує' <<<"$OUT" && [ -d "$W/rehearsal" ] \
  && pass "rehearse --apply поверх залишку відмовляє й залишок не чіпає" || fail "rehearse --apply поверх залишку відмовляє й залишок не чіпає" "rc=$RC $OUT"
X rehearse --teardown --apply
[ $RC -eq 0 ] && [ -z "$(leftovers)" ] && pass "rehearse --teardown --apply прибирає залишок: корінь, юніти, порти" || fail "rehearse --teardown --apply прибирає залишок: корінь, юніти, порти" "rc=$RC left='$(leftovers)' $OUT"
# 🔴 Самостійний teardown кличеться без імен релізів, тож доказ «репетиційних посилань не лишилось» крутився
# нуль разів і мовчки рапортував успіх. Тепер імена беруться з теки, яку він прибирає, і кожен названо.
if [ $RC -eq 0 ] && grep -q "бойовий реліз $S0: лічильник посилань BUILD_ID = 1" <<<"$OUT" && grep -q "бойовий реліз $S1: лічильник посилань BUILD_ID = 1" <<<"$OUT"; then
  pass "самостійний teardown (після --keep) доводить, що лічильник посилань BUILD_ID = 1 в обох бойових релізів, а не мовчить"
else fail "самостійний teardown (після --keep) доводить, що лічильник посилань BUILD_ID = 1 в обох бойових релізів, а не мовчить" "rc=$RC $OUT"; fi

rehearsal_world i9
X rehearse --apply --keep >/dev/null
ln "$W/root/releases/$S1/apps/web/.next/BUILD_ID" "$W/stray-link"   # чуже жорстке посилання на бойовий файл
X rehearse --teardown --apply
[ $RC -ne 0 ] && grep -q "бойовий реліз $S1: лічильник посилань BUILD_ID = 2" <<<"$OUT" && grep -q 'лишились чужі посилання' <<<"$OUT" && [ -z "$(leftovers)" ] \
  && pass "чуже жорстке посилання на бойовий файл: самостійний teardown не рапортує успіх (код ≠ 0, лічильник 2 названо)" || fail "чуже жорстке посилання на бойовий файл: самостійний teardown не рапортує успіх (код ≠ 0, лічильник 2 названо)" "rc=$RC left='$(leftovers)' $OUT"

rehearsal_world i10
X rehearse --apply --keep >/dev/null
STUB_STAT_FAIL=1 X rehearse --teardown --apply
[ $RC -ne 0 ] && grep -q "бойовий реліз .*: лічильник посилань BUILD_ID не прочитався" <<<"$OUT" && ! grep -q 'лічильник посилань BUILD_ID = 1' <<<"$OUT" && [ -z "$(leftovers)" ] \
  && pass "лічильник посилань не прочитався (stat мовчить): teardown не рапортує «= 1» і не успіх, а називає, що не знає" || fail "лічильник посилань не прочитався (stat мовчить): teardown не рапортує «= 1» і не успіх, а називає, що не знає" "rc=$RC left='$(leftovers)' $OUT"

rehearsal_world i5
node -e 'require("http").createServer().listen(+process.argv[1], "127.0.0.1")' "$RWP" & BUSY=$!
for _ in $(seq 1 30); do port_up "$RWP" && break; sleep 0.1; done
X rehearse --apply
kill $BUSY 2>/dev/null; wait $BUSY 2>/dev/null
[ $RC -eq 1 ] && grep -q 'зайнятий' <<<"$OUT" && [ ! -e "$W/rehearsal" ] && pass "порт репетиції зайнятий: відмова до створення будь-чого" || fail "порт репетиції зайнятий: відмова до створення будь-чого" "rc=$RC $OUT"

rehearsal_world i6
STUB_PROTECT_OVERRIDE=no X rehearse --apply
[ $RC -ne 0 ] && grep -q 'без ProtectSystem=strict' <<<"$OUT" && ! calls_have '^systemctl start' && [ -z "$(leftovers)" ] \
  && pass "юніт репетиції без ProtectSystem=strict (за станом, який віддає systemd): не стартує, світ прибрано" || fail "юніт репетиції без ProtectSystem=strict (за станом, який віддає systemd): не стартує, світ прибрано" "rc=$RC $OUT"
rehearsal_world i7
STUB_RWP_OVERRIDE=/srv X rehearse --apply
[ $RC -ne 0 ] && grep -q 'має ReadWritePaths' <<<"$OUT" && ! calls_have '^systemctl start' && [ -z "$(leftovers)" ] \
  && pass "systemd каже, що в юніта репетиції є ReadWritePaths (напр. drop-in): не стартує, світ прибрано" || fail "systemd каже, що в юніта репетиції є ReadWritePaths (напр. drop-in): не стартує, світ прибрано" "rc=$RC $OUT"
rehearsal_world i8
STUB_PROBE_WRITABLE=1 X rehearse --apply
[ $RC -ne 0 ] && grep -q 'проба запису' <<<"$OUT" && ! calls_have '^systemctl start' && [ -z "$(leftovers)" ] \
  && pass "проба запису в пісочниці вдалась (мало бути READONLY): не стартує, пробу прибрано, світ прибрано" || fail "проба запису в пісочниці вдалась (мало бути READONLY): не стартує, пробу прибрано, світ прибрано" "rc=$RC $OUT"

# ═══════════════════════════════════════════════════════════════════
section "J. Облікові дані не потрапляють у командний рядок"

# 🔴 `ps` на сервері бачить кожен: /proc там змонтовано без hidepid. Тож пароль БД і токен збірки не смій-
# ть стояти в argv жодного процесу: ні самого інструмента (`psql "$url"`, `pg_dump "$url"`), ні його
# предка (`sudo -u … env DATABASE_URL=… npm`: sudo живе всю збірку, ~400 с, з повним argv).
# Світ тут — «root»: `id -u` дає 0, `sudo` — підмінник, що лишається батьком і тримає argv видимим.
# Підмінники інструментів у свою мить читають `ps` по ВСІЙ машині й пишуть, скільки процесів мають секрет.
J_PW='p@ss:w/rd%x y_PWMARK9'
J_URL='postgres://camp:p%40ss%3Aw%2Frd%25x%20y_PWMARK9@db.example.test:6543/campdb?sslmode=require'
J_TOK='TOKMARK9-selftest'
# 🔴 CAMP-340. Прикметна адреса, якої немає ніде більше: якщо вона
# опиниться в оточенні збірки, це означає, що build_web() справді провів
# NEXT_PUBLIC_* з .env, а не що хтось десь написав правильний рядок.
J_PUB='https://pubmark9.example.test/api'
# 🔴 ДРУГИЙ КЛЮЧ ОБОВʼЯЗКОВИЙ. З одним NEXT_PUBLIC_* у .env мутація
# «повернути зашитий перелік на одну змінну» виживає й дає 131/131 —
# рецензія це виміряла. Перелік, зашитий на N ключів, падає лише там,
# де ключів більше за N і перевіряють КОЖЕН.
J_PUB2='pubmark9-mode'
jworld() { # імʼя [url]
  new_world "$1"
  printf 'DATABASE_URL=%s\nAPI_BUILD_TOKEN=%s\nPORT=3001\nNEXT_PUBLIC_API_BASE_URL=%s\nNEXT_PUBLIC_SITE_MODE=%s\n' "${2:-$J_URL}" "$J_TOK" "$J_PUB" "$J_PUB2" > "$W/root/releases/$S0/apps/api/.env"
  # .env цього світу інший, ніж у make_legacy_release, — «статику» релізу
  # переписуємо з НЬОГО, інакше реліз виглядав би зібраним проти чужої адреси.
  printf 'var API="%s";\n' "$J_PUB" > "$W/root/releases/$S0/apps/web/.next/static/chunks/main.js"
  mkdir -p "$W/tmp"; : > "$W/leak.log"; : > "$W/calls"
}
jrun() { # X від імені «root»
  id() { case "$*" in -u) echo 0 ;; selftest-nobody) return 0 ;; *) command id "$@" ;; esac; }
  export -f id
  TMPDIR="$W/tmp" STUB_SECRET_MARKS="PWMARK9 TOKMARK9" X "$@"
  unset -f id
}
# Знімок був І в ньому жоден процес не мав секрету. «Знімка не було» не є «витоку немає».
leak_clean() {
  grep -qE "^$1 procs=[1-9][0-9]* leaks=0\$" "$W/leak.log" && ! grep -qE "^$1 procs=[0-9]+ leaks=[1-9]" "$W/leak.log"
}
WANT_PSQL="host=db.example.test port=6543 user=camp db=campdb ssl=require pw=$J_PW opts=-c default_transaction_read_only=on"
WANT_DUMP="host=db.example.test port=6543 user=camp db=campdb ssl=require pw=$J_PW opts=<unset>"
benv() { sed -n "s/^$1=//p" "$W/buildenv"; }

jworld j1
jrun deploy --sha "$SHA2" --apply --migrate
if [ $RC -eq 0 ] && leak_clean psql && leak_clean pg_dump && leak_clean build:web; then
  pass "deploy --apply --migrate: у знімку процесів КОЖНОЇ машини в мить psql, pg_dump і збірки вебу пароля БД і токена немає в жодному argv"
else fail "deploy --apply --migrate: у знімку процесів КОЖНОЇ машини в мить psql, pg_dump і збірки вебу пароля БД і токена немає в жодному argv" "rc=$RC leak.log: $(cat "$W/leak.log")"; fi
if [ -s "$W/pgenv.psql" ] && [ -z "$(grep -vxF "$WANT_PSQL" "$W/pgenv.psql")" ] && [ -s "$W/pgenv.pg_dump" ] && [ -z "$(grep -vxF "$WANT_DUMP" "$W/pgenv.pg_dump")" ]; then
  pass "psql і pg_dump отримали з'єднання через ОТОЧЕННЯ, розкодоване точно (пароль зі @ : / % і пробілом, порт, база, sslmode), а не в argv"
else fail "psql і pg_dump отримали з'єднання через ОТОЧЕННЯ, розкодоване точно (пароль зі @ : / % і пробілом, порт, база, sslmode), а не в argv" "psql: $(sort -u "$W/pgenv.psql" 2>&1) pg_dump: $(sort -u "$W/pgenv.pg_dump" 2>&1)"; fi
if [ "$(benv DATABASE_URL)" = "$J_URL" ] && [ "$(benv API_BUILD_TOKEN)" = "$J_TOK" ] && [ "$(benv API_BASE_URL)" = "http://localhost:$TPORT" ] && [ "$(benv NODE_OPTIONS)" = "--max-old-space-size=5120" ]; then
  pass "збірка вебу отримала DATABASE_URL, API_BUILD_TOKEN, API_BASE_URL і NODE_OPTIONS через оточення, байт у байт"
else fail "збірка вебу отримала DATABASE_URL, API_BUILD_TOKEN, API_BASE_URL і NODE_OPTIONS через оточення, байт у байт" "$(sed 's/PWMARK9.*@/<…>@/' "$W/buildenv" 2>&1)"; fi
# 🔴 CAMP-340. ЦЕ ТОЙ САМИЙ ДЕФЕКТ, ЧЕРЕЗ ЯКИЙ АКАУНТИ НЕ ПРАЦЮВАЛИ. Перелік
# змінних збірки був зашитий і NEXT_PUBLIC_* у нього не входили; значення з
# .env просто не доїжджало, а веб брав запасне '' і мовчав. Питаємо прикметну
# адресу, якої немає ніде, крім .env цього світу, і додатково — що вона дійшла
# аж до «статики», бо саме там її читає браузер.
if [ "$(benv NEXT_PUBLIC_API_BASE_URL)" = "$J_PUB" ] && [ "$(benv NEXT_PUBLIC_SITE_MODE)" = "$J_PUB2" ] \
   && grep -qF "$J_PUB" "$W/root/releases/$S2/apps/web/.next/static/chunks/main.js" 2>/dev/null; then
  pass "ОБИДВІ NEXT_PUBLIC_* з .env доїхали до збірки вебу, і адреса запеклась у статику (перелік не зашитий)"
else fail "ОБИДВІ NEXT_PUBLIC_* з .env доїхали до збірки вебу, і адреса запеклась у статику (перелік не зашитий)" "api=$(benv NEXT_PUBLIC_API_BASE_URL) mode=$(benv NEXT_PUBLIC_SITE_MODE) static=$(cat "$W/root/releases/$S2/apps/web/.next/static/chunks/main.js" 2>&1)"; fi
[ "$(benv ENVFILES)" = 0 ] && pass "файл оточення з секретами зник ДО початку збірки вебу, а не після (за ~400 с збірки він лежав би на диску)" || fail "файл оточення з секретами зник ДО початку збірки вебу, а не після (за ~400 с збірки він лежав би на диску)" "envfiles=$(benv ENVFILES)"

jworld j4b
STUB_SUDO_FAIL=pg_dump jrun deploy --sha "$SHA2" --apply --migrate
if [ $RC -ne 0 ] && grep -q 'pg_dump не вдався' <<<"$OUT" && ! calls_have 'migration:run' && ! ls "$W/tmp"/camptribe-envfile.* >/dev/null 2>&1; then
  pass "sudo не запустив pg_dump (дитина не встигла прочитати файл): файл оточення з секретами все одно прибрано, міграцію не запущено"
else fail "sudo не запустив pg_dump (дитина не встигла прочитати файл): файл оточення з секретами все одно прибрано, міграцію не запущено" "rc=$RC left=$(ls "$W/tmp" 2>&1 | tr '\n' ' ') $OUT"; fi

jworld j5
jrun status
if [ $RC -eq 0 ] && leak_clean psql && [ -s "$W/pgenv.psql" ] && [ -z "$(grep -vxF "$WANT_PSQL" "$W/pgenv.psql")" ] && ! calls_have '^pg_dump'; then
  pass "status (читає БД через psql): пароля в argv немає, з'єднання прийшло оточенням, pg_dump не викликано"
else fail "status (читає БД через psql): пароля в argv немає, з'єднання прийшло оточенням, pg_dump не викликано" "rc=$RC leak.log: $(cat "$W/leak.log") $(sort -u "$W/pgenv.psql" 2>&1)"; fi

# 🔴 Те, чого не вмію передати через оточення, не вгадую і не пропускаю мовчки: відмова, що називає
# ПАРАМЕТР (не значення) і не друкує пароль.
J_BAD='postgres://camp:PWMARK9x@db.example.test/campdb?foo=bar'
jworld j6a "$J_BAD"
jrun status
if [ $RC -ne 0 ] && grep -q "'foo'" <<<"$OUT" && grep -q 'НЕ ПЕРЕВІРЕНО 1' <<<"$OUT" && ! grep -q 'PWMARK9' <<<"$OUT" && ! calls_have '^psql'; then
  pass "DATABASE_URL з параметром, якого не вмію передати оточенням: status не вгадує й не пропускає (НЕ ПЕРЕВІРЕНО), називає параметр, пароля не друкує"
else fail "DATABASE_URL з параметром, якого не вмію передати оточенням: status не вгадує й не пропускає (НЕ ПЕРЕВІРЕНО), називає параметр, пароля не друкує" "rc=$RC $(echo "$OUT" | sed 's/PWMARK9[^ ]*/<ПАРОЛЬ!>/g')"; fi
jworld j6b "$J_BAD"
jrun deploy --sha "$SHA2" --apply --migrate
if [ $RC -ne 0 ] && ! grep -q 'PWMARK9' <<<"$OUT" && ! calls_have '^(npm (ci|run)|pg_dump|systemctl restart)' && [ "$(readlink "$W/root/current")" = "releases/$S0" ]; then
  pass "той самий URL при deploy --apply --migrate: відмова ДО збірки, знімка й міграції, current не рушив, пароля у виводі немає"
else fail "той самий URL при deploy --apply --migrate: відмова ДО збірки, знімка й міграції, current не рушив, пароля у виводі немає" "rc=$RC $(echo "$OUT" | sed 's/PWMARK9[^ ]*/<ПАРОЛЬ!>/g')"; fi

# snapshot_db сам не розбирає чужого: у потоці `deploy` його ловить раніше applied_migrations, тож гілку
# «URL не розібрано» перевіряємо прямо, викликом функції.
jworld j7 "$J_BAD"
J7=$( source "$DEPLOY"; ROOT="$W/root"; TMPDIR="$W/tmp"; ( snapshot_db "$S0" ) 2>&1 && echo "rc=0" || echo "rc=$?" )
if grep -qx 'rc=1' <<<"$J7" && grep -q 'знімка БД не роблю' <<<"$J7" && ! grep -q 'PWMARK9' <<<"$J7" && ! calls_have '^pg_dump' && [ ! -d "$W/root/backups" ]; then
  pass "snapshot_db з URL, якого не вдалось розібрати: відмова ДО створення теки знімків і до pg_dump, пароля у виводі немає"
else fail "snapshot_db з URL, якого не вдалось розібрати: відмова ДО створення теки знімків і до pg_dump, пароля у виводі немає" "$(echo "$J7" | sed 's/PWMARK9[^ ]*/<ПАРОЛЬ!>/g')"; fi

# ═══════════════════════════════════════════════════════════════════
section "F. Запобіжники"

new_world f1
# shellcheck disable=SC1090
( source "$DEPLOY"; ROOT="$BASE/f1root"; LINK=current
  mkdir -p "$ROOT/releases/aaaaaaa" "$ROOT/releases/bbbbbbb" "$ROOT/releases/ccccccc"
  ln -sfn releases/aaaaaaa "$ROOT/current"
  r1=0; safe_rm_release aaaaaaa bbbbbbb >/dev/null 2>&1 && r1=1
  r2=0; safe_rm_release bbbbbbb bbbbbbb >/dev/null 2>&1 && r2=1
  r3=0; safe_rm_release ../x "" >/dev/null 2>&1 && r3=1
  r4=0; safe_rm_release 'a b' "" >/dev/null 2>&1 && r4=1
  r5=0; safe_rm_release ccccccc bbbbbbb >/dev/null 2>&1 && r5=1
  echo "$r1$r2$r3$r4$r5 $(ls "$ROOT/releases" | tr '\n' ',')" ) > "$BASE/f1.out"
[ "$(cat "$BASE/f1.out")" = "00001 aaaaaaa,bbbbbbb," ] && pass "safe_rm_release: не чіпає чинний, ціль відкату, шлях не-SHA; видаляє лише зайвий" || fail "safe_rm_release: не чіпає чинний, ціль відкату, шлях не-SHA; видаляє лише зайвий" "$(cat "$BASE/f1.out")"

new_world f2
# п'ять релізів із різним часом коміту; current=c4, ціль відкату=c3, KEEP_EXTRA=1
for pair in "$S0:$SHA0" "$S1:$SHA1" "$S2:$SHA2" "$S3:$SHA3" "$S4:$SHA4"; do
  s="${pair%%:*}"; [ -d "$W/root/releases/$s" ] || { d="$W/root/releases/$s"; mkdir -p "$d"; git -C "$d" init -q; git -C "$d" remote add origin "$REPO"; git -C "$d" fetch -q --depth 1 origin "${pair#*:}"; git -C "$d" checkout -q --detach FETCH_HEAD; }
done
# shellcheck disable=SC1090,SC2034
GOT=$( source "$DEPLOY"; ROOT="$W/root"; KEEP_EXTRA=1; prune_candidates "$S4" "$S3" | tr '\n' ' ' )
[ "$GOT" = "$S1 $S0 " ] && pass "prune: лишає чинний, ціль відкату й 1 найновіший із решти; решту (від найстаршого) називає до видалення" || fail "prune: лишає чинний, ціль відкату й 1 найновіший із решти; решту (від найстаршого) називає до видалення" "got='$GOT' want='$S1 $S0 '"

new_world f3
# shellcheck disable=SC1090,SC2034
GOT=$( source "$DEPLOY"; ROOT=/srv/camptribe
  mkdir -p "$BASE/rh1" "$BASE/rh2"; : > "$BASE/rh1/.camptribe-rehearsal-root"
  a=0; safe_rm_rehearsal "$BASE/rh2" >/dev/null 2>&1 && a=1
  b=0; safe_rm_rehearsal /srv/camptribe >/dev/null 2>&1 && b=1
  c=0; ROOT="$BASE/rh1"; safe_rm_rehearsal "$BASE/rh1" >/dev/null 2>&1 && c=1
  ROOT=/srv/camptribe; e=0; mkdir -p "$BASE/rh3"; : > "$BASE/rh3/.camptribe-rehearsal-root"; safe_rm_rehearsal "$BASE/rh3" >/dev/null 2>&1 && e=1
  # з міткою, але ПОЗА дозволеними префіксами (/srv/camptribe-rehearsal*, /tmp, TMPDIR)
  OUTSIDE="$HOME/.camptribe-selftest-outside-$$"; mkdir -p "$OUTSIDE"; : > "$OUTSIDE/.camptribe-rehearsal-root"
  f=0; TMPDIR=/nonexistent-tmp safe_rm_rehearsal "$OUTSIDE" >/dev/null 2>&1 && f=1; rm -rf "$OUTSIDE"
  echo "$a$b$c$e$f $( [ -d "$BASE/rh2" ] && echo rh2-alive ) $( [ -d "$BASE/rh1" ] && echo rh1-alive ) $( [ -d "$BASE/rh3" ] && echo rh3-alive )" )
[ "$GOT" = "00010 rh2-alive rh1-alive " ] && pass "safe_rm_rehearsal: без мітки не видаляє, бойовий корінь не видаляє, з міткою — видаляє" || fail "safe_rm_rehearsal: без мітки не видаляє, бойовий корінь не видаляє, з міткою — видаляє" "'$GOT'"

new_world f4
# shellcheck disable=SC1090,SC2034
GOT=$( source "$DEPLOY"; ROOT=/srv/camptribe; LINK=current; WEB_PORT=3000; API_PORT=3001
  for u in api web; do render_rehearsal_unit "$HERE/systemd/camptribe-$u.service" /srv/camptribe-rehearsal 3100 3101 > "$BASE/unit.$u"; done; echo ok )
U="$BASE/unit.web"; A="$BASE/unit.api"
if ! grep -q '/srv/camptribe/' "$U" "$A" && ! grep -qE '(^|[^0-9])(3000|3001)([^0-9]|$)' "$U" "$A" \
   && grep -q 'WorkingDirectory=/srv/camptribe-rehearsal/current/apps/web' "$U" \
   && grep -q 'ExecStart=.*-p 3100' "$U" && grep -q 'API_BASE_URL=http://localhost:3101' "$U" \
   && grep -q 'Requires=camptribe-rehearsal-api.service' "$U" && grep -q '^ProtectSystem=strict' "$U" "$A" \
   && grep -qx 'ReadWritePaths=' "$U" && grep -qx 'ReadWritePaths=' "$A" && ! grep -q '^\[Install\]' "$U" "$A"; then
  pass "юніти репетиції з РЕАЛЬНИХ юнітів репо: жодного бойового шляху чи порту, лише читання, без [Install]"
else fail "юніти репетиції з РЕАЛЬНИХ юнітів репо: жодного бойового шляху чи порту, лише читання, без [Install]" "$(cat "$U")"; fi

# 🔴 Випадок заведено 22.10.2026, коли попередній упав НЕ на поведінці, а на
# коментарі: CAMP-385 дописав у прод-юніт пояснення, що тричі називає 3001,
# і sed копіював його в юніт репетиції дослівно. Юніт був функціонально
# правильний — неправдою була проза. Тут перевіряється саме це: проза
# прод-юніта не їде в згенерований файл, а заголовок про походження — їде.
new_world f4b
T="$BASE/tmpl.service"
cat > "$T" <<'TMPL'
[Unit]
Description=camptribe api
# Слухає 3001 на /srv/camptribe/current, назовні пускає Caddy.
; крапка з комою теж коментар у systemd

[Service]
WorkingDirectory=/srv/camptribe/current/apps/web
Environment=PORT=3000
ExecStart=/usr/bin/npx next start -p 3000
API_BASE_URL=http://localhost:3001
ReadWritePaths=/srv/camptribe/shared

[Install]
WantedBy=multi-user.target
TMPL
# shellcheck disable=SC1090,SC2034
( source "$DEPLOY"; ROOT=/srv/camptribe; LINK=current; WEB_PORT=3000; API_PORT=3001
  render_rehearsal_unit "$T" /srv/camptribe-rehearsal 3100 3101 > "$BASE/unit.tmpl" ) >/dev/null 2>&1
R="$BASE/unit.tmpl"
if ! grep -qE '(^|[^0-9])(3000|3001)([^0-9]|$)' "$R" \
   && ! grep -q '/srv/camptribe/' "$R" \
   && ! grep -q 'Слухає' "$R" \
   && ! grep -q 'крапка з комою' "$R" \
   && grep -q '^# ЗГЕНЕРОВАНО з юніта tmpl.service' "$R" \
   && grep -q '^# Світ репетиції (CAMP-61): корінь /srv/camptribe-rehearsal, порти 3100 і 3101\.$' "$R" \
   && grep -q 'ExecStart=.*-p 3100' "$R" \
   && grep -qx 'ReadWritePaths=' "$R" \
   && grep -qx '\[Unit\]' "$R" && grep -qx '\[Service\]' "$R"; then
  pass "юніт репетиції не несе прози прод-юніта: коментарі # і ; вирізано, секції й заголовок на місці"
else fail "юніт репетиції не несе прози прод-юніта: коментарі # і ; вирізано, секції й заголовок на місці" "$(cat "$R")"; fi

new_world f_camp340
# 🔴 CAMP-340. Сторож «статика несе адресу API» мусить уміти почервоніти,
# і ЩЕ мусить відрізняти «корпусу немає» (3) від «адреси немає» (5):
# порожній grep і grep по неіснуючій теці виглядають однаково.
# shellcheck disable=SC1090,SC2034
GOT=$( source "$DEPLOY"
  d="$BASE/c340"; mkdir -p "$d/good" "$d/empty" "$d/nojs"
  printf 'var a="https://camptribe.eu/api/auth";\n' > "$d/good/chunk.js"
  printf 'var a="https://camptribe.eu";\n'          > "$d/empty/chunk.js"
  : > "$d/nojs/readme.txt"
  B="https://camptribe.eu/api"
  for case_ in "$d/good:$B" "$d/empty:$B" "$d/nojs:$B" "$d/nema:$B" "$d/good:"; do
    rc=0; static_base_verdict "${case_%%:*}" "${case_#*:}" || rc=$?; printf '%s' "$rc"
  done
  printf ' '
  # і перелік ключів: беремо лише строгу форму NEXT_PUBLIC_<ВЕЛИКІ>=
  e="$d/.env"; printf 'DATABASE_URL=x\nNEXT_PUBLIC_API_BASE_URL=y\nNEXT_PUBLIC_SITE_MODE=public\nnext_public_lower=z\nNEXT_PUBLIC_BAD KEY=q\n' > "$e"
  public_keys "$e" | tr '\n' ',' )
if [ "$GOT" = "05334 NEXT_PUBLIC_API_BASE_URL,NEXT_PUBLIC_SITE_MODE," ]; then
  pass "CAMP-340: вердикт про статику розрізняє 0/5/3/3/4, public_keys бере лише строгу форму"
else
  fail "CAMP-340: вердикт про статику розрізняє 0/5/3/3/4, public_keys бере лише строгу форму" "got='$GOT' want='05334 NEXT_PUBLIC_API_BASE_URL,NEXT_PUBLIC_SITE_MODE,'"
fi

new_world f5
mkdir "$W/root/.deploy.lock"; sleep 300 & HOLDER=$!; echo $HOLDER > "$W/root/.deploy.lock/pid"
X deploy --sha "$SHA1" --apply
kill $HOLDER 2>/dev/null; wait $HOLDER 2>/dev/null
[ $RC -eq 1 ] && grep -q 'уже йде' <<<"$OUT" && [ ! -d "$W/root/releases/$S1" ] && pass "замок тримає живий процес: другий деплой відмовляє й нічого не створює" || fail "замок тримає живий процес: другий деплой відмовляє й нічого не створює" "rc=$RC $OUT"

new_world f6
X deploy --sha abc123 --apply
[ $RC -eq 1 ] && grep -q '40-символьним' <<<"$OUT" && pass "--sha коротший за 40 символів відхилено" || fail "--sha коротший за 40 символів відхилено" "rc=$RC $OUT"
X deploy --sha "$SHA0" --apply
[ $RC -eq 1 ] && grep -q 'і є чинний' <<<"$OUT" && pass "деплой уже чинного релізу відхилено (а не «перебудовано»)" || fail "деплой уже чинного релізу відхилено (а не «перебудовано»)" "rc=$RC $OUT"
X --help; R1=$RC; H1=$OUT; X deploy --help; R2=$RC
[ $R1 -eq 0 ] && [ $R2 -eq 0 ] && grep -q 'camptribe-deploy status' <<<"$H1" && pass "--help друкує користування й виходить 0, і як перший аргумент, і після команди" || fail "--help друкує користування й виходить 0, і як перший аргумент, і після команди" "rc=$R1/$R2 $H1"
X bogus; R1=$RC; X deploy --nonsense; R2=$RC
[ $R1 -eq 2 ] && [ $R2 -eq 2 ] && pass "невідома команда і невідомий прапорець: код 2" || fail "невідома команда і невідомий прапорець: код 2" "$R1 $R2"

# 🔴 Прапорець зі значенням, що стоїть ОСТАННІМ: `shift` у розбірнику падав під `set -e` без жодного слова,
# код 1, нічого не надруковано. «Нічого не сталося» тут не відрізнити від «усе гаразд, нема чого казати».
# Значення, що саме виглядає як прапорець (`--to --apply`), теж не значення.
new_world f7
BADV=""
for fl in --to --sha --ref --migrations --deployer; do
  X rollback "$fl"
  { [ $RC -eq 2 ] && grep -qF -- "$fl" <<<"$OUT"; } || BADV="$BADV $fl(rc=$RC)"
done
[ -z "$BADV" ] && pass "виконавець: прапорець зі значенням останнім і без значення (--to --sha --ref --migrations --deployer): код 2 і назва прапорця, а не мовчазний вихід 1" \
  || fail "виконавець: прапорець зі значенням останнім і без значення (--to --sha --ref --migrations --deployer): код 2 і назва прапорця, а не мовчазний вихід 1" "$BADV"
BADV=""; : > "$W/calls"
for fl in --to --sha --ref --migrations --deployer; do
  X rollback "$fl" --apply
  { [ $RC -eq 2 ] && [ -z "$(mutating_calls)" ]; } || BADV="$BADV $fl(rc=$RC)"
done
X deploy --sha "$SHA1" --migrations ""
[ $RC -eq 0 ] || BADV="$BADV порожній-список-міграцій(rc=$RC)"
[ -z "$BADV" ] && pass "виконавець: «--to --apply» — не значення (код 2, нічого не змінено), але порожній список міграцій (--migrations \"\") лишається законним значенням" \
  || fail "виконавець: «--to --apply» — не значення (код 2, нічого не змінено), але порожній список міграцій (--migrations \"\") лишається законним значенням" "$BADV"

# ═══════════════════════════════════════════════════════════════════
section "F2. Переносимість"

# 🔴 `$S0→$S1`: у локалі без UTF-8 bash 3.2 бере перший байт «→» за частину імені
# змінної і падає з «unbound variable». Заміряно 15.10.2026 на запуску з Python
# (він виставляє LC_CTYPE=C.UTF-8, невалідну на macOS). Властивість така: у скриптах
# жодна змінна не стоїть упритул до не-ASCII без фігурних дужок.
BAD=$(node -e '
  const fs = require("fs"); const bad = [];
  for (const f of process.argv.slice(1)) {
    fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (l.trimStart().startsWith("#")) return;
      for (const m of l.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)(?=[^\x00-\x7f])/g)) bad.push(f.split("/").pop() + ":" + (i + 1) + " " + m[0]);
    });
  }
  console.log(bad.join("; "));
' "$DEPLOY" "$WRAPPER" "$HERE/deploy.selftest.sh")
[ -z "$BAD" ] && pass "жодна змінна в скриптах infra/ не стоїть упритул до не-ASCII (без дужок)" || fail "жодна змінна в скриптах infra/ не стоїть упритул до не-ASCII (без дужок)" "$BAD"

# ═══════════════════════════════════════════════════════════════════
section "G. Обгортка на ноутбуці: infra/deploy-app.sh"

if [ -f "$WRAPPER" ]; then
  # `ssh` підмінено: записує аргументи й виконує віддалену команду ЛОКАЛЬНО над світом.
  mkdir -p "$BASE/wbin"
  cat > "$BASE/wbin/ssh" <<'SH'
#!/usr/bin/env bash
echo "ssh $*" >> "$WRAP_LOG"
# відкидаємо -i/-o …, лишаємо host і віддалену команду
while [ $# -gt 0 ]; do case "$1" in -i|-o) shift 2 ;; -*) shift ;; *) break ;; esac; done
shift
# 🔴 /run на сервері змонтовано noexec: файл ЧИТАТИ можна, ЗАПУСТИТИ як програму — ні.
# Тут це відтворено як властивість «машини»: команда, що починається зі шляху до
# тимчасового файлу виконавця, дає «Permission denied» (126), як на Ubuntu.
first="${1%% *}"
case "$first" in "$CAMPTRIBE_REMOTE_TMP"/*) echo "bash: $first: Permission denied" >&2; exit 126 ;; esac
bash -c "$*"
SH
  cat > "$BASE/wbin/scp" <<'SH'
#!/usr/bin/env bash
echo "scp $*" >> "$WRAP_LOG"
exit 0
SH
  chmod +x "$BASE/wbin/ssh" "$BASE/wbin/scp"
  new_world g1
  # Обгортка працює над КЛОНОМ: їй потрібен git із origin, а виконавець лежить поруч за тим самим розташуванням, що й у репо.
  W_REPO="$BASE/wrapperclone"; git clone -q "$REPO" "$W_REPO"; git -C "$W_REPO" config user.email tester@example.test
  # 🔴 Разом зі скриптом їде й `lib/`: на машині він читає `.env` тим
  # самим `env_value`, що бекап і перенос таблиць (CAMP-349). Без цієї
  # теки підроблений репозиторій відрізнявся б від справжнього саме тим,
  # що перевіряється.
  mkdir -p "$W_REPO/infra/bin" "$W_REPO/infra/lib"
  cp "$DEPLOY" "$W_REPO/infra/bin/camptribe-deploy"; cp "$WRAPPER" "$W_REPO/infra/deploy-app.sh"
  cp "$HERE/lib/env-value.sh" "$W_REPO/infra/lib/env-value.sh"
  WRAP_LOG="$BASE/wrap.log"; : > "$WRAP_LOG"; export WRAP_LOG
  WRAPX() {
    OUT=$(cd "$W_REPO" && env PATH="$BASE/wbin:$PATH" CAMPTRIBE_HOST=root@selftest.invalid CAMPTRIBE_KEY=/dev/null CAMPTRIBE_REMOTE_TMP="$BASE" \
          CAMPTRIBE_ROOT="$W/root" CAMPTRIBE_REPO="$REPO" CAMPTRIBE_API_PORT="$APIP" CAMPTRIBE_WEB_PORT="$WEBP" CAMPTRIBE_BUILD_API_PORT="$TPORT" \
          CAMPTRIBE_READY_TRIES=20 CAMPTRIBE_READY_SLEEP=0.3 CAMPTRIBE_MIN_FREE_GB=0 CAMPTRIBE_USER=selftest-nobody CAMPTRIBE_UNIT_SRC="$W/unitsrc" CAMPTRIBE_UNIT_DIR="$W/unitdir" \
          CAMPTRIBE_REHEARSAL_ROOT="$W/rehearsal" CAMPTRIBE_REHEARSAL_WEB_PORT="$RWP" CAMPTRIBE_REHEARSAL_API_PORT="$RAP" \
          bash "$W_REPO/infra/deploy-app.sh" "$@" 2>&1)
    RC=$?
  }
  FP=$(fingerprint "$W/root"); : > "$WRAP_LOG"
  WRAPX --sha "$SHA1"
  if [ $RC -eq 0 ] && ! grep -q -- '--apply' "$WRAP_LOG" && [ "$(fingerprint "$W/root")" = "$FP" ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT"; then
    pass "deploy-app.sh без --apply: ssh не отримав --apply, прод не змінився, виведено сухий прогін"
  else fail "deploy-app.sh без --apply: ssh не отримав --apply, прод не змінився, виведено сухий прогін" "rc=$RC log=$(cat "$WRAP_LOG") $OUT"; fi
  : > "$WRAP_LOG"; WRAPX --sha "$SHA1" --apply
  if [ $RC -eq 0 ] && grep -q -- '--apply' "$WRAP_LOG" && [ "$(readlink "$W/root/current")" = "releases/$S1" ]; then
    pass "deploy-app.sh --apply: ssh отримав --apply і реліз викочено"
  else fail "deploy-app.sh --apply: ssh отримав --apply і реліз викочено" "rc=$RC $(cat "$WRAP_LOG") $OUT"; fi
  jq -e --arg sha "$SHA1" '.sha == $sha and (.deployed_by | startswith("tester@example.test@"))' "$W/root/releases/$S1/RELEASE.json" >/dev/null \
    && pass "обгортка розв'язала SHA на ноутбуці й передала повний: у маніфесті саме він, оператор записаний" || fail "обгортка розв'язала SHA на ноутбуці й передала повний: у маніфесті саме він, оператор записаний"
  : > "$WRAP_LOG"; WRAPX --rollback
  if [ $RC -eq 0 ] && ! grep -q -- '--apply' "$WRAP_LOG" && [ "$(readlink "$W/root/current")" = "releases/$S1" ]; then
    pass "deploy-app.sh --rollback без --apply: лише план, current не рушив"
  else fail "deploy-app.sh --rollback без --apply: лише план, current не рушив" "rc=$RC $OUT"; fi
  WRAPX --rollback --apply
  [ $RC -eq 0 ] && [ "$(readlink "$W/root/current")" = "releases/$S0" ] && pass "deploy-app.sh --rollback --apply: повернуто $S0" || fail "deploy-app.sh --rollback --apply: повернуто $S0" "rc=$RC $OUT"
  : > "$WRAP_LOG"; WRAPX
  [ $RC -eq 0 ] && grep -q "$SHA4" <<<"$OUT" && ! grep -q -- '--apply' "$WRAP_LOG" && pass "deploy-app.sh без аргументів: розв'язав origin/main у ПОВНИЙ SHA кінчика ($SHA4) і передав його" || fail "deploy-app.sh без аргументів: розв'язав origin/main у ПОВНИЙ SHA кінчика ($SHA4) і передав його" "rc=$RC $OUT"
  WRAPX --sha "$SHA2"
  [ $RC -eq 0 ] && grep -q 'ЧЕКАЮТЬ 1' <<<"$OUT" && grep -q 'Gamma1000000000002' <<<"$OUT" && pass "deploy-app.sh: сухий прогін сам називає міграцію, що чекає (список з git за цим SHA дійшов до машини)" || fail "deploy-app.sh: сухий прогін сам називає міграцію, що чекає (список з git за цим SHA дійшов до машини)" "rc=$RC $OUT"
  WRAPX --sha "$SHA2" --apply
  [ $RC -ne 0 ] && grep -q -- '--migrate' <<<"$OUT" && ! grep -qx 'Gamma1000000000002' "$W/db/applied" && pass "deploy-app.sh --apply без --migrate при чекаючій міграції: відмова, БД не рушила" || fail "deploy-app.sh --apply без --migrate при чекаючій міграції: відмова, БД не рушила" "rc=$RC $OUT"
  WRAPX --sha "$SHA2" --apply --migrate
  [ $RC -eq 0 ] && grep -qx 'Gamma1000000000002' "$W/db/applied" && [ "$(readlink "$W/root/current")" = "releases/$S2" ] && pass "deploy-app.sh --apply --migrate: прапорець дійшов до машини, міграцію застосовано, реліз викочено" || fail "deploy-app.sh --apply --migrate: прапорець дійшов до машини, міграцію застосовано, реліз викочено" "rc=$RC $OUT"
  git -C "$W_REPO" -c user.email=x@y.z -c user.name=x commit -q --allow-empty -m "only local"
  WRAPX --sha HEAD --apply
  [ $RC -ne 0 ] && grep -q 'не лежить ні в одній гілці origin' <<<"$OUT" && pass "комміт, якого немає на origin: обгортка відмовляє до ssh, машина його б не отримала" || fail "комміт, якого немає на origin: обгортка відмовляє до ssh, машина його б не отримала" "rc=$RC $OUT"
  WRAPX --rehearse --apply --keep
  [ $RC -eq 0 ] && [ -d "$W/rehearsal" ] && pass "deploy-app.sh --rehearse --apply --keep: прапорець дійшов, світ лишено" || fail "deploy-app.sh --rehearse --apply --keep: прапорець дійшов, світ лишено" "rc=$RC $OUT"
  # 🔴 Рецензент відтворив це саме тут: `--rehearse --teardown` без --apply стирав світ, код 0, без слів «СУХИЙ ПРОГІН».
  FPG="$(fp_all)"; : > "$W/calls"; : > "$WRAP_LOG"
  WRAPX --rehearse --teardown
  if [ $RC -eq 0 ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT" && ! grep -q -- '--apply' "$WRAP_LOG" && [ "$(fp_all)" = "$FPG" ] && [ -d "$W/rehearsal" ] && [ -z "$(mutating_calls)" ]; then
    pass "deploy-app.sh --rehearse --teardown БЕЗ --apply: сухий прогін (слова є, ssh без --apply), світ репетиції стоїть, юніти й порти ті самі"
  else fail "deploy-app.sh --rehearse --teardown БЕЗ --apply: сухий прогін (слова є, ssh без --apply), світ репетиції стоїть, юніти й порти ті самі" "rc=$RC mutating=[$(mutating_calls)] $OUT"; fi
  WRAPX --rehearse --teardown --apply
  [ $RC -eq 0 ] && [ ! -e "$W/rehearsal" ] && ! ls "$W/unitdir"/camptribe-rehearsal-*.service >/dev/null 2>&1 && pass "deploy-app.sh --rehearse --teardown --apply: прапорці дійшли, світ прибрано" || fail "deploy-app.sh --rehearse --teardown --apply: прапорці дійшли, світ прибрано" "rc=$RC $OUT"
  WRAPX --rollback --to "$S1"
  [ $RC -eq 0 ] && grep -q 'явне --to' <<<"$OUT" && grep -q "rollback $S2 → $S1" <<<"$OUT" && pass "deploy-app.sh --rollback --to: явна ціль дійшла до машини" || fail "deploy-app.sh --rollback --to: явна ціль дійшла до машини" "rc=$RC $OUT"
  WRAPX --status
  [ $RC -eq 0 ] && grep -q 'ВИСНОВОК: усе збігається' <<<"$OUT" && pass "deploy-app.sh --status: одна команда відповідає, що зараз на проді" || fail "deploy-app.sh --status: одна команда відповідає, що зараз на проді" "rc=$RC $OUT"
  WRAPX --bogus; [ $RC -eq 2 ] && pass "обгортка: невідомий прапорець — код 2" || fail "обгортка: невідомий прапорець — код 2" "rc=$RC"
  BADV=""; : > "$WRAP_LOG"
  for fl in --to --sha --ref; do
    WRAPX "$fl"
    { [ $RC -eq 2 ] && grep -qF -- "$fl" <<<"$OUT"; } || BADV="$BADV $fl(rc=$RC)"
  done
  [ -z "$BADV" ] && ! grep -q . "$WRAP_LOG" && pass "обгортка: прапорець зі значенням останнім і без значення (--to --sha --ref): код 2 і назва прапорця, ssh не викликано" \
    || fail "обгортка: прапорець зі значенням останнім і без значення (--to --sha --ref): код 2 і назва прапорця, ssh не викликано" "$BADV log=$(cat "$WRAP_LOG")"
  BADV=""
  for fl in --to --sha --ref; do
    WRAPX --rollback "$fl" --apply
    { [ $RC -eq 2 ] && ! grep -q -- '--apply' "$WRAP_LOG"; } || BADV="$BADV $fl(rc=$RC)"
  done
  [ -z "$BADV" ] && pass "обгортка: «--rollback --to --apply» — не значення: код 2, --apply не дійшов до ssh" || fail "обгортка: «--rollback --to --apply» — не значення: код 2, --apply не дійшов до ssh" "$BADV log=$(cat "$WRAP_LOG")"
else
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do fail "обгортки ще немає ($WRAPPER)"; done
fi

# ═══════════════════════════════════════════════════════════════════
echo
echo "deploy self-test: ran $((PASSED + FAILED)), passed $PASSED, failed $FAILED (expected $EXPECTED cases)"
if [ "$FAILED" -ne 0 ]; then exit 1; fi
if [ $((PASSED + FAILED)) -ne "$EXPECTED" ]; then
  echo "виконано $((PASSED + FAILED)) випадків, а мало бути $EXPECTED: випадок тихо перестав виконуватись, або EXPECTED не оновлено" >&2
  exit 1
fi
echo "deploy self-test: усе гаразд"
