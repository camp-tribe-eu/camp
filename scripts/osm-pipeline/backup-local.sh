#!/usr/bin/env bash
# Back up the part of the database that cannot be rebuilt — and, since
# CAMP-386, the whole database beside it.
#
#   ./scripts/osm-pipeline/backup-local.sh backup  [DIR]
#   ./scripts/osm-pipeline/backup-local.sh verify   DIR
#   ./scripts/osm-pipeline/backup-local.sh restore  DIR   # CSV, злиттям
#   ./scripts/osm-pipeline/backup-local.selftest.sh       # дамп і замок на ньому
#
# Повне відновлення з дампа — руками й ТІЛЬКИ в порожню базу, бо це не
# злиття, а заміна (рівно цю команду ганяє selftest і backup-verify.yml):
#
#   createdb camptribe_restored
#   pg_restore --no-owner --exit-on-error -d camptribe_restored DIR/camptribe.dump
#
# 🔴 Дві половини, і жодна не замінює другу (CAMP-386).
#
# До 22.10.2026 тут стояло «Why this is not pg_dump»: більшість бази —
# копія OpenStreetMap, яку Geofabrik і так тримає, а щотижневий імпорт
# відбудовує. Це досі правда, і саме тому CSV лишаються: вони возять
# лише те, чого нізвідки не завантажити, і відновлюються ВИБІРКОВО —
# злиттям, яке не затирає новішу роботу (див. do_restore).
#
# Але «все інше відбудується» мовчки припускало, що все інше — це OSM.
# Заміряно власником 22.10.2026 на свіжому знімку проду: 208 обʼєктів
# directus_* — колекції, поля, звʼязки, флоу, операції, користувачі,
# ролі, політики, права і НАЛАШТУВАННЯ, — і жодного з них у восьми CSV
# не було. `grep -c -i directus backup-local.sh` давав 0.
#
# Найдорожче — directus_settings.project_id. Активація ліцензії Directus
# привʼязана до пари project_id + PUBLIC_URL
# (@directus/api/dist/license/manager.js:209); активацій пʼять, і
# спалений слот не повертають. Сценарій: база втрачена → контент
# відновлено з CSV → Directus згенерував НОВИЙ project_id → стара
# активація тримає слот назавжди. Бекап рятував контент і не рятував
# те, без чого адмінка не запуститься.
#
# Тому поруч із CSV лягає повний `pg_dump -Fc` (camptribe.dump): DDL,
# directus_*, усе. Не замість CSV — з дампа не зіллєш учорашній контекст
# у сьогоднішню базу, не затерши її, — а на другу аварію, «бази немає
# взагалі». І `verify` перевіряє його ВМІСТ, а не наявність:
# `pg_restore -l` мусить показати TABLE DATA для directus_settings і
# directus_flows, інакше це не знімок (див. verify_dump).
#
# What the CSV half carries — what cannot be downloaded again:
#
#   camping_spots.context       what is AROUND each campsite — the water,
#                               the town, the elevation, the terrain. It
#                               is computed by us, and the elevation half
#                               comes from Open-Meteo, whose free tier is
#                               rationed by COORDINATE per day, not by
#                               request. Measured on 23.09.2026: a day's
#                               allowance moved 6 campsites of the 778 in
#                               Croatia. Rebuilding the 289 we already
#                               hold is weeks; rebuilding Europe is not a
#                               plan, it is a year.
#
#   camping_spots.owner_overrides  corrections a human typed. Not
#                               expensive to rebuild — impossible. There
#                               is no source to rebuild them from.
#
#   reviews, photo_submissions  the same, from the public.
#   guides, routes              our own writing.
#
#   missing_since,              when we first and last saw a site. Lose
#   content_changed_at          it and every campsite looks new today,
#                               which resets the "gone" logic and every
#                               sitemap date at once.
#
# All of that is currently about 120 kB, and it lives in exactly one
# place: this laptop. That is the whole argument for this file. Keeping
# the database locally is fine and costs nothing — what is not fine is
# one copy of the only thing we cannot download again.

set -euo pipefail

