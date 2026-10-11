#!/usr/bin/env bash
# Чи має цей прогін CI будуватись, чи вже є кращий (CAMP-269).
#
#   should-build.sh <event_name> <repository> <sha>   → друкує yes|no
#   should-build.sh --self-test
#
# 🔴 НАВІЩО. `ci.yml` слухає і `push: ['**']`, і `pull_request`, тож
# гілка з відкритим PR збирається ДВІЧІ на одному коміті. Заміряно на
# 100 останніх прогонах (06–11.10.2026): 58 унікальних комітів, 40 із
# них зібрані двічі, 777 зайвих хвилин за пʼять діб.
#
# Обидва тригери лишаються, бо кожен відповідає на СВОЄ питання:
#   · pull_request збирає злиття гілки з поточним main — те, що поїде;
#   · push: ['**'] існує, бо CAMP-34…CAMP-39 додали кроки CI, які не
#     бігали жодного разу: робота лежала на гілці без PR.
#
# Тому push-прогін відступає рівно тоді, коли в коміта вже є PR.
#
# 🔴 ПРИ ПОМИЛЦІ — БУДУЄМО. Ворота, що мовчки кажуть «ні», зупиняють CI
# не падаючи, а це та сама тиха форма, яку цей репозиторій ловить у
# своїх запобіжниках знову й знову.
set -uo pipefail

decide() {
  local event="$1" repo="$2" sha="$3" n
  if [ "$event" != 'push' ]; then echo yes; return 0; fi
  n=$(gh api "repos/$repo/commits/$sha/pulls" --jq 'length' 2>/dev/null)
  if ! printf '%s' "$n" | grep -qE '^[0-9]+$'; then echo yes; return 0; fi
  if [ "$n" -gt 0 ]; then echo no; else echo yes; fi
}

if [ "${1:-}" = '--self-test' ]; then
  WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; mkdir -p "$WORK/bin"
  cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$STUB" in
  one)    echo 1 ;;
  none)   echo 0 ;;
  broken) echo '<html>404</html>' ;;
  dead)   exit 1 ;;
esac
STUB
  chmod +x "$WORK/bin/gh"; export PATH="$WORK/bin:$PATH"
  pass=0; fail=0
  t() { # опис, очікуване, подія, STUB
    local got; got=$(STUB="$4" decide "$3" r/r deadbeef)
    if [ "$got" = "$2" ]; then echo "  ✓ $1"; pass=$((pass+1));
    else echo "  ✗ $1 — дало «$got», чекав «$2»"; fail=$((fail+1)); fi
  }
  t 'pull_request будується завжди' yes pull_request one
  t 'workflow_dispatch будується завжди' yes workflow_dispatch one
  t 'push без PR будується — інакше гілка лишиться без CI' yes push none
  t 'push із відкритим PR відступає' no push one
  # 🔴 Три різні поломки, і всі мусять дати «будуємо».
  t 'gh віддав не число → будуємо' yes push broken
  t 'gh упав → будуємо' yes push dead
  t 'порожня відповідь → будуємо' yes push ''
  echo
  if [ "$fail" -eq 0 ]; then echo "✓ self-test passed: $pass cases"; else echo "::error::$fail of $((pass+fail)) failed"; exit 1; fi
  exit 0
fi

decide "${1:?event}" "${2:?repository}" "${3:?sha}"
