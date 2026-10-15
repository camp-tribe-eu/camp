#!/usr/bin/env bash
# CampTribe — вимикач відкриття З НОУТБУКА (CAMP-322).
#
#   CAMPTRIBE_HOST=root@… ./infra/launch-switch.sh status
#   CAMPTRIBE_HOST=root@… ./infra/launch-switch.sh env --public --apply
#   CAMPTRIBE_HOST=root@… ./infra/launch-switch.sh open  [--apply]
#   CAMPTRIBE_HOST=root@… ./infra/launch-switch.sh close [--apply]
#   CAMPTRIBE_HOST=root@… ./infra/launch-switch.sh install [--apply]
#
# Кладе на машину РІВНО `infra/bin/camptribe-launch` з коміта, який ти
# переглянув, і запускає там. Встановлена копія не може розійтись із
# репозиторієм, бо її немає: файл щоразу новий і після виходу стирається.
#
# `install` — окремо: кладе в /etc/caddy конфіг сайту й обидві половинки
# замка з `infra/caddy/`, не чіпаючи ні gate.conf, ні справжній
# gate-closed.conf (у ньому хеш пароля, якого в репозиторії немає).
#
# Порядок відкриття — у docs/launch-switch.md. Коротко: env → викладка →
# open. Кроки 1 і 3 без кроку 2 між ними не працюють.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXECUTOR="$REPO_ROOT/infra/bin/camptribe-launch"
CADDY_SRC="$REPO_ROOT/infra/caddy"
HOST="${CAMPTRIBE_HOST:?задай CAMPTRIBE_HOST=root@… — адреси машини в репозиторії немає навмисно}"
KEY="${CAMPTRIBE_KEY:-$HOME/.ssh/id_ed25519_camptribe_server}"
REMOTE_TMP="${CAMPTRIBE_REMOTE_TMP:-/tmp}"

die() { printf '✗ %s\n' "$*" >&2; exit 1; }
ssh_() { ssh -i "$KEY" -o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=15 "$HOST" "$@"; }

[ $# -ge 1 ] || die 'потрібна команда: status | env | open | close | install'
bash -n "$EXECUTOR" || die "у $EXECUTOR синтаксична помилка — на машину не кладу"

if [ "$1" = install ]; then
  shift; apply=0
  for a in "$@"; do [ "$a" = --apply ] && apply=1 || die "невідомий прапорець: $a"; done
  for f in camptribe.eu.caddyfile gate-open.conf gate-closed.conf.example; do
    [ -f "$CADDY_SRC/$f" ] || die "немає $CADDY_SRC/$f"
  done
  if [ "$apply" != 1 ]; then
    echo 'СУХИЙ ПРОГІН — нічого не змінено. Поклав би в /etc/caddy:'
    echo '  Caddyfile              ← infra/caddy/camptribe.eu.caddyfile'
    echo '  gate-open.conf         ← infra/caddy/gate-open.conf'
    echo '  gate-closed.conf.example'
    echo 'НЕ чіпав би: gate.conf (симлінк стану) і gate-closed.conf (у ньому хеш).'
    exit 0
  fi
  # 🔴 ЦЕ СТОСУЄТЬСЯ ЛИШЕ Caddyfile: він лягає поруч як `.new`, проходить
  # validate і лише тоді стає на місце, тож конфіг, який не валідується,
  # не буває чинним навіть мить. Дві половинки замка кладуться ДО того —
  # і це навмисно й безпечно: `gate-open.conf` нічого не робить, доки
  # `gate.conf` на нього не показує (а його цей крок не чіпає), а
  # `gate-closed.conf.example` взагалі ніким не імпортується. Рецензія
  # слушно зауважила, що попереднє формулювання обіцяло більше, ніж код
  # робить: воно звучало як гарантія на всі три файли.
  tar -C "$CADDY_SRC" -cf - camptribe.eu.caddyfile gate-open.conf gate-closed.conf.example \
    | ssh_ 'set -e; d=$(mktemp -d /tmp/camptribe-caddy.XXXXXX); tar -C "$d" -xf -;
            install -m 0644 "$d/gate-open.conf" /etc/caddy/gate-open.conf;
            install -m 0644 "$d/gate-closed.conf.example" /etc/caddy/gate-closed.conf.example;
            cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)";
            install -m 0644 "$d/camptribe.eu.caddyfile" /etc/caddy/Caddyfile.new;
            [ -e /etc/caddy/gate.conf ] || { echo "немає /etc/caddy/gate.conf — спершу створи симлінк на gate-closed.conf" >&2; exit 1; };
            caddy validate --config /etc/caddy/Caddyfile.new >/dev/null \
              || { echo "новий Caddyfile не проходить validate — лишаю чинний" >&2; rm -f /etc/caddy/Caddyfile.new; exit 1; };
            mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile;
            caddy reload --config /etc/caddy/Caddyfile >/dev/null;
            rm -rf "$d"; echo "✓ /etc/caddy оновлено й перечитано"'
  exit 0
fi

remote="$(ssh_ "f=\$(mktemp $REMOTE_TMP/camptribe-launch.XXXXXX) && cat > \"\$f\" && chmod 700 \"\$f\" && echo \"\$f\"" < "$EXECUTOR")" \
  || die 'не вдалось покласти виконавця на машину'
[ -n "$remote" ] || die 'машина не назвала шлях до виконавця'
trap 'ssh_ rm -f "$remote" >/dev/null 2>&1 || true' EXIT

quoted=""
for a in "$@"; do quoted+=" $(printf '%q' "$a")"; done
set +e
ssh_ "bash $remote$quoted"
exit $?
