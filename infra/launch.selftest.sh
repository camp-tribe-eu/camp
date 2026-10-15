#!/usr/bin/env bash
# Self-test для infra/bin/camptribe-launch (CAMP-322).
#
#   ./infra/launch.selftest.sh
#
# 🔴 ЩО ТУТ СПРАВЖНЄ. Справжній скрипт, справжні файли, справжні симлінки,
# справжній .env. Підмінено двоє: `caddy` і `curl` — їх тут немає й бути
# не може. І підмінники віддають СИРЕ, а не готову відповідь:
#
#   * `caddy validate` справді читає Caddyfile і справді падає, якщо
#     імпортований gate.conf не існує;
#   * `curl` на публічну адресу ГРАЄ РОЛЬ ПРОКСІ: він щоразу читає
#     gate.conf У ЦЮ МИТЬ і сам вирішує, віддати 401, додати noindex чи
#     пропустити відповідь збірки. Тому «пароль зняли, а сайт лишився
#     noindex» тут ВІДТВОРЮЄТЬСЯ, а не вигадується.
#
# 🔴 ЧОМУ ЦЕ ВАЖЛИВО САМЕ ТУТ. Перевірка відкриття, яка питає 127.0.0.1,
# зеленіє при повністю закритому сайті: noindex додає проксі, якого там
# немає. Підмінник curl розрізняє дві адреси саме для цього.
#
# 🔴 ЛІЧИЛЬНИК. «N cases» — підпис, а не перевірка. EXPECTED записано
# нижче; останній рядок друкується лише коли виконаних стільки ж.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LAUNCH="${CAMPTRIBE_LAUNCH_BIN:-$HERE/bin/camptribe-launch}"
EXPECTED=24

[ -f "$LAUNCH" ] || { echo "немає $LAUNCH" >&2; exit 1; }
BASE="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-launch-selftest.XXXXXX")"
trap 'rm -rf "$BASE"' EXIT
trap 'exit 130' INT TERM

PASS=0; FAIL=0; RUN=0
pass() { RUN=$((RUN+1)); PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { RUN=$((RUN+1)); FAIL=$((FAIL+1)); printf '  ✗ %s\n     %s\n' "$1" "${2-}"; }
ok()   { if [ "$1" = 0 ]; then pass "$2"; else fail "$2" "${3-}"; fi; }

# --- світ ------------------------------------------------------------------
ROOT="$BASE/srv/camptribe"; CADDY="$BASE/etc/caddy"; STUB="$BASE/stub"; W="$BASE/world"
mkdir -p "$ROOT/releases/r1/apps/api" "$ROOT/releases/r1/apps/web" "$CADDY" "$STUB" "$W"
ln -sfn "$ROOT/releases/r1" "$ROOT/current"
printf 'DATABASE_URL=postgres://x/y\nPORT=3001\n' > "$ROOT/releases/r1/apps/api/.env"

cp "$HERE/caddy/gate-open.conf" "$CADDY/gate-open.conf"
sed 's/__HASH__/$2a$14$STUBSTUBSTUBSTUB/' "$HERE/caddy/gate-closed.conf.example" > "$CADDY/gate-closed.conf"
sed "s#/etc/caddy/gate.conf#$CADDY/gate.conf#" "$HERE/caddy/camptribe.eu.caddyfile" > "$CADDY/Caddyfile"
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"

# Збірка: те, що віддає Next. Керується файлом, який міняє тест.
printf 'closed\n' > "$W/build-mode"

cat > "$STUB/caddy" <<'STUBCADDY'
#!/usr/bin/env bash
# Підмінник caddy. validate СПРАВДІ читає конфіг і справді падає, якщо
# імпортований файл не існує — саме так падає й справжній caddy.
CFG=""; for a in "$@"; do [ -n "${TAKE-}" ] && { CFG="$a"; TAKE=""; }; [ "$a" = --config ] && TAKE=1; done
echo "$*" >> "$CADDY_LOG"
case "$1" in
  validate)
    [ -f "$CFG" ] || exit 1
    while read -r line; do
      case "$line" in *import\ *) f="${line#*import }"; f="${f%% *}"; [ -e "$f" ] || exit 1 ;; esac
    done < "$CFG"
    [ -e "$CADDY_VALIDATE_FAILS" ] && exit 1
    exit 0 ;;
  reload) [ -e "$CADDY_RELOAD_FAILS" ] && exit 1; exit 0 ;;
  *) exit 2 ;;
