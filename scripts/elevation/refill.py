#!/usr/bin/env python3
"""Добрати висоту й рельєф кемпінгам, яким їх бракує — CAMP-493.

   DATABASE_URL=… python3 scripts/elevation/refill.py [--dry-run] [--limit N]

Бере з бази ЛИШЕ рядки без числової висоти, групує їх за смугою широти,
сама тягне потрібні плитки з відра `openmeteo` (CC-BY-4.0) і дописує
`elevation` та `terrain` у `context`. Дзеркало `/srv/camptribe/tools/dem`
їй не потрібне й нею не читається.

🔴 ЛИШЕ ТАМ, ДЕ ВИСОТИ НЕМАЄ — і умова стоїть у ДВОХ місцях: у вибірці й
у самому UPDATE. Між вибіркою та записом може пройти хвилина (качається
плитка), і за цей час `compute-context` або людина встигає записати
значення; без другої перевірки ми б його затерли.

🔴 «НЕМАЄ» — ЦЕ НЕ ЛИШЕ «КЛЮЧА НЕМАЄ». `{"elevation": null}` теж без
висоти, і `context ? 'elevation'` назвав би такий рядок заповненим. Умова
`MISSING` слово в слово збігається з тією, що рахує сторож
`scripts/ci/check-elevation-coverage.mjs`; самотест сторожа порівнює
обидва файли.

🔴 КІЛЬЦЕ РЕЛЬЄФУ ПЕРЕТИНАЄ МЕЖІ СМУГ. Кемпінг на 44,003° бере точки на
43,994°, тобто з сусідньої плитки. Тому для кожного рядка рахуються ВСІ
потрібні смуги, а не лише його «рідна»; інакше він гарантовано дав би
помилку (так було в CAMP-484 — 1,7% результату).

🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО ЗАПИСУ. Рядок, що не порахувався,
чи вийшов за межі здорового глузду, лічиться й пропускається; смуга, що не
завантажилась, коштує свої рядки. Код виходу ненульовий, якщо хоч щось
пропущено, — юніт падає, і це тривога, а не мовчазне «майже».
"""
import argparse, importlib.util, math, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TILE_URL = os.environ.get(
    'ELEVATION_TILE_URL',
    'https://openmeteo.s3.amazonaws.com/data/copernicus_dem90/static/lat_{band}.om',
)

# 🔴 Той самий рядок, що в `check-elevation-coverage.mjs` (MISSING_SQL).
MISSING = "jsonb_typeof(context->'elevation') IS DISTINCT FROM 'number'"

# Межі здорового глузду — ті самі, що в apply.sh: найвища точка ЄС — Монблан
# (4 808 м), найнижча суходільна — польдери (≈ −7 м).
ELEVATION_RANGE = (-20, 4900)
RELIEF_RANGE = (0, 4000)


