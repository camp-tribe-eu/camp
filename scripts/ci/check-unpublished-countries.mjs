#!/usr/bin/env node
// CAMP-490: країни, яких ми не публікуємо, не з'являються у ВІДПОВІДЯХ API.
//
//   cd apps/api && node -r dotenv/config ../../scripts/ci/check-unpublished-countries.mjs
//   node scripts/ci/check-unpublished-countries.mjs --self-test
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ МІРЯЄ ВИВІД, А НЕ КОД. Сторож, що перевіряє «чи стоїть
// фільтр у запиті», обходиться першим же забутим запитом: хтось додасть
// одинадцяту точку входу, не знаючи про перелік, і код із фільтром вигляне
// чистим. Тому сторож НЕ читає запити. Він бере зібраний API
// (`apps/api/dist`), підставляє під нього справжню базу й ПИТАЄ кожну
// точку входу, а червоніє на тому, що вона відповіла.
//
// Перелік кодів береться з `unpublished-countries` (зібраного), а не
// переписується тут: два переліки розійшлися б.
//
// 🔴 ЗНАМЕННИК ДРУКУЄТЬСЯ ЗАВЖДИ. «Кіпру не знайдено» нічого не варте, якщо
// під ним нуль перевірених рядків. Тому:
//   • у базі мусить бути хоч один прихований рядок — інакше доводити нічого
//     (вихід 2): фільтр, якому немає що фільтрувати, зеленіє на будь-якому коді;
//   • кожна точка, що повертає рядки, мусить їх повернути — порожня відповідь
//     означає зламану базу або запит, а не «чисто» (вихід 2);
//   • вихід 1 — код із переліку знайшовся у відповіді; 0 — тільки коли
//     знаменник ненульовий і нічого не знайдено.
//
// 🔴 ЖИВЕ НА МАШИНІ, А НЕ В CI — як і check-directus-config. База CI має
// міграції, але не має жодного рядка кемпінгу: сторож там завжди б
// закінчував виходом 2. У CI їде лише `--self-test`.
//
// 🔴 ЗІБРАНИЙ КОД МОЖЕ ВІДСТАВАТИ. Якщо `dist` старіший за вихідник, сторож
// питав би вчорашній код і казав «чисто» про сьогоднішній. Це вихід 2 з
// наказом зібрати наново.

import { realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const API = join(ROOT, 'apps', 'api');

// ─────────────────────────────────────────────────────────────────────
// Читання відповіді: чи є в ній код із переліку.
// ─────────────────────────────────────────────────────────────────────

/**
 * Усе, що виглядає як «цей рядок із країни X»: поле `country` будь-якого
 * вкладеного обʼєкта й будь-який рядок виду `/camping/<код>/…`.
 * Регістр байдужий: `CY` у базі, `cy` в адресі.
 */
export function leaksIn(value, codes, path = '$') {
  const hits = [];
  const walk = (v, at) => {
    if (typeof v === 'string') {
      const m = /^\/camping\/([a-z]{2})(?:\/|$)/i.exec(v);
      if (m && codes.includes(m[1].toLowerCase())) hits.push(`${at}=${v}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
      return;
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      for (const [k, x] of Object.entries(v)) {
        if (
          k === 'country' &&
          typeof x === 'string' &&
          codes.includes(x.toLowerCase())
        ) {
          hits.push(`${at}.country=${x}`);
        }
        walk(x, `${at}.${k}`);
      }
    }
  };
  walk(value, path);
  return hits;
}

// ─────────────────────────────────────────────────────────────────────
// Точки входу.
// ─────────────────────────────────────────────────────────────────────

/**
 * Опитує кожну точку входу й повертає звіт.
 *
 * `env` — усе, що потрібно, щоб питати: сервіси, довідка з бази (`raw`) і
 * дві функції складання адрес. У живому прогоні це зібраний API над справжньою
 * базою, у самотесті — підробка, яку можна зіпсувати.
 */
export async function interrogate(env) {
  const { spots, map, planner, routes, raw, codes, slugifyRegion } = env;
  const { regionChunkSlug } = env;
  const entries = new Map();
  const entry = (name, mustReturnRows) => {
    if (!entries.has(name)) {
      entries.set(name, {
        calls: 0,
        rows: 0,
        problems: [],
        mustReturnRows,
      });
    }
    return entries.get(name);
  };
  const guard = async (name, mustReturnRows, fn) => {
    const e = entry(name, mustReturnRows);
    e.calls += 1;
    try {
      await fn(e);
    } catch (err) {
      e.problems.push(`впало: ${err?.message ?? err}`);
    }
  };
  const seen = (e, where, value, rows) => {
    e.rows += rows;
    for (const h of leaksIn(value, codes)) e.problems.push(`${where}: ${h}`);
  };

  // ── Списки, які читач бачить цілком ────────────────────────────────
  let countries = [];
  await guard('spots.countries', true, async (e) => {
    countries = await spots.countries();
    seen(e, 'countries()', countries, countries.length);
  });
  await guard('spots.allPublishable', true, async (e) => {
    const r = await spots.allPublishable();
    seen(e, 'allPublishable()', r, r.length);
  });
  await guard('spots.searchDocuments', true, async (e) => {
    const r = await spots.searchDocuments();
    seen(e, 'searchDocuments()', r, r.length);
  });
  await guard('spots.notable', true, async (e) => {
    const r = await spots.notable(1_000_000);
    seen(e, 'notable()', r, r.length);
  });
  await guard('map.regions', true, async (e) => {
    const r = await map.regions();
    seen(e, 'map.regions()', r, r.length);
  });

  // ── Підсумок: числа без країни, тож звіряємо їх зі списками вище ───
  await guard('spots.summary', true, async (e) => {
    const s = await spots.summary();
    let regions = 0;
    for (const c of countries) {
      const r = await spots.regions(c.country);
      regions += r.length;
    }
    e.rows += Number(s.spots);
    const want = {
      spots: countries.reduce((n, c) => n + Number(c.spots), 0),
      countries: countries.length,
      regions,
    };
    for (const k of Object.keys(want)) {
      if (Number(s[k]) !== want[k]) {
        e.problems.push(
          `summary().${k}=${s[k]}, а списки країн дають ${want[k]}: ` +
            `підсумок рахує рядки, яких списки не бачать`,
        );
      }
    }
  });

  // ── Для кожної прихованої країни: усе, що питає країну, має мовчати ─
  const regionSlugs = [
    ...new Set(
      raw.hiddenRows
        .filter((r) => r.region !== null)
        .map((r) => `${r.country}\u0000${slugifyRegion(r.region)}`),
    ),
  ].map((s) => s.split('\u0000'));
  const chunkSlugs = [
    ...new Set(
      raw.hiddenRows.map(
        (r) => `${r.country}\u0000${regionChunkSlug(r.region)}`,
      ),
    ),
  ].map((s) => s.split('\u0000'));

  for (const code of codes) {
    await guard('spots.regions(hidden)', false, async (e) => {
      const r = await spots.regions(code);
      seen(e, `regions(${code})`, r, 1);
      if (r.length) e.problems.push(`regions(${code}) повернув ${r.length}`);
    });
    await guard('spots.hubStats(hidden)', false, async (e) => {
      const r = await spots.hubStats(code);
      seen(e, `hubStats(${code})`, r, 1);
      if (r.length) e.problems.push(`hubStats(${code}) повернув ${r.length}`);
    });
  }
  for (const [code, slug] of regionSlugs) {
    await guard('spots.regionSpots(hidden)', false, async (e) => {
      const r = await spots.regionSpots(code, slug);
      seen(e, `regionSpots(${code},${slug})`, r, 1);
      if (r.region !== null || r.total !== 0 || r.items.length !== 0) {
        e.problems.push(
          `regionSpots(${code},${slug}): region=${r.region} total=${r.total}`,
        );
      }
    });
    await guard('spots.regionInsights(hidden)', false, async (e) => {
      const r = await spots.regionInsights(code, slug);
      seen(e, `regionInsights(${code},${slug})`, r, 1);
      if (r !== null) {
        e.problems.push(`regionInsights(${code},${slug}) не null`);
      }
    });
  }
  for (const [code, slug] of chunkSlugs) {
    await guard('map.regionMarkers(hidden)', false, async (e) => {
      const r = await map.regionMarkers(code, slug);
      seen(e, `regionMarkers(${code},${slug})`, r, 1);
      if (r.length) {
        e.problems.push(`regionMarkers(${code},${slug}) повернув ${r.length}`);
      }
    });
  }

  // ── Кожен прихований рядок окремо: сторінка й сусіди ───────────────
  for (const row of raw.hiddenRows) {
    await guard('spots.findBySlug(hidden)', false, async (e) => {
      e.rows += 1;
      const region = row.region === null ? '_unplaced' : slugifyRegion(row.region);
      let view;
      try {
        view = await spots.findBySlug(row.country, region, row.slug);
      } catch (err) {
        // Єдина прийнятна відповідь — 404, і БЕЗ підказки «є за іншою
        // адресою»: така підказка веде веб на 301 до Кіпру.
        const body = typeof err?.getResponse === 'function' ? err.getResponse() : null;
        if (err?.name !== 'NotFoundException') {
          e.problems.push(`findBySlug(${row.slug}) впало не 404: ${err?.message}`);
          return;
        }
        for (const h of leaksIn(body, codes)) {
          e.problems.push(`findBySlug(${row.slug}) 404 із адресою: ${h}`);
        }
        return;
      }
      e.problems.push(
        `findBySlug(${row.country},${region},${row.slug}) віддав сторінку: ` +
          `${view?.country ?? '?'}`,
      );
    });
    await guard('spots.nearby(hidden)', false, async (e) => {
      const r = await spots.nearby(row.slug, 50);
      seen(e, `nearby(${row.slug})`, r, 1);
      if (r.length) {
        e.problems.push(`nearby(${row.slug}) повернув сусідів: ${r.length}`);
      }
    });
  }

  // Найближча ОПУБЛІКОВАНА точка до прихованих: єдиний спосіб побачити, чи
  // не потрапляє прихований рядок у чужих сусідів. Ліміт — уся таблиця, щоб
  // відповідь сягала Кіпру, куди б він не лежав.
  if (raw.nearestPublishedSlug) {
    await guard('spots.nearby(published)', true, async (e) => {
      const r = await spots.nearby(raw.nearestPublishedSlug, 1_000_000);
      seen(e, `nearby(${raw.nearestPublishedSlug}, усе)`, r, r.length);
    });
  }

  // ── Мапа в межах, де лежать приховані рядки ────────────────────────
  if (raw.bbox) {
    // 🔴 Острів: у цих межах опублікованих рядків може бути нуль, і тоді
    // чесна відповідь порожня. Знаменником тут слугують ПРИХОВАНІ рядки,
    // що лежать у межах і мали б з'явитись, будь фільтр забутий
    // (`raw.hiddenLive`), а не довжина відповіді.
    await guard('map.points', false, async (e) => {
      const r = await map.points(raw.bbox, undefined, 1_000_000);
      seen(e, 'points()', r, r.markers.length + raw.hiddenLive);
      if (r.markers.length !== raw.publishedInBox) {
        e.problems.push(
          `points() дав ${r.markers.length} маркерів, база має ` +
            `${raw.publishedInBox} опублікованих у цих межах`,
        );
      }
    });
    await guard('map.clusters', false, async (e) => {
      const r = await map.clusters(raw.bbox);
      const total = r.reduce((n, c) => n + Number(c.count), 0);
      seen(e, 'clusters()', r, total + raw.hiddenLive);
      // Кластер із кількох рядків країни не називає, тож рахуємо суму.
      if (total !== raw.publishedInBox) {
        e.problems.push(
          `clusters() дав ${total} рядків, база має ${raw.publishedInBox} ` +
            `опублікованих у цих межах`,
        );
      }
    });
  }

  // ── Планувальник і маршрут: теж віддають кемпінги читачеві ─────────
  if (raw.centre) {
    await guard('planner.selectLocated', false, async (e) => {
      const r = await planner(raw.centre);
      seen(e, 'selectLocated()', r, r.length + raw.hiddenLive);
    });
    await guard('routes.near', false, async (e) => {
      const r = await routes.near([raw.centre], 50, 200_000);
      const rows = r.groups.reduce((n, g) => n + g.spots.length, 0);
      seen(e, 'near()', r, rows + raw.hiddenLive);
    });
  }

  return { entries, hidden: raw.hiddenRows.length };
}

/** Вирок: { code, lines }. 2 — не зміг перевірити, 1 — знайшов, 0 — чисто. */
export function judge(report, codes) {
  const lines = [];
  let calls = 0;
  let rows = 0;
  const problems = [];
  const empty = [];
  for (const [name, e] of report.entries) {
    calls += e.calls;
    rows += e.rows;
    for (const p of e.problems) problems.push(`${name}: ${p}`);
    if (e.mustReturnRows && e.rows === 0) empty.push(name);
  }
  const header =
    `перевірено рядків у відповідях: ${rows}; точок входу опитано: ` +
    `${report.entries.size} (викликів ${calls}); прихованих рядків у базі: ` +
    `${report.hidden}; коди: ${codes.join(', ')}`;
  lines.push(header);
  for (const [name, e] of report.entries) {
    lines.push(
      `  ${e.problems.length ? '✗' : '✓'} ${name}: викликів ${e.calls}, ` +
        `рядків ${e.rows}${e.problems.length ? `, проблем ${e.problems.length}` : ''}`,
    );
  }
  if (report.hidden === 0) {
    lines.push(
      '✗ у базі немає жодного рядка з прихованих країн: фільтру нічого ' +
        'фільтрувати, і «чисто» нічого б не означало. Вихід 2.',
    );
    return { code: 2, lines };
  }
  if (problems.length) {
    for (const p of problems.slice(0, 40)) lines.push(`✗ ${p}`);
    if (problems.length > 40) lines.push(`… ще ${problems.length - 40}`);
    lines.push(`✗ приховану країну віддають: проблем ${problems.length}`);
    return { code: 1, lines };
  }
  if (empty.length || rows === 0) {
    lines.push(
      `✗ порожня вибірка: ${empty.join(', ') || 'усе'} не повернуло рядків. ` +
        'Це збій бази або запиту, а не «чисто». Вихід 2.',
    );
    return { code: 2, lines };
  }
  lines.push(`✓ жоден код із переліку (${codes.join(', ')}) не знайдено у ${rows} рядках`);
  return { code: 0, lines };
}

// ─────────────────────────────────────────────────────────────────────
// Живий прогін.
// ─────────────────────────────────────────────────────────────────────

function freshness(dist, files) {
  const stale = [];
  for (const f of files) {
    const src = join(API, 'src', f);
    const out = join(dist, f.replace(/\.ts$/, '.js'));
    let s;
    let o;
    try {
      s = statSync(src).mtimeMs;
      o = statSync(out).mtimeMs;
    } catch {
      stale.push(`${f} (немає в dist)`);
      continue;
    }
    if (s > o) stale.push(f);
  }
  return stale;
}

async function live() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Немає DATABASE_URL. Без неї питати нікого, і «чисто» означало б ' +
        'лише те, що я нікуди не ходив.\n' +
        'Запускати з теки, де лежить .env: ' +
        'cd apps/api && node -r dotenv/config ../../scripts/ci/check-unpublished-countries.mjs',
    );
    return 2;
  }
  const dist = join(API, 'dist');
  const watched = [
    'spots/unpublished-countries.ts',
    'spots/spots.service.ts',
    'spots/map.service.ts',
    'spots/detail-query.ts',
    'spots/hub-stats.ts',
    'spots/region-insights.ts',
    'spots/region-listing.ts',
    'routes/routes.service.ts',
    'planner/hard-constraints.ts',
    'planner/shortlist.ts',
  ];
  const stale = freshness(dist, watched);
  if (stale.length) {
    console.error(
      `apps/api/dist старіший за вихідники або порожній: ${stale.join(', ')}.\n` +
        'Збери: cd apps/api && npx nest build. Інакше сторож питав би вчорашній код.',
    );
    return 2;
  }

  const require = createRequire(join(API, 'package.json'));
  const { default: pg } = await import('pg');
  const unpublished = require(join(dist, 'spots', 'unpublished-countries.js'));
  const { SpotsService, slugifyRegion } = require(
    join(dist, 'spots', 'spots.service.js'),
  );
  const { MapQueryService, regionChunkSlug } = require(
    join(dist, 'spots', 'map.service.js'),
  );
  const { selectLocated } = require(join(dist, 'planner', 'shortlist.js'));
  const { RoutesService } = require(join(dist, 'routes', 'routes.service.js'));
  const { notSecondarySql } = require(join(dist, 'spots', 'links.js'));
  const codes = [...unpublished.UNPUBLISHED_COUNTRIES];

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    // TypeORM-подібна обгортка: сервіси чекають рядки, а не { rows }.
    const db = { query: async (sql, params) => (await pool.query(sql, params)).rows };

    const hidden = (
      await pool.query(
        `SELECT slug, lower(country) AS country, region
           FROM camping_spots WHERE lower(country) = ANY($1::text[])
          ORDER BY slug`,
        [codes],
      )
    ).rows;

    const raw = {
      hiddenRows: hidden,
      bbox: null,
      publishedInBox: 0,
      hiddenLive: 0,
      nearestPublishedSlug: null,
      centre: null,
    };

    // Межі, де лежать приховані рядки, що були б видимі (живі, не вторинні).
    const [b] = (
      await pool.query(
        `SELECT min(ST_X(location::geometry)) AS "minLon",
                min(ST_Y(location::geometry)) AS "minLat",
                max(ST_X(location::geometry)) AS "maxLon",
                max(ST_Y(location::geometry)) AS "maxLat",
                count(*)::int AS n
           FROM camping_spots s
          WHERE lower(country) = ANY($1::text[])
            AND missing_since IS NULL AND ${notSecondarySql('s')}`,
        [codes],
      )
    ).rows;
    raw.hiddenLive = b.n;
    if (b.n > 0) {
      const M = 0.5;
      raw.bbox = {
        minLon: b.minLon - M,
        minLat: b.minLat - M,
        maxLon: b.maxLon + M,
        maxLat: b.maxLat + M,
      };
      raw.centre = { lon: (b.minLon + b.maxLon) / 2, lat: (b.minLat + b.maxLat) / 2 };
      const box = [raw.bbox.minLon, raw.bbox.minLat, raw.bbox.maxLon, raw.bbox.maxLat];
      raw.publishedInBox = (
        await pool.query(
          `SELECT count(*)::int AS n FROM camping_spots s
            WHERE missing_since IS NULL AND ${notSecondarySql('s')}
              AND lower(country) <> ALL($5::text[])
              AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)`,
          [...box, codes],
        )
      ).rows[0].n;
      raw.nearestPublishedSlug =
        (
          await pool.query(
            `SELECT s.slug FROM camping_spots s
              WHERE missing_since IS NULL AND region IS NOT NULL
                AND ${notSecondarySql('s')}
                AND lower(country) <> ALL($1::text[])
              ORDER BY s.location <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)
              LIMIT 1`,
            [codes, raw.centre.lon, raw.centre.lat],
          )
        ).rows[0]?.slug ?? null;
    }

    const spots = new SpotsService(db);
    const map = new MapQueryService(db);
    const routes = new RoutesService(db);
    const report = await interrogate({
      spots,
      map,
      routes,
      planner: (c) =>
        selectLocated(pool, { line: [[c.lon, c.lat]], bufferM: 300_000 }),
      raw,
      codes,
      slugifyRegion,
      regionChunkSlug,
    });
    const verdict = judge(report, codes);
    for (const l of verdict.lines) console.log(l);
    return verdict.code;
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Самотест: сторож, який ніколи не червонів, нічого не стереже.
//
// Підробка вміє відповідати чисто й вміє «забути фільтр» у КОЖНІЙ точці
// входу окремо. Тест вимагає, щоб чиста відповідь дала 0, а кожне забуття
// дало 1 і назвало саме ту точку. Проганяється справжній `interrogate`,
// не окрема копія його логіки.
// ─────────────────────────────────────────────────────────────────────

class NotFoundException extends Error {
  constructor(body) {
    super('Not Found');
    this.name = 'NotFoundException';
    this.body = body;
  }
  getResponse() {
    return this.body;
  }
}

const SELF_CODES = ['cy'];

function fakeEnv(leakAt, { hidden = 2 } = {}) {
  const leak = (name) => leakAt === name;
  const clean = [
    { country: 'de', spots: 10, regions: 3 },
    { country: 'fr', spots: 10, regions: 3 },
  ];
  const cy = { country: 'cy', spots: 5, regions: 1 };
  const hiddenRows = Array.from({ length: hidden }, (_, i) => ({
    slug: `cy-${i}`,
    country: 'cy',
    region: i === 0 ? 'Limassol' : null,
  }));
  const spots = {
    countries: async () => (leak('spots.countries') ? [...clean, cy] : clean),
    allPublishable: async () => [
      { country: 'de', region: 'a', slug: 'x' },
      ...(leak('spots.allPublishable')
        ? [{ country: 'cy', region: 'a', slug: 'y' }]
        : []),
    ],
    searchDocuments: async () => [
      { country: 'de', slug: 'x' },
      ...(leak('spots.searchDocuments') ? [{ country: 'cy', slug: 'y' }] : []),
    ],
    notable: async () => [
      { country: 'de', slug: 'x' },
      ...(leak('spots.notable') ? [{ country: 'cy', slug: 'y' }] : []),
    ],
    summary: async () => ({
      spots: 20 + (leak('spots.summary') ? 5 : 0),
      countries: 2,
      regions: 6,
    }),
    regions: async (c) =>
      c === 'cy'
        ? leak('spots.regions(hidden)')
          ? [{ region: 'Limassol', slug: 'limassol' }]
          : []
        : [{}, {}, {}],
    hubStats: async (c) =>
      c === 'cy' && leak('spots.hubStats(hidden)') ? [{ region: 'x' }] : [],
    regionSpots: async () =>
      leak('spots.regionSpots(hidden)')
        ? { region: 'Limassol', total: 3, items: [{ slug: 'a' }] }
        : { region: null, total: 0, items: [] },
    regionInsights: async () =>
      leak('spots.regionInsights(hidden)') ? { spots: 3 } : null,
    findBySlug: async (c, r, s) => {
      if (leak('spots.findBySlug(hidden)')) return { country: 'CY', slug: s };
      if (leak('spots.findBySlug(hidden)#canonical')) {
        throw new NotFoundException({ canonical: '/camping/cy/limassol/a' });
      }
      throw new NotFoundException({ message: 'No campsite' });
    },
    nearby: async (slug) => {
      if (slug.startsWith('cy-')) {
        return leak('spots.nearby(hidden)') ? [{ slug: 'g', country: 'gr' }] : [];
      }
      return [
        { slug: 'g', country: 'gr' },
        ...(leak('spots.nearby(published)')
          ? [{ slug: 'cy-9', country: 'cy' }]
          : []),
      ];
    },
  };
  const map = {
    regions: async () => [
      { country: 'de', region: 'a', count: 3 },
      ...(leak('map.regions') ? [{ country: 'cy', region: null, count: 2 }] : []),
    ],
    regionMarkers: async () =>
      leak('map.regionMarkers(hidden)') ? [{ country: 'cy', slug: 'z' }] : [],
    points: async () => ({
      markers: [
        ...Array.from({ length: 7 }, (_, i) => ({ country: 'gr', slug: `m${i}` })),
        ...(leak('map.points') ? [{ country: 'cy', slug: 'm9' }] : []),
      ],
      truncated: false,
      unknownExcluded: 0,
    }),
    clusters: async () => [
      { count: 4, lat: 1, lon: 1 },
      { count: 3 + (leak('map.clusters') ? 5 : 0), lat: 2, lon: 2 },
    ],
  };
  const planner = async () => [
    { slug: 'p', country: 'gr' },
    ...(leak('planner.selectLocated') ? [{ slug: 'q', country: 'cy' }] : []),
  ];
  const routes = {
    near: async () => ({
      groups: [
        {
          spots: [
            { country: 'gr', slug: 'r' },
            ...(leak('routes.near') ? [{ country: 'cy', slug: 's' }] : []),
          ],
        },
      ],
    }),
  };
  return {
    spots,
    map,
    planner,
    routes,
    raw: {
      hiddenRows,
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      publishedInBox: 7,
      hiddenLive: 3,
      nearestPublishedSlug: 'g',
      centre: { lon: 0, lat: 0 },
    },
    codes: SELF_CODES,
    slugifyRegion: (r) => r.toLowerCase(),
    regionChunkSlug: (r) => (r === null ? '_unplaced' : r.toLowerCase()),
  };
}

const LEAK_POINTS = [
  'spots.countries',
  'spots.allPublishable',
  'spots.searchDocuments',
  'spots.notable',
  'spots.summary',
  'spots.regions(hidden)',
  'spots.hubStats(hidden)',
  'spots.regionSpots(hidden)',
  'spots.regionInsights(hidden)',
  'spots.findBySlug(hidden)',
  'spots.findBySlug(hidden)#canonical',
  'spots.nearby(hidden)',
  'spots.nearby(published)',
  'map.regions',
  'map.regionMarkers(hidden)',
  'map.points',
  'map.clusters',
  'planner.selectLocated',
  'routes.near',
];

async function selfTest() {
  let failed = 0;
  let cases = 0;
  const check = (label, ok, detail = '') => {
    cases += 1;
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : ` — ${detail}`}`);
  };

  // 1. Чиста відповідь: 0, і знаменник ненульовий.
  {
    const r = await interrogate(fakeEnv(null));
    const v = judge(r, SELF_CODES);
    check('чисті відповіді → вихід 0', v.code === 0, `вийшло ${v.code}`);
    check(
      'знаменник надруковано',
      /перевірено рядків у відповідях: [1-9]\d*; точок входу опитано: [1-9]\d*/.test(
        v.lines[0],
      ),
      v.lines[0],
    );
  }

  // 2. Кожне забуття фільтру в кожній точці окремо → 1 і ім'я точки.
  for (const point of LEAK_POINTS) {
    const r = await interrogate(fakeEnv(point));
    const v = judge(r, SELF_CODES);
    const base = point.replace(/#.*/, '');
    check(
      `забутий фільтр у ${point} → вихід 1`,
      v.code === 1 && v.lines.some((l) => l.startsWith('✗ ') && l.includes(base)),
      `вихід ${v.code}`,
    );
  }

  // 3. У базі немає прихованих рядків → 2, а не «чисто».
  {
    const r = await interrogate(fakeEnv(null, { hidden: 0 }));
    const v = judge(r, SELF_CODES);
    check('жодного прихованого рядка → вихід 2', v.code === 2, `вийшло ${v.code}`);
  }

  // 4. Порожня відповідь списку → 2, а не «чисто».
  {
    const env = fakeEnv(null);
    env.spots.countries = async () => [];
    env.spots.summary = async () => ({ spots: 0, countries: 0, regions: 0 });
    const v = judge(await interrogate(env), SELF_CODES);
    check('порожній перелік країн → не 0', v.code !== 0, `вийшло ${v.code}`);
  }

  // 5. Самі читачі відповіді: регістр, адреса, глибина.
  check(
    'CY у верхньому регістрі впізнано',
    leaksIn({ a: [{ country: 'CY' }] }, SELF_CODES).length === 1,
  );
  check(
    'адреса /camping/cy/… впізнана',
    leaksIn({ canonical: '/camping/cy/a/b' }, SELF_CODES).length === 1,
  );
  check(
    'адреса чужої країни не плутається',
    leaksIn({ canonical: '/camping/cz/a/b', country: 'cz' }, SELF_CODES).length === 0,
  );

  console.log(
    failed === 0
      ? `✓ check-unpublished-countries self-test: ${cases} випадків, кожна точка входу вміє червоніти`
      : `✗ check-unpublished-countries self-test: ${failed} випадків не вдалось`,
  );
  return failed === 0 ? 0 : 1;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test'],
    'check-unpublished-countries.mjs',
  );
  const code = action.has('--self-test') ? await selfTest() : await live();
  process.exit(code);
}
