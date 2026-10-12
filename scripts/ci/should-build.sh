#!/usr/bin/env bash
# Чи має цей прогін CI будуватись, чи вже є кращий (CAMP-269).
#
#   should-build.sh <event> <repo> <sha> <ref_name> <default_branch>
#   should-build.sh --self-test
#
# 🔴 НАВІЩО. `ci.yml` слухає і `push: ['**']`, і `pull_request`, тож
# гілка з відкритим PR збирається ДВІЧІ на одному коміті. Заміряно на
# 100 прогонах (06–11.10.2026): 58 унікальних комітів, 40 зібрані
# двічі, 777 зайвих хвилин за пʼять діб.
#
# Обидва тригери лишаються: pull_request збирає злиття з поточним main —
# те, що поїде; push: ['**'] існує, бо CAMP-34…CAMP-39 додали кроки CI,
# які не бігали жодного разу — робота лежала на гілці без PR.
set -uo pipefail

decide() {
  local event="$1" repo="$2" sha="$3" ref="$4" base="$5" n

  if [ "$event" != 'push' ]; then echo yes; return 0; fi

  # 🔴 ГІЛКА ЗА ЗАМОВЧУВАННЯМ БУДУЄТЬСЯ ЗАВЖДИ, І ЦЕ ПЕРША ПЕРЕВІРКА.
  #
  # Перша редакція цих воріт пропустила ВСІ джоби на `main` одразу після
  # власного злиття, і прогін відзвітував `success`. Зелена галочка над
  # коміком, який ніхто не збирав, — найгірше, що ці ворота могли
  # зробити. Жодне питання до API не має права цьому передувати.
  if [ -n "$base" ] && [ "$ref" = "$base" ]; then echo yes; return 0; fi

  # 🔴 І ПРИЧИНА ТІЄЇ ПОМИЛКИ: `/commits/<sha>/pulls` віддає ВСІ PR, де
  # цей коміт зустрічається, разом із уже ЗАКРИТИМИ. Після squash-злиття
  # коміт на `main` звʼязаний із щойно злитим PR, тож «чи є PR» давало 1
  # і ворота відступали. Рахувати можна лише ВІДКРИТІ.
  n=$(gh api "repos/$repo/commits/$sha/pulls" \
        --jq '[.[] | select(.state == "open")] | length' 2>/dev/null)

  # 🔴 ПРИ ПОМИЛЦІ — БУДУЄМО. Ворота, що мовчки кажуть «ні», зупиняють
  # CI не падаючи, а це та сама тиха форма, яку цей репозиторій ловить
  # у своїх запобіжниках знову й знову.
  if ! printf '%s' "$n" | grep -qE '^[0-9]+$'; then echo yes; return 0; fi
  if [ "$n" -gt 0 ]; then echo no; else echo yes; fi
}

if [ "${1:-}" = '--self-test' ]; then
  WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; mkdir -p "$WORK/bin"
  # 🔴 Шим віддає JSON ТОГО САМОГО вигляду, що й GitHub, а не готове
  # число. Перша редакція стенду віддавала число — тобто кодувала моє
  # припущення, і тому пропустила рівно ту помилку, через яку `main`
  # лишився незібраним.
  cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
# 🔴 Шим віддає JSON ТОГО САМОГО вигляду, що й GitHub, і сам проганяє
# крізь справжній --jq. Перша редакція стенду віддавала готове число —
# тобто перевіряла моє припущення замість фільтра, і через це пропустила
# рівно ту помилку, через яку `main` лишився незібраним.
payload=''
case "$STUB" in
  open)   payload='[{"number":9,"state":"open"}]' ;;
  closed) payload='[{"number":161,"state":"closed"}]' ;;
  both)   payload='[{"number":9,"state":"open"},{"number":1,"state":"closed"}]' ;;
  none)   payload='[]' ;;
  broken) payload='<html>404</html>' ;;
  dead)   exit 1 ;;
  *)      payload='' ;;
esac
filter=''
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  [ "${args[i]}" = '--jq' ] && filter="${args[i+1]}"
done
if [ -n "$filter" ]; then
  printf '%s' "$payload" | jq -r "$filter" 2>/dev/null || printf '%s' "$payload"
else
  printf '%s' "$payload"
fi
STUB
  chmod +x "$WORK/bin/gh"; export PATH="$WORK/bin:$PATH"
  pass=0; fail=0
  t() { # опис, очікуване, подія, STUB, ref, base
    local got; got=$(STUB="$4" decide "$3" r/r deadbeef "${5:-feature}" "${6:-main}")
    if [ "$got" = "$2" ]; then echo "  ✓ $1"; pass=$((pass+1));
    else echo "  ✗ $1 — дало «$got», чекав «$2»"; fail=$((fail+1)); fi
  }
  t 'pull_request будується завжди' yes pull_request open
  t 'workflow_dispatch будується завжди' yes workflow_dispatch open
  t 'push у гілку без PR будується' yes push none
  t 'push у гілку з ВІДКРИТИМ PR відступає' no push open
  # 🔴 Випадок, через який main лишився незібраним.
  t 'коміт, звʼязаний лише із ЗАКРИТИМ PR, будується' yes push closed
  t 'відкритий плюс закритий — рахується відкритий' no push both
  # 🔴 Друга, незалежна перевірка: гілка за замовчуванням.
  t 'push у main будується, навіть коли API каже «є PR»' yes push open main main
  t 'push у main будується навіть коли API мовчить' yes push dead main main
  # Три різні поломки, і всі мусять дати «будуємо».
  t 'gh віддав не JSON → будуємо' yes push broken
  t 'gh упав → будуємо' yes push dead
  t 'порожня відповідь → будуємо' yes push ''
  echo
  # 🔴 CAMP-286: the line names this file, so the CI step that greps it
  # cannot be satisfied by some other script printing the same sentence —
  # and the COUNT is asserted, not merely printed. Review stubbed `t()`
  # to a no-op: every case stopped running, and this line said
  # "✓ should-build self-test: 0 cases" with the step exiting 0. A number
  # nobody compares is a label.
  if [ "$pass" -ne 11 ] || [ "$fail" -ne 0 ]; then
    echo "::error::$pass passed and $fail failed, expected 11 and 0"
    exit 1
  fi
  echo "✓ should-build self-test: $pass cases"
  exit 0
fi

# 🔴 CAMP-286: a flag this script does not know is an error with a name
# on it. `--selftest` used to reach `decide` as the EVENT, and the run
# died on `${2:?repository}` — non-zero, but for the wrong reason and
# with a message about a repository nobody was missing.
case "${1:-}" in
  -*)
    echo "::error::should-build.sh: unknown flag '$1'. It takes --self-test," >&2
    echo "  or the five positional arguments event/repo/sha/head/base." >&2
    exit 2
    ;;
esac

decide "${1:?event}" "${2:?repository}" "${3:?sha}" "${4:-}" "${5:-}"
