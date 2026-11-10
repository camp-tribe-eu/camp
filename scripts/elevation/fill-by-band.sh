#!/bin/bash
# Висоти смуга за смугою — CAMP-484.
#
# 🔴 НЕ ЧЕКАЄМО ВСЕ ДЗЕРКАЛО. Перша редакція качала всі 40 плиток
# (4,2 ГБ) і лише потім рахувала. Заміряно: відро віддає повільно, і це
# години простою, за які не зʼявляється жодного заповненого кемпінга.
#
# Тут інакше: одна плитка → усі кемпінги цієї смуги → наступна. Перший
# результат є за хвилини, і робота переживає перерву: уже пораховане
# лишається порахованим.
#
# 🔴 СМУГИ ЙДУТЬ ЗА КІЛЬКІСТЮ КЕМПІНГІВ, А НЕ ЗА НОМЕРОМ. На 43–47
# припадає майже третина всіх; рахувати з 32° означало б витратити
# перші півгодини на Мадейру.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SPOTS=${SPOTS:?треба SPOTS=шлях до csv (id,lat,lon)}
DEM=${DEM_DIR:?треба DEM_DIR}
OUT=${OUT:?треба OUT=шлях до результату}
KEEP=${KEEP_TILES:-0}
mkdir -p "$DEM"
: > "$OUT.tmp"

# Смуги в порядку спадання кількості кемпінгів.
BANDS=$(awk -F, '{print int($2)}' "$SPOTS" | sort | uniq -c | sort -rn | awk '{print $2}')

for b in $BANDS; do
  n=$(awk -F, -v b="$b" 'int($2)==b' "$SPOTS" | wc -l | tr -d ' ')
  f="$DEM/lat_$b.om"
  if [ ! -s "$f" ]; then
    echo "[$(date +%H:%M:%S)] смуга $b: качаю плитку ($n кемпінгів)"
    curl -sS --max-time 1200 -o "$f.part" \
      "https://openmeteo.s3.amazonaws.com/data/copernicus_dem90/static/lat_$b.om" \
      && mv "$f.part" "$f" || { echo "  🔴 смуга $b не завантажилась — пропускаю"; rm -f "$f.part"; continue; }
  fi
  awk -F, -v b="$b" 'int($2)==b' "$SPOTS" > "$DEM/band.csv"
  DEM_DIR="$DEM" "$PY" "$HERE/fill-from-mirror.py" "$DEM/band.csv" >> "$OUT.tmp" 2>>"$OUT.err"
  echo "[$(date +%H:%M:%S)] смуга $b: готово, разом $(wc -l < "$OUT.tmp" | tr -d ' ')"
  # 🔴 ПЛИТКУ ПРИБИРАЄМО ОДРАЗУ, якщо не просили інакше: 4,2 ГБ на диску
  # заради даних, які більше не знадобляться, — це борг, не зручність.
  [ "$KEEP" = "1" ] || rm -f "$f"
done

mv "$OUT.tmp" "$OUT"
echo "пораховано $(wc -l < "$OUT" | tr -d ' ') із $(wc -l < "$SPOTS" | tr -d ' ')"
