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
EXPECTED=49

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
  "$WEB_ORIGIN"*) [ -e "$WEB_DOWN" ] && exit 7; emit_build ;;
  "$SITE_ORIGIN"*)
    # CDN перед нами може відповісти сам: 503, челендж WAF, 403. Для
    # скрипта це НЕ «сайт відкрито», і підмінник мусить уміти це сказати.
    if [ -e "$SITE_5XX" ]; then
      CODE=503; HDR='HTTP/1.1 503 Service Temporarily Unavailable'; BODY='<html>cloudflare</html>'
      [ "$WANT_CODE" = 1 ] && { printf '%s' "$CODE"; exit 0; }
      [ "$WANT_HDR" = 1 ] && { printf '%s\n\n' "$HDR"; exit 0; }
      printf '%s\n' "$BODY"; exit 0
    fi
    emit_build
    GATE_NOW="$(readlink -f "$GATE_PATH" 2>/dev/null || echo none)"
    if [ "$GATE_NOW" = "$(readlink -f "$GATE_CLOSED_PATH" 2>/dev/null)" ] || [ -e "$CF_STALE" ]; then
      # 🔴 ПЕРЕЛІК ВИНЯТКІВ ЧИТАЄТЬСЯ З СПРАВЖНЬОГО gate-closed.conf, А НЕ
      # ПЕРЕКАЗУЄТЬСЯ ТУТ. Доки він був переписаний у цьому case, підмінник
      # і конфіг могли розійтись: додаєш виняток у конфіг — самотест і далі
      # каже 401 і «ловить» неіснуючу аварію; прибираєш — не ловить
      # справжню. Тепер двійника немає.
      EXEMPT=$(sed -n 's/^@needs-password not path //p' "$GATE_CLOSED_PATH" 2>/dev/null)
      # Порожньо = файл не прочитався. Це провал, а не «винятків немає»:
      # інакше «не виміряли» виглядало б як «усе під паролем, як і треба».
      [ -n "$EXEMPT" ] || { echo "підмінник curl: не прочитав винятки з $GATE_CLOSED_PATH" >&2; exit 23; }
      # 🔴 `set -f` ОБОВʼЯЗКОВИЙ. Без нього незакавичене $EXEMPT не лише
      # ділиться на слова, а й розкривається як глоб ПО СПРАВЖНІЙ ФС:
      # зараз теки /api немає, тож тримається випадково, а в контейнері,
      # де вона є, випадок почав би падати без причини в коді.
      HIT=0; set -f
      for pat in $EXEMPT; do
        case "$PATHPART" in $pat) HIT=1; break ;; esac
      done
      set +f
      [ "$HIT" = 1 ] || { CODE=401; HDR='HTTP/1.1 401 Unauthorized'; BODY=''; }
    fi
    # 🔴 МАРШРУТ ЧИТАЄТЬСЯ З Caddyfile, А НЕ ВИГАДУЄТЬСЯ ТУТ. Доки цього не
    # було, випадок «акаунти виходять з-під пароля» діставав 200 від
    # ВЕБ-підмінника: прибери з Caddyfile увесь блок
    # `handle_path /api/* { reverse_proxy … }` — і самотест лишався 34/34.
    # Тобто єдиний тест на цю гілку не стеріг головного, що вона додала.
    #
    # Це симуляція, а не Caddy: знає лише `handle_path <глоб> {` з
    # `reverse_proxy 127.0.0.1:<порт>` усередині. Вирішальний доказ — живий
    # вимір на машині; це тут для того, щоб видалення маршруту не минало
    # мовчки.
    if [ "$CODE" = 200 ]; then
      # 🔴 НАЙДОВШИЙ ЗБІГ, А НЕ ПЕРШИЙ. Caddy сортує маршрути й віддає
      # запит ВУЖЧОМУ path-матчеру (той самий `sortRoutes`, яким
      # `handle_path` опиняється перед `handle`). Перша редакція цього
      # розбірника брала перший за порядком рядків: щойно хтось додав би
      # вужчий `/api/auth/*` під наявний `/api/*`, підмінник назвав би
      # старий порт, а випадок лишився б зеленим над іншим маршрутом.
      #
      # 🔴 Префікс для зрізання теж ВИВОДИТЬСЯ з матчера, а не зашитий як
      # `/api`: зашитий був переказом семантики handle_path, тобто жив би
      # правильно лише доти, доки ніхто не перейменує шлях.
      R=$(awk -v want="$PATHPART" '
        /^[[:space:]]*handle_path[[:space:]]/ {
          np=0; for (i=2; i<NF; i++) pats[++np]=$i   # остання лексема — "{"
          up=""; inblk=1; next
        }
        inblk && match($0, /127\.0\.0\.1:[0-9]+/) { up=substr($0, RSTART, RLENGTH) }
        inblk && /^[[:space:]]*}[[:space:]]*$/ {
          if (up != "") for (i=1; i<=np; i++) {
            pp=pats[i]; n=length(pp)
            if (substr(pp,n,1) == "*") {
              pre=substr(pp,1,n-1)
              if (substr(want,1,length(pre)) == pre && length(pre) > bestlen) {
                bestlen=length(pre); best=up; bestpre=pre
              }
            } else if (want == pp && n > bestlen) { bestlen=n; best=up; bestpre=pp }
          }
          inblk=0; np=0; up=""
        }
        END { if (best != "") { sub(/\/$/, "", bestpre); print best "\t" bestpre } }
      ' "$CADDYFILE_PATH" 2>/dev/null)
      if [ -n "$R" ]; then
        UP="${R%%	*}"; PRE="${R##*	}"
        REST="${PATHPART#"$PRE"}"; [ -n "$REST" ] || REST=/
        BODY="API@$UP$REST"
      fi
    fi ;;
  *) exit 6 ;;
