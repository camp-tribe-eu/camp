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

🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО ЗАПИСУ. Рядок, що не порахувався
(NaN, поза межами здорового глузду) чи чия смуга відсутня у відрі (404),
іде в карантин на 30 діб: заповнювач його не чіпає, сторож не червоніє,
але друкує їхню кількість і червоніє за бюджетом. Код виходу 1 — лише за
НОВУ біду (рядок упав уперше) або коли відро не віддало плитку (мережа):
рядок, що вже сидів у карантині, мовчки подовжує його.
"""
import argparse, importlib.util, math, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TILE_URL = os.environ.get(
    'ELEVATION_TILE_URL',
    'https://openmeteo.s3.amazonaws.com/data/copernicus_dem90/static/lat_{band}.om',
)

# 🔴 Ці умови — слово в слово ті, що рахує сторож
# `check-elevation-coverage.mjs` (LIVE_SQL, MISSING_SQL, PARKED_SQL).
# Заповнювач і сторож мусять питати про ОДНУ множину рядків: заповнювач, що
# добирає мертвих, дає код 1 через кемпінг, якого читач не бачить, а сторож,
# що рахує інших, червоніє через рядок, якого заповнювач не торкається.
LIVE = "missing_since IS NULL"
MISSING = "jsonb_typeof(context->'elevation') IS DISTINCT FROM 'number'"
# 🔴 КАРАНТИН ЖИВЕ В ОКРЕМІЙ ТАБЛИЦІ `spot_elevation_skips`, НЕ В `context`:
# правило індексації кемпінга — буквально `context = '{}'`, і мітка в
# `context` робила порожню сторінку індексованою (замір рецензента).
# Для сторожа «у карантині» = рядок у таблиці існує, БЕЗ порівняння з
# часом; `until` читає лише заповнювач (PARKED_ACTIVE) — тому строк, що
# спливає між заповнювачем і сторожем, не дає хибного червоного.
PARKED = ("EXISTS (SELECT 1 FROM spot_elevation_skips k "
          "WHERE k.camping_spot_id = camping_spots.id)")
PARKED_ACTIVE = ("EXISTS (SELECT 1 FROM spot_elevation_skips k "
                 "WHERE k.camping_spot_id = camping_spots.id AND k.until > now())")
QUARANTINE_DAYS = 30


class BadData(Exception):
    """Дані такі: NaN у плитці, висота поза здоровим глуздом. Це карантин."""


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


class TileMissing(Exception):
    """Відро відповіло 404: цієї смуги немає взагалі, і повтор її не створить."""


RETRY_SLEEP = 2  # секунд × номер спроби; тести ставлять 0


def fetch_tile(band: int, tiles_dir: str, retries: int = 3) -> str:
    """Качає плитку в `tiles_dir`; готовий файл береться без повторного завантаження."""
    import urllib.error
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
            # 🔴 ОБІРВАНЕ ЗАВАНТАЖЕННЯ НЕ КИДАЄ ПОМИЛКИ САМЕ: читач просто бачить
            # менше байтів. Звіряти є з чим лише тоді, коли відро назвало
            # довжину; без заголовка «обрив» і «ціла плитка» не відрізнити, а
            # обрізана плитка читається без помилки й дає ЧУЖІ висоти (у
            # підставці рецензії: 12 м замість 1 234). Тому відповідь без
            # `Content-Length` — відмова, а не довіра. S3 заголовок шле.
            if want is None:
                raise IOError('відповідь без Content-Length: обрив не відрізнити від цілої плитки')
            if int(want) != size:
                raise IOError(f'отримано {size} із {want} байтів')
            if size == 0:
                raise IOError('порожня відповідь')
            os.replace(part, path)
            return path
        except urllib.error.HTTPError as err:
            last = err
            if os.path.exists(part):
                os.remove(part)
            if err.code == 404:
                raise TileMissing(f'смуга {band}: відро відповіло 404') from err
            time.sleep(RETRY_SLEEP * attempt)
        except Exception as err:  # noqa: BLE001
            last = err
            if os.path.exists(part):
                os.remove(part)
            time.sleep(RETRY_SLEEP * attempt)
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
    """(ще не добрано, у карантині, усього живих) — те саме, що міряє сторож."""
    cur.execute(
        f"SELECT count(*) FILTER (WHERE {LIVE} AND {MISSING} AND NOT {PARKED}), "
        f"count(*) FILTER (WHERE {LIVE} AND {MISSING} AND {PARKED}), "
        f"count(*) FILTER (WHERE {LIVE}) FROM camping_spots")
    return cur.fetchone()


def select_todo(cur, limit: int = 0):
    """Живі рядки без висоти, чий карантин не чинний: (id, lat, lon, був_карантин).

    «Був» — будь-який рядок у таблиці, навіть минулий: саме він означає, що
    цей рядок уже відомий як безнадійний і повторна невдача не новина.
    """
    cur.execute(
        f"SELECT id::text, ST_Y(location::geometry), ST_X(location::geometry), "
        f"{PARKED} FROM camping_spots "
        f"WHERE {LIVE} AND {MISSING} AND NOT {PARKED_ACTIVE} ORDER BY 2, 1"
        + (f' LIMIT {int(limit)}' if limit else ''))
    return cur.fetchall()


def write_rows(cur, rows) -> int:
    """Дописати висоту. Повертає, скільки рядків база СПРАВДІ змінила.

    🔴 РАХУЄТЬСЯ ТЕ, ЩО ПОВЕРНУВ UPDATE, А НЕ `len(rows)`. Між вибіркою й
    записом проходить хвилина (качається плитка); якщо за цей час хтось уже
    записав висоту, умова в UPDATE його пропустить, а лічильник за `len(rows)`
    усе одно сказав би «добрано N». Такий звіт брехав би рівно там, де
    друга умова працює або ЗЛАМАНА, і мутація її зняття була б невидимою.
    """
    if not rows:
        return 0
    from psycopg2.extras import execute_values
    got = execute_values(cur, f"""
        UPDATE camping_spots s
           SET context = coalesce(s.context, '{{}}'::jsonb)
               || jsonb_build_object(
                    'elevation', d.ele,
                    'terrain', jsonb_build_object('relief', d.rel, 'type', d.kind))
          FROM (VALUES %s) AS d(id, ele, rel, kind)
         WHERE s.id = d.id::uuid
           AND {LIVE.replace('missing_since', 's.missing_since')}
           AND {MISSING.replace('context', 's.context')}
        RETURNING s.id
        """, rows, template='(%s, %s::int, %s::int, %s)', fetch=True)
    return len(got)


def quarantine(cur, items) -> int:
    """Закарантинити рядки, що не порахуються: [(id, чому)]. Лише живі й ще порожні.

    Пише в `spot_elevation_skips`, НЕ в `context`; повторний виклик на тому
    самому рядку подовжує строк. Повертає, скільки рядків справді записано.
    """
    if not items:
        return 0
    from psycopg2.extras import execute_values
    got = execute_values(cur, f"""
        INSERT INTO spot_elevation_skips (camping_spot_id, until, why)
        SELECT s.id, now() + make_interval(days => {int(QUARANTINE_DAYS)}), d.why
          FROM (VALUES %s) AS d(id, why)
          JOIN camping_spots s ON s.id = d.id::uuid
         WHERE {LIVE.replace('missing_since', 's.missing_since')}
           AND {MISSING.replace('context', 's.context')}
        ON CONFLICT (camping_spot_id)
          DO UPDATE SET until = EXCLUDED.until, why = EXCLUDED.why
        RETURNING camping_spot_id
        """, items, template='(%s, %s)', fetch=True)
    return len(got)


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
    conn = psycopg2.connect(url)
    try:
        return run(conn, args, tiles_dir)
    finally:
        conn.close()


def run(conn, args, tiles_dir: str) -> int:
    cur = conn.cursor()

    pending, parked, live = count_missing(cur)
    conn.commit()
    print(f'до: {pending} без висоти (+{parked} у карантині) із {live} живих кемпінгів')

    todo = select_todo(cur, args.limit)
    conn.commit()
    if not todo:
        print('нічого добирати')
        return 0

    dem = load_dem()
    dem.DEM_DIR = tiles_dir
    by_band: dict = {}
    for sid, lat, lon, was_parked in todo:
        by_band.setdefault(math.floor(lat), []).append((sid, float(lat), float(lon), was_parked))
    print(f'до добору: {len(todo)} рядків у {len(by_band)} смугах: '
          f'{sorted(by_band)}')
    if args.dry_run:
        print('СУХИЙ ПРОГІН — нічого не качаю й не пишу')
        return 0

    # Три різні долі рядка, і вони не змішуються:
    #   done      — висоту записано;
    #   new_bad   — не порахувався ВПЕРШЕ: це новина, код виходу 1 (одна тривога);
    #   transient — відро не віддало плитку (мережа): лишається «ще не добрано»,
    #               код 1, сторож червоніє — так і мусить, це не вада рядка.
    # Рядок, що вже сидів у карантині й знову не порахувався, мовчки продовжує
    # карантин: інакше один безнадійний рядок давав би лист кожні 30 днів.
    done = new_bad = known_bad = transient = 0
    for band in sorted(by_band):
        spots = by_band[band]
        drop_tiles_below(dem, tiles_dir, band - 1)
        need = set()
        for _, lat, lon, _ in spots:
            need |= bands_needed(dem, lat, lon)
        parked_now = []
        try:
            for b in sorted(need):
                fetch_tile(b, tiles_dir)
        except TileMissing as err:
            # 🔴 404 — це «такої смуги немає», а не «мережа кашляє»: повтор
            # завтра дасть те саме. Усі рядки смуги — у карантин.
            print(f'🔴 смуга {band}: {err} — {len(spots)} рядків у карантин', file=sys.stderr)
            for sid, _, _, was in spots:
                parked_now.append((sid, 'немає плитки'))
                known_bad, new_bad = (known_bad + 1, new_bad) if was else (known_bad, new_bad + 1)
            quarantine(cur, parked_now)
            conn.commit()
            continue
        except Exception as err:  # noqa: BLE001
            print(f'🔴 смуга {band}: {err} — {len(spots)} рядків лишаються без висоти',
                  file=sys.stderr)
            transient += len(spots)
            continue
        rows = []
        for sid, lat, lon, was in spots:
            try:
                centre = dem.elevation(lat, lon)
                vals = [centre] + [dem.elevation(a, b) for a, b in dem.ring(lat, lon)]
                # 🔴 NaN — це «плитка тут нічого не знає», і округлення NaN
                # кидало б ValueError, не відрізняючи його від зламаного venv.
                # Тому «дані такі» називається явно, і лише воно карантинить.
                if not all(math.isfinite(v) for v in vals):
                    raise BadData('плитка не має значення в цій точці (NaN)')
                relief = max(vals) - min(vals)
                ele, rel = round(centre), round(relief)
                if not (ELEVATION_RANGE[0] <= ele <= ELEVATION_RANGE[1]
                        and RELIEF_RANGE[0] <= rel <= RELIEF_RANGE[1]):
                    raise BadData(f'поза межами здорового глузду: {ele} м, рельєф {rel} м')
            except BadData as err:
                # 🔴 Нуль метрів — правдоподібна висота; тихо записати його
                # замість «не знаю» означало б збрехати правдоподібно.
                print(f'🔴 {sid}: {err}', file=sys.stderr)
                parked_now.append((sid, str(err)[:200]))
                known_bad, new_bad = (known_bad + 1, new_bad) if was else (known_bad, new_bad + 1)
                continue
            except Exception as err:  # noqa: BLE001
                # 🔴 ВСЕ ІНШЕ — «НАМ СТАЛО ЗЛЕ» (битий кеш плитки, зламане
                # середовище), а не «дані такі». Карантин на 30 діб після
                # полагодження причини тримав би рядки без висоти, тож тут —
                # лише тривога й повтор наступної ночі.
                print(f'🔴 {sid}: збій обрахунку, не вада даних — {type(err).__name__}: '
                      f'{str(err)[:80]}', file=sys.stderr)
                transient += 1
                continue
            rows.append((sid, ele, rel, dem.terrain(relief)))
        wrote = write_rows(cur, rows)
        quarantine(cur, parked_now)
        conn.commit()
        done += wrote
        print(f'смуга {band}: записано {wrote} із {len(spots)}, разом {done}', flush=True)

    drop_tiles_below(dem, tiles_dir, 10_000)
    pending, parked, live = count_missing(cur)
    conn.commit()
    print(f'добрано {done}, нових у карантин {new_bad}, повторно в карантин {known_bad}, '
          f'не віддала мережа {transient}')
    print(f'після: {pending} без висоти (+{parked} у карантині) із {live} живих кемпінгів')
    return 0 if (new_bad == 0 and transient == 0) else 1


if __name__ == '__main__':
    raise SystemExit(main())
