#!/bin/bash
# Записати пораховані висоти в базу — CAMP-484.
#
#   DATABASE_URL=… bash scripts/elevation/apply.sh elevations.csv [--apply]
#
# 🔴 БЕЗ --apply НІЧОГО НЕ ПИШЕ. Це 62 тисячі рядків на живій базі; крок,
# який робиться одним словом і не відкочується одним словом, не має
# робитись «за замовчуванням».
#
# 🔴 ПИШЕМО ЛИШЕ ТАМ, ДЕ ВИСОТИ НЕМАЄ. Наявні значення прийшли з того
# самого Copernicus через API і вже на сайті; переписати їх нашим
# округленням означало б рух, якого ніхто не просив.
#
# 🔴 ЧЕРЕЗ ТИМЧАСОВУ ТАБЛИЦЮ Й ОДНУ ТРАНЗАКЦІЮ. Шістдесят дві тисячі
# окремих UPDATE — це години й частковий результат при будь-якому збої.
set -u
CSV=${1:?треба файл із результатом (id,elevation,relief,terrain)}
APPLY=${2:-}
U=${DATABASE_URL:?треба DATABASE_URL}

ROWS=$(wc -l < "$CSV" | tr -d ' ')
# 🔴 ЗНАМЕННИК І МЕЖІ ЗДОРОВОГО ГЛУЗДУ. Найвища точка ЄС — Монблан,
# 4 808 м; найнижча суходільна — польдери Нідерландів, близько −7 м.
# Значення поза цим не «рідкісний кемпінг», а хибно прочитана плитка.
BAD=$(awk -F, '$2 < -20 || $2 > 4900 || $3 < 0 || $3 > 4000' "$CSV" | wc -l | tr -d ' ')
echo "рядків у файлі: $ROWS · поза межами здорового глузду: $BAD"
if [ "$BAD" != "0" ]; then
  echo "🔴 є значення поза межами — не пишу, дивись:"; awk -F, '$2 < -20 || $2 > 4900 || $3 < 0 || $3 > 4000' "$CSV" | head -5
  exit 1
fi
awk -F, '{print $4}' "$CSV" | sort | uniq -c | sort -rn | awk '{print "  " $2 ": " $1}'

if [ "$APPLY" != "--apply" ]; then
  echo "СУХИЙ ПРОГІН — нічого не записано. Додай --apply."
  exit 0
fi

psql "$U" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE TEMP TABLE dem_in (id uuid, elevation int, relief int, terrain text);
\\copy dem_in FROM '$CSV' WITH (FORMAT csv)
UPDATE camping_spots s
   SET context = coalesce(s.context, '{}'::jsonb)
       || jsonb_build_object(
            'elevation', d.elevation,
            'terrain', jsonb_build_object('relief', d.relief, 'type', d.terrain))
  FROM dem_in d
 WHERE s.id = d.id
   AND NOT (s.context ? 'elevation');
SELECT count(*) FILTER (WHERE context ? 'elevation') AS "з висотою",
       count(*) AS "усього"
  FROM camping_spots;
COMMIT;
SQL
