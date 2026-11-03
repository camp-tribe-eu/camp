#!/usr/bin/env bash
# Мутаційний стенд для geofabrik-url.sh. Жодної мережі: `curl` підміняється
# на PATH, бо перевіряється не Geofabrik, а те, як скрипт читає його відповіді.
#
# 🔴 Кожен випадок тут існує тому, що рецензія показала, як чотири різні
# події зводились до однієї хибної фрази «Geofabrik layout … has changed».
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
URL="${@: -1}"
case "$STUB_MODE" in
  all404)   exit 22 ;;
  dns)      exit 6 ;;
  rootpage) printf 'https://download.geofabrik.de/'; exit 0 ;;
  hit)      if [[ "$URL" == *"-$STUB_YMD.osm.pbf" ]]; then printf '%s' "$URL"; exit 0; fi; exit 22 ;;
  # 🔴 28 — таймаут. Два режими, бо це дві різні події:
  #   timeout      — мовчить усе; має впасти, але НАЗВАТИ мережу;
  #   timeout-today — мовчить лише запитана дата (спекулятивна проба
  #                   сьогоднішнього файлу), старіший лежить і має взятись.
  timeout)  exit 28 ;;
  # 🔴 Перша проба цієї адреси мовчить, друга відповідає. Без стану між
  # викликами стенд не відрізняє ОДНУ спробу від ДВОХ — і мутація
  # «прибрати повтор» проходила б повз. Лічильник у файлі, бо кожен
  # виклик curl це окремий процес.
  timeout-once)
            N="$STUB_STATE/$(echo "$URL" | tr -c 'a-zA-Z0-9' '_')"
            if [ ! -f "$N" ]; then : > "$N"; exit 28; fi
            if [[ "$URL" == *"-$STUB_YMD.osm.pbf" ]]; then printf '%s' "$URL"; exit 0; fi
            exit 22 ;;
  timeout-today)
            if [[ "$URL" == *"-$STUB_TIMEOUT.osm.pbf" ]]; then exit 28; fi
            if [[ "$URL" == *"-$STUB_YMD.osm.pbf" ]]; then printf '%s' "$URL"; exit 0; fi
            exit 22 ;;
  *) exit 99 ;;
esac
STUB
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH"

pass=0; fail=0
check() { # опис, очікуваний код, очікуваний фрагмент у stderr, реальний код, stderr
  local what="$1" wantrc="$2" wantmsg="$3" gotrc="$4" goterr="$5"
  # Порожній $wantmsg означає «stderr не перевіряємо». Без цієї гілки
  # `grep -q ""` по порожньому stderr повертає 1, і випадок, де все
  # правильно, читається як падіння — тобто сам стенд бреше.
  if [ "$gotrc" = "$wantrc" ] && { [ -z "$wantmsg" ] || grep -q "$wantmsg" <<<"$goterr"; }; then
    echo "  ✓ $what"; pass=$((pass+1))
  else
    echo "  ✗ $what — код $gotrc (чекав $wantrc), stderr: $(printf '%s' "$goterr" | head -1)"; fail=$((fail+1))
  fi
}
mkdir -p "$WORK/state"
run() { rm -rf "$WORK/state"; mkdir -p "$WORK/state"
        STUB_MODE="$1" STUB_YMD="${2:-}" GEOFABRIK_STALE_FROM="${3:-4}" \
          STUB_TIMEOUT="${4:-}" STUB_STATE="$WORK/state" \
          "$HERE/geofabrik-url.sh" europe/testland 7 2>"$WORK/err" >"$WORK/out"; echo $?; }

rc=$(run all404);   check "нічого не опубліковано → падає й називає вікно" 1 "no dated extract in the last 8 days" "$rc" "$(cat "$WORK/err")"
rc=$(run dns);      check "мережа впала → каже transport failure, а не «layout changed»" 1 "transport failure" "$rc" "$(cat "$WORK/err")"
rc=$(run dns);      check "мережа впала → НЕ звинувачує назву регіону" 1 "curl exited 6" "$rc" "$(cat "$WORK/err")"
rc=$(run rootpage); check "200 на корінь сайту → не приймається за екстракт" 1 "resolves to https://download.geofabrik.de/" "$rc" "$(cat "$WORK/err")"
rc=$(run rootpage); check "редирект на чуже місце каже саме це, а не «нічого не опубліковано»" 1 "not an extract named for" "$rc" "$(cat "$WORK/err")"
# 🔴 Два різні провали мусять звучати по-різному. Якщо вони злиті в одну
# фразу, запобіжник стверджує про причину, якої не перевіряв.
rc=$(run rootpage); redirect_err="$(cat "$WORK/err")"
rc=$(run all404);   missing_err="$(cat "$WORK/err")"
if [ "$redirect_err" != "$missing_err" ]; then echo "  ✓ редирект і відсутність файлу дають РІЗНІ повідомлення"; pass=$((pass+1));
else echo "  ✗ редирект і відсутність файлу дають однакове повідомлення"; fail=$((fail+1)); fi

