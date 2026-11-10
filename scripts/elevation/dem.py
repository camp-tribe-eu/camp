#!/usr/bin/env python3
"""Висоти з відкритого відра Open-Meteo замість безкоштовного API — CAMP-484.

   python3 scripts/elevation/dem.py --verify          # звірити з наявними
   python3 scripts/elevation/dem.py --fill [--limit N]  # заповнити порожні

🔴 НАВІЩО. Безкоштовний API Open-Meteo некомерційний, і обовʼязок перейти
на платний вмикається першим афіліатним посиланням. Ті самі дані —
Copernicus GLO-90 — лежать у відрі `openmeteo` під CC-BY-4.0, і їх можна
читати комерційно (лист Ticket#235498, 10.11.2026).

🔴 І ЦЕ НЕ ЛИШЕ ПРО ЛІЦЕНЗІЮ. Заміряно 10.11.2026 на проді: висоту мають
1 289 кемпінгів із 63 307 — два відсотки. Квота безкоштовного API
~1 100 на добу, тобто решту він заповнював би 56 днів. З відра — одразу.

🔴 РОЗКЛАДКА ВИВЕДЕНА ДОСЛІДОМ, А НЕ ПРОЧИТАНА: README проєкту прямо
каже, що інструкції для прямого доступу будуть пізніше. Один файл на
смугу широти, рядки з ПІВДНЯ на північ, довгота від −180°, крок по
довготі за GLO-90 (3″ до 50°, далі грубше). Перевірено на 40 кемпінгах:
медіана різниці 0,0 м.
"""
import argparse, json, math, os, sys

RELIEF_RADIUS_M = 1000
RELIEF_SAMPLES = 8
# Межі словами — фізичні, не квантилі наших даних. Ті самі, що в
# `spot-context.ts` і в тексті правової сторінки про базу.
TERRAIN_BANDS = ((25, 'flat'), (70, 'rolling'), (150, 'hilly'))

_readers: dict = {}


def reader(band: int):
    """Плитка на смугу широти, відкрита один раз за прогін."""
    if band not in _readers:
        import fsspec
        from omfiles import OmFileReader
        fs = fsspec.filesystem('s3', anon=True)
        key = f'openmeteo/data/copernicus_dem90/static/lat_{band}.om'
        _readers[band] = OmFileReader(fs.open(key, 'rb'))
    return _readers[band]


def elevation(lat: float, lon: float) -> float:
    band = math.floor(lat)
    r = reader(band)
    rows, cols = r.shape
    # 🔴 РЯДОК РАХУЄТЬСЯ ЗНИЗУ СМУГИ. Зверху дає правдоподібні, але чужі
    # висоти: на пробі 773 м замість 183. Правдоподібне число не на тому
    # місці — найгірший різновид помилки, бо не виглядає помилкою.
    i = min(max(int(round((lat - band) * rows)), 0), rows - 1)
    j = min(max(int(round((lon + 180) / 360 * cols)), 0), cols - 1)
    import numpy as np
    return float(np.asarray(r[i:i + 1, j:j + 1]).ravel()[0])


def ring(lat: float, lon: float):
    """Вісім точок на колі 1 км — той самий розрахунок, що в compute-context."""
    for k in range(RELIEF_SAMPLES):
        a = 2 * math.pi * k / RELIEF_SAMPLES
        d_lat = RELIEF_RADIUS_M * math.cos(a) / 111_320
        d_lon = RELIEF_RADIUS_M * math.sin(a) / (111_320 * math.cos(math.radians(lat)))
        yield round(lat + d_lat, 5), round(lon + d_lon, 5)


def terrain(relief: float) -> str:
    for limit, word in TERRAIN_BANDS:
        if relief < limit:
            return word
    return 'mountainous'


def db():
    import psycopg2
    url = os.environ.get('DATABASE_URL')
    if not url:
        # 🔴 КОД 2, А НЕ 1. Один означає «знайдено розбіжність», інший —
        # «перевірити не вдалось». Сплутати їх означає, що загублена
        # змінна середовища виглядає як розходження даних, і шукати
        # почнуть не там.
        print('🔴 немає DATABASE_URL — читати нічого, і «0 розбіжностей» '
              'означало б лише те, що я нікуди не ходив', file=sys.stderr)
        raise SystemExit(2)
    return psycopg2.connect(url)


