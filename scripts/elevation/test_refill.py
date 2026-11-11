#!/usr/bin/env python3
"""Тести заповнювача висоти на СПРАВЖНІЙ базі й справжніх плитках — CAMP-493.

   PGHOST=… PGUSER=… PGPASSWORD=… python3 scripts/elevation/test_refill.py

🔴 ЧОМУ НЕ ПІДСТАВНИЙ КУРСОР. Рецензія #544 зняла з заповнювача шість
рядків — `WHERE false` у вибірці, другу умову в UPDATE, лічильник за
`len(rows)`, довіру до відповіді без `Content-Length` — і самотест сторожа
пережив усі: він ганяв лише `verdict()`. Тут піднімається тимчасова база
з PostGIS, пишуться справжні `.om`-плитки (синтетичні, але читаються тим
самим `OmFileReader`), а відро грає локальний HTTP-сервер, який уміє віддати
плитку, обірвати її й відповісти 404 та 500.

База — з оточення (PGHOST/PGUSER/PGPASSWORD або локальний сокет). Немає
Postgres — тест ПАДАЄ, а не пропускається: пропущений тест виглядає як
пройдений.
"""
import http.server, importlib.util, json, math, os, subprocess, sys, tempfile, threading, unittest

import numpy as np
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
os.environ.setdefault('NO_PROXY', '127.0.0.1')

spec = importlib.util.spec_from_file_location('refill', os.path.join(HERE, 'refill.py'))
refill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refill)
refill.RETRY_SLEEP = 0

ROWS, COLS = 1200, 3600
EXPECTED_TESTS = 10


def write_tile(path, nan_at=None, wild_at=None):
    """Висота = 100 + 0.1 × номер рядка знизу смуги: відома наперед у будь-якій точці."""
    from omfiles import OmFileWriter
    d = (100 + 0.1 * np.arange(ROWS, dtype=np.float32))[:, None] * np.ones((1, COLS), dtype=np.float32)
    if nan_at:
        d[nan_at] = np.nan
    if wild_at:
        d[wild_at] = 9000.0
    w = OmFileWriter(path)
    w.close(w.write_array(d, chunks=[60, 360], compression='fpx_xor_2d'))


def cell(lat, lon):
    band = math.floor(lat)
    return (min(max(int(round((lat - band) * ROWS)), 0), ROWS - 1),
            min(max(int(round((lon + 180) / 360 * COLS)), 0), COLS - 1))


class Bucket(http.server.ThreadingHTTPServer):
    """Відро: /good/ віддає файл, /nocl/ — обрубок БЕЗ Content-Length, /short/ — обрубок
    із Content-Length більшим за тіло, /boom/ — 500, будь-що інше без файла — 404."""