esac

[ "$FAILFAST" = 1 ] && [ "$CODE" != 200 ] && exit 22
if [ "$WANT_CODE" = 1 ]; then printf '%s' "$CODE"; exit 0; fi
if [ "$WANT_HDR" = 1 ]; then printf '%s\n\n' "$HDR"; exit 0; fi
printf '%s\n' "$BODY"
STUBCURL
# CAMP-339 — підмінник `sudo`.
#
# 🔴 ПІДМІНЮЄМО ЗОВНІШНЮ КОМАНДУ, А НЕ ФУНКЦІЮ. Перша редакція підміняла
# всю `readable_by_caddy` через CAMPTRIBE_READCHECK, і самотест задавав її
# ЗАВЖДИ — тобто рядок `sudo -u caddy test -r`, єдиний, що справді їде на
# машину, не виконувався в наборі жодного разу. Мутація «прибрати
# `sudo -u $CADDY_USER`» лишала 42 з 42 зеленими, хоч на сервері скрипт
# іде від root, root читає все, і вся CAMP-339 ставала порожньою.
#
# 🔴 І ПЕРЕВІРЯЄ ФОРМУ ВИКЛИКУ, не лише відповідає. Код 64 на будь-яке
# інше написання: так «перестали питати від імені користувача» і
# «перестали питати про читання» мають свій спосіб почервоніти.
#
# Відповідь — СИРА: дивиться справжні права справжнього файла. Користувача
# `caddy` в пісочниці немає, тож питання зводиться до того, що вирішує
# ядро для будь-якого чужого користувача: чи дає режим читання групі або
# всім. Власником цих файлів на машині є root, Caddy — ніколи не власник.
#
# 🔴 GNU ПЕРШИМ, І ЦЕ НЕ СМАК. У coreutils `-f` це `--file-system`: на
# невідому директиву друкує `?` і ВИХОДИТЬ 0, тож `||` до форми `-c` не
# доходить ніколи, і підмінник стає константою «не читає» — 42/0 на
# макбуку, 27/14 на раннері. BSD чесно відкидає `-c` кодом 1 (заміряно),
# тому GNU→BSD правильний на обох. Та сама пастка описана в
# `scripts/osm-pipeline/load-context.sh` із посиланням на `src/stat.c`.
#
# `-L` — бо `gate.conf` сам симлінк, а `stat` без нього читає права
# САМОГО симлінка (0777 завжди) і каже «читається» там, де `test -r`
# сказав би «ні».
cat > "$STUB/sudo" <<'STUBSUDO'
#!/usr/bin/env bash
[ "$1" = "-u" ] || { echo "sudo-підмінник: очікував -u, дістав: $*" >&2; exit 64; }
user="$2"; shift 2
[ "$user" = "${CAMPTRIBE_CADDY_USER:-caddy}" ] || { echo "sudo-підмінник: чужий користувач «${user}»" >&2; exit 64; }
[ "$1" = "test" ] && [ "$2" = "-r" ] || { echo "sudo-підмінник: очікував test -r, дістав: $*" >&2; exit 64; }
f="$3"
[ -f "$f" ] || exit 1
m=$(stat -L -c '%a' "$f" 2>/dev/null) || m=$(stat -L -f '%Lp' "$f" 2>/dev/null) || exit 1
m=$(printf '%03d' "$((10#$m))")
g=${m:1:1}; o=${m:2:1}
if [ $(( g & 4 )) -ne 0 ] || [ $(( o & 4 )) -ne 0 ]; then exit 0; fi
exit 1
STUBSUDO
chmod +x "$STUB/caddy" "$STUB/curl" "$STUB/sudo"

