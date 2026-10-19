#!/usr/bin/env bash
# Self-test для infra/bin/camptribe-firewall.
#
#   ./infra/firewall.selftest.sh
#
# 🔴 ЩО ТУТ СПРАВЖНЄ. Сам скрипт — справжній, без єдиного гачка
# всередині. Підмінено рівно двоє: `ufw` і `curl`, бо цієї машини тут
# немає. Підмінник `ufw` НЕ імітує відповідь: він тримає справжній стан
# у файлі, виконує над ним `allow`/`delete` і друкує `status numbered`
# у тому самому форматі, що й справжній. Тобто «правило додалось» тут
# означає, що воно додалось, а не що хтось так сказав.
#
# 🔴 ГОЛОВНИЙ ВИПАДОК — ЗМІНА СПИСКУ. Картка вимагає довести не те, що
# правила ставляться, а те, що вони ОНОВЛЮЮТЬСЯ: зник діапазон —
# правило знято, зʼявився — додано. Замок, який застигає на першому
# списку, виглядає точно так само, як робочий, доки Cloudflare не
# змінить мережі.
#
# 🔴 ЛІЧИЛЬНИК. «N випадків» — підпис, а не перевірка. EXPECTED
# записано; останній рядок друкується лише коли виконаних стільки ж.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${CAMPTRIBE_FIREWALL_BIN:-$HERE/bin/camptribe-firewall}"
EXPECTED=23

[ -x "$BIN" ] || { echo "немає $BIN" >&2; exit 1; }

W="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-fw.XXXXXX")"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"

PASS=0; FAIL=0; RAN=0
ok() {
  RAN=$((RAN + 1))
  if [ "$1" = 0 ]; then PASS=$((PASS + 1)); echo "  ✓ $2"
  else FAIL=$((FAIL + 1)); echo "  ✗ $2"; [ -n "${3:-}" ] && echo "      $3"; fi
}

# ── підмінник ufw: справжній стан у файлі ─────────────────────────────
cat > "$W/bin/ufw" <<'STUB'
#!/usr/bin/env bash
# Стан: по рядку "<to>|<from>". Друкує у форматі справжнього ufw.
set -u
S="$UFW_STATE"; L="$UFW_LOG"
printf '%s\n' "ufw $*" >> "$L"
case "${1:-}" in
  status)
    echo "Status: active"; echo; echo "     To                         Action      From"
    echo "     --                         ------      ----"
    n=0
    while IFS='|' read -r to from; do
      [ -n "$to" ] || continue
      n=$((n + 1))
      printf '[%2d] %-26s ALLOW IN    %s\n' "$n" "$to" "$from"
    done < "$S"
    ;;
  allow)
    # allow from CIDR to any port P proto tcp   |   allow P/tcp
    if [ "${2:-}" = from ]; then
      printf '%s|%s\n' "${7:-}/tcp" "$3" >> "$S"
    else
      printf '%s|Anywhere\n' "${2:-}" >> "$S"
    fi
    echo "Rule added"
    ;;
  delete)
    [ "${2:-}" = allow ] || { echo "stub ufw: не вмію: $*" >&2; exit 64; }
    if [ "${3:-}" = from ]; then
      to="${8:-}/tcp"; from="$4"
    else
      # 🔴 Справжній ufw не знає команди `delete allow 80/tcp (v6)`:
      # v4 і v6 — один rule spec. Підмінник, який мовчки це приймав,
      # сховав дефект, що виліз аж на сухому прогоні прода.
      [ "$#" = 3 ] || { echo "stub ufw: зайвий аргумент: $*" >&2; exit 64; }
      to="${3:-}"; from="Anywhere"
    fi
    tmp="$(mktemp)"
    removed=0
    while IFS='|' read -r t f; do
      # 🔴 Один rule spec — два рядки. Справжній `ufw delete allow
      # 80/tcp` знімає і v4, і v6; підмінник, що знімав лише перший
      # збіг, лишав v6 живим і робив набір добрішим за прод.
      if [ "$from" = Anywhere ]; then
        case "$t" in "$to"|"$to (v6)") case "$f" in Anywhere*) removed=1; continue ;; esac ;; esac
      elif [ "$removed" = 0 ] && [ "$t" = "$to" ] && [ "$f" = "$from" ]; then
        removed=1; continue
      fi
      printf '%s|%s\n' "$t" "$f" >> "$tmp"
    done < "$S"
    mv "$tmp" "$S"
    [ "$removed" = 1 ] && echo "Rule deleted" || { echo "Could not delete non-existent rule" >&2; exit 1; }
    ;;
  *) echo "stub ufw: не вмію: $*" >&2; exit 64 ;;
esac
STUB
chmod +x "$W/bin/ufw"