esac
STUBCADDY

cat > "$STUB/curl" <<'STUBCURL'
#!/usr/bin/env bash
# Підмінник curl. Дві адреси — дві різні правди, і друга виводиться з
# ПЕРШОЇ плюс стан gate.conf у цю мить, як це робить Caddy.
URL=""; WANT_HDR=0; WANT_CODE=0; FAILFAST=0
for a in "$@"; do
  case "$a" in
    -D) WANT_HDR=1 ;;
    '%{http_code}') WANT_CODE=1 ;;
    -fsS|-fs) FAILFAST=1 ;;
    http*) URL="$a" ;;
  esac
done
[ -n "$URL" ] || exit 2
PATHPART="${URL#*://}"; PATHPART="/${PATHPART#*/}"; PATHPART="${PATHPART%%\?*}"
MODE="$(cat "$WORLD/build-mode")"

emit_build() { # заголовки й тіло того, що віддає Next
  if [ "$PATHPART" = /robots.txt ]; then
    if [ "$MODE" = public ]; then BODY=$'User-Agent: *\nAllow: /'; else BODY=$'User-Agent: *\nDisallow: /'; fi
  else BODY='<html>camptribe</html>'; fi
  HDR='HTTP/1.1 200 OK'
  [ "$MODE" = public ] || HDR="$HDR"$'\n'"X-Robots-Tag: noindex, nofollow"
  CODE=200
}