# Замок народився з файлів, які створює людина від root. Відтворюємо саме
# це: 640 root:caddy на закритому (як виправлено на проді 16.10) і 644 на
# відкритому.
chmod 640 "$CADDY/gate-closed.conf" 2>/dev/null || true
chmod 644 "$CADDY/gate-open.conf" 2>/dev/null || true

export CADDY_LOG="$BASE/caddy.log"; : > "$CADDY_LOG"
export CADDY_VALIDATE_FAILS="$BASE/no-validate" CADDY_RELOAD_FAILS="$BASE/no-reload"
export CF_STALE="$BASE/cf-stale" WORLD="$W" SITE_5XX="$BASE/site-5xx" WEB_DOWN="$BASE/web-down"
export WEB_ORIGIN='http://127.0.0.1:3000' SITE_ORIGIN='https://camptribe.eu'
export GATE_PATH="$CADDY/gate.conf" GATE_CLOSED_PATH="$CADDY/gate-closed.conf" CADDYFILE_PATH="$CADDY/Caddyfile"

run() { # прапорці скрипта → вивід у $OUT, код у $RC
  OUT="$(CAMPTRIBE_ROOT="$ROOT" CAMPTRIBE_CADDY_DIR="$CADDY" \
        CAMPTRIBE_CADDY_BIN="$STUB/caddy" CAMPTRIBE_CURL="$STUB/curl" \
        CAMPTRIBE_SUDO="$STUB/sudo" \
        CAMPTRIBE_WEB_URL="$WEB_ORIGIN" CAMPTRIBE_SITE_URL="$SITE_ORIGIN" \
        CAMPTRIBE_VERIFY_TRIES=2 CAMPTRIBE_VERIFY_SLEEP=0 \
        bash "$LAUNCH" "$@" 2>&1)"; RC=$?
}
gate_now() { case "$(readlink -f "$CADDY/gate.conf")" in *gate-open.conf) echo open ;; *gate-closed.conf) echo closed ;; *) echo чуже ;; esac; }
envline()  { grep -c '^NEXT_PUBLIC_SITE_MODE=public$' "$ROOT/releases/r1/apps/api/.env"; }

echo '— замкнений світ: status читає всі чотири замки'
run status
[ "$RC" = 0 ] && grep -q 'ЗАКРИТО' <<<"$OUT"
ok $? 'status на закритому світі: код 0 і слово ЗАКРИТО' "rc=$RC $OUT"
grep -q 'ззовні                        : пароль' <<<"$OUT"; ok $? 'status бачить 401 ЗЗОВНІ, а не на 127.0.0.1' "$OUT"

