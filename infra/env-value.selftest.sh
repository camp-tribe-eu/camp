#!/usr/bin/env bash
# Self-test для infra/lib/env-value.sh (CAMP-349).
#
# 🔴 ГОЛОВНИЙ ВИПАДОК — НЕ «ЧИ ПРОЧИТАЛО», А «ЧИ НЕ ВИКОНАЛО». Значення
# з `$(…)` мусить повернутись текстом, а слід від виконання — не
# зʼявитись. Читач, який правильно віддає прості значення й виконує
# складні, виглядає робочим рівно до того пароля, який його зламає.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/env-value.sh
. "$HERE/lib/env-value.sh"
EXPECTED=26

W="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-envval.XXXXXX")"
trap 'rm -rf "$W"' EXIT
F="$W/.env"

PASS=0; FAIL=0; RAN=0
ok() {
  RAN=$((RAN + 1))
  if [ "$1" = 0 ]; then PASS=$((PASS + 1)); echo "  ✓ $2"
  else FAIL=$((FAIL + 1)); echo "  ✗ $2"; [ -n "${3:-}" ] && echo "      $3"; fi
}
eq() { [ "$1" = "$2" ]; }

echo '— звичайне читання'
printf 'A=1\nB=two\n' > "$F"
eq "$(env_value "$F" A)" 1; ok $? 'простий ключ' "$(env_value "$F" A)"
eq "$(env_value "$F" B)" two; ok $? 'другий ключ' "$(env_value "$F" B)"
env_value "$F" NEMA >/dev/null 2>&1; [ $? = 1 ]; ok $? 'ключа немає — код 1'
env_value "$W/nope" A >/dev/null 2>&1; [ $? = 1 ]; ok $? 'файла немає — код 1'

echo '— 🔴 символи, через які все й зламалось'
for v in 'GYN6!)G;pB3*8a3]:vu' 'a b c' 'має(дужки)' 'крапка;з;комою' 'амперсанд&і&ще' 'зворотна\риска' 'відсоток%s' '*зірочка*' 'труба|всередині' 'знак<більше>'; do
  printf 'K=%s\n' "$v" > "$F"
  eq "$(env_value "$F" K)" "$v"; ok $? "значення «$v» віддано дослівно" "отримав: $(env_value "$F" K)"
done

echo '— 🔴 ГОЛОВНЕ: підстановка НЕ виконується'
MARK="$W/виконалось"
printf 'K=$(touch %s)значення\n' "$MARK" > "$F"
got="$(env_value "$F" K)"
{ [ ! -e "$MARK" ] && eq "$got" "\$(touch $MARK)значення"; }
ok $? '🔴 $( ) повернуто текстом, файл-слід НЕ створено' "слід=$([ -e "$MARK" ] && echo є || echo нема), got=$got"
printf 'K=`touch %s`значення\n' "$MARK" > "$F"
got="$(env_value "$F" K)"
{ [ ! -e "$MARK" ] && eq "$got" "\`touch $MARK\`значення"; }
ok $? '🔴 зворотні лапки теж не виконались' "слід=$([ -e "$MARK" ] && echo є || echo нема)"
printf 'K=${HOME}/далі\n' > "$F"
eq "$(env_value "$F" K)" '${HOME}/далі'; ok $? '🔴 ${HOME} не розгорнуто' "$(env_value "$F" K)"

echo '— лапки, як у systemd'
printf "K='у лапках'\n" > "$F"
eq "$(env_value "$F" K)" 'у лапках'; ok $? "одинарні лапки знято" "$(env_value "$F" K)"
printf 'K="у подвійних"\n' > "$F"
eq "$(env_value "$F" K)" 'у подвійних'; ok $? 'подвійні лапки знято' "$(env_value "$F" K)"
printf "K=не'посередині'лапки\n" > "$F"
eq "$(env_value "$F" K)" "не'посередині'лапки"; ok $? '🔴 лапки посеред значення лишаються' "$(env_value "$F" K)"

echo '— форма файла'
printf '# K=закоментовано\nK=справжнє\n' > "$F"
eq "$(env_value "$F" K)" 'справжнє'; ok $? 'закоментований рядок пропущено' "$(env_value "$F" K)"
printf 'export K=через-export\n' > "$F"
eq "$(env_value "$F" K)" 'через-export'; ok $? '`export KEY=` приймається' "$(env_value "$F" K)"
printf 'K=перше\nK=останнє\n' > "$F"
eq "$(env_value "$F" K)" 'останнє'; ok $? 'при повторі виграє останній' "$(env_value "$F" K)"
printf 'K=має=знак=рівності\n' > "$F"
eq "$(env_value "$F" K)" 'має=знак=рівності'; ok $? 'знак рівності у значенні збережено' "$(env_value "$F" K)"
printf 'KK=не-той\nK=той\n' > "$F"
eq "$(env_value "$F" K)" 'той'; ok $? '🔴 KK не сходить за K' "$(env_value "$F" K)"
printf 'K=з-віндовс\r\n' > "$F"
eq "$(env_value "$F" K)" 'з-віндовс'; ok $? 'CR у кінці зрізано' "$(env_value "$F" K)"

echo
if [ "$RAN" != "$EXPECTED" ]; then echo "✗ виконано $RAN випадків, очікувалось $EXPECTED" >&2; exit 1; fi
if [ "$FAIL" != 0 ]; then echo "env-value self-test: $PASS пройшло, $FAIL впало" >&2; exit 1; fi
echo "env-value self-test: усе гаразд, $RAN випадків"