def verify(limit: int) -> int:
    """Звірити наш розрахунок із висотами, які вже лежать у базі."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT ST_Y(location::geometry), ST_X(location::geometry),
                   (context->>'elevation')::float
              FROM camping_spots
             WHERE context ? 'elevation'
             ORDER BY random() LIMIT %s""", (limit,))
        rows = cur.fetchall()

    # 🔴 ЗНАМЕННИК ДРУКУЄТЬСЯ: «0 розбіжностей» над нулем рядків виглядає
    # так само, як справжня згода.
    if not rows:
        print('🔴 жодного кемпінга з висотою — звіряти нема з чим')
        return 2

    diffs = [elevation(lat, lon) - stored for lat, lon, stored in rows]
    import statistics
    big = [d for d in diffs if abs(d) > 30]
    print(f'звірено {len(rows)} кемпінгів')
    print(f'  медіана {statistics.median(diffs):+.1f} м · '
          f'середнє |різниці| {statistics.mean(abs(d) for d in diffs):.2f} м · '
          f'максимум {max(abs(d) for d in diffs):.0f} м')
    print(f'  у межах ±5 м: {sum(1 for d in diffs if abs(d) <= 5)}/{len(diffs)}')
    print(f'  понад 30 м:   {len(big)}/{len(diffs)}')
    # 🔴 ПОРІГ НА МЕДІАНІ, А НЕ НА МАКСИМУМІ. Окремі гірські майданчики
    # розходяться на десятки метрів, бо ми беремо найближчу клітинку, а
    # API інтерполює. Систематичний зсув — інша річ: він означає, що
    # розкладка прочитана хибно.
    return 0 if abs(statistics.median(diffs)) <= 2 else 1


def fill(limit: int, batch: int = 200) -> int:
    """Порахувати висоту й рельєф для кемпінгів, у яких їх немає.

    🔴 ПИШЕМО ЛИШЕ ТЕ, ЧОГО НЕМАЄ. Наявні значення не чіпаємо: вони
    прийшли з того самого Copernicus через API, і переписати їх нашим
    округленням означало б зробити рух, якого ніхто не просив, на
    даних, які вже на сайті.

    🔴 ПЛИТКИ ВІДКРИВАЮТЬСЯ ОДИН РАЗ НА СМУГУ, тому вибірка йде
    ВПОРЯДКОВАНО за широтою. Випадковий порядок відкривав би ту саму
    плитку сотні разів — це та сама робота, помножена на мережу.
    """
    import numpy as np
    done = 0
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, ST_Y(location::geometry), ST_X(location::geometry)
                  FROM camping_spots
                 WHERE NOT (context ? 'elevation')
                   AND location IS NOT NULL
                 ORDER BY ST_Y(location::geometry)
                 LIMIT %s""", (limit,))
            rows = cur.fetchall()

        if not rows:
            print('порожніх кемпінгів немає — заповнювати нічого')
            return 0

        for start in range(0, len(rows), batch):
            chunk = rows[start:start + batch]
            updates = []
            for spot_id, lat, lon in chunk:
                try:
                    centre = elevation(lat, lon)
                    ring_vals = [elevation(a, b) for a, b in ring(lat, lon)]
                except Exception as err:          # noqa: BLE001
                    # 🔴 ОДИН КЕМПІНГ, ЩО НЕ ПРОЧИТАВСЯ, НЕ ВАЛИТЬ ПРОГІН,
                    # але й не стає тихим нулем: його просто не чіпаємо,
                    # і наступний прогін спробує знову.
                    print(f'  🔴 {spot_id}: {str(err)[:60]}', file=sys.stderr)
                    continue
                vals = [centre] + ring_vals
                relief = max(vals) - min(vals)
                updates.append((
                    json.dumps({
                        'elevation': round(centre),
                        'terrain': {'relief': round(relief), 'type': terrain(relief)},
                    }),
                    spot_id,
                ))

            with conn.cursor() as cur:
                cur.executemany(
                    "UPDATE camping_spots "
                    "SET context = coalesce(context, '{}'::jsonb) || %s::jsonb "
                    "WHERE id = %s",
                    updates,
                )
            conn.commit()
            done += len(updates)
            print(f'  записано {done} із {len(rows)}', flush=True)

    # 🔴 ЗНАМЕННИК: скільки взяли й скільки справді записали. Розрив між
    # ними — це кемпінги, що не прочитались, і він мусить бути видимим.
    print(f'узято {len(rows)}, записано {done}')
    return 0 if done == len(rows) else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--fill', action='store_true')
    ap.add_argument('--limit', type=int, default=200)
    a = ap.parse_args()
    if a.verify:
        return verify(a.limit)
    if a.fill:
        # 🔴 ЗАПОВНЕННЯ НЕ ПОЧИНАЄТЬСЯ, ПОКИ ЗВІРКА НЕ ЗЕЛЕНА. Писати в
        # базу з розкладки, яку щойно не перевірили, означає розсіяти
        # правдоподібні чужі числа по 62 тисячах сторінок.
        code = verify(40)
        if code != 0:
            print('🔴 звірка не зелена — нічого не пишу', file=sys.stderr)
            return code
        return fill(a.limit)
    ap.print_help()
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
