#!/usr/bin/env python3
"""Порахувати висоту й рельєф із ЛОКАЛЬНОГО дзеркала плиток — CAMP-484.

   DEM_DIR=… python3 scripts/elevation/fill-from-mirror.py spots.csv > out.csv

Вхід:  id,lat,lon  (CSV без заголовка — те, що віддає psql -A -F,)
Вихід: id,elevation,relief,terrain

🔴 ЧОМУ ОБРАХУНОК НЕ НА СЕРВЕРІ. На проді немає `ensurepip`, тож
віртуальне середовище там не створюється, а ставити системний пакет
заради разової роботи — зміна інфраструктури, якої можна уникнути.
Тому координати їдуть із сервера сюди, а назад — лише результат.
Рядок підключення до бази машини не залишає: запит виконується ТАМ.

🔴 ЧОМУ ДЗЕРКАЛО, А НЕ ЧИТАННЯ З S3 НАЖИВО. Заміряно: сорок кемпінгів
дали 360 читань і понад хвилину, бо кожна нова смуга широти тягне з
мережі десятки мегабайтів. На 62 018 кемпінгах це доба. З локальних
файлів — читання з диска.

🔴 СМУГИ 32–71, А НЕ 34–71. Перша редакція взяла 34, бо «ЄС-27 від
34°». Дані кажуть інше: найпівденніший кемпінг на 32,7° — Мадейра.
Поза вузькою смугою опинилось би 36 кемпінгів, і вони просто лишились
би без висоти, не давши жодної помилки.
"""
import csv, json, math, os, sys

RELIEF_RADIUS_M = 1000
RELIEF_SAMPLES = 8
TERRAIN_BANDS = ((25, 'flat'), (70, 'rolling'), (150, 'hilly'))

DEM_DIR = os.environ.get('DEM_DIR')
_tiles: dict = {}


def tile(band: int):
    if band not in _tiles:
        from omfiles import OmFileReader
        path = os.path.join(DEM_DIR, f'lat_{band}.om')
        if not os.path.exists(path):
            raise FileNotFoundError(f'немає плитки {path}')
        _tiles[band] = OmFileReader(open(path, 'rb'))
    return _tiles[band]


def elevation(lat: float, lon: float) -> float:
    import numpy as np
    band = math.floor(lat)
    r = tile(band)
    rows, cols = r.shape
    # Рядок знизу смуги — перевірено звіркою; зверху дають правдоподібні,
    # але чужі висоти (медіана +49,5 м замість 0,0).
    i = min(max(int(round((lat - band) * rows)), 0), rows - 1)
    j = min(max(int(round((lon + 180) / 360 * cols)), 0), cols - 1)
    return float(np.asarray(r[i:i + 1, j:j + 1]).ravel()[0])


def ring(lat: float, lon: float):
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


def main() -> int:
    if not DEM_DIR or not os.path.isdir(DEM_DIR):
        print('🔴 немає DEM_DIR або теки не існує — рахувати нема з чого',
              file=sys.stderr)
        return 2
    if len(sys.argv) < 2:
        print('🔴 треба файл із координатами', file=sys.stderr)
        return 2

    out = csv.writer(sys.stdout)
    done = skipped = 0
    with open(sys.argv[1], newline='') as fh:
        for row in csv.reader(fh):
            if len(row) != 3:
                continue
            spot_id, lat, lon = row[0], float(row[1]), float(row[2])
            try:
                centre = elevation(lat, lon)
                vals = [centre] + [elevation(a, b) for a, b in ring(lat, lon)]
            except Exception as err:            # noqa: BLE001
                # 🔴 ПРОПУЩЕНИЙ РЯХОК НЕ СТАЄ НУЛЕМ. Нуль метрів — це
                # правдоподібна висота (узбережжя), і тихо записати її
                # замість «не знаю» означає збрехати правдоподібно.
                print(f'🔴 {spot_id}: {str(err)[:70]}', file=sys.stderr)
                skipped += 1
                continue
            relief = max(vals) - min(vals)
            out.writerow([spot_id, round(centre), round(relief), terrain(relief)])
            done += 1
            if done % 5000 == 0:
                print(f'  {done} пораховано', file=sys.stderr, flush=True)

    # 🔴 ЗНАМЕННИК В ОБИДВА БОКИ: скільки пораховано й скільки пропущено.
    print(f'пораховано {done}, пропущено {skipped}', file=sys.stderr)
    return 0 if skipped == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