# 🔴 Корінь рахуємо ДО `cd`, бо після нього `$0` вже відносний і
# `dirname "$0"` вказує не туди. Рецензія заміряла: виклик
# `./backup-local.sh` із власної теки скрипта давав
# `./../../infra/lib/env-value.sh: No such file or directory`.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# 🔴 An explicit DATABASE_URL wins, and the .env is only a fallback.
#
# Written as an `if` rather than `[ -f … ] && …` because under `set -e` a
# false test at the top level ends the script: with no apps/api/.env — CI,
# or a fresh clone — the whole thing would have exited 0 having done
# nothing, which is the quietest possible way for a backup to fail.
#
# 🔴 ЧИТАЄМО, А НЕ ВИКОНУЄМО. Тут стояло `set -a; . apps/api/.env`, і
# 17.10.2026 у файлі зʼявився пароль із `)`. Читання почало падати з
# `syntax error near unexpected token ')'`, і бекап не робився ТРИ НОЧІ,
# поки сайт працював — бо systemd читає той самий файл через
# `EnvironmentFile=`, а воно не оболонка. Формат `.env` ніколи й не був
# шел-скриптом; ним його зробили ми (CAMP-349).
if [ -z "${DATABASE_URL:-}" ] && [ -f apps/api/.env ]; then
  # shellcheck source=../../infra/lib/env-value.sh
  . "$REPO_ROOT/infra/lib/env-value.sh" \
    || { echo "немає $REPO_ROOT/infra/lib/env-value.sh — читати .env нічим" >&2; exit 1; }
  DATABASE_URL="$(env_value apps/api/.env DATABASE_URL || true)"
fi
DB="${DATABASE_URL:-postgres://localhost:5432/camptribe_dev}"

# 🔴 Default OUTSIDE the repository. The repository is public: a backup
# written into the working tree is one `git add .` away from publishing
# every review and every correction we hold. The .gitignore entry is the
# second line of that defence, not the first.
DEFAULT_DIR="$HOME/CampTribe-backups/$(date -u +%Y-%m-%d)"

# 🔴 Parents first, and children INCLUDED — both were wrong before.
#
# The list used to be reviews, photo_submissions, guides, routes. Two of
# those are shells: a guide's text lives in `guide_translations` and a
# route's line lives in `route_points`, and neither was backed up.
# Measured 24.09.2026: 36 guides, 36 translations, none of the text
# saved. Restoring that backup would have produced thirty-six empty
# guides and called it a success.
#
# Found by the nightly rehearsal (CAMP-58) failing to TRUNCATE `guides`
# because of a foreign key — the error that exposed the missing child was
# the one the test tripped over on the way to something else.
#
# Order matters now, because restore inserts in this order and a child
# cannot land before its parent.
#
# ⚠️ Still open, deliberately: `rental_cities`, `camper_types` and their
# translations are our own editorial data too, and empty today. They go
# in the day they carry anything, and that day should not be discovered
# the same way this was.
TABLES=(
  "guides"
  "guide_translations"
  "routes"
  "route_points"
  "legal_pages"
  "legal_page_translations"
  "reviews"
  "photo_submissions"
)

SPOTS_COLUMNS="osm_ref, context, context_computed_at, owner_overrides, missing_since, content_changed_at"

# 🔴 Імʼя дампа й те, без чого він не вважається дампом (CAMP-386).
# Обидві таблиці мусять стояти в TOC як TABLE DATA: рядок
# directus_settings несе project_id, до якого привʼязана активація
# ліцензії; directus_flows — автоматизації, яких адмінка не відбудує.
# Перевіряється саме TABLE DATA, а не TABLE: дамп зі схемою й без рядків
# (`--schema-only`) має TABLE і теж нічого не рятує.
DUMP_NAME="camptribe.dump"
DUMP_MUST_CARRY=(directus_settings directus_flows)

say() { printf '%s\n' "$*" >&2; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

rows_in_gz() {
  # Rows in a CSV with a header — the header is not a row.
  local n
  n=$(gzip -dc "$1" | wc -l | tr -d ' ')
  echo $(( n > 0 ? n - 1 : 0 ))
}

table_exists() {
  psql "$DB" -tAc "SELECT to_regclass('public.$1') IS NOT NULL"
}

# --------------------------------------------------------------------
# Повний дамп бази поруч із CSV (CAMP-386). Чому саме так — у шапці.
# Підхід той самий, що в `camptribe-cms snapshot_db`: там цей дамп із
# перевіркою вмісту вже стоїть перед міграцією схеми.
dump_db() {
  local dir="$1" dump="$1/$DUMP_NAME" mode
  say "→ pg_dump -Fc → ${DUMP_NAME}"
  # 🔴 umask У ПІДОБОЛОНЦІ: дамп несе хеші паролів directus_users, токени
  # сесій і license_token. Без umask він лягає з правами виклику —
  # у snapshot_db заміряно `-rw-r--r--`, тобто читати міг будь-хто на
  # машині. Пароль НЕ експортується: pg_dump дістає DATABASE_URL
  # аргументом, рівно як кожен psql у цьому файлі (і так само видний у
  # `ps` — self-check №12; не ширше, ніж було).
  ( umask 077; pg_dump -Fc -d "$DB" -f "$dump" ) \
    || { rm -f "$dump"; die "pg_dump не вдався — зріз без дампа не вважається зробленим"; }
  # 🔴 ПРАВА ЧИТАЄМО ПІСЛЯ ЗАПИСУ, А НЕ ВИВОДИМО З umask. Заміряно
  # 22.10.2026: `pg_dump -f` у файл, що ВЖЕ лежав із 0644, лишає 0644 —
  # umask діє лише на створення файлу. «umask стоїть» ≠ «дамп закритий».
  # Такий дамп не лишаємо: з хешами паролів йому не можна лежати ні
  # ночі; CSV поруч цілі, а попередні зрізи — на місці.
  mode="$(ls -l "$dump" | cut -c1-10)"
  case "$mode" in
    -rw-------) : ;;
    *) rm -f "$dump"
       die "дамп ліг із правами ${mode}, а не -rw------- — прибрав, бо з хешами паролів так лежати не можна" ;;
  esac
}