# ── підмінник curl: віддає СИРИЙ список із файла ──────────────────────
#
# 🔴 Віддає сире, а не відповідь. Шим, який повертав би готовий вердикт,
# пропустив би будь-яку помилку розбору (CAMP-221).
cat > "$W/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -u
url=""
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
case "$url" in
  *ips-v4) f="$CF_V4_FILE" ;;
  *ips-v6) f="$CF_V6_FILE" ;;
  *) exit 6 ;;
esac
[ -f "$f" ] || exit 7
printf '%s' "$(cat "$f")"
STUB
chmod +x "$W/bin/curl"

PROD_STATE=$'22/tcp|Anywhere\n80/tcp|Anywhere\n443/tcp|Anywhere\n22/tcp (v6)|Anywhere (v6)\n80/tcp (v6)|Anywhere (v6)\n443/tcp (v6)|Anywhere (v6)\n'

mk_v4() { local n="$1" i; : > "$W/v4"; for ((i = 0; i < n; i++)); do echo "10.$i.0.0/20" >> "$W/v4"; done; }
mk_v6() { local n="$1" i; : > "$W/v6"; for ((i = 0; i < n; i++)); do echo "2400:cb00:$i::/32" >> "$W/v6"; done; }

reset_world() { printf '%s' "$PROD_STATE" > "$W/state"; : > "$W/log"; }

run() {
  OUT="$(env PATH="$W/bin:$PATH" UFW_STATE="$W/state" UFW_LOG="$W/log" \
    CF_V4_FILE="$W/v4" CF_V6_FILE="$W/v6" \
    CAMPTRIBE_UFW_BIN="$W/bin/ufw" CAMPTRIBE_CURL_BIN="$W/bin/curl" \
    "$BIN" "$@" 2>&1)"
  RC=$?
}

# 🔴 `grep -c` друкує 0 І виходить 1. `|| echo 0` після нього дає ДВА
# рядки, «0\n0», і порівняння з 0 падає на правильному стані. Коштувало
# двох хибних червоних тут же.
allowed_count() { grep -cv '|Anywhere' "$W/state" 2>/dev/null || true; }
blanket_count() { grep -cE '^(80|443)/tcp( \(v6\))?\|Anywhere' "$W/state" 2>/dev/null || true; }

echo '— сухий прогін'
mk_v4 15; mk_v6 7; reset_world
run sync
eq_rc=$RC
{ [ "$eq_rc" = 0 ] && grep -q 'СУХИЙ ПРОГІН' <<<"$OUT" && [ "$(allowed_count)" = 0 ] && [ "$(blanket_count)" = 4 ]; }
ok $? 'сухий прогін нічого не змінює і каже про це' "rc=$eq_rc $OUT"
grep -q 'ufw allow' "$W/log"; [ $? = 1 ]
ok $? 'сухий прогін не кликав ufw на зміну' "$(cat "$W/log")"

echo '— 🔴 план знімає загальний дозвіл ОДНИМ правилом на порт, без (v6)'
mk_v4 15; mk_v6 7; reset_world
run sync
{ [ "$(grep -c 'delete allow 80/tcp' <<<"$OUT" || true)" = 1 ] \
  && [ "$(grep -c 'delete allow 443/tcp' <<<"$OUT" || true)" = 1 ] \
  && ! grep -q '(v6)' <<<"$OUT"; }
ok $? '🔴 у плані рівно два зняття і жодного «(v6)»' "$OUT"

echo '— застосування'
run sync --apply
{ [ "$RC" = 0 ] && [ "$(allowed_count)" = 22 ] && [ "$(blanket_count)" = 0 ]; }
ok $? 'після --apply дозволено 22 діапазони, загальних дозволів 0' "rc=$RC $(cat "$W/state")"
grep -q '^22/tcp|Anywhere$' "$W/state"
ok $? '🔴 правило SSH на місці' "$(cat "$W/state")"
grep -q 'ufw .*22' "$W/log"; [ $? = 1 ]
ok $? '🔴 SSH не згадувався в жодному виклику ufw' "$(grep '22' "$W/log")"

echo '— 🔴 порядок: усі allow ПЕРЕД усіма delete'
last_allow=$(grep -n 'ufw allow' "$W/log" | tail -1 | cut -d: -f1)
first_delete=$(grep -n 'ufw delete' "$W/log" | head -1 | cut -d: -f1)
[ -n "$last_allow" ] && [ -n "$first_delete" ] && [ "$last_allow" -lt "$first_delete" ]
ok $? '🔴 жодного delete до того, як додано всі allow' "останній allow=$last_allow, перший delete=$first_delete"

