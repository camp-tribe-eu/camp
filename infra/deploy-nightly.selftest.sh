#!/usr/bin/env bash
# Self-test для infra/bin/camptribe-deploy-nightly.
#
# 🔴 ПЕРШЕ ПИТАННЯ — «ЧИ БУДУЄТЬСЯ, КОЛИ НЕ ТРЕБА». Таймер, що збирає 8,6 ГБ
# щоночі «про всяк випадок», виглядає справним рівно до першого простою
# сайту посеред дня. Тому «main не змінився» перевіряється свідком, який
# НЕ ДЕПЛОЇТЬ: підмінений `camptribe-deploy` пише кожен виклик у журнал, і
# тест читає журнал, а не вивід скрипта (вивід може сказати «не будую» і
# все одно викликати).
#
# Справжні: git, jq, сам скрипт, справжній (локальний) репозиторій і справжня
# тека релізів із симлінком. Підмінено лише `camptribe-deploy`.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NIGHTLY="$HERE/bin/camptribe-deploy-nightly"
EXPECTED=30

W="$(mktemp -d "${TMPDIR:-/tmp}/camptribe-nightly.XXXXXX")"
trap 'rm -rf "$W"' EXIT

PASS=0; FAIL=0; RAN=0
ok() {
  RAN=$((RAN + 1))
  if [ "$1" = 0 ]; then PASS=$((PASS + 1)); echo "  ✓ $2"
  else FAIL=$((FAIL + 1)); echo "  ✗ $2"; [ -n "${3:-}" ] && echo "      $3"; fi
}
eq() { [ "$1" = "$2" ]; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

# ── світ: «GitHub», машина, підмінений деплой ───────────────────────────
ORIGIN="$W/origin.git"
SRC="$W/src"
git init -q --bare -b main "$ORIGIN"
git init -q -b main "$SRC"
git -C "$SRC" remote add origin "$ORIGIN"
echo one > "$SRC/f"; git -C "$SRC" add f; git -C "$SRC" commit -q -m one
git -C "$SRC" push -q origin main
SHA1="$(git -C "$SRC" rev-parse HEAD)"
echo two > "$SRC/f"; git -C "$SRC" commit -q -am two
git -C "$SRC" push -q origin main
SHA2="$(git -C "$SRC" rev-parse HEAD)"

MROOT="$W/srv"
mkdir -p "$MROOT/releases/${SHA1:0:7}"
ln -s "releases/${SHA1:0:7}" "$MROOT/current"
printf '{"sha":"%s"}\n' "$SHA1" > "$MROOT/releases/${SHA1:0:7}/RELEASE.json"

CALLS="$W/calls.log"
STUB="$W/camptribe-deploy"
cat > "$STUB" <<'EOS'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CALLS"
exit "${STUB_RC:-0}"
EOS
chmod +x "$STUB"

# run <REPO> — повертає код у RC, вивід у OUT; журнал викликів очищено.
run() {
  : > "$CALLS"
  OUT="$(CAMPTRIBE_ROOT="$MROOT" CAMPTRIBE_REPO="${1:-$ORIGIN}" CAMPTRIBE_DEPLOY_BIN="${DEPLOY_BIN:-$STUB}" \
         STUB_CALLS="$CALLS" STUB_RC="${STUB_RC:-0}" CAMPTRIBE_FETCH_TIMEOUT=20 \
         "$NIGHTLY" 2>&1)"
  RC=$?
}
calls() { grep -c . "$CALLS" 2>/dev/null || true; }

echo '— 🔴 main НЕ змінився: жодного деплою'
printf '{"sha":"%s"}\n' "$SHA2" > "$MROOT/releases/${SHA1:0:7}/RELEASE.json"
run
eq "$RC" 0; ok $? 'код 0' "код=$RC; $OUT"
eq "$(calls)" 0; ok $? '🔴 camptribe-deploy НЕ викликано (журнал порожній)' "викликів=$(calls)"
echo "$OUT" | grep -q 'збірку не починаю'; ok $? 'сказано словами, що нічого не робить' "$OUT"
printf '{"sha":"%s"}\n' "$SHA1" > "$MROOT/releases/${SHA1:0:7}/RELEASE.json"

echo '— 🔴 main змінився: деплой запущено, і саме такий'
run
eq "$RC" 0; ok $? 'код 0' "код=$RC; $OUT"
eq "$(calls)" 1; ok $? 'camptribe-deploy викликано рівно раз' "викликів=$(calls)"
eq "$(cat "$CALLS")" "deploy --sha $SHA2 --ref main --apply --deployer nightly-timer"
ok $? '🔴 аргументи: повний SHA нового main, --ref main, --apply' "$(cat "$CALLS")"
! grep -q -- '--migrate' "$CALLS"; ok $? '🔴 --migrate НЕ передано ніколи' "$(cat "$CALLS")"
grep -q -- '--apply' "$CALLS"; ok $? '--apply є (без нього deploy лише показує план)' "$(cat "$CALLS")"

echo '— код виходу деплою не губиться'
STUB_RC=3 run
eq "$RC" 3; ok $? 'автовідкат (3) проходить нагору як 3' "код=$RC"
STUB_RC=4 run
eq "$RC" 4; ok $? 'стан невідомий (4) проходить нагору як 4' "код=$RC"
STUB_RC=1 run
eq "$RC" 1; ok $? 'зупинка до перемикання (1) проходить нагору' "код=$RC"
unset STUB_RC

echo '— 🔴 відкат не скасовується сам'
HIST="$MROOT/deploy-history.jsonl"
printf '{"action":"deploy","from":"aaaaaaa","to":"%s","ok":true}\n{"action":"rollback","from":"%s","to":"aaaaaaa","ok":true}\n' "${SHA2:0:7}" "${SHA2:0:7}" > "$HIST"
run
eq "$RC" 1; ok $? 'останній крок — відкат З релізу, що є main: код 1' "код=$RC; $OUT"
eq "$(calls)" 0; ok $? '🔴 …і деплою немає' "викликів=$(calls)"
echo "$OUT" | grep -q 'скасувати rollback'; ok $? '…і сказано, чому' "$OUT"
printf '{"action":"switch","from":"%s","to":"aaaaaaa","ok":true}\n' "${SHA2:0:7}" > "$HIST"
run
eq "$(calls)" 0; ok $? 'ручне switch З цього релізу — теж утримує' "викликів=$(calls)"
printf '{"action":"rollback","from":"ccccccc","to":"aaaaaaa","ok":true}\n' > "$HIST"
run
eq "$(calls)" 1; ok $? 'відкат З ІНШОГО релізу (main пішов уперед) — не утримує' "викликів=$(calls)"
printf '{"action":"rollback","from":"%s","to":"aaaaaaa","ok":true}\n{"action":"deploy","from":"aaaaaaa","to":"ddddddd","ok":true}\n' "${SHA2:0:7}" > "$HIST"
run
eq "$(calls)" 1; ok $? 'після відкату був новий успішний деплой — не утримує' "викликів=$(calls)"
printf '{"action":"rollback","from":"%s","to":"aaaaaaa","ok":true}\n{"action":"revert","from":"x","to":"y","ok":true}\n' "${SHA2:0:7}" > "$HIST"
run
eq "$(calls)" 0; ok $? '`revert` в історії не стирає відкат (як у hist_last_ok)' "викликів=$(calls)"
rm -f "$HIST"

echo '— 🔴 «не знаю» не дорівнює «не змінилось»'
run "$W/нема-такого-репозиторію.git"
{ [ "$RC" != 0 ] && [ "$(calls)" = 0 ]; }; ok $? 'репозиторій недосяжний: помилка, деплою немає' "код=$RC; викликів=$(calls)"
git init -q --bare -b other "$W/empty.git"
run "$W/empty.git"
{ [ "$RC" != 0 ] && [ "$(calls)" = 0 ]; }; ok $? '🔴 у репозиторії немає main (ls-remote мовчить з кодом 0): помилка' "код=$RC; викликів=$(calls)"
mv "$MROOT/current" "$MROOT/current.off"
run
{ [ "$RC" != 0 ] && [ "$(calls)" = 0 ]; }; ok $? 'немає current — не знаю, що на проді: помилка, деплою немає' "код=$RC; викликів=$(calls)"
mv "$MROOT/current.off" "$MROOT/current"
mv "$MROOT/releases/${SHA1:0:7}/RELEASE.json" "$W/RELEASE.bak"
run
{ [ "$RC" != 0 ] && [ "$(calls)" = 0 ]; }; ok $? 'ні маніфесту, ні .git у релізі — помилка, деплою немає' "код=$RC; викликів=$(calls)"
git -C "$MROOT/releases/${SHA1:0:7}" init -q
git -C "$MROOT/releases/${SHA1:0:7}" fetch -q "$ORIGIN" "$SHA2" && git -C "$MROOT/releases/${SHA1:0:7}" checkout -q --detach FETCH_HEAD
run
{ [ "$RC" = 0 ] && [ "$(calls)" = 0 ]; }; ok $? 'реліз без маніфесту: SHA береться з .git, main збігається — нічого не робить' "код=$RC; викликів=$(calls)"
rm -rf "$MROOT/releases/${SHA1:0:7}/.git"; mv "$W/RELEASE.bak" "$MROOT/releases/${SHA1:0:7}/RELEASE.json"
DEPLOY_BIN="$W/нема-деплою" run
{ [ "$RC" != 0 ] && [ "$(calls)" = 0 ]; }; ok $? 'main змінився, а camptribe-deploy немає: помилка' "код=$RC"
unset DEPLOY_BIN

echo '— самі юніти'
SVC="$HERE/systemd/camptribe-deploy-nightly.service"
TMR="$HERE/systemd/camptribe-deploy-nightly.timer"
# Рядки без коментарів: у коментарях слово «--migrate» стоїть навмисно.
active() { grep -v '^[[:space:]]*#' "$1"; }
active "$SVC" | grep -q '^ExecStart=/usr/local/bin/camptribe-deploy-nightly$'
ok $? 'ExecStart веде на скрипт, без аргументів' "$(active "$SVC" | grep ExecStart)"
{ active "$SVC" | grep -q '^OnFailure=camptribe-failed@%n.service$' && active "$SVC" | grep -q '^ExecStartPost=/bin/rm -f /srv/camptribe/failed/camptribe-deploy-nightly.service$'; }
ok $? 'падіння лишає слід, успіх його знімає' ""
! active "$SVC" | grep -qE 'migrate|EnvironmentFile|Environment=.*(KEY|TOKEN|SECRET|PASSWORD)'
ok $? '🔴 у юніті немає --migrate, EnvironmentFile і секретів' ""
H="$(active "$TMR" | sed -n 's/^OnCalendar=\*-\*-\* \([0-9][0-9]\):00:00 UTC$/\1/p')"
{ [ -n "$H" ] && [ "$((10#$H))" -ge 12 ]; }
ok $? "🔴 час деплою ${H:-?}:00 UTC — після найпізнішого заміряного старту data-refresh (10:57 UTC)" "OnCalendar: $(active "$TMR" | grep OnCalendar)"
active "$TMR" | grep -q '^Persistent=true$'; ok $? 'Persistent=true' ""
[ "$(active "$TMR" | grep -c '^OnCalendar=')" = 1 ]; ok $? 'рівно один OnCalendar — один деплой на добу' ""

echo
echo "виконано $RAN з $EXPECTED, зелених $PASS, червоних $FAIL"
if [ "$RAN" != "$EXPECTED" ]; then echo "✗ очікувалось $EXPECTED випадків, виконано $RAN"; exit 1; fi
[ "$FAIL" = 0 ] || exit 1
echo "deploy-nightly self-test: усе гаразд ($RAN)"