case "$URL" in
  "$WEB_ORIGIN"*) emit_build ;;
  "$SITE_ORIGIN"*)
    emit_build
    GATE_NOW="$(readlink -f "$GATE_PATH" 2>/dev/null || echo none)"
    if [ "$GATE_NOW" = "$(readlink -f "$GATE_CLOSED_PATH" 2>/dev/null)" ] || [ -e "$CF_STALE" ]; then
      case "$PATHPART" in
        /.well-known/acme-challenge/*) : ;;
        *) CODE=401; HDR='HTTP/1.1 401 Unauthorized'; BODY='' ;;
      esac
    fi ;;
  *) exit 6 ;;
esac

[ "$FAILFAST" = 1 ] && [ "$CODE" != 200 ] && exit 22
if [ "$WANT_CODE" = 1 ]; then printf '%s' "$CODE"; exit 0; fi
if [ "$WANT_HDR" = 1 ]; then printf '%s\n\n' "$HDR"; exit 0; fi
printf '%s\n' "$BODY"
STUBCURL
chmod +x "$STUB/caddy" "$STUB/curl"

export CADDY_LOG="$BASE/caddy.log"; : > "$CADDY_LOG"
export CADDY_VALIDATE_FAILS="$BASE/no-validate" CADDY_RELOAD_FAILS="$BASE/no-reload"
export CF_STALE="$BASE/cf-stale" WORLD="$W"
export WEB_ORIGIN='http://127.0.0.1:3000' SITE_ORIGIN='https://camptribe.eu'
export GATE_PATH="$CADDY/gate.conf" GATE_CLOSED_PATH="$CADDY/gate-closed.conf"

run() { # прапорці скрипта → вивід у $OUT, код у $RC
  OUT="$(CAMPTRIBE_ROOT="$ROOT" CAMPTRIBE_CADDY_DIR="$CADDY" \
        CAMPTRIBE_CADDY_BIN="$STUB/caddy" CAMPTRIBE_CURL="$STUB/curl" \
        CAMPTRIBE_WEB_URL="$WEB_ORIGIN" CAMPTRIBE_SITE_URL="$SITE_ORIGIN" \
        CAMPTRIBE_VERIFY_TRIES=2 CAMPTRIBE_VERIFY_SLEEP=0 \
        bash "$LAUNCH" "$@" 2>&1)"; RC=$?
}
gate_now() { case "$(readlink -f "$CADDY/gate.conf")" in *gate-open.conf) echo open ;; *gate-closed.conf) echo closed ;; *) echo чуже ;; esac; }
envline()  { grep -c '^NEXT_PUBLIC_SITE_MODE=public$' "$ROOT/releases/r1/apps/api/.env"; }

echo '— замкнений світ: status читає всі чотири замки'
run status
[ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'ЗАКРИТО'
ok $? 'status на закритому світі: код 0 і слово ЗАКРИТО' "rc=$RC $OUT"
printf '%s' "$OUT" | grep -q 'ззовні                        : пароль'; ok $? 'status бачить 401 ЗЗОВНІ, а не на 127.0.0.1' "$OUT"

echo '— .env'
run env --public
[ "$RC" = 0 ] && [ "$(envline)" = 0 ] && printf '%s' "$OUT" | grep -q 'СУХИЙ ПРОГІН'
ok $? 'env --public без --apply: .env не змінено' "rc=$RC env=$(envline) $OUT"
run env --public --apply
[ "$RC" = 0 ] && [ "$(envline)" = 1 ]; ok $? 'env --public --apply: рядок зʼявився' "rc=$RC env=$(envline) $OUT"
printf '%s' "$OUT" | grep -q 'НІЧОГО НЕ ЗМІНИЛО'; ok $? 'env --apply каже прямо, що саме по собі це нічого не відкрило' "$OUT"
run env --public --apply
# 🔴 Не лише «рядок один». Запис у .env іде через тимчасовий файл, і
# перевірка, яка дивиться тільки на свій рядок, однаково зелена над
# файлом, з якого зникли DATABASE_URL і PORT.
[ "$RC" = 0 ] && [ "$(envline)" = 1 ] && printf '%s' "$OUT" | grep -q 'уже' \
  && [ "$(wc -l < "$ROOT/releases/r1/apps/api/.env" | tr -d " ")" = 3 ] \
  && grep -q '^DATABASE_URL=' "$ROOT/releases/r1/apps/api/.env" \
  && grep -q '^PORT=3001$' "$ROOT/releases/r1/apps/api/.env"
ok $? 'env --public двічі: рядок один, а решта .env ціла' "rc=$RC env=$(envline) файл=$(cat "$ROOT/releases/r1/apps/api/.env" | tr '\n' ' ') $OUT"
run env --apply; [ "$RC" = 2 ]; ok $? 'env без --public/--closed: код 2' "rc=$RC $OUT"

echo '— головне: зняти пароль над закритою збіркою НЕ МОЖНА'
run status
[ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q 'повна викладка'
ok $? 'env=public, збірка=closed → status 1 і просить викладку, а не open' "rc=$RC $OUT"
run open --apply
[ "$RC" = 1 ] && [ "$(gate_now)" = closed ]
ok $? 'open --apply при закритій збірці: відмова, gate не рушив' "rc=$RC gate=$(gate_now) $OUT"
printf '%s' "$OUT" | grep -q 'сам просить себе не індексувати'; ok $? 'відмова називає ПРИЧИНУ (robots.txt із Disallow)' "$OUT"
[ ! -s "$CADDY_LOG" ]; ok $? 'при відмові caddy не викликали жодного разу' "log=$(cat "$CADDY_LOG")"

echo '— збірка стала публічною'
printf 'public\n' > "$W/build-mode"
run status
[ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q 'camptribe-launch open --apply'
ok $? 'env+збірка public, gate closed → status 1 і просить саме open' "rc=$RC $OUT"
run open
[ "$RC" = 0 ] && [ "$(gate_now)" = closed ] && ! grep -q . "$CADDY_LOG"
ok $? 'open без --apply: gate не рушив, caddy не викликали' "rc=$RC gate=$(gate_now) $OUT"
run open --apply
[ "$RC" = 0 ] && [ "$(gate_now)" = open ]; ok $? 'open --apply: gate → open' "rc=$RC gate=$(gate_now) $OUT"
grep -q '^validate ' "$CADDY_LOG" && grep -q '^reload ' "$CADDY_LOG"
ok $? 'open --apply: validate ПЕРЕД reload' "log=$(cat "$CADDY_LOG")"
run status
[ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'ВІДКРИТО'; ok $? 'status після open: ВІДКРИТО, код 0' "rc=$RC $OUT"

echo '— назад під пароль'
run close --apply
[ "$RC" = 0 ] && [ "$(gate_now)" = closed ]; ok $? 'close --apply: gate → closed' "rc=$RC gate=$(gate_now) $OUT"
# 🔴 Закритий gate над ПУБЛІЧНОЮ збіркою — це ще не «закрито»: збірка
# лишилась індексовною, і єдине, що стримує робота, — пароль. status не
# має називати це ЗАКРИТО, бо наступна ж викладка без пароля відкриє сайт
# несподівано для того, хто читав цей рядок.
run status
[ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q 'НЕУЗГОДЖЕНО'
ok $? 'closed gate над public збіркою: НЕУЗГОДЖЕНО, а не ЗАКРИТО' "rc=$RC $OUT"
printf 'closed\n' > "$W/build-mode"
run env --closed --apply
[ "$RC" = 0 ] && [ "$(envline)" = 0 ]; ok $? 'env --closed --apply: рядок прибрано' "rc=$RC env=$(envline) $OUT"
run status
[ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'ЗАКРИТО'; ok $? 'світ повернуто в передзапуск: ЗАКРИТО' "rc=$RC $OUT"

echo '— зовнішня перевірка не пройшла (кеш Cloudflare віддає старе)'
printf 'public\n' > "$W/build-mode"
: > "$CF_STALE"; : > "$CADDY_LOG"
run open --apply
[ "$RC" = 3 ] && [ "$(gate_now)" = closed ]
ok $? 'ззовні досі пароль → код 3 і gate повернуто в closed' "rc=$RC gate=$(gate_now) $OUT"
printf '%s' "$OUT" | grep -q 'повертаю'; ok $? 'повернення назване вголос' "$OUT"
rm -f "$CF_STALE"

echo '— caddy validate падає'
: > "$CADDY_VALIDATE_FAILS"; : > "$CADDY_LOG"
run open --apply
[ "$RC" = 1 ] && [ "$(gate_now)" = closed ] && ! grep -q '^reload ' "$CADDY_LOG"
ok $? 'validate впав → gate повернуто, reload не кликали' "rc=$RC gate=$(gate_now) log=$(cat "$CADDY_LOG")"
rm -f "$CADDY_VALIDATE_FAILS"

echo '— gate.conf показує на те, чого немає'
ln -sfn "$CADDY/gate-missing.conf" "$CADDY/gate.conf"
run status; [ "$RC" = 1 ]; ok $? 'чужа ціль gate.conf: status не каже ні ЗАКРИТО, ні ВІДКРИТО' "rc=$RC $OUT"
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"

printf '\n%s\n' "$PASS passed, $FAIL failed"
if [ "$RUN" != "$EXPECTED" ]; then
  printf '🔴 виконано %s випадків, а записано %s — набір мовчки схуд\n' "$RUN" "$EXPECTED"; exit 1
fi
[ "$FAIL" = 0 ] || exit 1
# 🔴 Рядок НАЗИВАЄ СВІЙ СКРИПТ, і крок CI грепає саме його. Спільне
# «✓ self-test passed» задовольняється чужим самотестом (CAMP-285).
printf 'launch self-test: усе гаразд, %s випадків\n' "$EXPECTED"