def make_handler(root):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            mode, name = self.path.strip('/').split('/', 1)
            if mode == 'boom':
                self.send_response(500); self.end_headers(); return
            path = os.path.join(root, name)
            if not os.path.exists(path):
                self.send_response(404); self.end_headers(); return
            body = open(path, 'rb').read()
            if mode == 'good':
                self.send_response(200); self.send_header('Content-Length', str(len(body)))
                self.end_headers(); self.wfile.write(body)
            elif mode == 'nocl':
                self.send_response(200); self.send_header('Connection', 'close')
                self.end_headers(); self.wfile.write(body[: len(body) // 2])
                self.close_connection = True
            elif mode == 'short':
                self.send_response(200); self.send_header('Content-Length', str(len(body)))
                self.end_headers(); self.wfile.write(body[: len(body) // 2])
                self.close_connection = True
    return H


class RefillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='camp493-refill-')
        cls.bucket_dir = os.path.join(cls.tmp, 'bucket')
        os.makedirs(cls.bucket_dir)
        # смуга 44, 45 — є; 50 — ні (404). У 45 є клітина з NaN і клітина 9000 м.
        write_tile(os.path.join(cls.bucket_dir, 'lat_44.om'))
        write_tile(os.path.join(cls.bucket_dir, 'lat_45.om'),
                   nan_at=cell(45.5, 10.0), wild_at=cell(45.6, 10.0))
        cls.srv = Bucket(('127.0.0.1', 0), make_handler(cls.bucket_dir))
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.port = cls.srv.server_address[1]

        cls.dbname = f'camp493_refill_{os.getpid()}'
        adm = psycopg2.connect(dbname='postgres')
        adm.autocommit = True
        adm.cursor().execute(f'CREATE DATABASE {cls.dbname}')
        adm.close()
        cls.conn = psycopg2.connect(dbname=cls.dbname)
        cls.url = f'postgres:///{cls.dbname}'
        c = cls.conn.cursor()
        c.execute('CREATE EXTENSION postgis')
        c.execute("CREATE TABLE camping_spots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "
                  "location geometry(Point,4326), context jsonb NOT NULL DEFAULT '{}', "
                  "missing_since timestamptz)")
        cls.conn.commit()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.conn.close()
        adm = psycopg2.connect(dbname='postgres')
        adm.autocommit = True
        adm.cursor().execute(f'DROP DATABASE IF EXISTS {cls.dbname}')
        adm.close()

    def setUp(self):
        self.conn.cursor().execute('TRUNCATE camping_spots')
        self.conn.commit()
        refill.TILE_URL = f'http://127.0.0.1:{self.port}/good/lat_{{band}}.om'

    def add(self, lat=45.2, lon=5.0, ctx='{}', dead=False):
        c = self.conn.cursor()
        c.execute("INSERT INTO camping_spots (location, context, missing_since) "
                  "VALUES (ST_SetSRID(ST_MakePoint(%s,%s),4326), %s::jsonb, "
                  + ('now()' if dead else 'NULL') + ') RETURNING id::text', (lon, lat, ctx))
        self.conn.commit()
        return c.fetchone()[0]

    def ctx(self, sid):
        c = self.conn.cursor()
        c.execute('SELECT context FROM camping_spots WHERE id = %s::uuid', (sid,))
        self.conn.commit()
        return c.fetchone()[0]

    def run_main(self, *argv):
        tiles = os.path.join(self.tmp, 'tiles')
        old = (sys.argv, os.environ.get('DATABASE_URL'), os.environ.get('ELEVATION_TILES'))
        sys.argv = ['refill.py', *argv]
        os.environ['DATABASE_URL'], os.environ['ELEVATION_TILES'] = self.url, tiles
        try:
            return refill.main()
        finally:
            sys.argv = old[0]
            for k, v in zip(('DATABASE_URL', 'ELEVATION_TILES'), old[1:]):
                if v is None: os.environ.pop(k, None)
                else: os.environ[k] = v

    # ── 1. умови заповнювача — ті самі, що в сторожа ──────────────────
    def test_conditions_are_the_guards(self):
        out = subprocess.run(
            ['node', '--input-type=module', '-e',
             "import * as g from './scripts/ci/check-elevation-coverage.mjs';"
             "console.log(JSON.stringify([g.LIVE_SQL,g.MISSING_SQL,g.QUARANTINED_SQL]))"],
            cwd=ROOT, capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), [refill.LIVE, refill.MISSING, refill.QUARANTINED])

    # ── 2. вибірка: живі, без числової висоти, не в чинному карантині ──
    def test_select_takes_exactly_the_live_unfilled_unparked(self):
        import time
        soon, past = int(time.time()) + 86400, int(time.time()) - 86400
        want = {
            self.add(ctx='{}'),
            self.add(ctx='{"elevation": null}'),
            self.add(ctx='{"elevation": "137"}'),
            self.add(ctx=f'{{"elevation_skipped": {{"until": {past}}}}}'),   # карантин минув
        }
        self.add(ctx='{"elevation": 137}')                                    # вже є
        self.add(ctx='{}', dead=True)                                         # мертвий
        self.add(ctx=f'{{"elevation_skipped": {{"until": {soon}}}}}')         # чинний карантин
        got = {r[0] for r in refill.select_todo(self.conn.cursor())}
        self.conn.commit()
        self.assertEqual(got, want)

    # ── 3. UPDATE: друга умова й чесний лічильник ─────────────────────
    def test_write_counts_what_the_database_changed_and_keeps_newer_values(self):
        a, b, c = self.add(), self.add(), self.add()
        # Між вибіркою й записом хтось встиг записати висоту рядку b.
        cur = self.conn.cursor()
        cur.execute("UPDATE camping_spots SET context = '{\"elevation\": 999}' WHERE id = %s::uuid", (b,))
        self.conn.commit()
        n = refill.write_rows(cur, [(a, 100, 3, 'flat'), (b, 100, 3, 'flat'), (c, 100, 3, 'flat')])
        self.conn.commit()
        self.assertEqual(n, 2, 'лічильник мусить рахувати змінене базою, а не len(rows)')
        self.assertEqual(self.ctx(b)['elevation'], 999, 'чуже значення затерто')
        self.assertEqual(self.ctx(a)['elevation'], 100)

    def test_write_never_touches_a_dead_row(self):
        d = self.add(dead=True)
        cur = self.conn.cursor()
        n = refill.write_rows(cur, [(d, 100, 3, 'flat')])
        self.conn.commit()
        self.assertEqual((n, 'elevation' in self.ctx(d)), (0, False))

    # ── 4. наскрізно: добір, карантин, ідемпотентність ─────────────────
    def test_end_to_end_fill_quarantine_and_rerun(self):
        normal = self.add(45.2, 5.0)
        edge = self.add(44.99955, 5.0)           # кільце заходить у смугу 45
        nan = self.add(45.5, 10.0)
        wild = self.add(45.6, 10.0)
        nowhere = self.add(50.5, 5.0)            # смуги 50 у відрі немає → 404
        dead = self.add(45.2, 5.1, dead=True)
        rc = self.run_main()
        self.assertEqual(rc, 1, 'три нових біди (NaN, 9000 м, 404) — це новина, код 1')
        self.assertEqual(self.ctx(normal)['elevation'], 124)      # 100 + 0.1 × 240
        self.assertIn('terrain', self.ctx(normal))
        self.assertIsInstance(self.ctx(edge)['elevation'], int)   # кільце не завадило
        for bad, why in ((nan, None), (wild, 'межами'), (nowhere, 'немає плитки')):
            c = self.ctx(bad)
            self.assertNotIn('elevation', c)
            self.assertIn('until', c['elevation_skipped'])
            if why:
                self.assertIn(why, c['elevation_skipped']['why'])
        self.assertNotIn('elevation', self.ctx(dead), 'мертвого не чіпали')
        # Другий прогін: нічого добирати, жодної нової тривоги, жодного завантаження.
        self.assertEqual(self.run_main(), 0)
        cur = self.conn.cursor()
        self.assertEqual(refill.count_missing(cur), (0, 3, 5))
        self.conn.commit()

    def test_a_network_failure_is_not_a_quarantine(self):
        sid = self.add(45.2, 5.0)
        refill.TILE_URL = f'http://127.0.0.1:{self.port}/boom/lat_{{band}}.om'
        self.assertEqual(self.run_main(), 1, 'мережа не віддала — тривога')
        self.assertNotIn('elevation_skipped', self.ctx(sid), 'тимчасова біда не карантинить')
        refill.TILE_URL = f'http://127.0.0.1:{self.port}/good/lat_{{band}}.om'
        self.assertEqual(self.run_main(), 0, 'наступного разу відро віддало — добрано')
        self.assertEqual(self.ctx(sid)['elevation'], 124)

    def test_a_retried_parked_row_does_not_ring_again(self):
        import time
        past = int(time.time()) - 86400
        sid = self.add(45.5, 10.0, ctx=f'{{"elevation_skipped": {{"until": {past}}}}}')  # NaN
        self.assertEqual(self.run_main(), 0, 'уже відомий безнадійний рядок мовчки подовжує карантин')
        self.assertGreater(self.ctx(sid)['elevation_skipped']['until'], time.time())

    # ── 5. завантаження: обрив без Content-Length — відмова ────────────
    def test_download_without_content_length_is_refused(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        refill.TILE_URL = f'http://127.0.0.1:{self.port}/nocl/lat_{{band}}.om'
        with self.assertRaises(RuntimeError):
            refill.fetch_tile(44, d)
        self.assertEqual(os.listdir(d), [], 'обрубок не мусить лишитись плиткою')

    def test_truncated_download_with_content_length_is_refused(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        refill.TILE_URL = f'http://127.0.0.1:{self.port}/short/lat_{{band}}.om'
        with self.assertRaises(RuntimeError):
            refill.fetch_tile(44, d)
        self.assertEqual(os.listdir(d), [])

    def test_a_whole_download_is_accepted_and_a_404_is_its_own_error(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        path = refill.fetch_tile(44, d)
        self.assertEqual(os.path.getsize(path),
                         os.path.getsize(os.path.join(self.bucket_dir, 'lat_44.om')))
        with self.assertRaises(refill.TileMissing):
            refill.fetch_tile(50, d)


if __name__ == '__main__':
    r = unittest.TextTestRunner(verbosity=1).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(RefillTests))
    failed = len(r.failures) + len(r.errors)
    # 🔴 Лічильник стверджується: тест, до якого не дійшли, виглядає як пройдений.
    ok = r.wasSuccessful() and r.testsRun == EXPECTED_TESTS
    print(f'elevation refill tests: ran {r.testsRun}, failed {failed}')
    sys.exit(0 if ok else 1)