Y0=$(date -u -d "-0 day" +%y%m%d 2>/dev/null || date -u -v-0d +%y%m%d)
Y3=$(date -u -d "-3 day" +%y%m%d 2>/dev/null || date -u -v-3d +%y%m%d)
Y5=$(date -u -d "-5 day" +%y%m%d 2>/dev/null || date -u -v-5d +%y%m%d)

rc=$(run hit "$Y0"); check "свіжий файл → код 0, без попередження" 0 "" "$rc" "$(cat "$WORK/err")"
[ -z "$(cat "$WORK/err")" ] && { echo "  ✓ свіжий файл не шумить"; pass=$((pass+1)); } || { echo "  ✗ свіжий файл чомусь попереджає"; fail=$((fail+1)); }
grep -q " $Y0 0$" "$WORK/out" && { echo "  ✓ друкує url, дату й вік"; pass=$((pass+1)); } || { echo "  ✗ вивід не той: $(cat "$WORK/out")"; fail=$((fail+1)); }

rc=$(run hit "$Y3"); check "D-3 це норма → код 0" 0 "" "$rc" "$(cat "$WORK/err")"
[ -z "$(cat "$WORK/err")" ] && { echo "  ✓ D-3 не попереджає (заміряна норма 2–3 дні)"; pass=$((pass+1)); } || { echo "  ✗ D-3 попереджає, хоча це норма"; fail=$((fail+1)); }

rc=$(run hit "$Y5"); check "D-5 → код 0, але ГУЧНО" 0 "5 days old" "$rc" "$(cat "$WORK/err")"
rc=$(run hit "$Y5"); check "D-5 → попередження каже, що Geofabrik відстає" 0 "Geofabrik is behind" "$rc" "$(cat "$WORK/err")"

# 🔴 ТАЙМАУТ — ЦЕ НЕ «НІЧОГО НЕ ОПУБЛІКОВАНО».
#
# Заміряно 03.11.2026: тижневий імпорт Німеччини падав на пробі
# СЬОГОДНІШНЬОГО файлу (`curl exited 28`), хоч учорашній лежав поруч із
# чинним md5. Запобіжник коштував дорожче за дефект — він зупиняв усе
# заради кандидата, якого зазвичай і не існує.
Y1=$(date -u -d "-1 day" +%y%m%d 2>/dev/null || date -u -v-1d +%y%m%d)

rc=$(run timeout-today "$Y1" 4 "$Y0")
check "таймаут на сьогоднішньому → бере вчорашній, код 0" 0 "" "$rc" "$(cat "$WORK/err")"
grep -q " $Y1 1$" "$WORK/out" \
  && { echo "  ✓ і друкує саме вчорашню дату з віком 1"; pass=$((pass+1)); } \
  || { echo "  ✗ вивід не той: $(cat "$WORK/out")"; fail=$((fail+1)); }
rc=$(run timeout-today "$Y1" 4 "$Y0")
check "про обхід сказано вголос, а не мовчки" 0 "лишився невизначеним" "$rc" "$(cat "$WORK/err")"

# Усе мовчить — падати треба, але назвати МЕРЕЖУ, а не Geofabrik.
rc=$(run timeout)
check "усі проби в таймаут → падає" 1 "таймаутом" "$rc" "$(cat "$WORK/err")"
rc=$(run timeout)
check "🔴 і НЕ стверджує «nothing published», чого не перевіряв" 1 "це мережа, а не відсутність файлу" "$rc" "$(cat "$WORK/err")"
rc=$(run timeout)
if grep -q "nothing published that recently" <<<"$(cat "$WORK/err")"; then
  echo "  ✗ таймаут читається як «нічого не опубліковано» — злиття двох подій"; fail=$((fail+1))
else
  echo "  ✓ таймаут і відсутність файлу лишились різними подіями"; pass=$((pass+1))
fi

# 🔴 ПОВТОРНА СПРОБА МУСИТЬ БУТИ ВИДИМОЮ, А НЕ ДЕКОРАТИВНОЮ.
#
# Перша редакція цих випадків її не бачила: стенд мовчав ЗАВЖДИ, тож
# одна проба й дві давали той самий результат, і мутація «прибрати
# повтор» проходила повз. Тут перша проба мовчить, друга відповідає —
# без повтору сьогоднішній файл не знайшовся б узагалі.
rc=$(run timeout-once "$Y0")
check "🔴 перша проба мовчить, друга відповідає → сьогоднішній знайдено" 0 "" "$rc" "$(cat "$WORK/err")"
grep -q " $Y0 0$" "$WORK/out" \
  && { echo "  ✓ і це саме сьогоднішній файл, вік 0"; pass=$((pass+1)); } \
  || { echo "  ✗ повтор не спрацював, вивід: $(cat "$WORK/out")"; fail=$((fail+1)); }

# DNS мусить лишитись фатальним ОДРАЗУ: він про хост, не про кандидата.
rc=$(run dns); check "🔴 DNS і далі падає одразу, без обходу" 1 "curl exited 6" "$rc" "$(cat "$WORK/err")"

echo
if [ "$fail" -eq 0 ]; then echo "✓ self-test passed: $pass cases"; else echo "✗ $fail of $((pass+fail)) failed"; exit 1; fi