echo '— ідемпотентність'
: > "$W/log"; run sync --apply
{ [ "$RC" = 0 ] && grep -q 'нічого робити' <<<"$OUT"; }
ok $? 'повторний --apply не має що робити' "rc=$RC $OUT"
grep -qE 'ufw (allow|delete)' "$W/log"; [ $? = 1 ]
ok $? 'і не кличе ufw на зміну' "$(cat "$W/log")"
run status
ok $? 'status на зійденому стані дає код 0' "rc=$RC $OUT"

echo '— 🔴 СПИСОК ЗМІНИВСЯ: правила мусять оновитись, а не застигнути'
gone='10.3.0.0/20'; fresh='198.51.100.0/24'
grep -q "^$gone|" <<<"$(sed 's/|/|/' "$W/state")" || true
before_gone=$(grep -c "|$gone$" "$W/state")
sed -i.bak "s|^$gone\$|$fresh|" "$W/v4" && rm -f "$W/v4.bak"
: > "$W/log"; run sync --apply
after_gone=$(grep -c "|$gone$" "$W/state")
after_fresh=$(grep -c "|$fresh$" "$W/state")
{ [ "$RC" = 0 ] && [ "$before_gone" = 1 ] && [ "$after_gone" = 0 ] && [ "$after_fresh" = 1 ] && [ "$(allowed_count)" = 22 ]; }
ok $? '🔴 зниклий діапазон ЗНЯТО, новий ДОДАНО, усього так само 22' "було=$before_gone стало=$after_gone новий=$after_fresh rc=$RC"
grep -q "ufw delete allow from $gone" "$W/log"
ok $? '…і зняття зробив саме ufw delete, а не перезапис' "$(cat "$W/log")"

echo '— порожнє й поламане джерело'
mk_v4 15; mk_v6 7; reset_world; run sync --apply   # повернути світ у чистий стан
: > "$W/v4"; : > "$W/log"
before="$(cat "$W/state")"
run sync --apply
{ [ "$RC" != 0 ] && [ "$(cat "$W/state")" = "$before" ]; }
ok $? '🔴 порожній список — відмова, стан не змінився' "rc=$RC $OUT"

printf '%s\n' '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>' > "$W/v4"
run sync --apply
{ [ "$RC" != 0 ] && grep -q 'не схожий на мережу' <<<"$OUT" && [ "$(cat "$W/state")" = "$before" ]; }
ok $? '🔴 сторінка помилки замість списку — відмова з назвою причини' "rc=$RC $OUT"

mk_v4 3
run sync --apply
{ [ "$RC" != 0 ] && grep -q 'щонайменше' <<<"$OUT" && [ "$(cat "$W/state")" = "$before" ]; }
ok $? '🔴 обрізаний список (3 < підлоги) — відмова, а не «закрити всіх»' "rc=$RC $OUT"

mk_v4 15; rm -f "$W/v6"
run sync --apply
{ [ "$RC" != 0 ] && [ "$(cat "$W/state")" = "$before" ]; }
ok $? 'curl не дістав список — відмова, стан не змінився' "rc=$RC $OUT"

echo '— 🔴 стан машини не такий, як скрипт думає'
mk_v4 15; mk_v6 7
printf '%s' $'80/tcp|Anywhere\n443/tcp|Anywhere\n' > "$W/state"; : > "$W/log"
run sync --apply
{ [ "$RC" != 0 ] && grep -q "немає дозволу на 22/tcp" <<<"$OUT"; }
ok $? '🔴 без дозволу на SSH скрипт зупиняється' "rc=$RC $OUT"
grep -q 'ufw allow' "$W/log"; [ $? = 1 ]
ok $? '…і зупиняється ДО будь-якої зміни' "$(cat "$W/log")"
grep -qE '^(80|443)/tcp\|Anywhere' "$W/state"
ok $? '…лишивши загальні дозволи на місці' "$(cat "$W/state")"

echo '— status і виклик'
mk_v4 15; mk_v6 7; reset_world
run status
{ [ "$RC" = 1 ] && grep -q 'РОЗБІЖНІСТЬ' <<<"$OUT"; }
ok $? 'status на розбіжності дає код 1 і каже про це' "rc=$RC $OUT"
: > "$W/log"; run status
grep -qE 'ufw (allow|delete)' "$W/log"; [ $? = 1 ]
ok $? 'status нічого не міняє' "$(cat "$W/log")"
run sync --нечекане
[ "$RC" = 2 ]
ok $? 'невідомий прапорець — код 2' "rc=$RC $OUT"
run
[ "$RC" = 2 ]
ok $? 'без команди — код 2' "rc=$RC $OUT"

echo
if [ "$RAN" != "$EXPECTED" ]; then
  echo "✗ виконано $RAN випадків, очікувалось $EXPECTED" >&2
  exit 1
fi
if [ "$FAIL" != 0 ]; then
  echo "firewall self-test: $PASS пройшло, $FAIL впало" >&2
  exit 1
fi
echo "firewall self-test: усе гаразд, $RAN випадків"
