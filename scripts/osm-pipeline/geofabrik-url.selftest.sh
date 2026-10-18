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
run() { STUB_MODE="$1" STUB_YMD="${2:-}" GEOFABRIK_STALE_FROM="${3:-4}" \
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

echo
if [ "$fail" -eq 0 ]; then echo "✓ self-test passed: $pass cases"; else echo "✗ $fail of $((pass+fail)) failed"; exit 1; fi