# 🔴 ФАЙЛ Є ≠ ЗНІМОК Є. Перевіряємо ВМІСТ: TOC дампа мусить мати
# TABLE DATA для кожної таблиці з DUMP_MUST_CARRY. Перевірка, що дивиться
# на наявність файлу, — той самий дефект, що й до картки, лише з новим
# імʼям: дамп, зроблений із `-T 'directus_*'`, існує, має правильну суму
# й нічого не рятує. Повертає 1, а не вбиває: do_verify збирає всі
# відмови разом, щоб людина побачила їх за один прогін.
#
# 🔴 ДВА СТАНИ — ДВА ПРИСУДИ (рецензія PR #318). Перша редакція падала й
# тоді, коли ключа "dump" у маніфесті НЕМАЄ ВЗАГАЛІ — а це кожен зріз,
# зроблений до CAMP-386, тобто всі 14 тек на машині в день викатки.
# `restore` починається з `verify`, отже два тижні не можна було б
# відновити CSV з ЖОДНОГО наявного бекапу: сторож забороняв відновлення
# заради відновлення — площа ураження більша за дефект, який він ловить.
#
#   (а) ключа "dump" немає → старий зріз: попередити голосно, повернути 0.
#       CSV-половина ціла, контент відновлюється; directus_* — ні.
#   (б) ключ є, а дамп не такий (немає файла, сума розійшлась, не
#       читається, бракує TABLE DATA) → тверда відмова, як і була.
#
# Чому (а) безпечно: НОВИЙ зріз без ключа неможливий — dump_db вбиває
# прогін, якщо pg_dump не вдався, а маніфест пишеться після нього. Тож
# відсутність ключа означає «старий зріз», а не «дамп тихо зник». А щоб
# це лишалось правдою й після чиєїсь правки маніфесту, `backup` звіряє
# щойно записаний зріз у режимі fresh, де (а) — теж відмова.
verify_dump() {
  local dir="$1" mode="${2:-}" line file want dump got toc n t total rc=0
  # 🔴 Маніфест читаємо так само, як CSV-половину: збій читання — це
  # відмова, а не «нічого не перевірили». Код 3 зарезервовано під
  # «ключа немає», щоб відрізнити його від зіпсованого маніфесту.
  line=$(python3 -c '
import json, sys
m = json.load(open(sys.argv[1]))
if "dump" not in m:
    sys.exit(3)
d = m["dump"]
if not isinstance(d, dict) or not d.get("file") or not d.get("sha256"):
    sys.exit("manifest names a dump without file or sha256")
print("\t".join([d["file"], d["sha256"]]))
' "$dir/manifest.json" 2>/dev/null) || rc=$?
  if [ "$rc" = 3 ]; then
    if [ "$mode" = fresh ]; then
      say "  ✗ щойно записаний маніфест не називає дампа — новий зріз без дампа не зараховується"
      return 1
    fi
    say "  ⚠ зріз зроблено до CAMP-386: повного дампа в ньому немає, тож"
    say "    directus_* із нього не відновити. CSV-половина ціла — відновлення"
    say "    контенту працює. Зроби новий backup, щоб мати повне покриття."
    return 0
  elif [ "$rc" != 0 ]; then
    say "  ✗ manifest.json називає дамп без імені чи суми — зріз не звіряється"
    return 1
  fi
  IFS=$'\t' read -r file want <<< "$line"
  # Імʼя з файла в теці бекапу підставляється в шлях — не даємо йому
  # вийти за теку, як check-restore.mjs не дає імені таблиці вийти в SQL.
  case "$file" in
    ''|*/*|.*) say "  ✗ маніфест називає дамп «${file}» — це не імʼя файла в теці"; return 1 ;;
  esac
  dump="$dir/$file"
  [ -f "$dump" ] || { say "  ✗ $file is missing"; return 1; }
  got=$(sha "$dump")
  [ "$got" = "$want" ] || { say "  ✗ $file has changed since it was written"; return 1; }
  # 🔴 У змінну, а не в конвеєр: pg_restore, що не зміг прочитати файл,
  # мусить ЗУПИНИТИ перевірку, а не віддати grep порожнечу й нуль.
  toc=$(pg_restore -l "$dump" 2>&1) \
    || { say "  ✗ pg_restore -l не читає ${file} — це не дамп: ${toc}"; return 1; }
  for t in "${DUMP_MUST_CARRY[@]}"; do
    n=$(grep -cE " TABLE DATA [^ ]+ ${t} " <<< "$toc" || true)
    if [ "${n:-0}" -lt 1 ]; then
      say "  ✗ у дампі немає TABLE DATA для ${t} — він не покриває те, заради чого робиться"
      return 1
    fi
  done
  total=$(grep -c ' directus_' <<< "$toc" || true)
  say "  ✓ $file — ${total} обʼєктів directus_*, серед них TABLE DATA для ${DUMP_MUST_CARRY[*]}"
}

# --------------------------------------------------------------------
do_backup() {
  local dir="${1:-$DEFAULT_DIR}"
  mkdir -p "$dir"
  say "→ $dir"

  # The spots are a projection, not the whole table: everything else in
  # camping_spots comes back from the next OSM import.
  psql "$DB" -c "\\copy (SELECT $SPOTS_COLUMNS FROM camping_spots WHERE context <> '{}'::jsonb OR owner_overrides <> '{}'::jsonb OR missing_since IS NOT NULL) TO STDOUT WITH CSV HEADER" \
    | gzip -9 > "$dir/camping_spots_context.csv.gz"

  for t in "${TABLES[@]}"; do
    if [ "$(table_exists "$t")" != 't' ]; then
      say "  · $t does not exist yet — skipped"
      continue
    fi
    psql "$DB" -c "\\copy (SELECT * FROM $t) TO STDOUT WITH CSV HEADER" \
      | gzip -9 > "$dir/$t.csv.gz"
  done

  # CAMP-386: повний дамп — ДО маніфесту, бо маніфест несе його суму.
  dump_db "$dir"

  # A manifest so `verify` has something to check against, and so a
  # human opening the folder in a year can tell what it is.
  {
    printf '{\n  "takenAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    # 🔴 Дамп — окремим ключем, не в "files": "files" читає
    # check-restore.mjs як «таблиця → рядки» й підставляє імʼя в SQL.
    printf '  "dump": { "file": "%s", "bytes": %s, "sha256": "%s" },\n' \
      "$DUMP_NAME" "$(wc -c < "$dir/$DUMP_NAME" | tr -d ' ')" "$(sha "$dir/$DUMP_NAME")"
    printf '  "files": {\n'
    local first=1
    for f in "$dir"/*.csv.gz; do
      [ "$first" = 1 ] || printf ',\n'
      first=0
      printf '    "%s": { "rows": %s, "sha256": "%s" }' \
        "$(basename "$f")" "$(rows_in_gz "$f")" "$(sha "$f")"
    done
    printf '\n  }\n}\n'
  } > "$dir/manifest.json"

  say ""
  for f in "$dir"/*.csv.gz; do
    printf '  %-32s %6s rows  %s\n' "$(basename "$f")" "$(rows_in_gz "$f")" \
      "$(du -h "$f" | awk '{print $1}')" >&2
  done
  printf '  %-32s %6s       %s\n' "$DUMP_NAME" "" \
    "$(du -h "$dir/$DUMP_NAME" | awk '{print $1}')" >&2

  # 🔴 Verify immediately. A backup nobody has read back is a folder, not
  # a backup, and the failure mode of an unverified one is that you find
  # out on the day it is the only copy left.
  #
  # 🔴 `fresh`: для щойно записаного зрізу відсутність дампа в маніфесті
  # — відмова, а не «старий зріз» (див. verify_dump). Поблажка для тек,
  # зроблених до CAMP-386, не сміє поширюватись на нові.
  say ""
  do_verify "$dir" fresh
}

# --------------------------------------------------------------------
# do_verify DIR [fresh] — `fresh` лише з do_backup, див. там.
do_verify() {
  local dir="$1" mode="${2:-}"
  [ -f "$dir/manifest.json" ] || die "no manifest.json in $dir"

  # 🔴 Read the manifest into a variable FIRST, so a failure to read it
  # stops the script.
  #
  # This was `while read … < <(python3 …)`, and the python had a syntax
  # error. Process substitution does not fail the shell, so the loop read
  # nothing, no file was checked, `bad` stayed 0 — and the script printed
  # "✓ verifies" over a backup it had not looked at. Measured, not
  # imagined: it did exactly that on the first real run, 23.09.2026.
  #
  # A verification that cannot run has to fail. The empty-list check
  # below is the second half of that: zero files checked is not a pass.
  local listing
  listing=$(python3 -c '
import json, sys
m = json.load(open(sys.argv[1]))
for name, v in m["files"].items():
    print("\t".join([name, str(v["rows"]), v["sha256"]]))
' "$dir/manifest.json") || die "manifest.json in $dir cannot be read"

  [ -n "$listing" ] || die "manifest.json in $dir lists no files"

  local bad=0 checked=0
  while IFS=$'\t' read -r name rows want; do
    [ -n "$name" ] || continue
    checked=$((checked + 1))
    local f="$dir/$name"
    [ -f "$f" ] || { say "  ✗ $name is missing"; bad=1; continue; }
    local got_sha got_rows
    got_sha=$(sha "$f")
    got_rows=$(rows_in_gz "$f")
    if [ "$got_sha" != "$want" ]; then
      say "  ✗ $name has changed since it was written"; bad=1
    elif [ "$got_rows" != "$rows" ]; then
      say "  ✗ $name has $got_rows rows, the manifest says $rows"; bad=1
    else
      say "  ✓ $name — $rows rows, checksum matches"
    fi
  done <<< "$listing"

  [ "$checked" -gt 0 ] || die "verified nothing — that is a failure, not a pass"

  # And the files on disk must all be accounted for. A backup with an
  # extra file is a manifest that was not rewritten, which means the
  # numbers above describe a different backup than the one in the folder.
  local on_disk
  on_disk=$(find "$dir" -maxdepth 1 -name '*.csv.gz' | wc -l | tr -d ' ')
  if [ "$on_disk" != "$checked" ]; then
    say "  ✗ $on_disk archives on disk but $checked in the manifest"
    bad=1
  fi

  # And the file must still be readable as what it claims to be — a
  # checksum proves the bytes are unchanged, not that they are a CSV.
  gzip -t "$dir"/*.csv.gz || { say "  ✗ an archive is corrupt"; bad=1; }

  # 🔴 І повний дамп — за ВМІСТОМ, не за наявністю (CAMP-386). Новий
  # зріз без дампа, або будь-який із дампом без directus_settings, не
  # проходить, навіть якщо всі CSV бездоганні: саме така «бездоганна»
  # тека й була дефектом. Старий зріз (без ключа "dump") проходить із
  # попередженням — інакше два тижні нічого не можна було б відновити.
  verify_dump "$dir" "$mode" || bad=1

  [ "$bad" = 0 ] || die "backup in $dir does not verify"
  say ""
  say "✓ $dir verifies"
}

# --------------------------------------------------------------------
do_restore() {
  local dir="$1"
  [ -d "$dir" ] || die "no such directory: $dir"
  do_verify "$dir"

  say ""
  say "→ restoring into $DB"

  # 🔴 Це CSV-половина: злиття в ЖИВУ базу. Повний дамп (camptribe.dump)
  # звідси не відновлюється навмисно — він замінює, а не зливає, і йому
  # місце лише в порожній базі; команда в шапці файла (CAMP-386).
  #
  # 🔴 Restore must never be able to destroy newer work.
  #
  # The obvious implementation — UPDATE … SET context = incoming — turns
  # this script into the thing it exists to prevent: run yesterday's
  # backup against today's database and a week of computed context is
  # gone, with no error and nothing to notice. So an incoming row is
  # written only when it is not empty AND it is genuinely newer, which
  # also makes running it twice harmless.
  # 🔴 Two real defects were fixed here, both by being run rather than
  # by being read.
  #
  # First: `gzip -dc … | psql <<SQL … \copy FROM STDIN`. The heredoc
  # overrides the pipe, so \copy would have read the SQL text as its
  # data. shellcheck named it (SC2259) before it ever ran.
  #
  # Second, and worse: the replacement used `\copy … FROM :'csv'`. psql
  # does NOT interpolate variables inside \copy — it has its own parser —
  # so the path arrived literally as `:` and the restore failed with
  # ":: No such file or directory". Measured 23.09.2026; the surrounding
  # test then compared the database to itself and would have called that
  # success. Hence FROM PROGRAM, and hence the row assertion below.
  local gz="$dir/camping_spots_context.csv.gz"
  case "$gz" in
    *\'*) die "the backup path contains a quote, which cannot be passed safely: $gz" ;;
  esac

  local sql
  # 🔴 A full template, not `-t`. `mktemp -t camptribe-restore` works on
  # macOS, where BSD mktemp appends its own suffix — and fails outright on
  # Linux with "too few X's in template", because GNU mktemp requires them.
  #
  # So the restore path had never run anywhere but this laptop, and nobody
  # knew, because nobody had ever restored. The nightly rehearsal added in
  # CAMP-58 found it on its first CI run — which is the entire argument of
  # that card, arriving as evidence rather than as a claim.
  sql="$(mktemp "${TMPDIR:-/tmp}/camptribe-restore.XXXXXX")"
  # shellcheck disable=SC2064  # $sql must be expanded now, not at trap time
  trap "rm -f '$sql'" RETURN

  {
    cat <<'HEAD'
CREATE TEMP TABLE incoming (
  osm_ref text, context jsonb, context_computed_at timestamptz,
  owner_overrides jsonb, missing_since timestamptz, content_changed_at timestamptz
);
HEAD
    # The one line that needs the path, built here so the rest of the
    # SQL can stay in a quoted heredoc where `$` is literal.
    printf "\\\\copy incoming FROM PROGRAM 'gzip -dc %s' WITH CSV HEADER\n" "$gz"
    cat <<'SQL'
-- 🔴 An empty temp table means the load silently did nothing, which is
-- precisely how the two bugs above presented. Every UPDATE below would
-- then match no rows and the script would report a clean restore.
DO $$
BEGIN
  IF (SELECT count(*) FROM incoming) = 0 THEN
    RAISE EXCEPTION 'nothing was loaded from the backup — refusing to report success';
  END IF;
END $$;

UPDATE camping_spots s SET
  context             = i.context,
  context_computed_at = i.context_computed_at
FROM incoming i
WHERE s.osm_ref = i.osm_ref
  AND i.context <> '{}'::jsonb
  AND (s.context = '{}'::jsonb
       OR s.context_computed_at IS NULL
       OR i.context_computed_at > s.context_computed_at);

UPDATE camping_spots s SET owner_overrides = i.owner_overrides
FROM incoming i
WHERE s.osm_ref = i.osm_ref
  AND i.owner_overrides <> '{}'::jsonb
  AND s.owner_overrides = '{}'::jsonb;

UPDATE camping_spots s SET
  missing_since      = LEAST(s.missing_since, i.missing_since),
  content_changed_at = GREATEST(s.content_changed_at, i.content_changed_at)
FROM incoming i WHERE s.osm_ref = i.osm_ref;

SELECT
  (SELECT count(*) FROM incoming) AS "rows read",
  (SELECT count(*) FROM incoming i JOIN camping_spots s USING (osm_ref)) AS "matched",
  (SELECT count(*) FROM incoming i
     WHERE NOT EXISTS (SELECT 1 FROM camping_spots s WHERE s.osm_ref = i.osm_ref))
    AS "not in this database";
SQL
  } > "$sql"

  psql "$DB" -v ON_ERROR_STOP=1 -f "$sql"

  # 🔴 Rows that matched nothing are not an error — they are campsites
  # this database has not imported yet. They are reported because the
  # alternative is a restore that silently drops half of what it read.
  say ""
  say "Rows reported as 'not in this database' belong to countries this"
  say "database has not imported. Import them, then restore again."

  # 🔴 THE FOUR TABLES THAT WERE BACKED UP AND NEVER RESTORED.
  #
  # Until CAMP-58's review, do_restore() loaded exactly one archive —
  # camping_spots_context.csv.gz — while `backup` wrote five. Reviews,
  # photo submissions, guides and routes were saved every night and had
  # no restore path at all, which is the same as not being backed up
  # except that it looks safer.
  #
  # It survived because the CI fixture holds none of them: the gate
  # compared 0 rows against a manifest that said 0 and printed a tick.
  # Demonstrated by review with a real row — backed up, destroyed, and
  # still gone after a "successful" restore.
  #
  # 🔴 ON CONFLICT DO NOTHING, and no target column. Same rule as the
  # clauses above: a restore must never destroy newer work. A row that
  # exists now wins, whatever the backup says; a row that is missing
  # comes back. Running it twice is therefore harmless, which is the
  # property that makes it safe to run unattended.
  #
  # ⚠️ The CSV was written with SELECT *, so the load is POSITIONAL. If a
  # migration adds or reorders a column between a backup and its restore,
  # this misaligns. The temp table is created LIKE the real one, so the
  # types usually catch it loudly — but "usually" is doing work in that
  # sentence, and a column added at the END is the case it would not
  # catch. Worth a header check the day these tables start changing.
  for t in "${TABLES[@]}"; do
    local arch="$dir/$t.csv.gz"
    [ -f "$arch" ] || continue
    if [ "$(table_exists "$t")" != 't' ]; then
      say "  · $t does not exist in this database — skipped"
      continue
    fi
    case "$arch" in
      *\'*) die "the backup path contains a quote, which cannot be passed safely: $arch" ;;
    esac

    local tsql
    tsql="$(mktemp "${TMPDIR:-/tmp}/camptribe-restore-$t.XXXXXX")"
    {
      printf 'CREATE TEMP TABLE incoming_%s (LIKE %s);\n' "$t" "$t"
      printf "\\copy incoming_%s FROM PROGRAM 'gzip -dc %s' WITH CSV HEADER\n" "$t" "$arch"
      printf 'INSERT INTO %s SELECT * FROM incoming_%s ON CONFLICT DO NOTHING;\n' "$t" "$t"
      printf 'SELECT (SELECT count(*) FROM incoming_%s) AS "read", count(*) AS "now in %s" FROM %s;\n' "$t" "$t" "$t"
    } > "$tsql"
    psql "$DB" -v ON_ERROR_STOP=1 -f "$tsql"
    rm -f "$tsql"
  done
}

# --------------------------------------------------------------------
# 🔴 The one thing this script must never do is destroy newer work.
#
# It exists because the computed context is expensive — weeks of Open-Meteo
# quota — so a restore that overwrote a fresh context with a stale one
# would be the exact disaster it was written to prevent, and it would do
# it quietly. That rule lives in three WHERE clauses, and a WHERE clause
# nobody has tried to break is a comment.
#
# This runs the real clauses against temp tables. It touches no live row,
# needs no fixture, and can be run on any machine with the database up.
do_self_test() {
  # 🔴 CAMP-286: the ✓ below is earned, not printed.
  #
  # Review inserted `RETURN;` after the block's BEGIN: every check was
  # skipped, psql still exited 0, and this function printed "the restore
  # rules still bite" with the CI lock satisfied. So the SQL now counts
  # the checks it ran, and the shell refuses a count that is not the one
  # this file was written around.
  local out expected=7 ran
  out="$(psql "$DB" -v ON_ERROR_STOP=1 -q 2>&1 <<'SQL'
CREATE TEMP TABLE spots (
  osm_ref text, context jsonb, context_computed_at timestamptz,
  owner_overrides jsonb, missing_since timestamptz, content_changed_at timestamptz);
CREATE TEMP TABLE incoming (LIKE spots);

INSERT INTO spots VALUES
  -- 1: the disaster case — the database is NEWER than the backup
  ('n/1', '{"elevation":900}', '2026-09-23', '{}', NULL, NULL),
  -- 2: the ordinary case — the database lost it, the backup has it
  ('n/2', '{}',                NULL,         '{}', NULL, NULL),
  -- 3: the backup is genuinely newer
  ('n/3', '{"elevation":10}',  '2026-09-01', '{}', NULL, NULL),
  -- 4: a human correction already in the database
  ('n/4', '{}', NULL, '{"name":"kept"}', NULL, NULL),
  -- 5: first-seen dates must widen, never narrow
  ('n/5', '{}', NULL, '{}', '2026-09-20', '2026-09-20');

INSERT INTO incoming VALUES
  ('n/1', '{"elevation":1}',   '2026-09-01', '{}', NULL, NULL),
  ('n/2', '{"elevation":2}',   '2026-09-01', '{}', NULL, NULL),
  ('n/3', '{"elevation":333}', '2026-09-22', '{}', NULL, NULL),
  ('n/4', '{}', NULL, '{"name":"stale"}', NULL, NULL),
  ('n/5', '{}', NULL, '{}', '2026-09-10', '2026-09-10'),
  -- 6: a campsite this database has not imported
  ('n/6', '{"elevation":6}',   '2026-09-01', '{}', NULL, NULL);

UPDATE spots s SET context = i.context, context_computed_at = i.context_computed_at
FROM incoming i WHERE s.osm_ref = i.osm_ref AND i.context <> '{}'::jsonb
  AND (s.context = '{}'::jsonb OR s.context_computed_at IS NULL
       OR i.context_computed_at > s.context_computed_at);

UPDATE spots s SET owner_overrides = i.owner_overrides
FROM incoming i WHERE s.osm_ref = i.osm_ref
  AND i.owner_overrides <> '{}'::jsonb AND s.owner_overrides = '{}'::jsonb;

UPDATE spots s SET missing_since = LEAST(s.missing_since, i.missing_since),
  content_changed_at = GREATEST(s.content_changed_at, i.content_changed_at)
FROM incoming i WHERE s.osm_ref = i.osm_ref;

DO $$
DECLARE failures int := 0; checks int := 0;
BEGIN
  IF (SELECT context->>'elevation' FROM spots WHERE osm_ref='n/1') <> '900' THEN
    checks := checks+1; RAISE WARNING '  x a STALE backup overwrote NEWER context'; failures := failures+1;
  ELSE checks := checks+1; RAISE INFO '  ok a stale backup cannot overwrite newer context'; END IF;

  IF (SELECT context->>'elevation' FROM spots WHERE osm_ref='n/2') <> '2' THEN
    checks := checks+1; RAISE WARNING '  x an empty context was NOT filled from the backup'; failures := failures+1;
  ELSE checks := checks+1; RAISE INFO '  ok an empty context is filled from the backup'; END IF;

  IF (SELECT context->>'elevation' FROM spots WHERE osm_ref='n/3') <> '333' THEN
    checks := checks+1; RAISE WARNING '  x a genuinely newer backup did not win'; failures := failures+1;
  ELSE checks := checks+1; RAISE INFO '  ok a genuinely newer backup wins'; END IF;

  IF (SELECT owner_overrides->>'name' FROM spots WHERE osm_ref='n/4') <> 'kept' THEN
    checks := checks+1; RAISE WARNING '  x a human correction was overwritten'; failures := failures+1;
  ELSE checks := checks+1; RAISE INFO '  ok a human correction in the database is kept'; END IF;

  IF (SELECT missing_since FROM spots WHERE osm_ref='n/5') <> '2026-09-10'::timestamptz THEN
    checks := checks+1; RAISE WARNING '  x first-seen date did not widen to the earlier one'; failures := failures+1;
  ELSE checks := checks+1; RAISE INFO '  ok first-seen widens to the earliest evidence'; END IF;

  IF (SELECT content_changed_at FROM spots WHERE osm_ref='n/5') <> '2026-09-20'::timestamptz THEN
    checks := checks+1; RAISE WARNING '  x last-changed date went backwards'; failures := failures+1;
  ELSE checks := checks+1; RAISE INFO '  ok last-changed never goes backwards'; END IF;

  IF (SELECT count(*) FROM spots WHERE osm_ref='n/6') <> 0 THEN
    checks := checks+1; RAISE WARNING '  x restore invented a row that is not in this database'; failures := failures+1;
  ELSE checks := checks+1; RAISE INFO '  ok a campsite not imported here is reported, not invented'; END IF;

  IF failures > 0 THEN
    RAISE EXCEPTION '% self-test failure(s)', failures;
  END IF;
  -- 🔴 CAMP-286: say how many checks RAN, not only how many failed. A
  -- `RETURN;` after BEGIN skipped every one of them and this block still
  -- ended quietly; the shell below printed its ✓ over nothing.
  RAISE INFO 'self-test cases: %', checks;
  RAISE INFO 'self-test passed';
END $$;
SQL
)"
  printf '%s\n' "$out" >&2
  ran="$(printf '%s\n' "$out" | sed -n 's/.*self-test cases: \([0-9]*\).*/\1/p' | tail -1)"
  if [ "${ran:-0}" -ne "$expected" ]; then
    die "the restore rehearsal ran ${ran:-0} checks, expected $expected"
  fi
  say ""
  say "✓ the restore rules hold"
  # 🔴 CAMP-286: a line that names THIS file, for the CI step to read
  # back. "self-test passed" is printed by the SQL block above and by
  # several other scripts; a grep for it is a lock another key opens.
  #
  # 🔴 AND ON STDOUT, not through `say`, which prints to stderr (line
  # 103). The CI lock pipes stdout; a named line on stderr is a line the
  # step cannot read, and the lock would have been green over nothing.
  printf '%s\n' "✓ backup-local self-test: the restore rules still bite"
}

# --------------------------------------------------------------------
case "${1:-}" in
  backup)  do_backup "${2:-}" ;;
  verify)  do_verify "${2:?usage: verify DIR}" ;;
  restore) do_restore "${2:?usage: restore DIR}" ;;
  --self-test|self-test) do_self_test ;;
  *) die "usage: $0 backup [DIR] | verify DIR | restore DIR" ;;
esac