def load_dem():
    """Обрахунок — той самий код, що заповнив 63 307 кемпінгів (CAMP-484)."""
    spec = importlib.util.spec_from_file_location(
        'fill_from_mirror', os.path.join(HERE, 'fill-from-mirror.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def bands_needed(dem, lat: float, lon: float) -> set:
    """Рідна смуга + смуги всіх восьми точок кільця."""
    got = {math.floor(lat)}
    for ring_lat, _ in dem.ring(lat, lon):
        got.add(math.floor(ring_lat))
    return got


def fetch_tile(band: int, tiles_dir: str, retries: int = 3) -> str:
    """Качає плитку в `tiles_dir`; готовий файл береться без повторного завантаження."""
    path = os.path.join(tiles_dir, f'lat_{band}.om')
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(tiles_dir, exist_ok=True)
    part = path + '.part'
    last = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(TILE_URL.format(band=band), timeout=120) as resp, \
                    open(part, 'wb') as out:
                want = resp.headers.get('Content-Length')
                size = 0
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
                    size += len(chunk)
            # 🔴 Обірване завантаження не кидає помилки саме: читач просто
            # бачить менше байтів. Звіряємо з тим, що відро обіцяло.
            if want is not None and int(want) != size:
                raise IOError(f'отримано {size} із {want} байтів')
            if size == 0:
                raise IOError('порожня відповідь')
            os.replace(part, path)
            return path
        except Exception as err:  # noqa: BLE001
            last = err
            if os.path.exists(part):
                os.remove(part)
            time.sleep(2 * attempt)
    raise RuntimeError(f'смуга {band} не завантажилась: {last}')


def drop_tiles_below(dem, tiles_dir: str, keep_from: int) -> None:
    """Плитки нижче `keep_from` більше не знадобляться: смуги йдуть вгору."""
    if not os.path.isdir(tiles_dir):
        return
    for name in os.listdir(tiles_dir):
        if name.startswith('lat_') and name.endswith('.om'):
            b = int(name[4:-3])
            if b < keep_from:
                dem._tiles.pop(b, None)
                os.remove(os.path.join(tiles_dir, name))


def count_missing(cur):
    cur.execute(
        f"SELECT count(*) FILTER (WHERE missing_since IS NULL AND {MISSING}), "
        f"count(*) FILTER (WHERE missing_since IS NULL) FROM camping_spots")
    return cur.fetchone()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true',
                    help='порахувати, що бракує, нічого не качати й не писати')
    ap.add_argument('--limit', type=int, default=0,
                    help='обробити не більше N рядків (для перевірки)')
    args = ap.parse_args()

    url = os.environ.get('DATABASE_URL')
    if not url:
        print('🔴 немає DATABASE_URL', file=sys.stderr)
        return 2
    tiles_dir = os.environ.get('ELEVATION_TILES')
    if not tiles_dir:
        print('🔴 немає ELEVATION_TILES (запуск не через refill.sh?)', file=sys.stderr)
        return 2

    import psycopg2
    from psycopg2.extras import execute_values
    conn = psycopg2.connect(url)
    cur = conn.cursor()

    before_missing, before_live = count_missing(cur)
    conn.commit()
    print(f'до: {before_missing} без висоти із {before_live} живих кемпінгів')

    cur.execute(
        f"SELECT id::text, ST_Y(location::geometry), ST_X(location::geometry) "
        f"FROM camping_spots WHERE {MISSING} ORDER BY 2, 1"
        + (f' LIMIT {int(args.limit)}' if args.limit else ''))
    todo = cur.fetchall()
    conn.commit()
    if not todo:
        print('нічого добирати')
        return 0

    dem = load_dem()
    dem.DEM_DIR = tiles_dir
    by_band: dict = {}
    for sid, lat, lon in todo:
        by_band.setdefault(math.floor(lat), []).append((sid, float(lat), float(lon)))
    print(f'до добору: {len(todo)} рядків у {len(by_band)} смугах: '
          f'{sorted(by_band)}')
    if args.dry_run:
        print('СУХИЙ ПРОГІН — нічого не качаю й не пишу')
        return 0

    done = skipped = 0
    for band in sorted(by_band):
        spots = by_band[band]
        drop_tiles_below(dem, tiles_dir, band - 1)
        need = set()
        for _, lat, lon in spots:
            need |= bands_needed(dem, lat, lon)
        try:
            for b in sorted(need):
                fetch_tile(b, tiles_dir)
        except Exception as err:  # noqa: BLE001
            print(f'🔴 смуга {band}: {err} — {len(spots)} рядків пропущено', file=sys.stderr)
            skipped += len(spots)
            continue
        rows = []
        for sid, lat, lon in spots:
            try:
                centre = dem.elevation(lat, lon)
                vals = [centre] + [dem.elevation(a, b) for a, b in dem.ring(lat, lon)]
                relief = max(vals) - min(vals)
                ele, rel = round(centre), round(relief)
                if not (ELEVATION_RANGE[0] <= ele <= ELEVATION_RANGE[1]
                        and RELIEF_RANGE[0] <= rel <= RELIEF_RANGE[1]):
                    raise ValueError(f'поза межами здорового глузду: {ele} м, рельєф {rel} м')
            except Exception as err:  # noqa: BLE001
                # 🔴 Нуль метрів — правдоподібна висота; тихо записати його
                # замість «не знаю» означало б збрехати правдоподібно.
                print(f'🔴 {sid}: {str(err)[:80]}', file=sys.stderr)
                skipped += 1
                continue
            rows.append((sid, ele, rel, dem.terrain(relief)))
        if rows:
            execute_values(cur, f"""
                UPDATE camping_spots s
                   SET context = coalesce(s.context, '{{}}'::jsonb)
                       || jsonb_build_object(
                            'elevation', d.ele,
                            'terrain', jsonb_build_object('relief', d.rel, 'type', d.kind))
                  FROM (VALUES %s) AS d(id, ele, rel, kind)
                 WHERE s.id = d.id::uuid AND {MISSING.replace('context', 's.context')}
                """, rows, template='(%s, %s::int, %s::int, %s)')
            conn.commit()
            done += len(rows)
        print(f'смуга {band}: {len(rows)} із {len(spots)}, разом {done}', flush=True)

    drop_tiles_below(dem, tiles_dir, 10_000)
    after_missing, after_live = count_missing(cur)
    conn.commit()
    print(f'добрано {done}, пропущено {skipped}')
    print(f'після: {after_missing} без висоти із {after_live} живих кемпінгів')
    return 0 if skipped == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