echo '— .env'
# 🔴 Якір `^` у lock_env. Без нього закоментований рядок читається як
# ввімкнений, і крок 1 вважається зробленим над файлом, де змінної немає.
# Ставимо це ДО першого `env --apply`, поки справжнього рядка ще нема —
# інакше перевірка зелена незалежно від якоря.
printf '#NEXT_PUBLIC_SITE_MODE=public\n' >> "$ROOT/releases/r1/apps/api/.env"
run status
grep -q 'NEXT_PUBLIC_SITE_MODE : closed' <<<"$OUT"
ok $? 'закоментований рядок у .env не рахується за ввімкнений' "$OUT"
sed -i.bak '/^#NEXT_PUBLIC_SITE_MODE/d' "$ROOT/releases/r1/apps/api/.env"
rm -f "$ROOT/releases/r1/apps/api/.env.bak"
run env --public
[ "$RC" = 0 ] && [ "$(envline)" = 0 ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT"
ok $? 'env --public без --apply: .env не змінено' "rc=$RC env=$(envline) $OUT"
run env --public --apply
[ "$RC" = 0 ] && [ "$(envline)" = 1 ]; ok $? 'env --public --apply: рядок зʼявився' "rc=$RC env=$(envline) $OUT"
grep -q 'НІЧОГО НЕ ЗМІНИЛО' <<<"$OUT"; ok $? 'env --apply каже прямо, що саме по собі це нічого не відкрило' "$OUT"
run env --public --apply
# 🔴 Не лише «рядок один». Запис у .env іде через тимчасовий файл, і
# перевірка, яка дивиться тільки на свій рядок, однаково зелена над
# файлом, з якого зникли DATABASE_URL і PORT.
[ "$RC" = 0 ] && [ "$(envline)" = 1 ] && grep -q 'уже' <<<"$OUT" \
  && [ "$(wc -l < "$ROOT/releases/r1/apps/api/.env" | tr -d " ")" = 3 ] \
  && grep -q '^DATABASE_URL=' "$ROOT/releases/r1/apps/api/.env" \
  && grep -q '^PORT=3001$' "$ROOT/releases/r1/apps/api/.env"
ok $? 'env --public двічі: рядок один, а решта .env ціла' "rc=$RC env=$(envline) файл=$(cat "$ROOT/releases/r1/apps/api/.env" | tr '\n' ' ') $OUT"
run env --apply; [ "$RC" = 2 ]; ok $? 'env без --public/--closed: код 2' "rc=$RC $OUT"
run bogus-command; [ "$RC" = 2 ]; ok $? 'невідома команда: код 2' "rc=$RC $OUT"
run status --bogus; [ "$RC" = 2 ]; ok $? 'невідомий прапорець: код 2' "rc=$RC $OUT"

echo '— головне: зняти пароль над закритою збіркою НЕ МОЖНА'
run status
[ "$RC" = 1 ] && grep -q 'повна викладка' <<<"$OUT"
ok $? 'env=public, збірка=closed → status 1 і просить викладку, а не open' "rc=$RC $OUT"
run open --apply
[ "$RC" = 1 ] && [ "$(gate_now)" = closed ]
ok $? 'open --apply при закритій збірці: відмова, gate не рушив' "rc=$RC gate=$(gate_now) $OUT"
grep -q 'сам просить себе не індексувати' <<<"$OUT"; ok $? 'відмова називає ПРИЧИНУ (robots.txt із Disallow)' "$OUT"
[ ! -s "$CADDY_LOG" ]; ok $? 'при відмові caddy не викликали жодного разу' "log=$(cat "$CADDY_LOG")"

echo '— збірка стала публічною'
printf 'public\n' > "$W/build-mode"
run status
[ "$RC" = 1 ] && grep -q 'camptribe-launch open --apply' <<<"$OUT"
ok $? 'env+збірка public, gate closed → status 1 і просить саме open' "rc=$RC $OUT"
run open
[ "$RC" = 0 ] && [ "$(gate_now)" = closed ] && ! grep -q . "$CADDY_LOG"
ok $? 'open без --apply: gate не рушив, caddy не викликали' "rc=$RC gate=$(gate_now) $OUT"
run open --apply
[ "$RC" = 0 ] && [ "$(gate_now)" = open ]; ok $? 'open --apply: gate → open' "rc=$RC gate=$(gate_now) $OUT"
# 🔴 Не «обидва рядки є», а саме ПОРЯДОК: присутність задовольняється і
# тоді, коли reload непровалідованого конфігу стоїть першим.
VL="$(grep -n '^validate ' "$CADDY_LOG" | head -1 | cut -d: -f1)"
RL="$(grep -n '^reload ' "$CADDY_LOG" | head -1 | cut -d: -f1)"
[ -n "$VL" ] && [ -n "$RL" ] && [ "$VL" -lt "$RL" ]
ok $? 'open --apply: validate стоїть ПЕРЕД reload, а не просто поруч' "validate=$VL reload=$RL log=$(cat "$CADDY_LOG")"
run status
[ "$RC" = 0 ] && grep -q 'ВІДКРИТО' <<<"$OUT"; ok $? 'status після open: ВІДКРИТО, код 0' "rc=$RC $OUT"

echo '— назад під пароль'
run close --apply
[ "$RC" = 0 ] && [ "$(gate_now)" = closed ]; ok $? 'close --apply: gate → closed' "rc=$RC gate=$(gate_now) $OUT"
# 🔴 Закритий gate над ПУБЛІЧНОЮ збіркою — це ще не «закрито»: збірка
# лишилась індексовною, і єдине, що стримує робота, — пароль. status не
# має називати це ЗАКРИТО, бо наступна ж викладка без пароля відкриє сайт
# несподівано для того, хто читав цей рядок.
run status
[ "$RC" = 1 ] && grep -q 'НЕУЗГОДЖЕНО' <<<"$OUT"
ok $? 'closed gate над public збіркою: НЕУЗГОДЖЕНО, а не ЗАКРИТО' "rc=$RC $OUT"
printf 'closed\n' > "$W/build-mode"
run env --closed --apply
[ "$RC" = 0 ] && [ "$(envline)" = 0 ]; ok $? 'env --closed --apply: рядок прибрано' "rc=$RC env=$(envline) $OUT"
run status
[ "$RC" = 0 ] && grep -q 'ЗАКРИТО' <<<"$OUT"; ok $? 'світ повернуто в передзапуск: ЗАКРИТО' "rc=$RC $OUT"

echo '— зовнішня перевірка не пройшла (кеш Cloudflare віддає старе)'
printf 'public\n' > "$W/build-mode"
: > "$CF_STALE"; : > "$CADDY_LOG"
run open --apply
[ "$RC" = 3 ] && [ "$(gate_now)" = closed ]
ok $? 'ззовні досі пароль → код 3 і gate повернуто в closed' "rc=$RC gate=$(gate_now) $OUT"
grep -q 'повертаю' <<<"$OUT"; ok $? 'повернення назване вголос' "$OUT"
rm -f "$CF_STALE"

echo '— caddy validate падає'
: > "$CADDY_VALIDATE_FAILS"; : > "$CADDY_LOG"
run open --apply
[ "$RC" = 1 ] && [ "$(gate_now)" = closed ] && ! grep -q '^reload ' "$CADDY_LOG"
ok $? 'validate впав → gate повернуто, reload не кликали' "rc=$RC gate=$(gate_now) log=$(cat "$CADDY_LOG")"
rm -f "$CADDY_VALIDATE_FAILS"

echo '— gate.conf показує на те, чого немає'
# 🔴 Ізолюємо саме gate: замки 1 і 2 ставимо в public, інакше rc=1 дає
# гілка .env, і випадок зелений навіть коли lock_gate повертає 'open'.
run env --public --apply; printf 'public\n' > "$W/build-mode"
ln -sfn "$CADDY/gate-missing.conf" "$CADDY/gate.conf"
run status
[ "$RC" = 1 ] && grep -q 'gate.conf              : чуже' <<<"$OUT"
ok $? 'чужа ціль gate.conf: названа «чуже», і стан не цілісний' "rc=$RC $OUT"
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"

echo '— що саме виходить з-під пароля, поки закрито (CAMP-340)'
# 🔴 Рішення власника 16.10.2026: з-під пароля виходять ЛИШЕ /api/auth/*
# і /api/account/*, бо браузер не може надіслати basic-auth до API
# (`credentials: 'omit'`), і без цього акаунти не перевірити до відкриття.
# Випадок питає ОБИДВІ сторони: що виняток працює І що він вузький —
# перелік, який пускає все, задовольнив би половину тверджень.
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"
gcode() { "$STUB/curl" -s -o /dev/null -w '%{http_code}' "https://camptribe.eu$1"; }
G_ROOT=$(gcode /); G_SPOTS=$(gcode /api/spots); G_GUIDES=$(gcode /api/guides)
G_AUTH=$(gcode /api/auth/login); G_ACC=$(gcode /api/account/export); G_ACME=$(gcode /.well-known/acme-challenge/x)
# 🔴 Код 200 сам по собі нічого не каже — його дав би й веб. Питаємо ТІЛО:
# воно називає порт, узятий із Caddyfile, і шлях ПІСЛЯ зрізання префікса.
B_AUTH=$("$STUB/curl" -s "https://camptribe.eu/api/auth/login")
B_ACC=$("$STUB/curl" -s "https://camptribe.eu/api/account/export")
B_ACME=$("$STUB/curl" -s "https://camptribe.eu/.well-known/acme-challenge/x")
[ "$G_ROOT" = 401 ] && [ "$G_SPOTS" = 401 ] && [ "$G_GUIDES" = 401 ] && [ "$G_AUTH" = 200 ] && [ "$G_ACC" = 200 ] && [ "$G_ACME" = 200 ] && [ "$B_AUTH" = 'API@127.0.0.1:3001/auth/login' ] && [ "$B_ACC" = 'API@127.0.0.1:3001/account/export' ] && [ "${B_ACME#API@}" = "$B_ACME" ]
ok $? 'закрито: /, /api/spots і /api/guides під паролем; /api/auth/* і /api/account/* ідуть на 127.0.0.1:3001 зі зрізаним /api; acme віддає веб' "/=$G_ROOT spots=$G_SPOTS guides=$G_GUIDES auth=$G_AUTH account=$G_ACC acme=$G_ACME auth-тіло='$B_AUTH' acc-тіло='$B_ACC' acme-тіло='$B_ACME'"

# 🔴 Вірність розбірника маршрутів: перекриття «загальний вище за вузький».
# У нашому Caddyfile один handle_path, тож без цього випадку правило
# «найдовший збіг» не проганяє ніхто — а саме на ньому підмінник і Caddy
# розходились: перший брав перший за порядком рядків, другий — вужчий
# матчер. Синтетичний конфіг, бо предмет перевірки тут сам розбірник.
echo '— розбірник маршрутів: вужчий handle_path виграє в ширшого'
OVER="$BASE/Caddyfile.overlap"
{ printf 'camptribe.eu {\n\timport %s\n\n' "$CADDY/gate.conf"
  printf '\thandle_path /api/* {\n\t\treverse_proxy 127.0.0.1:3001\n\t}\n\n'
  printf '\thandle_path /api/auth/* {\n\t\treverse_proxy 127.0.0.1:3002\n\t}\n\n'
  printf '\thandle {\n\t\treverse_proxy 127.0.0.1:3000\n\t}\n}\n'; } > "$OVER"
O_AUTH=$(CADDYFILE_PATH="$OVER" "$STUB/curl" -s "https://camptribe.eu/api/auth/login")
O_ACC=$(CADDYFILE_PATH="$OVER" "$STUB/curl" -s "https://camptribe.eu/api/account/export")
# 🔴 Зрізається префікс ТОГО блоку, що виграв: `handle_path /api/auth/*`
# знімає `/api/auth`, тож апстрім бачить `/login`, а не `/auth/login`.
# Перша редакція цього випадку чекала `/auth/login` — помилка була в
# очікуванні, і знайшов її сам випадок, а не код.
[ "$O_AUTH" = 'API@127.0.0.1:3002/login' ] && [ "$O_ACC" = 'API@127.0.0.1:3001/account/export' ]
ok $? 'перекриття маршрутів: /api/auth/* бере вужчий блок (3002) і зрізає СВІЙ префікс; /api/account/* лишається на ширшому (3001)' "auth='$O_AUTH' account='$O_ACC'"

echo '— збірка мовчить (Next лежить)'
: > "$WEB_DOWN"; : > "$CADDY_LOG"
run open --apply
[ "$RC" = 1 ] && [ "$(gate_now)" = closed ] && grep -q 'невідомо' <<<"$OUT"
ok $? 'збірка «невідомо»: open --apply відмовляється, а не вважає це публічним' "rc=$RC gate=$(gate_now) $OUT"
rm -f "$WEB_DOWN"

echo '— gate.conf рукописний файл, а не симлінк'
rm -f "$CADDY/gate.conf"
printf 'basic_auth {\n\tcamptribe XXX\n}\n' > "$CADDY/gate.conf"
BEFORE="$(cat "$CADDY/gate.conf")"
run open --apply
[ "$RC" = 1 ] && [ ! -L "$CADDY/gate.conf" ] && [ "$(cat "$CADDY/gate.conf")" = "$BEFORE" ]
ok $? 'рукописний gate.conf: відмова, файл не знищено й не перетворено на симлінк на себе' "rc=$RC $OUT"
rm -f "$CADDY/gate.conf"; ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"

echo '— CDN відповідає сам: 503 це не «відкрито»'
: > "$SITE_5XX"
run status
[ "$RC" = 1 ] && grep -q 'ззовні                        : код-503' <<<"$OUT"
ok $? '503 від CDN читається як «код-503», а не як відкритий сайт' "rc=$RC $OUT"
# 🔴 Головний регрес: close під недосяжною публічною адресою. Перша
# редакція вертала «туди, де були», тобто ВІДКРИВАЛА сайт командою,
# чия єдина робота — повернути пароль.
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"; : > "$CADDY_LOG"
run close --apply
[ "$RC" = 3 ] && [ "$(gate_now)" = closed ]
ok $? 'close --apply при 503: сайт лишився ПІД ПАРОЛЕМ, а не відкритим' "rc=$RC gate=$(gate_now) $OUT"
rm -f "$SITE_5XX"

echo '— відкат релізу повернув закриту збірку, а пароль уже знятий'
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"
printf 'closed\n' > "$W/build-mode"
run status
grep -q 'ззовні                        : noindex' <<<"$OUT"
ok $? 'пароля немає, а збірка просить noindex — ззовні саме noindex' "$OUT"
[ "$RC" = 1 ] && grep -q 'повна викладка' <<<"$OUT"
ok $? 'і це НЕУЗГОДЖЕНО з вимогою зібрати заново, а не «відкрито»' "rc=$RC $OUT"
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"; printf 'public\n' > "$W/build-mode"

echo '— CAMP-339: права на файлах замка'

# 🔴 КОНТРОЛЬ. Світ, у якому status без проблем із правами віддає 0.
# Без нього наступний випадок нічого не доводить: код 1 тут буває й від
# неузгодженості замків, тож «не нуль» задовольнялось би вже наявною
# причиною, а не новою перевіркою.
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"
printf 'closed\n' > "$W/build-mode"
run env --closed --apply
run status
[ "$RC" = 0 ] && grep -q 'ЗАКРИТО' <<<"$OUT"
ok $? 'контроль: у цьому світі status віддає 0 і ЗАКРИТО' "rc=$RC $OUT"

# 🔴 І САМА АВАРІЯ: перемикання НЕМАЄ, світ узгоджений, зламано
# НЕАКТИВНИЙ файл. 15.10 о 14:50 виставили права, нічого не чіпали, усі
# замки показували правильне — лягло через добу на перезапуску.
# Файл навмисно неактивний: інакше «обидва» в циклі не перевіряє ніхто.
chmod 600 "$CADDY/gate-open.conf"
run status
[ "$RC" = 1 ] && grep -q 'ЗАМОК ОДНОРАЗОВИЙ' <<<"$OUT"
ok $? 'зламані права на НЕАКТИВНОМУ файлі: код 1 у світі, що віддавав 0' "rc=$RC $OUT"
chmod 644 "$CADDY/gate-open.conf"

# «Немає» і «читається» — різні твердження. Файл справді буває відсутнім:
# його збирають на машині з .example, у репозиторії його нема.
mv "$CADDY/gate-closed.conf" "$CADDY/gate-closed.keep"
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"
run status
[ "$RC" != 0 ] && grep -q 'НЕМАЄ' <<<"$OUT"
ok $? 'відсутній файл замка названий, а не пропущений' "rc=$RC $OUT"
mv "$CADDY/gate-closed.keep" "$CADDY/gate-closed.conf"
printf 'public\n' > "$W/build-mode"; run env --public --apply

# Ціль нечитабельна — перехід не йде.
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"
chmod 600 "$CADDY/gate-closed.conf"
run close --apply
[ "$RC" != 0 ] && [ "$(gate_now)" = open ] && grep -q 'НЕ МОЖЕ прочитати' <<<"$OUT"
ok $? 'close не йде, коли НЕЧИТАБЕЛЬНА САМЕ ЦІЛЬ' "rc=$RC gate=$(gate_now) $OUT"

# 🔴 ЦІЛЬ ВІДКАТУ. Ціль переходу (gate-open.conf) читається, зламаний
# лише gate-closed.conf — і перша редакція вважала це приводом для
# попередження. Хибно: `caddy_apply … "$GATE_CLOSED"` і
# `point_gate "$GATE_CLOSED"` вертають саме туди, хай що ми відкривали.
# Тобто невдале відкриття поклало б gate.conf на файл, якого служба не
# прочитає, і скрипт назвав би це «повернуто під пароль, і це перевірено».
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"
chmod 600 "$CADDY/gate-closed.conf"
run open --apply
[ "$RC" != 0 ] && [ "$(gate_now)" = closed ] && grep -q 'саме туди цей запуск відкотиться' <<<"$OUT"
ok $? 'open не йде, коли нечитабельна ЦІЛЬ ВІДКАТУ, хоч сама ціль читається' "rc=$RC gate=$(gate_now) $OUT"
chmod 640 "$CADDY/gate-closed.conf"

# А ось де попередження справді доречне: закриваємось, і нечитабельний
# саме той файл, який Caddy після цього взагалі не читає. Спиняти через
# нього означало б заглушити аварійний важіль.
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"
chmod 600 "$CADDY/gate-open.conf"
run close --apply
[ "$RC" = 0 ] && [ "$(gate_now)" = closed ] && grep -q 'не читає' <<<"$OUT"
ok $? 'close ІДЕ з попередженням, коли зламаний лише покинутий файл' "rc=$RC gate=$(gate_now) $OUT"

# Сухий прогін не має казати обидві речі одразу.
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"
run close
grep -q 'не читає' <<<"$OUT" && ! grep -q 'читає обидва файли' <<<"$OUT"
ok $? 'сухий прогін не каже «читає обидва» після власного попередження' "rc=$RC $OUT"
chmod 644 "$CADDY/gate-open.conf"

# Відсутній покинутий файл — теж попередження, і воно має бути своє.
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"
mv "$CADDY/gate-open.conf" "$CADDY/gate-open.keep"
run close --apply
[ "$RC" = 0 ] && grep -q 'ШЛЯХУ НАЗАД НЕ ІСНУЄ' <<<"$OUT"
ok $? 'відсутній покинутий файл названий окремо, а не мовчки пропущений' "rc=$RC $OUT"
mv "$CADDY/gate-open.keep" "$CADDY/gate-open.conf"

# Та сама мутація на gate-open.conf, коли ВІН є ціллю.
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"
chmod 600 "$CADDY/gate-open.conf"
run open --apply
[ "$RC" != 0 ] && [ "$(gate_now)" = closed ] && grep -q 'НЕ МОЖЕ прочитати' <<<"$OUT"
ok $? 'open не йде, коли нечитабельний gate-open.conf як ціль' "rc=$RC gate=$(gate_now) $OUT"
chmod 644 "$CADDY/gate-open.conf"

# 🔴 «УЖЕ В ЦЬОМУ СТАНІ» — не привід мовчати. Саме так виглядала аварія:
# перемикати нічого не треба, а файл, який Caddy імпортує прямо зараз,
# він не читає. Оператор тисне аварійний важіль і дістає 0.
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"
chmod 600 "$CADDY/gate-closed.conf"
run close --apply
[ "$RC" != 0 ] && grep -q 'НЕ МОЖЕ прочитати' <<<"$OUT"
ok $? 'close --apply на ВЖЕ закритому сайті не мовчить про зламані права' "rc=$RC $OUT"

# Сухий прогін у напрямку open мусить казати про ціль ВІДКАТУ: єдиний
# інший сухий випадок — close, де ціль і ціль відкату збігаються, тож
# гілка в ньому не виконується взагалі.
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"
run open
[ "$RC" != 0 ] && grep -q 'саме туди цей запуск відкотиться' <<<"$OUT"
ok $? 'сухий open попереджає про ціль відкату, не лише --apply' "rc=$RC $OUT"
chmod 640 "$CADDY/gate-closed.conf"

# Порада має бути здійсненною: на ВІДСУТНЬОМУ файлі chown не допоможе.
mv "$CADDY/gate-closed.conf" "$CADDY/gate-closed.keep"
ln -sfn "$CADDY/gate-open.conf" "$CADDY/gate.conf"
run open --apply
grep -q 'немає' <<<"$OUT" && ! grep -q 'НЕ МОЖЕ прочитати' <<<"$OUT"
ok $? 'відсутня ціль відкату: сказано «немає», а не «полагодь права»' "rc=$RC $OUT"
mv "$CADDY/gate-closed.keep" "$CADDY/gate-closed.conf"

# 🔴 ТРЕТІЙ ФАЙЛ. gate.conf може вказувати не на жоден із двох відомих —
# код це визнає, `lock_gate` має для такого вердикт «чуже». Перевірка, що
# ходить лише по двох іменах, у цьому стані друкує «обидва читає caddy»,
# тоді як Caddy імпортує саме той третій.
cp "$CADDY/gate-closed.conf" "$CADDY/gate-maint.conf"
chmod 600 "$CADDY/gate-maint.conf"
ln -sfn "$CADDY/gate-maint.conf" "$CADDY/gate.conf"
run status
grep -q 'gate-maint.conf' <<<"$OUT"
ok $? 'status перевіряє той файл, на який gate.conf вказує НАСПРАВДІ' "rc=$RC $OUT"
rm -f "$CADDY/gate-maint.conf"
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"

# І перевірка вміє зеленіти — інакше вона просто «завжди ні».
run open --apply
[ "$RC" = 0 ] && [ "$(gate_now)" = open ]
ok $? 'із правильними правами перемикання відбувається' "rc=$RC gate=$(gate_now) $OUT"
ln -sfn "$CADDY/gate-closed.conf" "$CADDY/gate.conf"

printf '\n%s\n' "$PASS passed, $FAIL failed"
if [ "$RUN" != "$EXPECTED" ]; then
  printf '🔴 виконано %s випадків, а записано %s — набір мовчки схуд\n' "$RUN" "$EXPECTED"; exit 1
fi
[ "$FAIL" = 0 ] || exit 1
# 🔴 Рядок НАЗИВАЄ СВІЙ СКРИПТ, і крок CI грепає саме його. Спільне
# «✓ self-test passed» задовольняється чужим самотестом (CAMP-285).
printf 'launch self-test: усе гаразд, %s випадків\n' "$EXPECTED"
